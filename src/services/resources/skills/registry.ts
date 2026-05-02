/**
 * Skill 注册表（有状态、带热载）
 *
 * 职责：
 *   1. 启动时扫描 project + user 两层 skills 目录，构建内存索引
 *   2. 提供 CRUD（list / get / create / update / delete / toggle）
 *   3. 通过 chokidar 监听两层目录的变更，去抖 200ms 后增量重载并 emit resource:changed
 *   4. 暴露 listSkillSlashCommands() 供 chat-meta 列入 / 命令补全
 *
 * 覆盖语义：项目级与用户级同名时，项目级 wins；两个版本都保留在 records 中，
 *   getSkill(name) 默认返回 winning（project），getSkill(name, 'user') 可显式取被遮蔽的那份。
 */

import path from 'node:path';
import fs from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';

import {
  assertValidResourceName,
  ensureResourceDir,
  getResourceDir,
  getResourceDirs,
} from '../paths.js';
import { emitResourceChange } from '../events.js';
import type { ResourceScope } from '../types.js';
import {
  parseSkillDir,
  scanSkillsInScope,
  serializeSkillMarkdown,
  type ParsedSkill,
  type SkillFrontmatter,
  type SkillLoadError,
} from './loader.js';

/** 内部记录：可能是已加载的 skill，或加载失败的占位。 */
type SkillRecord =
  | { kind: 'ok'; skill: ParsedSkill }
  | { kind: 'error'; error: SkillLoadError };

/** 公开的 skill 摘要（list 用），不含完整 markdown，避免大量 IO。 */
export interface SkillSummary {
  name: string;
  scope: ResourceScope;
  status: 'loaded' | 'disabled' | 'error';
  description?: string;
  version?: string;
  enabled: boolean;
  allowedTools?: string[];
  /** 被同名项目级 skill 遮蔽时为 true（仅 user 层条目可能为 true）。 */
  shadowed: boolean;
  error?: string;
  lastReloadAt?: string;
  scriptsCount: number;
  assetsCount: number;
}

/** Slash 命令补全条目。 */
export interface SkillSlashCommand {
  /** 形如 "/skill:my-skill"，前端按字面拼接展示。 */
  command: string;
  description: string;
  /** 触发后注入到对话的内容（SKILL.md 正文，可能含 frontmatter 提示）。 */
  payload: string;
  /** 来源 skill 名，便于点击跳转编辑。 */
  skill: string;
  scope: ResourceScope;
}

/** 热载去抖窗口（毫秒）。 */
const DEBOUNCE_MS = 200;

class SkillRegistry {
  /** key = `${scope}:${name}`，避免 project/user 同名互相覆盖记录。 */
  private records = new Map<string, SkillRecord>();
  private watchers: FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  private lastReloadAt: string | undefined;

  /** 启动：确保目录存在、首次扫描、启动 watcher。多次调用幂等。 */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    ensureResourceDir('skill', 'project');
    // user 目录不主动创建——避免污染 HOME；watcher 会容忍不存在。

    this.fullReload('init');
    this.startWatchers();
  }

  /** 关闭 watcher、清空缓存。 */
  async dispose(): Promise<void> {
    if (!this.initialized) return;
    this.initialized = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
    this.records.clear();
  }

  /** 全量重载（启动、手动 reload、目录批量变更时使用）。 */
  fullReload(_reason: string): void {
    const newMap = new Map<string, SkillRecord>();
    for (const scope of ['user', 'project'] as ResourceScope[]) {
      // 顺序：先 user 后 project，便于人工调试时观察日志；映射 key 含 scope 互不干扰。
      const dir = getResourceDir('skill', scope);
      const { skills, errors } = scanSkillsInScope(dir, scope);
      for (const s of skills) newMap.set(`${scope}:${s.name}`, { kind: 'ok', skill: s });
      for (const e of errors) {
        // 扫描失败（根目录读失败）时 name 可能是 <scan>；用稳定 key 防覆盖
        const key = e.name === '<scan>' ? `${scope}:<scan>` : `${scope}:${e.name}`;
        newMap.set(key, { kind: 'error', error: e });
      }
    }
    this.records = newMap;
    this.lastReloadAt = new Date().toISOString();
    emitResourceChange('skill', 'reload');
  }

  /** 启动文件监听。两层目录都监听；不存在的目录会被 chokidar 忍受。 */
  private startWatchers(): void {
    const { project, user } = getResourceDirs('skill');
    for (const dir of [project, user]) {
      const watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        depth: 3, // skill 目录 + 子目录（scripts/assets）足够
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });
      const trigger = (filePath: string) => {
        // 仅当变更落在 SKILL.md 或者 skill 顶层目录时触发；其它（脚本/附件）也触发
        // 但用去抖合并成一次 reload。
        void filePath;
        this.scheduleReload();
      };
      watcher
        .on('add', trigger)
        .on('change', trigger)
        .on('unlink', trigger)
        .on('addDir', trigger)
        .on('unlinkDir', trigger)
        .on('error', (err) => {
          // eslint-disable-next-line no-console
          console.warn('[Skills] watcher error:', err);
        });
      this.watchers.push(watcher);
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.fullReload('watch');
    }, DEBOUNCE_MS);
  }

  /** 列出所有 skill 摘要（含 user 被遮蔽的那一份）。 */
  list(): SkillSummary[] {
    const summaries: SkillSummary[] = [];
    // 找出项目级 name 集合，用于判定 user 是否被 shadow
    const projectNames = new Set<string>();
    for (const [, rec] of this.records) {
      if (rec.kind === 'ok' && rec.skill.scope === 'project') {
        projectNames.add(rec.skill.name);
      }
    }
    for (const [, rec] of this.records) {
      if (rec.kind === 'ok') {
        const s = rec.skill;
        const shadowed = s.scope === 'user' && projectNames.has(s.name);
        const status: SkillSummary['status'] = !s.frontmatter.enabled ? 'disabled' : 'loaded';
        summaries.push({
          name: s.name,
          scope: s.scope,
          status,
          description: s.frontmatter.description,
          version: s.frontmatter.version,
          enabled: s.frontmatter.enabled,
          allowedTools: s.frontmatter.allowedTools,
          shadowed,
          lastReloadAt: this.lastReloadAt,
          scriptsCount: s.scripts.length,
          assetsCount: s.assets.length,
        });
      } else {
        summaries.push({
          name: rec.error.name,
          scope: rec.error.scope,
          status: 'error',
          enabled: false,
          shadowed: false,
          error: rec.error.message,
          lastReloadAt: this.lastReloadAt,
          scriptsCount: 0,
          assetsCount: 0,
        });
      }
    }
    // 排序：project 在前，name 升序
    summaries.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return summaries;
  }

  /**
   * 获取单个 skill 的完整内容。
   * 不指定 scope 时返回 winning 版本（project 优先），便于编辑器载入。
   */
  get(name: string, scope?: ResourceScope): ParsedSkill | null {
    if (scope) {
      const rec = this.records.get(`${scope}:${name}`);
      return rec && rec.kind === 'ok' ? rec.skill : null;
    }
    const proj = this.records.get(`project:${name}`);
    if (proj && proj.kind === 'ok') return proj.skill;
    const user = this.records.get(`user:${name}`);
    if (user && user.kind === 'ok') return user.skill;
    return null;
  }

  /**
   * 创建新 skill。
   * 默认写到 project；若同名已存在于该 scope 抛错。
   */
  create(input: {
    name: string;
    scope?: ResourceScope;
    frontmatter: Omit<SkillFrontmatter, 'name' | 'extra'> & { extra?: Record<string, unknown> };
    body: string;
  }): ParsedSkill {
    const scope = input.scope ?? 'project';
    assertValidResourceName(input.name);

    const dir = path.join(getResourceDir('skill', scope), input.name);
    if (fs.existsSync(dir)) {
      throw new Error(`skill 已存在: ${input.name} (scope=${scope})`);
    }

    ensureResourceDir('skill', scope);
    fs.mkdirSync(dir, { recursive: true });

    const fm: SkillFrontmatter = {
      name: input.name,
      description: input.frontmatter.description,
      version: input.frontmatter.version,
      allowedTools: input.frontmatter.allowedTools,
      enabled: input.frontmatter.enabled ?? true,
      extra: input.frontmatter.extra ?? {},
    };
    const md = serializeSkillMarkdown(fm, input.body);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), md, 'utf-8');

    // 立即同步内存（不等 watcher）
    const result = parseSkillDir(dir, scope, input.name);
    if (result.ok) {
      this.records.set(`${scope}:${input.name}`, { kind: 'ok', skill: result.skill });
      this.lastReloadAt = new Date().toISOString();
      emitResourceChange('skill', 'add', { name: input.name, scope });
      return result.skill;
    }
    throw new Error(`skill 创建后解析失败: ${result.error.message}`);
  }

  /**
   * 更新 skill：直接覆盖 SKILL.md。
   * 若 scope 未指定，按 project>user 顺序定位现有版本。
   */
  update(input: {
    name: string;
    scope?: ResourceScope;
    frontmatter: Partial<Omit<SkillFrontmatter, 'name' | 'extra'>> & {
      extra?: Record<string, unknown>;
    };
    body?: string;
  }): ParsedSkill {
    const existing = input.scope
      ? this.get(input.name, input.scope)
      : this.get(input.name);
    if (!existing) throw new Error(`skill 不存在: ${input.name}`);

    const merged: SkillFrontmatter = {
      name: existing.frontmatter.name,
      description: input.frontmatter.description ?? existing.frontmatter.description,
      version:
        input.frontmatter.version !== undefined
          ? input.frontmatter.version
          : existing.frontmatter.version,
      allowedTools:
        input.frontmatter.allowedTools !== undefined
          ? input.frontmatter.allowedTools
          : existing.frontmatter.allowedTools,
      enabled:
        input.frontmatter.enabled !== undefined
          ? input.frontmatter.enabled
          : existing.frontmatter.enabled,
      extra: input.frontmatter.extra ?? existing.frontmatter.extra,
    };

    const body = input.body ?? existing.body;
    const md = serializeSkillMarkdown(merged, body);
    fs.writeFileSync(existing.filePath, md, 'utf-8');

    const result = parseSkillDir(existing.dir, existing.scope, existing.name);
    if (!result.ok) throw new Error(`skill 更新后解析失败: ${result.error.message}`);

    this.records.set(`${existing.scope}:${existing.name}`, {
      kind: 'ok',
      skill: result.skill,
    });
    this.lastReloadAt = new Date().toISOString();
    emitResourceChange('skill', 'update', { name: existing.name, scope: existing.scope });
    return result.skill;
  }

  /** 删除 skill 目录。 */
  delete(name: string, scope?: ResourceScope): void {
    const target = scope ? this.get(name, scope) : this.get(name);
    if (!target) throw new Error(`skill 不存在: ${name}`);
    fs.rmSync(target.dir, { recursive: true, force: true });
    this.records.delete(`${target.scope}:${target.name}`);
    this.lastReloadAt = new Date().toISOString();
    emitResourceChange('skill', 'remove', { name: target.name, scope: target.scope });
  }

  /** 启用 / 禁用：改写 frontmatter.enabled。 */
  toggle(name: string, enabled: boolean, scope?: ResourceScope): ParsedSkill {
    return this.update({
      name,
      scope,
      frontmatter: { enabled },
    });
  }

  /** 暴露给 chat-meta 的 slash 命令清单（仅 enabled 且 winning 版本）。 */
  listSlashCommands(): SkillSlashCommand[] {
    const cmds: SkillSlashCommand[] = [];
    const seen = new Set<string>();
    // 先 project，后 user；同名 user 被跳过实现 shadow 语义
    for (const scope of ['project', 'user'] as ResourceScope[]) {
      for (const [, rec] of this.records) {
        if (rec.kind !== 'ok') continue;
        if (rec.skill.scope !== scope) continue;
        if (!rec.skill.frontmatter.enabled) continue;
        if (seen.has(rec.skill.name)) continue;
        seen.add(rec.skill.name);
        cmds.push({
          command: `/skill:${rec.skill.name}`,
          description: rec.skill.frontmatter.description,
          payload: rec.skill.body,
          skill: rec.skill.name,
          scope: rec.skill.scope,
        });
      }
    }
    cmds.sort((a, b) => a.command.localeCompare(b.command));
    return cmds;
  }

  /** 测试用：判断是否已 init。 */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/** 单例实例。所有模块共享同一份 registry。 */
export const skillRegistry = new SkillRegistry();
