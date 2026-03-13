import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../src/reliability/scheduler.js';
import { RuntimeCronManager } from '../src/reliability/runtime-cron.js';

const loadCronControl = async () => {
  vi.resetModules();
  return await import('../src/reliability/cron-control.js');
};

describe('cron-control', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应解析 slash cron 子命令', async () => {
    const { parseCronSlashIntent } = await loadCronControl();

    const listIntent = parseCronSlashIntent('');
    expect(listIntent.action).toBe('list');

    const addIntent = parseCronSlashIntent('add --name demo --expr "0 */5 * * * *" --text "巡检"');
    expect(addIntent.action).toBe('add');
    expect(addIntent.argsText).toContain('--name demo');

    const naturalIntent = parseCronSlashIntent('添加个定时任务，每天早上8点向我发送一份AI简报');
    expect(naturalIntent.action).toBe('help');
    expect(naturalIntent.argsText).toContain('每天早上8点');
  });

  it('slash 自然语句应优先走语义解析回调', async () => {
    const { resolveCronIntentForExecution } = await loadCronControl();

    const resolved = await resolveCronIntentForExecution({
      source: 'slash',
      action: 'help',
      argsText: '添加个定时任务，每天早上8点向我发送一份AI简报',
      semanticParser: async () => ({
        action: 'add',
        source: 'slash',
        argsText: '--expr "0 0 8 * * *" --text "向我发送一份AI简报" --name "AI简报"',
      }),
    });

    expect(resolved.action).toBe('add');
    expect(resolved.argsText).toContain('0 0 8 * * *');
  });

  it('slash update 非结构化参数应走语义解析回调', async () => {
    const { resolveCronIntentForExecution } = await loadCronControl();

    const resolved = await resolveCronIntentForExecution({
      source: 'slash',
      action: 'update',
      argsText: '把任务 job-1 改成每天 10:30 发日报',
      semanticParser: async (_argsText, _source, actionHint) => {
        expect(actionHint).toBe('update');
        return {
          action: 'update',
          source: 'slash',
          argsText: '--id "job-1" --expr "0 30 10 * * *" --text "发日报"',
        };
      },
    });

    expect(resolved.action).toBe('update');
    expect(resolved.argsText).toContain('--id "job-1"');
  });

  it('应支持 slash “暂停任务 <id>”结构化解析', async () => {
    const { resolveCronIntentForExecution } = await loadCronControl();

    const resolved = await resolveCronIntentForExecution({
      source: 'slash',
      action: 'pause',
      argsText: 'job-1',
    });

    expect(resolved.action).toBe('pause');
    expect(resolved.argsText).toBe('job-1');
  });

  it('应支持执行 add/list/pause/remove', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-control-test-'));
    const jobsFile = path.join(root, 'jobs.json');
    const scheduler = new CronScheduler();
    const manager = new RuntimeCronManager({
      scheduler,
      filePath: jobsFile,
    });

    const { executeCronIntent, parseCronSlashIntent } = await loadCronControl();

    const addText = executeCronIntent({
      manager,
      intent: parseCronSlashIntent('add --name demo --expr "0 */10 * * * *" --text "执行巡检" --session current'),
      currentSessionId: 'session-1',
      currentConversationId: 'oc_test_chat',
      creatorId: 'user-1',
      platform: 'feishu',
    });
    expect(addText).toContain('创建成功');

    const jobs = manager.listJobs();
    expect(jobs.length).toBe(1);
    const jobId = jobs[0].id;
    expect(jobs[0].payload.sessionId).toBe('session-1');
    expect(jobs[0].payload.delivery).toEqual({
      platform: 'feishu',
      conversationId: 'oc_test_chat',
      creatorId: 'user-1',
    });

    const listText = executeCronIntent({
      manager,
      intent: parseCronSlashIntent('list'),
      platform: 'feishu',
    });
    expect(listText).toContain(jobId);

    const pauseText = executeCronIntent({
      manager,
      intent: parseCronSlashIntent(`pause --id ${jobId}`),
      platform: 'feishu',
    });
    expect(pauseText).toContain('已暂停任务');

    const removeText = executeCronIntent({
      manager,
      intent: parseCronSlashIntent(`remove --id ${jobId}`),
      platform: 'feishu',
    });
    expect(removeText).toContain('已删除任务');
  });

  it('未显式传 --session 时也应绑定当前 sessionId', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-control-bind-current-'));
    const jobsFile = path.join(root, 'jobs.json');
    const scheduler = new CronScheduler();
    const manager = new RuntimeCronManager({
      scheduler,
      filePath: jobsFile,
    });

    const { executeCronIntent, parseCronSlashIntent } = await loadCronControl();
    const addText = executeCronIntent({
      manager,
      intent: parseCronSlashIntent('add --name greet --expr "0 50 14 * * *" --text "对我说下午好"'),
      currentSessionId: 'session-current',
      currentConversationId: 'oc_test_chat',
      creatorId: 'user-1',
      platform: 'feishu',
    });

    expect(addText).toContain('创建成功');
    expect(manager.listJobs()[0]?.payload.sessionId).toBe('session-current');
  });

  it('语义解析产出 --session current 但当前无会话时应拒绝创建', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-control-current-empty-'));
    const jobsFile = path.join(root, 'jobs.json');
    const scheduler = new CronScheduler();
    const manager = new RuntimeCronManager({
      scheduler,
      filePath: jobsFile,
    });

    const { executeCronIntent, parseCronSlashIntent } = await loadCronControl();
    const addText = executeCronIntent({
      manager,
      intent: parseCronSlashIntent('add --name greet --expr "0 50 14 * * *" --text "对我说下午好" --session current'),
      currentConversationId: 'oc_test_chat',
      creatorId: 'user-1',
      platform: 'feishu',
    });

    expect(addText).toContain('尚未绑定 OpenCode 会话');
    expect(manager.listJobs()).toHaveLength(0);
  });

  it('当前聊天无会话时应拒绝创建 cron 任务', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-control-no-session-'));
    const jobsFile = path.join(root, 'jobs.json');
    const scheduler = new CronScheduler();
    const manager = new RuntimeCronManager({
      scheduler,
      filePath: jobsFile,
    });

    const { executeCronIntent, parseCronSlashIntent } = await loadCronControl();
    const text = executeCronIntent({
      manager,
      intent: parseCronSlashIntent('add --name demo --expr "0 */10 * * * *" --text "执行巡检"'),
      currentConversationId: 'oc_test_chat',
      creatorId: 'user-1',
      platform: 'feishu',
    });

    expect(text).toContain('尚未绑定 OpenCode 会话');
    expect(manager.listJobs()).toHaveLength(0);
  });

  it('cron list 应展示目标窗口、孤儿与回退状态', async () => {
    const previousForward = process.env.RELIABILITY_CRON_FORWARD_TO_PRIVATE;
    delete process.env.RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID;
    delete process.env.RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID;
    process.env.RELIABILITY_CRON_FORWARD_TO_PRIVATE = 'true';
    let cleanupStore: { removeSessionByConversation: (platform: string, conversationId: string) => void } | null = null;

    try {
      vi.resetModules();
      const cronModule = await import('../src/reliability/cron-control.js');
      const storeModule = await import('../src/store/chat-session.js');
      const { executeCronIntent, parseCronSlashIntent } = cronModule;
      const { chatSessionStore } = storeModule;
      cleanupStore = chatSessionStore;

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-control-status-'));
      const jobsFile = path.join(root, 'jobs.json');
      const scheduler = new CronScheduler();
      const manager = new RuntimeCronManager({
        scheduler,
        filePath: jobsFile,
      });

      chatSessionStore.setSessionByConversation('feishu', 'chat-status-target', 'session-status-1', 'user-status', '群聊-status', {
        chatType: 'group',
      });
      chatSessionStore.setSessionByConversation('feishu', 'chat-status-private', 'session-status-private', 'user-status', '私聊-status', {
        chatType: 'p2p',
      });

      manager.addJob({
        name: 'valid-job',
        schedule: { kind: 'cron', expr: '0 0 8 * * *' },
        payload: {
          kind: 'systemEvent',
          text: '发送日报',
          sessionId: 'session-status-1',
          delivery: {
            platform: 'feishu',
            conversationId: 'chat-status-target',
            creatorId: 'user-status',
          },
        },
        enabled: true,
      });

      manager.addJob({
        name: 'orphan-job',
        schedule: { kind: 'cron', expr: '0 30 8 * * *' },
        payload: {
          kind: 'systemEvent',
          text: '发送新闻',
          sessionId: 'session-status-2',
          delivery: {
            platform: 'feishu',
            conversationId: 'chat-status-missing',
            creatorId: 'user-status',
          },
        },
        enabled: true,
      });

      chatSessionStore.setSessionByConversation('feishu', 'chat-status-migrated', 'session-status-2', 'user-status', '群聊-migrated', {
        chatType: 'group',
      });

      const listText = executeCronIntent({
        manager,
        intent: parseCronSlashIntent('list'),
        platform: 'feishu',
      });

      expect(listText).toContain('（状态基于本地绑定表；fallback 为候选目标）');
      expect(listText).toContain('target: feishu:chat-status-target（本地绑定有效） | session: session-status-1');
      expect(listText).toContain('orphan: 否');
      expect(listText).toContain('target: feishu:chat-status-missing（原会话已迁移到 feishu:chat-status-migrated） | session: session-status-2');
      expect(listText).toContain('orphan: 是（原会话已迁移到其他窗口）');
      expect(listText).toContain('fallback: 候选 feishu:chat-status-private（创建者私聊）；原会话已迁移，运行时不会直接回退');

    } finally {
      cleanupStore?.removeSessionByConversation('feishu', 'chat-status-target');
      cleanupStore?.removeSessionByConversation('feishu', 'chat-status-private');
      cleanupStore?.removeSessionByConversation('feishu', 'chat-status-migrated');
      if (previousForward === undefined) {
        delete process.env.RELIABILITY_CRON_FORWARD_TO_PRIVATE;
      } else {
        process.env.RELIABILITY_CRON_FORWARD_TO_PRIVATE = previousForward;
      }
    }
  });
});
