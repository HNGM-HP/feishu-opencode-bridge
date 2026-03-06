import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { P2PHandler } from '../src/handlers/p2p.js';
import { opencodeClient } from '../src/opencode/client.js';
import { directoryConfig, userConfig } from '../src/config.js';
import type { CreateChatCardData } from '../src/feishu/cards.js';

type InternalP2PHandler = {
  buildCreateChatCardData: (selectedSessionId?: string) => Promise<CreateChatCardData>;
};

describe('P2P create_chat 工作项目来源', () => {
  let originalAllowedDirectories: string[];
  let originalDefaultWorkDirectory: string | undefined;
  let originalEnableManualSessionBind: boolean;

  beforeEach(() => {
    originalAllowedDirectories = [...directoryConfig.allowedDirectories];
    originalDefaultWorkDirectory = directoryConfig.defaultWorkDirectory;
    originalEnableManualSessionBind = userConfig.enableManualSessionBind;
  });

  afterEach(() => {
    directoryConfig.allowedDirectories = [...originalAllowedDirectories];
    directoryConfig.defaultWorkDirectory = originalDefaultWorkDirectory;
    userConfig.enableManualSessionBind = originalEnableManualSessionBind;
    vi.restoreAllMocks();
  });

  it('应包含 DEFAULT_WORK_DIRECTORY 与 ALLOWED_DIRECTORIES', async () => {
    const handler = new P2PHandler();
    const cwd = path.resolve(process.cwd());
    const parent = path.dirname(cwd);

    directoryConfig.allowedDirectories = [cwd, parent];
    directoryConfig.defaultWorkDirectory = parent;
    userConfig.enableManualSessionBind = false;

    const data = await (handler as unknown as InternalP2PHandler).buildCreateChatCardData();
    const directories = new Set((data.projectOptions || []).map(item => item.directory));

    expect(directories.has(cwd)).toBe(true);
    expect(directories.has(parent)).toBe(true);
  });

  it('应包含已存在会话目录', async () => {
    const handler = new P2PHandler();
    const cwd = path.resolve(process.cwd());
    const parent = path.dirname(cwd);
    const sessionDirectory = path.join(cwd, 'src');

    directoryConfig.allowedDirectories = [cwd, parent];
    directoryConfig.defaultWorkDirectory = parent;
    userConfig.enableManualSessionBind = true;

    const opencodeSession = {
      id: 'ses_create_chat_1',
      title: '会话一',
      directory: sessionDirectory,
      time: {
        created: 0,
        updated: 0,
      },
    } as unknown as Awaited<ReturnType<typeof opencodeClient.listSessionsAcrossProjects>>[number];

    vi.spyOn(opencodeClient, 'listSessionsAcrossProjects').mockResolvedValue([opencodeSession]);

    const data = await (handler as unknown as InternalP2PHandler).buildCreateChatCardData();
    const directories = new Set((data.projectOptions || []).map(item => item.directory));

    expect(directories.has(sessionDirectory)).toBe(true);
  });
});
