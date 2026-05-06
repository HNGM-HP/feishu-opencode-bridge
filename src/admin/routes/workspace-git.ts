import express from 'express';
import { simpleGit } from 'simple-git';
import type { Response } from 'express';
import { getWorkspaceDirectoryInput, resolveWorkspaceDirectory } from './workspace-utils.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unknown error';
}

function isUntracked(index: string, workingTree: string): boolean {
  return index === '?' || workingTree === '?';
}

function isConflicted(index: string, workingTree: string): boolean {
  return index === 'U' || workingTree === 'U' || (index === 'A' && workingTree === 'A');
}

function sendGitError(res: Response, error: unknown, fallbackMessage: string): void {
  const message = errorMessage(error);
  console.error(`[Workspace Git] ${fallbackMessage}:`, error);
  res.status(502).json({ error: message || fallbackMessage });
}

function isNoCommitsError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('does not have any commits yet')
    || (message.includes('unknown revision') && message.includes('head'))
    || (message.includes('bad revision') && message.includes('head'))
    || (message.includes('ambiguous argument') && message.includes('head'));
}

async function ensureGitRepo(git: ReturnType<typeof simpleGit>, res: Response): Promise<boolean> {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    res.status(409).json({ error: '当前目录不是 Git 仓库。' });
    return false;
  }
  return true;
}

async function validateBranchName(git: ReturnType<typeof simpleGit>, branch: string): Promise<void> {
  await git.raw(['check-ref-format', '--branch', branch]);
}

async function ensureCleanWorktree(git: ReturnType<typeof simpleGit>): Promise<void> {
  const status = await git.status();
  if (status.files.length > 0) {
    throw new Error('当前工作区有未提交变更，请先提交、暂存或清理后再切换。');
  }
}

export function registerWorkspaceGitRoutes(api: express.Router): void {
  api.post('/workspace/git/init', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      await git.init();
      res.json({ ok: true });
    } catch (error) {
      sendGitError(res, error, '初始化 Git 仓库失败');
    }
  });

  api.get('/workspace/git/status', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      const [status, branches, repositoryRoot, latestCommit] = await Promise.all([
        git.status(),
        git.branchLocal(),
        git.revparse(['--show-toplevel']),
        git.log({ maxCount: 1 })
          .then(log => {
            if (!log.latest) {
              return undefined;
            }

            return {
              hash: log.latest.hash,
              message: log.latest.message,
              authorName: log.latest.author_name,
              date: log.latest.date,
            };
          })
          .catch(error => {
            if (isNoCommitsError(error)) {
              return undefined;
            }
            throw error;
          }),
      ]);

      const files = status.files.map(file => {
        const index = file.index ?? ' ';
        const workingTree = file.working_dir ?? ' ';
        const untracked = isUntracked(index, workingTree);
        const conflicted = isConflicted(index, workingTree);
        const staged = !untracked && index.trim().length > 0 && !conflicted;
        const modified = !untracked && workingTree.trim().length > 0 && !conflicted;

        return {
          path: file.path,
          index,
          workingTree,
          staged,
          modified,
          untracked,
          conflicted,
        };
      });

      const currentBranch = status.current || branches.current || 'HEAD';
      const branchNames = branches.all.includes(currentBranch) || currentBranch === 'HEAD'
        ? branches.all
        : [currentBranch, ...branches.all];

      res.json({
        directory: resolvedDirectory.directory,
        repositoryRoot: repositoryRoot.trim() || resolvedDirectory.directory,
        branch: currentBranch,
        tracking: status.tracking || undefined,
        ahead: status.ahead ?? 0,
        behind: status.behind ?? 0,
        clean: files.length === 0,
        detached: Boolean(status.detached),
        branches: branchNames,
        counts: {
          staged: files.filter(file => file.staged).length,
          modified: files.filter(file => file.modified).length,
          untracked: files.filter(file => file.untracked).length,
          conflicted: files.filter(file => file.conflicted).length,
        },
        files,
        lastCommit: latestCommit,
      });
    } catch (error) {
      sendGitError(res, error, '获取 Git 状态失败');
    }
  });

  api.get('/workspace/git/diff', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    const filePath = typeof req.query.filePath === 'string' && req.query.filePath.trim()
      ? req.query.filePath.trim()
      : undefined;
    const staged = req.query.staged === 'true';

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      const args: string[] = [];
      if (staged) {
        args.push('--cached');
      }
      if (filePath) {
        args.push('--', filePath);
      }

      const diff = await git.diff(args);
      res.json({
        directory: resolvedDirectory.directory,
        filePath,
        staged,
        diff,
      });
    } catch (error) {
      sendGitError(res, error, '获取 Git diff 失败');
    }
  });

  api.post('/workspace/git/commit', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: '缺少 commit message。' });
      return;
    }

    // files: optional array of file paths to stage; if omitted, stages all changes
    const rawFiles = req.body?.files;
    const files: string[] | null = Array.isArray(rawFiles) && rawFiles.length > 0
      ? rawFiles.filter((f: unknown): f is string => typeof f === 'string' && f.trim().length > 0).map((f: string) => f.trim())
      : null;

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      if (files && files.length > 0) {
        await git.add(files);
      } else {
        await git.add(['-A']);
      }
      const result = await git.commit(message);

      res.json({
        ok: true,
        commit: {
          hash: result.commit,
          branch: result.branch,
          summary: result.summary,
        },
      });
    } catch (error) {
      sendGitError(res, error, '提交变更失败');
    }
  });

  api.post('/workspace/git/pull', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      const result = await git.pull();
      res.json({ ok: true, result });
    } catch (error) {
      sendGitError(res, error, '拉取远端变更失败');
    }
  });

  api.post('/workspace/git/push', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      const result = await git.push();
      res.json({ ok: true, result });
    } catch (error) {
      sendGitError(res, error, '推送远端失败');
    }
  });

  api.post('/workspace/git/checkout', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
    const ref = typeof req.body?.ref === 'string' ? req.body.ref.trim() : '';
    const target = branch || ref;
    const detach = req.body?.detach === true;

    if (!target) {
      res.status(400).json({ error: '缺少 branch/ref。' });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      await ensureCleanWorktree(git);

      if (detach) {
        await git.checkout(['--detach', target]);
        res.json({ ok: true, ref: target, detached: true });
        return;
      }

      const branches = await git.branchLocal();
      if (!branches.all.includes(target)) {
        res.status(404).json({ error: `分支不存在: ${target}` });
        return;
      }

      await git.checkout(target);
      res.json({ ok: true, branch: target, detached: false });
    } catch (error) {
      sendGitError(res, error, '切换分支失败');
    }
  });

  api.post('/workspace/git/branch/create', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
    const switchAfterCreate = req.body?.switchAfterCreate !== false;
    if (!branch) {
      res.status(400).json({ error: '缺少 branch。' });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      await validateBranchName(git, branch);

      const branches = await git.branchLocal();
      if (branches.all.includes(branch)) {
        res.status(409).json({ error: `分支已存在: ${branch}` });
        return;
      }

      if (switchAfterCreate) {
        await git.checkoutLocalBranch(branch);
      } else {
        await git.raw(['branch', branch]);
      }

      res.json({
        ok: true,
        branch,
        switched: switchAfterCreate,
      });
    } catch (error) {
      sendGitError(res, error, '创建分支失败');
    }
  });

  api.get('/workspace/git/log', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 30;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      let log;
      try {
        log = await git.log({ maxCount: limit });
      } catch (error) {
        if (isNoCommitsError(error)) {
          res.json({ entries: [] });
          return;
        }
        throw error;
      }

      res.json({
        entries: log.all.map(entry => ({
          sha: entry.hash,
          message: entry.message,
          authorName: entry.author_name,
          authorEmail: entry.author_email,
          date: entry.date,
        })),
      });
    } catch (error) {
      sendGitError(res, error, '获取历史版本失败');
    }
  });

  api.get('/workspace/git/log/detail', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    const sha = typeof req.query.sha === 'string' ? req.query.sha.trim() : '';
    if (!sha) {
      res.status(400).json({ error: '缺少 sha。' });
      return;
    }

    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      res.status(400).json({ error: '非法 commit sha。' });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      const format = '%H%n%an%n%ae%n%aI%n%s';
      const [metaOutput, statsOutput, diffOutput] = await Promise.all([
        git.raw(['show', '-s', `--format=${format}`, sha]),
        git.show(['--no-patch', '--stat', '--format=', sha]),
        git.show(['--format=', '--patch', sha]),
      ]);

      const metaLines = metaOutput.trim().split('\n');
      res.json({
        sha: metaLines[0] || sha,
        authorName: metaLines[1] || '',
        authorEmail: metaLines[2] || '',
        date: metaLines[3] || '',
        message: metaLines.slice(4).join('\n').trim(),
        stats: statsOutput.trim(),
        diff: diffOutput,
      });
    } catch (error) {
      sendGitError(res, error, '获取历史版本详情失败');
    }
  });

  api.post('/workspace/git/branch/delete', async (req, res) => {
    const resolvedDirectory = resolveWorkspaceDirectory(getWorkspaceDirectoryInput(req));
    if (!resolvedDirectory.ok) {
      res.status(resolvedDirectory.status).json({ error: resolvedDirectory.error });
      return;
    }

    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
    if (!branch) {
      res.status(400).json({ error: '缺少 branch。' });
      return;
    }

    try {
      const git = simpleGit(resolvedDirectory.directory);
      if (!(await ensureGitRepo(git, res))) {
        return;
      }

      const branches = await git.branchLocal();
      if (!branches.all.includes(branch)) {
        res.status(404).json({ error: `分支不存在: ${branch}` });
        return;
      }

      if (branches.current === branch) {
        res.status(409).json({ error: '不能删除当前所在分支。请先切换到其它分支。' });
        return;
      }

      await git.deleteLocalBranch(branch, false);
      res.json({ ok: true, branch });
    } catch (error) {
      sendGitError(res, error, '删除分支失败');
    }
  });
}
