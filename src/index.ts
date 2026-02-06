import { validateConfig, userConfig, modelConfig, outputConfig, attachmentConfig, opencodeConfig, projectConfig } from './config.js';
import { feishuClient, type FeishuMessageEvent, type FeishuCardActionEvent, type FeishuCardActionResponse, type FeishuAttachment, type BotMenuEvent, type MessageRecalledEvent } from './feishu/client.js';
import { opencodeClient, type PermissionRequestEvent } from './opencode/client.js';
import { userSessionStore } from './store/user-session.js';
import { sessionGroupStore } from './store/session-group.js';
import { sessionDirectoryStore } from './store/session-directory.js';
import { parseCommand, getHelpText, type ParsedCommand } from './commands/parser.js';
import { permissionHandler } from './permissions/handler.js';
import { buildPermissionCard, buildControlCard, buildQuestionCardV2, buildQuestionAnsweredCard, QUESTION_OPTION_PAGE_SIZE, type QuestionInfo } from './feishu/cards.js';
import { outputBuffer } from './opencode/output-buffer.js';
import { delayedResponseHandler } from './opencode/delayed-handler.js';
import { questionHandler, type QuestionRequest, type PendingQuestion } from './opencode/question-handler.js';
import { CardStreamer } from './feishu/streamer.js';
import type { Part, Message } from '@opencode-ai/sdk';
import path from 'path';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { spawn, type ChildProcess } from 'child_process';

// Opencode 子进程实例
let opencodeProcess: ChildProcess | null = null;

// 活跃任务映射 messageId -> { sessionId, streamer, abortController? }
// 用于撤回时中断任务
const activeTasks = new Map<string, {
  sessionId: string;
  streamer: CardStreamer;
}>();

// 当前模型配置（可运行时切换）
let currentModel: { providerId?: string; modelId?: string } = {
  providerId: modelConfig.defaultProvider,
  modelId: modelConfig.defaultModel,
};

const OPENCODE_WAIT_REMINDER_MS = 180000;
const OPENCODE_MAX_WAIT_MS = 2 * 60 * 60 * 1000;
const OPENCODE_STATUS_CHECK_MS = 5 * 60 * 1000;
const ATTACHMENT_BASE_DIR = path.resolve(process.cwd(), 'tmp', 'feishu-uploads');
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.pjp',
  '.pjpeg',
  '.jfif',
  '.jpe',
]);

type ConversationMode = 'thread' | 'user' | 'chat';

type ConversationState = {
  lastOpencodeMessageId?: string;
  lastFeishuReplyMessageId?: string;
  lastUserMessageId?: string;
  agent?: string;
  chatId?: string; // 存储 chatId，用于 thread/user 模式下发送消息
};

type OpencodeTextPartInput = { type: 'text'; text: string };
type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = OpencodeTextPartInput | OpencodeFilePartInput;

const conversationStates = new Map<string, ConversationState>();

function getConversationState(key: string): ConversationState {
  const existing = conversationStates.get(key);
  if (existing) return existing;
  const state: ConversationState = {};
  conversationStates.set(key, state);
  return state;
}

function getConversationKey(event: FeishuMessageEvent): { key: string; mode: ConversationMode } {
  if (event.threadId) {
    return { key: `thread:${event.threadId}`, mode: 'thread' };
  }

  if (event.chatType === 'p2p') {
    return { key: `user:${event.senderId}`, mode: 'user' };
  }

  return { key: `chat:${event.chatId}`, mode: 'chat' };
}

function buildThreadTitle(text: string): string {
  const trimmed = text.trim();
  const prefix = trimmed.length > 20 ? trimmed.slice(0, 20) + '...' : trimmed;
  return `飞书：${prefix || '新话题'}`;
}

// 通过 sessionId 反查 conversationKey
function findConversationKeyBySessionId(sessionId: string): string | null {
  // 遍历 userSessionStore 查找
  for (const [key, data] of conversationStates.entries()) {
    const storedSessionId = userSessionStore.getCurrentSessionId(key);
    if (storedSessionId === sessionId) {
      return key;
    }
  }
  return null;
}

// 从 conversationKey 提取 chatId
function extractChatIdFromKey(key: string): string | null {
  // key 格式: thread:{threadId}, user:{userId}, chat:{chatId}
  if (key.startsWith('chat:')) {
    return key.slice(5);
  }
  // 对于 thread 和 user 模式，从 state 中获取 chatId
  const state = conversationStates.get(key);
  if (state?.chatId) {
    return state.chatId;
  }
  return null;
}

// 主函数
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     飞书 × OpenCode 桥接服务 v1.0              ║');
  console.log('╚════════════════════════════════════════════════╝');

  // 验证配置
  try {
    validateConfig();
  } catch (error) {
    console.error('配置错误:', error);
    process.exit(1);
  }

  console.log('[附件] 使用 data URL 传输附件');

  // 自动启动 Opencode
  if (opencodeConfig.autoStart) {
    console.log(`[OpenCode] 正在启动服务器: ${opencodeConfig.command}`);
    const [cmd, ...args] = opencodeConfig.command.split(' ');
    opencodeProcess = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
    });

    opencodeProcess.on('error', (err) => {
      console.error('[OpenCode] 启动失败:', err);
    });

    opencodeProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[OpenCode] 服务异常退出，退出码: ${code}`);
      }
    });

    // 等待服务启动
    console.log('[OpenCode] 等待服务就绪...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // 连接OpenCode
  const connected = await opencodeClient.connect();
  if (!connected) {
    console.error('无法连接到OpenCode服务器，请确保 opencode serve 已运行');
    console.log('提示: 在另一个终端运行 `opencode serve` 或 `opencode --port 4096`');
    process.exit(1);
  }

  // 设置输出缓冲回调
  outputBuffer.setUpdateCallback(async (buffer) => {
    const content = outputBuffer.getAndClear(buffer.key);
    if (!content) return;

    // 飞书文本消息不支持更新，避免重复发送
    if (buffer.messageId) {
      return;
    }

    const msgId = buffer.replyMessageId
      ? await feishuClient.reply(buffer.replyMessageId, content)
      : await feishuClient.sendText(buffer.chatId, content);
    if (msgId) {
      outputBuffer.setMessageId(buffer.key, msgId);
      const state = getConversationState(buffer.key);
      state.lastFeishuReplyMessageId = msgId;
    }
  });

  // 监听OpenCode权限请求事件
  opencodeClient.on('permissionRequest', async (event: PermissionRequestEvent) => {
    console.log(`[权限请求] 工具: ${event.tool}, 描述: ${event.description}`);

    // 检查是否在白名单中
    if (permissionHandler.isToolWhitelisted(event.tool)) {
      console.log(`[权限] 工具 ${event.tool} 在白名单中，自动允许`);
      await opencodeClient.respondToPermission(event.sessionId, event.permissionId, true);
      return;
    }

    // TODO: 需要找到对应的用户，发送权限确认卡片
    // 这里暂时通过sessionId查找用户（需要维护sessionId->userId映射）
  });

  // 监听消息更新事件（处理延迟响应）
  opencodeClient.on('messageUpdated', async (props: { info: Message }) => {
    const msg = props.info;
    
    // 只处理 assistant 消息且已完成
    if (msg.role !== 'assistant' || !msg.time.completed) return;
    
    const sessionId = msg.sessionID;
    const parentId = 'parentID' in msg ? msg.parentID : undefined;
    if (!parentId) return;
    
    // 检查是否有延迟处理器等待这个消息的响应
    if (!delayedResponseHandler.has(parentId)) return;
    
    console.log(`[SSE] 收到延迟响应: message=${parentId.slice(0, 8)}...`);
    
    try {
      // 获取完整消息内容（包含 parts）
      const messages = await opencodeClient.getSessionMessages(sessionId);
      const latest = messages.find(m => m.info.id === msg.id);
      
      if (latest) {
        await delayedResponseHandler.handleResponse(parentId, {
          info: latest.info,
          parts: latest.parts,
        });
      }
    } catch (error) {
      console.error('[SSE] 处理延迟响应失败:', error);
      delayedResponseHandler.remove(parentId);
    }
  });

  // 监听会话空闲事件（备用完成检测）
  opencodeClient.on('sessionIdle', async (props: { sessionID: string }) => {
    const pendings = delayedResponseHandler.getBySession(props.sessionID);
    if (pendings.length === 0) return;

    const oldest = Math.min(...pendings.map(item => item.createdAt));
    if (Date.now() - oldest <= 5000) return;

    console.log(`[SSE] 会话空闲，主动拉取响应: session=${props.sessionID.slice(0, 8)}...`);
    try {
      const messages = await opencodeClient.getSessionMessages(props.sessionID);
      const assistantByParent = new Map<string, { info: Message; parts: Part[] }>();
      for (const message of messages) {
        const info = message.info;
        if (info.role !== 'assistant' || !info.time.completed) continue;
        const parentId = 'parentID' in info ? info.parentID : undefined;
        if (parentId) {
          assistantByParent.set(parentId, { info, parts: message.parts });
        }
      }

      for (const pending of pendings) {
        const matched = assistantByParent.get(pending.messageId);
        if (matched) {
          await delayedResponseHandler.handleResponse(pending.messageId, matched);
        }
      }
    } catch (error) {
      console.error('[SSE] 主动拉取失败:', error);
      for (const pending of pendings) {
        delayedResponseHandler.remove(pending.messageId);
      }
    }
  });

  // 定期清理超时的延迟响应处理器
  setInterval(async () => {
    const expired = delayedResponseHandler.cleanupExpired(OPENCODE_MAX_WAIT_MS);
    for (const request of expired) {
      try {
        await sendNoticeToConversation(
          request.conversationKey,
          request.chatId,
          '⚠️ 请求处理超时，请稍后重试或在 OpenCode 中手动切换到对应会话',
          request.feishuMessageId
        );
      } catch (error) {
        console.error('[清理] 发送超时通知失败:', error);
      }
    }
  }, 60000); // 每分钟检查一次

  // 定期检查延迟响应状态（每 5 分钟提醒一次）
  setInterval(async () => {
    await checkDelayedResponses();
  }, OPENCODE_STATUS_CHECK_MS);

  // 监听 AI 提问事件 (question 工具)
  opencodeClient.on('questionAsked', async (request: QuestionRequest) => {
    console.log(`[问题] 收到AI提问: requestId=${request.id.slice(0, 8)}..., session=${request.sessionID.slice(0, 8)}...`);
    console.log(`[问题] 问题内容: ${request.questions.map(q => q.header).join(', ')}`);
    
    // 找到对应的会话上下文
    // 通过 sessionId 反查 conversationKey
    const conversationKey = findConversationKeyBySessionId(request.sessionID);
    if (!conversationKey) {
      console.log(`[问题] 未找到对应的会话上下文，跳过`);
      return;
    }
    
    const state = getConversationState(conversationKey);
    const chatId = extractChatIdFromKey(conversationKey);
    if (!chatId) {
      console.log(`[问题] 无法获取 chatId`);
      return;
    }
    
    // 注册待回答的问题
    questionHandler.register(request, conversationKey, chatId);
    
    const replyMessageId = state.lastUserMessageId;
    const sent = await sendQuestionCard(questionHandler.get(request.id)!, replyMessageId || undefined);
    if (!sent) {
      console.log('[问题] 卡片发送失败，发送文字备用');
      const questionList = request.questions.map((q, i) =>
        `${i + 1}. ${q.header}: ${q.options.map(o => o.label).join(' / ')}`
      ).join('\n');
      await feishuClient.sendText(
        chatId,
        `AI 需要你的输入，但卡片发送失败。\n\n${questionList}\n\n请直接回复答案。`
      );
      questionHandler.remove(request.id);
    }
  });

  // 定期清理超时的问题
  setInterval(async () => {
    const expired = questionHandler.cleanupExpired(OPENCODE_MAX_WAIT_MS);
    for (const pending of expired) {
      try {
        await sendNoticeToConversation(
          pending.conversationKey,
          pending.chatId,
          '⚠️ AI 提问已超时，任务可能已取消'
        );
      } catch (error) {
        console.error('[问题清理] 发送超时通知失败:', error);
      }
    }
  }, 60000);

  // 监听飞书消息
  feishuClient.on('message', async (event: FeishuMessageEvent) => {
    await handleMessage(event);
  });

  // 监听消息撤回
  feishuClient.on('messageRecalled', async (event: MessageRecalledEvent) => {
    console.log(`[撤回] 用户撤回消息: msgId=${event.messageId}`);
    const task = activeTasks.get(event.messageId);
    if (task) {
      console.log(`[撤回] 中断关联任务: session=${task.sessionId}`);
      try {
        await opencodeClient.abortSession(task.sessionId);
        task.streamer.setStatus('failed');
        task.streamer.updateText('\n\n(用户已撤回消息，任务中断)');
        activeTasks.delete(event.messageId);
      } catch (error) {
        console.error('[撤回] 中断任务失败:', error);
      }
    }
  });

  // 监听群解散事件
  feishuClient.eventDispatcher.register({
    'im.chat.disbanded_v1': async (data) => {
      const event = data as { chat_id: string };
      const userId = sessionGroupStore.findUserByChatId(event.chat_id);
      if (userId) {
        console.log(`[群组] 群 ${event.chat_id} 已解散，清理会话`);
        sessionGroupStore.removeGroup(userId, event.chat_id);
        // 清理会话状态
        const key = `chat:${event.chat_id}`;
        conversationStates.delete(key);
      }
      return { msg: 'ok' };
    },
    'im.chat.member.user.deleted_v1': async (data) => {
      const event = data as { chat_id: string, users: Array<{ user_id: { open_id: string } }> };
      const leavingUsers = event.users.map(u => u.user_id.open_id);
      const ownerId = sessionGroupStore.findUserByChatId(event.chat_id);
      
      if (ownerId && leavingUsers.includes(ownerId)) {
        console.log(`[群组] 用户 ${ownerId} 离开群 ${event.chat_id}，清理会话`);
        sessionGroupStore.removeGroup(ownerId, event.chat_id);
        const key = `chat:${event.chat_id}`;
        conversationStates.delete(key);
        // 尝试解散群（如果是机器人创建的）
        try {
          await feishuClient.deleteChat(event.chat_id);
        } catch {
          // ignore
        }
      }
      return { msg: 'ok' };
    }
  });

  // 监听飞书卡片动作（直接返回新卡片）
  feishuClient.setCardActionHandler(async (event: FeishuCardActionEvent) => {
    return await handleCardAction(event);
  });

  // 监听飞书菜单动作
  feishuClient.onBotMenu(async (event: BotMenuEvent) => {
    console.log(`[菜单] 用户点击菜单: key=${event.eventKey}, user=${event.operatorId}`);
    
    await feishuClient.sendText(
      `user:${event.operatorId}`, 
      `收到菜单点击: ${event.eventKey} (功能开发中)`
    );
  });

  // 启动飞书长连接
  await feishuClient.start();

  console.log('');
  console.log('✅ 服务已启动，等待飞书消息...');
  console.log('');

  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('\n正在关闭...');
    if (opencodeProcess) {
      console.log('[OpenCode] 停止服务...');
      opencodeProcess.kill();
    }
    feishuClient.stop();
    opencodeClient.disconnect();
    process.exit(0);
  });
}

// 处理飞书消息
async function handleMessage(event: FeishuMessageEvent): Promise<void> {
  const { senderId, chatId, content, messageId, threadId, chatType } = event;
  
  // 检查白名单（支持用户ID或群ID）
  if (userConfig.isWhitelistEnabled) {
    const isUserAllowed = userConfig.allowedUsers.includes(senderId);
    const isChatAllowed = userConfig.allowedUsers.includes(chatId);
    
    if (!isUserAllowed && !isChatAllowed) {
      console.log(`[拒绝] 用户 ${senderId} / 群 ${chatId} 不在白名单中`);
      await feishuClient.reply(
        messageId,
        `⛔ 抱歉，您没有使用此机器人的权限\nopen_id: ${senderId}`
      );
      return;
    }
  }

  // 核心变更：处理私聊消息自动建群逻辑
  if (chatType === 'p2p') {
    // 忽略机器人自己的消息（已经在client层过滤，这里双重保险）
    if (event.senderType === 'bot') return;

    // 检查是否有活跃的群组
    const activeGroup = sessionGroupStore.getActiveGroup(senderId);
    
    if (activeGroup) {
      // 已有活跃群，引导用户前往
      // 只有当用户发送的是命令（如 /session new）时才允许在私聊处理，否则引导去群里
      // 但为了简单，暂时全部引导，或者根据内容判断
      // 如果用户发的是 "清除" 或 "/clear"，可能想重置状态，这里暂时只做引导
      await feishuClient.reply(
        messageId,
        `👋 您有一个正在进行的会话群，请点击下方链接继续：\nhttps://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=${activeGroup}\n\n（或者输入 /session new 创建新对话）`
      );
      return;
    } else {
      // 没有活跃群，自动创建
      console.log(`[群组] 为用户 ${senderId} 创建新会话群...`);
      try {
        const result = await feishuClient.createChat('Opencode 会话', [senderId]);
        if (result && result.chatId) {
          sessionGroupStore.setActiveGroup(senderId, result.chatId);
          console.log(`[群组] 创建成功: ${result.chatId}`);
          
          await feishuClient.reply(
            messageId,
            `✅ 已为您创建专属会话群，请点击进入：\nhttps://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=${result.chatId}`
          );
          
          // 可选：在群里发一条欢迎消息
          await feishuClient.sendText(result.chatId, `👋 你好！我是 Opencode 助手。\n我们已经在一个独立的会话空间了，请直接告诉我你需要做什么。`);
          return;
        } else {
          console.error('[群组] 创建失败');
          await feishuClient.reply(messageId, '❌ 创建会话群失败，请稍后重试');
          return;
        }
      } catch (error) {
        console.error('[群组] 创建异常:', error);
        await feishuClient.reply(messageId, '❌ 创建会话群时发生错误');
        return;
      }
    }
  }

  const conversation = getConversationKey(event);
  const attachments = event.attachments || [];
  const hasAttachments = attachments.length > 0;

  // 保存 chatId 到 state，用于后续发送消息
  const state = getConversationState(conversation.key);
  state.chatId = chatId;

  // 忽略空消息（无文本且无附件）
  if (!content && !hasAttachments) {
    return;
  }

  const attachmentInfo = hasAttachments
    ? `, 附件: ${attachments.map(item => `${item.type}:${item.fileName || item.fileKey}`).join(', ')}`
    : '';
  console.log(`[收到] 用户: ${senderId}, 群: ${chatId}, 线程: ${threadId || '-'}, 内容: ${content.slice(0, 50)}...${attachmentInfo}`);

  // 检查是否有待回答的问题
  const pendingQuestion = questionHandler.getByConversationKey(conversation.key);
  if (pendingQuestion) {
    const trimmed = content.trim();
    const isCommand = trimmed.startsWith('/') || trimmed.startsWith('@') || trimmed.startsWith('#');

    if (!isCommand) {
      if (hasAttachments) {
        await feishuClient.reply(messageId, '当前有待回答问题，请先完成问题回答');
        return;
      }
      state.lastUserMessageId = messageId;
      const currentIndex = pendingQuestion.currentQuestionIndex;
      const question = pendingQuestion.request.questions[currentIndex];
      if (!question) {
        console.log(`[问题回答] 题目不存在: q=${currentIndex}`);
        return;
      }

      const parsed = parseQuestionAnswerText(trimmed, question);
      if (!parsed) {
        await feishuClient.reply(messageId, '未识别答案，请回复选项编号/字母，或直接输入自定义内容。');
        return;
      }

      if (parsed.type === 'skip') {
        questionHandler.setDraftAnswer(pendingQuestion.request.id, currentIndex, []);
        questionHandler.setDraftCustomAnswer(pendingQuestion.request.id, currentIndex, '');
        console.log(`[问题跳过] q=${currentIndex}`);
      } else if (parsed.type === 'custom') {
        questionHandler.setDraftAnswer(pendingQuestion.request.id, currentIndex, []);
        questionHandler.setDraftCustomAnswer(pendingQuestion.request.id, currentIndex, parsed.custom || trimmed);
        console.log(`[问题回答] 自定义: q=${currentIndex}, text=${trimmed.slice(0, 30)}...`);
      } else {
        questionHandler.setDraftCustomAnswer(pendingQuestion.request.id, currentIndex, '');
        questionHandler.setDraftAnswer(pendingQuestion.request.id, currentIndex, parsed.values || []);
        console.log(`[问题回答] 选择: q=${currentIndex}, answers=${JSON.stringify(parsed.values || [])}`);
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex < pendingQuestion.request.questions.length) {
        questionHandler.setCurrentQuestionIndex(pendingQuestion.request.id, nextIndex);
        await sendQuestionCard(pendingQuestion, messageId);
      } else {
        await submitQuestionAnswers(pendingQuestion, messageId);
      }
      return;
    }
  }

  // 解析命令
  const command = parseCommand(content);

  // 处理命令
  try {
    await executeCommand(command, senderId, chatId, chatType, messageId, conversation, hasAttachments ? attachments : undefined);
  } catch (error) {
    console.error('[错误]', error);
    await feishuClient.reply(messageId, `❌ 执行出错: ${(error as Error).message}`);
  }
}

// 执行命令
async function executeCommand(
  command: ParsedCommand,
  userId: string,
  chatId: string,
  chatType: 'p2p' | 'group',
  messageId: string,
  conversation: { key: string; mode: ConversationMode },
  attachments?: FeishuAttachment[]
): Promise<void> {
  switch (command.type) {
    case 'help':
      await feishuClient.reply(messageId, getHelpText());
      break;

    case 'command':
      await handleCommand(command, conversation, messageId);
      break;

    case 'stop':
      await handleStop(conversation, messageId);
      break;

    case 'undo':
      await handleUndo(conversation, chatId, chatType, messageId);
      break;

    case 'model':
      await handleModel(command, messageId);
      break;

    case 'agent':
      await handleAgent(command, conversation, messageId);
      break;

    case 'sessions':
      await handleListSessions(conversation, messageId);
      break;

    case 'session':
      await handleSession(command, conversation, messageId);
      break;

    case 'clear':
      await handleClear(conversation, messageId);
      break;

    case 'status':
      await handleStatus(conversation, messageId);
      break;

    case 'panel':
      await handlePanel(conversation, chatId, chatType, messageId);
      break;

    case 'admin':
      await handleAdmin(command, chatId, messageId);
      break;

    case 'permission':
      await handlePermissionResponse(command, userId, messageId);
      break;

    case 'command':
      await handleCommand(command, conversation, messageId);
      break;

    case 'prompt':
      await handlePrompt(command.text || '', conversation, chatId, messageId, attachments);
      break;
  }
}

// 处理普通消息（发送给AI）- 使用队列模式保证同会话消息串行处理
async function handlePrompt(
  text: string,
  conversation: { key: string; mode: ConversationMode },
  chatId: string,
  messageId: string,
  attachments?: FeishuAttachment[]
): Promise<void> {
  const state = getConversationState(conversation.key);
  state.lastUserMessageId = messageId;

  // 获取或创建会话
  let sessionId = userSessionStore.getCurrentSessionId(conversation.key);

  if (!sessionId) {
    const title = conversation.mode === 'thread'
      ? buildThreadTitle(text)
      : '飞书对话';
    const session = await opencodeClient.createSession(title);
    sessionId = session.id;
    userSessionStore.setCurrentSession(conversation.key, sessionId, title);
    console.log(`[会话] 为 ${conversation.key} 创建新会话: ${sessionId}`);
  }

  // 直接发送，不排队
  await processPrompt(sessionId!, text, conversation, chatId, messageId, state, attachments);
}

// 实际处理 prompt 的逻辑
async function processPrompt(
  sessionId: string,
  text: string,
  conversation: { key: string; mode: ConversationMode },
  chatId: string,
  messageId: string,
  state: ConversationState,
  attachments?: FeishuAttachment[]
): Promise<void> {
  // 使用流式卡片更新
  const streamer = new CardStreamer(chatId);
  await streamer.start();

  // 记录活跃任务
  activeTasks.set(messageId, { sessionId, streamer });

  try {
    const startedAt = Date.now();
    console.log(`[OpenCode] 发送消息: session=${sessionId.slice(0, 8)}..., text=${text.slice(0, 50)}...`);
    const modelLabel = currentModel.providerId && currentModel.modelId
      ? `${currentModel.providerId}/${currentModel.modelId}`
      : 'server-default';
    console.log(`[OpenCode] 使用模型: ${modelLabel}, agent: ${state.agent || 'default'}`);

    const parts: OpencodePartInput[] = [];
    if (text.trim()) {
      parts.push({ type: 'text', text });
    }

    if (attachments && attachments.length > 0) {
      const prepared = await prepareAttachmentParts(messageId, attachments);
      if (prepared.warnings.length > 0) {
        await sendNoticeToConversation(
          conversation.key,
          chatId,
          prepared.warnings.join('\n'),
          messageId
        );
      }
      parts.push(...prepared.parts);
    }

    if (parts.length === 0) {
      await feishuClient.reply(messageId, '未检测到可处理的文本或附件');
      streamer.setStatus('failed');
      return;
    }

    // 设置流式事件监听
    const partHandler = (props: { info: Message; part: Part }) => {
      const info = props.info;
      if (info.sessionID !== sessionId) return;
      if (info.role !== 'assistant') return;

      const part = props.part as any;
      if (part.type === 'text' && 'text' in part) {
        streamer.updateText(part.text as string);
      } else if (part.type === 'tool' && 'state' in part) {
        const toolPart = part as { tool: string; state: { status: string; output?: string } };
        if (toolPart.state.status === 'running') {
          streamer.updateToolStatus(toolPart.tool, 'running');
        } else if (toolPart.state.status === 'completed') {
          streamer.updateToolStatus(toolPart.tool, 'completed', toolPart.state.output);
        } else if (toolPart.state.status === 'failed') {
          streamer.updateToolStatus(toolPart.tool, 'failed', toolPart.state.output);
        } else {
          // pending or other
          streamer.addTool(toolPart.tool);
        }
      } else if (part.type === 'thinking' && 'text' in part) { // Assuming 'thinking' type exists or mapping logic
         streamer.updateThinking(part.text as string);
      }
    };

    const messageHandler = (props: { info: Message }) => {
      const info = props.info;
      if (info.sessionID !== sessionId) return;
      if (info.role === 'assistant' && info.time.completed) {
        state.lastOpencodeMessageId = info.id;
        streamer.setStatus('completed');
        
        // 自动重命名逻辑
        if (conversation.mode === 'chat') {
          const chatId = extractChatIdFromKey(conversation.key);
          if (chatId) {
            setTimeout(async () => {
              const groupInfo = sessionGroupStore.getGroupInfo(chatId);
              if (groupInfo && !groupInfo.title) {
                const summary = text.slice(0, 15).trim();
                const title = `o${sessionId.slice(0, 6)}-${summary}`;
                console.log(`[群组] 自动重命名: ${title}`);
                const success = await feishuClient.updateChatName(chatId, title);
                if (success) {
                  sessionGroupStore.updateGroupTitle(chatId, title);
                  
                  // 尝试重命名目录（可选增强）
                  // 1. 获取旧目录
                  const oldDir = sessionDirectoryStore.get(sessionId);
                  if (oldDir && projectConfig.root) {
                    // 2. 构建新目录名 (sanitize title)
                    const safeTitle = sanitizeFilename(title);
                    const newDir = path.join(projectConfig.root, safeTitle);
                    
                    if (oldDir !== newDir) {
                      try {
                        await fs.rename(oldDir, newDir);
                        sessionDirectoryStore.set(sessionId, newDir);
                        console.log(`[目录] 重命名: ${oldDir} -> ${newDir}`);
                        // 发送新的 cd 指令
                        await opencodeClient.sendMessageAsync(sessionId, `! cd "${newDir}"`, {});
                      } catch (err) {
                        console.error(`[目录] 重命名失败: ${err}`);
                      }
                    }
                  }
                }
              }
            }, 1000);
          }
        }
        
        // 移除监听器
        opencodeClient.off('messagePartUpdated', partHandler);
        opencodeClient.off('messageUpdated', messageHandler);
        
        // 清理活跃任务
        activeTasks.delete(messageId);
      }
    };

    opencodeClient.on('messagePartUpdated', partHandler);
    opencodeClient.on('messageUpdated', messageHandler);

    // 检查并确保目录存在
    let targetDir: string | undefined;
    if (projectConfig.root) {
      // 1. 如果已有绑定目录，使用它
      targetDir = sessionDirectoryStore.get(sessionId);
      
      // 2. 如果没有，且是新会话，生成默认目录
      if (!targetDir) {
        // 使用简单的 {sessionId前缀} 作为初始目录名，后续重命名
        // 如果是 chat 模式，尝试用 chatId
        const dirName = conversation.mode === 'chat' && chatId 
          ? `chat_${chatId}` 
          : `session_${sessionId.slice(0, 8)}`;
          
        targetDir = path.join(projectConfig.root, dirName);
        
        // 创建目录
        try {
          await fs.mkdir(targetDir, { recursive: true });
          sessionDirectoryStore.set(sessionId, targetDir);
          console.log(`[目录] 创建会话目录: ${targetDir}`);
        } catch (error) {
          console.error(`[目录] 创建失败: ${error}`);
          targetDir = undefined; // 回退到默认
        }
      }
    }

    // 注入 cd 指令（如果目录有效）
    if (targetDir) {
      // 发送隐式 CD 指令
      // 注意：这里我们假设可以通过发送 prompt 来执行 shell
      // 但为了不干扰当前对话流，最好是发一个单独的 prompt，或者 prepend 到当前 text
      // 这里采用 prepend 方式，让 AI 知道上下文
      // 或者使用 ! cd 命令（如果 Opencode 支持）
      // 根据指示，发送 "! cd {path}"
      
      // 为了避免每次都 cd，我们可以检查一下是否已经 cd 过
      // 但目前没有状态记录 Opencode 当前在哪，所以每次第一条消息或者重新连接时发送是安全的
      // 这里简单处理：每次 processPrompt 都带上 cd 指令作为 system context 或者 hidden prompt
      // 为了不让用户看到 "! cd ..." 出现在回复中，我们将其作为隐藏指令
      
      // 方案：发送两条消息，第一条是 cd，第二条是用户消息
      // 但这样会产生两条回复。
      
      // 更好的方案：在 prompt 前面加提示，告诉 AI 切换目录
      // 但题目要求 "本软件只需要给 opencode 指令... 或者发送 ! {命令}"
      
      // 我们在发送用户 text 之前，先发送一条 cd 指令
      // 并且忽略这条指令的输出
      try {
        console.log(`[目录] 切换到: ${targetDir}`);
        // 使用一个特殊的隐藏发送，不触发飞书回复
        // 但 opencodeClient.sendMessageAsync 会触发 messageUpdated
        // 我们需要一种方式告诉 messageHandler 忽略这次更新
        // 或者简单点：将 cd 指令合并到当前 Prompt 中？
        // "请在目录 ${targetDir} 下执行：${text}" -> 这改变了语义
        
        // 采用 ! cd 方式，并将其与用户文本合并
        // text = `! cd "${targetDir}" && true\n${text}`; 
        // 这种方式最直接，AI 会先执行 cd，然后处理后面的文本
        // 但如果 text 也是自然语言，可能造成混淆
        
        // 最佳实践：独立发送 cd 指令
        await opencodeClient.sendMessageAsync(sessionId, `! cd "${targetDir}"`, {
           // 不带 agent，使用默认
        });
        // 稍微等待一下确保 cd 执行？通常不需要，因为是队列
      } catch (e) {
        console.error('[目录] 切换指令发送失败', e);
      }
    }

    // 异步发送消息
    await opencodeClient.sendMessageAsync(sessionId, text, {
      providerId: currentModel.providerId,
      modelId: currentModel.modelId,
      agent: state.agent,
    });

    console.log(`[OpenCode] 异步请求已发送`);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[OpenCode] 发送消息失败:', message);
    streamer.setStatus('failed');
    await feishuClient.reply(messageId, `❌ 发送失败: ${message}`);
  } finally {
    // 任务结束（无论成功失败，但在流式中，messageUpdated才是真正的结束点）
    // 这里只处理同步错误或发送请求本身的结束
    // 真正的清理在 messageHandler 中
  }
}

// 格式化输出
function formatOutput(parts: Part[] | undefined): string {
  const output: string[] = [];
  const safeParts = Array.isArray(parts) ? parts : [];

  for (const part of safeParts) {
    if (part.type === 'text' && 'text' in part) {
      output.push(part.text as string);
    } else if (part.type === 'tool' && 'state' in part) {
      // 工具调用结果
      const toolPart = part as { tool: string; state: { status: string; output?: string } };
      if (toolPart.state.status === 'completed' && toolPart.state.output) {
        output.push(`📎 [${toolPart.tool}]\n${toolPart.state.output.slice(0, 1000)}`);
      }
    }
  }

  // 限制总长度
  const result = output.join('\n\n');
  if (result.length > outputConfig.maxMessageLength) {
    return result.slice(0, outputConfig.maxMessageLength) + '\n\n... (内容过长，已截断)';
  }

  return result || '(无输出)';
}

const modelOptionsCache: { items: Array<{ label: string; value: string }>; fetchedAt: number } = {
  items: [],
  fetchedAt: 0,
};

const agentOptionsCache: { items: Array<{ label: string; value: string }>; fetchedAt: number } = {
  items: [],
  fetchedAt: 0,
};

const CACHE_TTL_MS = 5 * 60 * 1000;

async function getModelOptions(): Promise<Array<{ label: string; value: string }>> {
  if (Date.now() - modelOptionsCache.fetchedAt < CACHE_TTL_MS) {
    return modelOptionsCache.items;
  }

  try {
    const data = await opencodeClient.getProviders();
    const options: Array<{ label: string; value: string }> = [];
    for (const provider of data.providers || []) {
      const providerId = (provider as { id?: string; providerID?: string }).id
        || (provider as { id?: string; providerID?: string }).providerID
        || 'unknown';
      const modelsRaw = (provider as { models?: unknown }).models;
      const models = Array.isArray(modelsRaw)
        ? modelsRaw
        : modelsRaw && typeof modelsRaw === 'object'
          ? Object.values(modelsRaw as Record<string, unknown>)
          : [];

      for (const model of models) {
        const modelObj = model as { id?: string; modelID?: string; name?: string };
        const modelId = modelObj.id || modelObj.modelID || modelObj.name;
        if (!modelId) continue;
        const value = `${providerId}/${modelId}`;
        options.push({ label: value, value });
      }
    }

    modelOptionsCache.items = options.slice(0, 100);
    modelOptionsCache.fetchedAt = Date.now();
  return modelOptionsCache.items;
  } catch (error) {
    console.error('[OpenCode] 获取模型列表失败:', error);
    return [];
  }
}

async function getAgentOptions(): Promise<Array<{ label: string; value: string }>> {
  if (Date.now() - agentOptionsCache.fetchedAt < CACHE_TTL_MS) {
    return agentOptionsCache.items;
  }

  const agents = await opencodeClient.getAgents();
  const options = agents.map(agent => ({
    label: agent.name,
    value: agent.name,
  }));

  agentOptionsCache.items = options.slice(0, 100);
  agentOptionsCache.fetchedAt = Date.now();
  return agentOptionsCache.items;
}

const ignoredActionValues = new Set([
  'model_select',
  'agent_select',
  'permission_allow',
  'permission_deny',
  'abort',
  'undo',
]);

function toCandidateString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function isIgnoredCandidate(value: string): boolean {
  return ignoredActionValues.has(value) || value.length > 200 || value.includes('\n');
}

function getSelectedOption(action: unknown): string | null {
  if (!action) return null;
  const direct = toCandidateString(action);
  if (direct && !isIgnoredCandidate(direct)) return direct;
  if (typeof action !== 'object') return null;

  const anyAction = action as {
    option?: { value?: unknown; text?: { text?: unknown; content?: unknown } };
    option_id?: unknown;
    optionId?: unknown;
    selected_value?: unknown;
    selectedValue?: unknown;
    value?: unknown;
    selected?: unknown;
    action?: unknown;
  };

  const optionDirect = toCandidateString(anyAction.option as unknown);
  if (optionDirect && !isIgnoredCandidate(optionDirect)) return optionDirect;

  const optionId = toCandidateString(anyAction.option_id) || toCandidateString(anyAction.optionId);
  if (optionId && !isIgnoredCandidate(optionId)) return optionId;

  const selectedCandidate = toCandidateString(anyAction.selected_value) || toCandidateString(anyAction.selectedValue);
  if (selectedCandidate && !isIgnoredCandidate(selectedCandidate)) return selectedCandidate;

  const optionValue = toCandidateString(anyAction.option?.value);
  if (optionValue && !isIgnoredCandidate(optionValue)) return optionValue;

  const selectedValue = toCandidateString(anyAction.selected);
  if (selectedValue && !isIgnoredCandidate(selectedValue)) return selectedValue;

  const valueValue = toCandidateString(anyAction.value);
  if (valueValue && !isIgnoredCandidate(valueValue)) return valueValue;

  if (anyAction.value && typeof anyAction.value === 'object') {
    const inner = anyAction.value as {
      selected?: unknown;
      value?: unknown;
      option?: unknown;
      option_id?: unknown;
      optionId?: unknown;
      selected_value?: unknown;
      selectedValue?: unknown;
    };
    const innerSelected = toCandidateString(inner.selected);
    if (innerSelected && !isIgnoredCandidate(innerSelected)) return innerSelected;
    const innerValue = toCandidateString(inner.value);
    if (innerValue && !isIgnoredCandidate(innerValue)) return innerValue;
    const innerOption = toCandidateString(inner.option);
    if (innerOption && !isIgnoredCandidate(innerOption)) return innerOption;
    const innerOptionId = toCandidateString(inner.option_id) || toCandidateString(inner.optionId);
    if (innerOptionId && !isIgnoredCandidate(innerOptionId)) return innerOptionId;
    const innerSelectedValue = toCandidateString(inner.selected_value) || toCandidateString(inner.selectedValue);
    if (innerSelectedValue && !isIgnoredCandidate(innerSelectedValue)) return innerSelectedValue;
  }

  const optionContent = toCandidateString(anyAction.option?.text?.content);
  if (optionContent && !isIgnoredCandidate(optionContent)) return optionContent;
  const optionText = toCandidateString(anyAction.option?.text?.text);
  if (optionText && !isIgnoredCandidate(optionText)) return optionText;

  if (anyAction.action) {
    const nested = getSelectedOption(anyAction.action);
    if (nested) return nested;
  }

  return findSelectedInPayload(action);
}

async function refreshQuestionCard(requestId: string): Promise<void> {
  const pending = questionHandler.get(requestId);
  if (!pending) {
    console.log(`[卡片刷新] 未找到问题: requestId=${requestId.slice(0, 8)}...`);
    return;
  }
  if (!pending.feishuCardMessageId) {
    console.log(`[卡片刷新] 无卡片消息ID: requestId=${requestId.slice(0, 8)}...`);
    return;
  }

  console.log(`[卡片刷新] 开始: requestId=${requestId.slice(0, 8)}..., q=${pending.currentQuestionIndex}, msgId=${pending.feishuCardMessageId.slice(0, 8)}...`);

  const card = buildQuestionCardV2({
    requestId: pending.request.id,
    sessionId: pending.request.sessionID,
    questions: pending.request.questions,
    conversationKey: pending.conversationKey,
    chatId: pending.chatId,
    draftAnswers: pending.draftAnswers,
    draftCustomAnswers: pending.draftCustomAnswers,
    pendingCustomQuestionIndex: pending.pendingCustomQuestionIndex,
    currentQuestionIndex: pending.currentQuestionIndex,
    optionPageIndexes: pending.optionPageIndexes,
  });

  try {
    const cardSize = JSON.stringify(card).length;
    console.log(`[卡片刷新] 卡片大小: ${cardSize} bytes`);
  } catch {
    // ignore
  }

  const success = await feishuClient.updateCard(pending.feishuCardMessageId, card);
  if (success) {
    console.log(`[卡片刷新] 成功: requestId=${requestId.slice(0, 8)}...`);
    return;
  }
  
  // === 降级处理：更新失败时，删除旧卡片并发送新卡片 ===
  console.log(`[卡片刷新] 更新失败，尝试删除旧卡片并发送新卡片`);
  
  const oldMsgId = pending.feishuCardMessageId;
  
  // 尝试删除旧卡片（不管成功与否都继续）
  const deleted = await feishuClient.deleteMessage(oldMsgId);
  console.log(`[卡片刷新] 删除旧卡片: ${deleted ? '成功' : '失败'}`);
  
  // 发送新卡片（优先回复到最近消息，避免新话题）
  const state = getConversationState(pending.conversationKey);
  let newMsgId: string | null = null;
  if (state.lastUserMessageId) {
    newMsgId = await feishuClient.replyCard(state.lastUserMessageId, card);
  }
  if (!newMsgId) {
    newMsgId = await feishuClient.sendCard(pending.chatId, card);
  }
  
  if (newMsgId) {
    // 更新存储的卡片消息 ID
    questionHandler.setCardMessageId(requestId, newMsgId);
    console.log(`[卡片刷新] 新卡片发送成功: msgId=${newMsgId.slice(0, 16)}...`);
    return;
  }
  
  // 最终降级：发送文字通知当前选择状态
  console.log(`[卡片刷新] 新卡片发送也失败，发送文字提示`);
  const selectedText = pending.draftAnswers.map((ans, i) => {
    const q = pending.request.questions[i];
    const answerStr = ans.length > 0 ? ans.join(', ') : '未选择';
    return `问题${i + 1} (${q?.header || ''}): ${answerStr}`;
  }).join('\n');
  
  await feishuClient.sendText(
    pending.chatId, 
    `📋 当前选择状态:\n${selectedText}\n\n请在卡片中点击"提交答案"完成回答。`
  );
}

function buildQuestionCardForRequest(requestId: string): object | null {
  const pending = questionHandler.get(requestId);
  if (!pending) return null;
  return buildQuestionCardV2({
    requestId: pending.request.id,
    sessionId: pending.request.sessionID,
    questions: pending.request.questions,
    conversationKey: pending.conversationKey,
    chatId: pending.chatId,
    draftAnswers: pending.draftAnswers,
    draftCustomAnswers: pending.draftCustomAnswers,
    pendingCustomQuestionIndex: pending.pendingCustomQuestionIndex,
    currentQuestionIndex: pending.currentQuestionIndex,
    optionPageIndexes: pending.optionPageIndexes,
  });
}

async function sendQuestionCard(
  pending: PendingQuestion,
  replyMessageId?: string
): Promise<boolean> {
  const card = buildQuestionCardV2({
    requestId: pending.request.id,
    sessionId: pending.request.sessionID,
    questions: pending.request.questions,
    conversationKey: pending.conversationKey,
    chatId: pending.chatId,
    draftAnswers: pending.draftAnswers,
    draftCustomAnswers: pending.draftCustomAnswers,
    pendingCustomQuestionIndex: pending.pendingCustomQuestionIndex,
    currentQuestionIndex: pending.currentQuestionIndex,
    optionPageIndexes: pending.optionPageIndexes,
  });

  const state = getConversationState(pending.conversationKey);
  const replyTarget = state.lastUserMessageId || replyMessageId;
  const isThread = pending.conversationKey.startsWith('thread:');
  let cardMessageId: string | null = null;
  if (isThread && replyTarget) {
    cardMessageId = await feishuClient.replyCard(replyTarget, card);
  } else {
    cardMessageId = await feishuClient.sendCard(pending.chatId, card);
  }

  if (cardMessageId) {
    questionHandler.setCardMessageId(pending.request.id, cardMessageId);
    return true;
  }

  return false;
}

async function submitQuestionAnswers(
  pending: PendingQuestion,
  replyMessageId?: string
): Promise<void> {
  const answers: string[][] = [];
  const totalQuestions = pending.request.questions.length;

  for (let i = 0; i < totalQuestions; i++) {
    const custom = (pending.draftCustomAnswers[i] || '').trim();
    if (custom) {
      answers.push([custom]);
    } else {
      answers.push(pending.draftAnswers[i] || []);
    }
  }

  console.log(`[问题提交] requestId=${pending.request.id.slice(0, 8)}..., answers=${JSON.stringify(answers)}`);

  const success = await opencodeClient.replyQuestion(pending.request.id, answers);
  if (success) {
    console.log('[问题提交] 已发送回答');
    questionHandler.remove(pending.request.id);
    const answeredCard = buildQuestionAnsweredCard(answers);
    const isThread = pending.conversationKey.startsWith('thread:');
    if (isThread && replyMessageId) {
      const replied = await feishuClient.replyCard(replyMessageId, answeredCard);
      if (replied) return;
    }
    await feishuClient.sendCard(pending.chatId, answeredCard);
    return;
  }

  console.log('[问题提交] 回答失败');
  await sendNoticeToConversation(
    pending.conversationKey,
    pending.chatId,
    '⚠️ 回答提交失败，请重试'
  );
}

async function sendNoticeToConversation(
  conversationKey: string,
  chatId: string,
  text: string,
  fallbackMessageId?: string
): Promise<void> {
  const state = getConversationState(conversationKey);
  const replyTarget = state.lastUserMessageId || fallbackMessageId;
  if (replyTarget) {
    const replied = await feishuClient.reply(replyTarget, text);
    if (replied) return;
  }
  await feishuClient.sendText(chatId, text);
}

async function checkDelayedResponses(): Promise<void> {
  const pendingRequests = delayedResponseHandler.getAll();
  if (pendingRequests.length === 0) return;

  for (const request of pendingRequests) {
    try {
      const messages = await opencodeClient.getSessionMessages(request.sessionId);
      if (messages.length > 0) {
        const latest = messages[messages.length - 1];
        if (latest.info.role === 'assistant' && latest.info.time.completed) {
          await delayedResponseHandler.handleResponse(request.messageId, {
            info: latest.info,
            parts: latest.parts,
          });
          continue;
        }
      }
      const lastReminderAt = request.lastReminderAt || 0;
      if (Date.now() - lastReminderAt < OPENCODE_STATUS_CHECK_MS) {
        continue;
      }
      await sendNoticeToConversation(
        request.conversationKey,
        request.chatId,
        '⏳ 请求已发送，正在等待处理...\n（OpenCode 可能正在处理其他任务，完成后会自动回复）',
        request.feishuMessageId
      );
      request.lastReminderAt = Date.now();
    } catch (error) {
      console.error('[状态检查] 获取会话消息失败:', error);
      const lastReminderAt = request.lastReminderAt || 0;
      if (Date.now() - lastReminderAt < OPENCODE_STATUS_CHECK_MS) {
        continue;
      }
      await sendNoticeToConversation(
        request.conversationKey,
        request.chatId,
        '⏳ 请求已发送，正在等待处理...\n（OpenCode 可能正在处理其他任务，完成后会自动回复）',
        request.feishuMessageId
      );
      request.lastReminderAt = Date.now();
    }
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'attachment';
}

function extractExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

function normalizeExtension(ext: string): string {
  if (!ext) return '';
  const withDot = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  if (withDot === '.jpeg' || withDot === '.pjpeg' || withDot === '.pjp' || withDot === '.jpe' || withDot === '.jfif') {
    return '.jpg';
  }
  return withDot;
}

function extensionFromContentType(contentType: string): string {
  const type = contentType.split(';')[0]?.trim().toLowerCase();
  if (type === 'image/png') return '.png';
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/webp') return '.webp';
  if (type === 'application/pdf') return '.pdf';
  return '';
}

function mimeFromExtension(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
    case '.pjpeg':
    case '.pjp':
    case '.jfif':
    case '.jpe':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function getHeaderValue(headers: Record<string, unknown>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return '';
}

async function prepareAttachmentParts(
  messageId: string,
  attachments: FeishuAttachment[]
): Promise<{ parts: OpencodeFilePartInput[]; warnings: string[] }> {
  const parts: OpencodeFilePartInput[] = [];
  const warnings: string[] = [];

  await fs.mkdir(ATTACHMENT_BASE_DIR, { recursive: true }).catch(() => undefined);

  for (const attachment of attachments) {
    const size = attachment.fileSize;
    if (typeof size === 'number' && size > attachmentConfig.maxSize) {
      warnings.push(`附件大小超过限制（${Math.round(size / 1024 / 1024)}MB），已跳过`);
      continue;
    }

    const resource = await feishuClient.downloadMessageResource(
      messageId,
      attachment.fileKey,
      attachment.type
    );
    if (!resource) {
      console.log(`[附件] 下载失败: messageId=${messageId.slice(0, 8)}..., key=${attachment.fileKey}`);
      warnings.push('附件下载失败，已跳过');
      continue;
    }

    const contentType = getHeaderValue(resource.headers || {}, 'content-type');
    const extFromName = attachment.fileName ? extractExtension(attachment.fileName) : '';
    const extFromType = attachment.fileType ? normalizeExtension(attachment.fileType) : '';
    const extFromContent = contentType ? extensionFromContentType(contentType) : '';
    let ext = normalizeExtension(extFromName || extFromType || extFromContent);
    if (!ext && attachment.type === 'image') {
      ext = '.jpg';
    }

    if (!ext || !ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
      console.log(`[附件] 不支持的格式: ext=${ext || 'unknown'}, contentType=${contentType}`);
      warnings.push('附件格式不支持，已跳过');
      continue;
    }

    const rawName = attachment.fileName || `attachment${ext}`;
    const safeName = sanitizeFilename(rawName.endsWith(ext) ? rawName : `${rawName}${ext}`);

    const fileId = randomUUID();
    const filePath = path.join(ATTACHMENT_BASE_DIR, `${fileId}${ext}`);
    try {
      await resource.writeFile(filePath);
      const stat = await fs.stat(filePath);
      if (stat.size > attachmentConfig.maxSize) {
        await fs.unlink(filePath);
        warnings.push(`附件大小超过限制（${Math.round(stat.size / 1024 / 1024)}MB），已跳过`);
        continue;
      }
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');
      const mime = contentType ? contentType.split(';')[0].trim() : mimeFromExtension(ext);
      const dataUrl = `data:${mime};base64,${base64}`;
      console.log(`[附件] data URL 长度=${dataUrl.length}`);
      parts.push({ type: 'file', mime, url: dataUrl, filename: safeName });
    } catch (error) {
      console.error('[附件] 保存文件失败:', error);
      warnings.push('附件保存失败，已跳过');
      continue;
    } finally {
      fs.unlink(filePath).catch(() => undefined);
    }
  }

  return { parts, warnings };
}

const skipKeywords = new Set(['跳过', 'skip', 'pass', '忽略']);

function splitAnswerTokens(text: string): string[] {
  return text
    .split(/[\s,，;；、]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function resolveOptionByToken(
  token: string,
  labels: string[],
  labelMap: Map<string, string>
): string | null {
  const cleaned = token.replace(/[\.。、]/g, '').trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  const byLabel = labelMap.get(lower);
  if (byLabel) return byLabel;

  if (/^[a-z]$/i.test(cleaned)) {
    const index = cleaned.toUpperCase().charCodeAt(0) - 65;
    if (index >= 0 && index < labels.length) return labels[index];
  }

  if (/^\d+$/.test(cleaned)) {
    const index = Number.parseInt(cleaned, 10) - 1;
    if (index >= 0 && index < labels.length) return labels[index];
  }

  return null;
}

function parseQuestionAnswerText(
  text: string,
  question: QuestionInfo
): { type: 'skip' | 'custom' | 'selection'; values?: string[]; custom?: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (skipKeywords.has(lower) || lower.startsWith('跳过')) {
    return { type: 'skip' };
  }

  const labels = question.options.map(opt => opt.label);
  const labelMap = new Map(labels.map(label => [label.toLowerCase(), label]));

  const exactMatch = labelMap.get(trimmed.toLowerCase());
  if (exactMatch) {
    return { type: 'selection', values: [exactMatch] };
  }

  const tokens = splitAnswerTokens(trimmed);
  if (tokens.length === 0) {
    return { type: 'custom', custom: trimmed };
  }

  const matched: string[] = [];
  let hasInvalid = false;

  for (const token of tokens) {
    const resolved = resolveOptionByToken(token, labels, labelMap);
    if (resolved) {
      matched.push(resolved);
    } else {
      hasInvalid = true;
    }
  }

  if (hasInvalid || matched.length === 0) {
    return { type: 'custom', custom: trimmed };
  }

  const unique = Array.from(new Set(matched));
  if (!question.multiple) {
    if (unique.length === 1 && tokens.length === 1) {
      return { type: 'selection', values: unique };
    }
    return { type: 'custom', custom: trimmed };
  }

  return { type: 'selection', values: unique };
}

function findMatchingOptionValue(
  payload: unknown,
  options: Array<{ value: string }>
): string | null {
  if (!payload || options.length === 0) return null;
  const optionSet = new Set(options.map(item => item.value));
  const visited = new Set<object>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const candidate = toCandidateString(current);
    if (candidate && !isIgnoredCandidate(candidate)) {
      if (optionSet.has(candidate)) return candidate;
      for (const option of optionSet) {
        if (candidate.includes(option)) return option;
      }
      const trimmed = candidate.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 2000) {
        try {
          stack.push(JSON.parse(trimmed));
        } catch {
          // ignore
        }
      }
    }

    if (typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      stack.push(value);
    }
  }

  return null;
}

function findSelectedInPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const visited = new Set<object>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    if (record.option && typeof record.option === 'object') {
      const optionRecord = record.option as { value?: unknown; text?: { text?: unknown; content?: unknown } };
      const optionValue = toCandidateString(optionRecord.value);
      if (optionValue && !isIgnoredCandidate(optionValue)) return optionValue;
      const optionContent = toCandidateString(optionRecord.text?.content);
      if (optionContent && !isIgnoredCandidate(optionContent)) return optionContent;
      const optionText = toCandidateString(optionRecord.text?.text);
      if (optionText && !isIgnoredCandidate(optionText)) return optionText;
    }

    const selectedValue = toCandidateString(record.selected);
    if (selectedValue && !isIgnoredCandidate(selectedValue)) return selectedValue;
    const valueValue = toCandidateString(record.value);
    if (valueValue && !isIgnoredCandidate(valueValue)) return valueValue;

    for (const value of Object.values(record)) {
      stack.push(value);
    }
  }

  return null;
}

function collectSelectedOptionsFromAction(
  payload: unknown,
  optionSet: Set<string>
): { values: string[]; hasExplicit: boolean } {
  const result = new Set<string>();
  const visited = new Set<object>();
  const stack: unknown[] = [payload];
  let hasExplicit = false;

  const selectedKeys = new Set([
    'selected_values',
    'selectedValues',
    'selected_value',
    'selectedValue',
    'selected',
  ]);

  const addCandidate = (value: unknown): void => {
    const candidate = toCandidateString(value);
    if (!candidate) return;
    if (optionSet.has(candidate)) {
      result.add(candidate);
    }
  };

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined) continue;

    if (typeof current === 'string' || typeof current === 'number') {
      addCandidate(current);
      continue;
    }

    if (typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (selectedKeys.has(key)) {
        if (Array.isArray(value)) {
          hasExplicit = true;
          for (const item of value) addCandidate(item);
          continue;
        }
        if (typeof value === 'string' || typeof value === 'number') {
          hasExplicit = true;
          addCandidate(value);
          continue;
        }
      }

      if (key === 'option') {
        if (Array.isArray(value)) {
          for (const item of value) stack.push(item);
          continue;
        }
        if (value && typeof value === 'object') {
          const optionRecord = value as { value?: unknown; text?: { text?: unknown; content?: unknown } };
          addCandidate(optionRecord.value);
          addCandidate(optionRecord.text?.content);
          addCandidate(optionRecord.text?.text);
          stack.push(value);
          continue;
        }
      }

      stack.push(value);
    }
  }

  return { values: Array.from(result), hasExplicit };
}

function extractCustomAnswersFromPayload(payload: unknown): Map<number, string> {
  const result = new Map<number, string>();
  if (!payload || typeof payload !== 'object') return result;
  const visited = new Set<object>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (key.startsWith('custom_q_')) {
        const indexStr = key.slice('custom_q_'.length);
        const index = Number.parseInt(indexStr, 10);
        if (!Number.isNaN(index)) {
          if (typeof value === 'string') {
            result.set(index, value);
          } else if (value === null || value === undefined) {
            result.set(index, '');
          } else {
            result.set(index, String(value));
          }
        }
      }

      stack.push(value);
    }
  }

  return result;
}

function updateCustomAnswersFromPayload(requestId: string, payload: unknown): void {
  const pending = questionHandler.get(requestId);
  if (!pending) return;
  const updates = extractCustomAnswersFromPayload(payload);
  if (updates.size === 0) return;
  for (const [index, value] of updates) {
    if (index < 0 || index >= pending.request.questions.length) continue;
    questionHandler.setDraftCustomAnswer(requestId, index, value);
  }
}

function resolvePendingQuestionFromEvent(
  event: FeishuCardActionEvent,
  rawValue: Record<string, unknown> | null
): { pending: PendingQuestion | null; requestId: string | null } {
  const requestId = typeof rawValue?.requestId === 'string' ? rawValue.requestId : null;
  if (requestId) {
    const pending = questionHandler.get(requestId) || null;
    return { pending, requestId };
  }
  const conversationKey = typeof rawValue?.conversationKey === 'string' ? rawValue.conversationKey : null;
  if (conversationKey) {
    const pending = questionHandler.getByConversationKey(conversationKey) || null;
    return { pending, requestId: pending?.request.id || null };
  }
  const messageId = event.messageId;
  if (messageId) {
    const pending = questionHandler.getByCardMessageId(messageId) || null;
    return { pending, requestId: pending?.request.id || null };
  }
  return { pending: null, requestId: null };
}

function extractQuestionIndexFromPayload(payload: unknown, prefix: string): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const visited = new Set<object>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (key.startsWith(prefix)) {
        const indexStr = key.slice(prefix.length);
        const index = Number.parseInt(indexStr, 10);
        if (!Number.isNaN(index)) return index;
      }
      stack.push(value);
    }
  }

  return null;
}

function findPayloadValue(payload: unknown, targetKey: string): unknown | null {
  if (!payload || typeof payload !== 'object') return null;
  const visited = new Set<object>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    if (targetKey in record) {
      return record[targetKey];
    }

    for (const value of Object.values(record)) {
      stack.push(value);
    }
  }

  return null;
}

function normalizeSelectedValues(
  value: unknown,
  optionSet: Set<string>
): string[] {
  const result: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = toCandidateString(item);
      if (candidate && optionSet.has(candidate)) {
        result.push(candidate);
      }
    }
    return result;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const candidate = toCandidateString(value);
    if (candidate && optionSet.has(candidate)) {
      return [candidate];
    }
    return [];
  }
  if (value && typeof value === 'object') {
    const collected = collectSelectedOptionsFromAction(value, optionSet);
    return collected.values;
  }
  return [];
}

function resolveSelectAction(actionTag: string, selected: string | null): 'model_select' | 'agent_select' | null {
  if (!selected || selected === 'none') return null;
  if (actionTag !== 'select_static' && actionTag !== 'select') return null;
  if (modelOptionsCache.items.some(item => item.value === selected)) return 'model_select';
  if (agentOptionsCache.items.some(item => item.value === selected)) return 'agent_select';
  return selected.includes('/') ? 'model_select' : 'agent_select';
}

// 处理中断命令
async function handleStop(conversation: { key: string }, messageId: string): Promise<void> {
  const sessionId = userSessionStore.getCurrentSessionId(conversation.key);

  if (!sessionId) {
    await feishuClient.reply(messageId, '❌ 没有正在进行的任务');
    return;
  }

  const success = await opencodeClient.abortSession(sessionId);
  if (success) {
    outputBuffer.setStatus(conversation.key, 'aborted');
    await feishuClient.reply(messageId, '⏹️ 已中断执行');
  } else {
    await feishuClient.reply(messageId, '❌ 中断失败，可能没有正在执行的任务');
  }
}

// 撤回上一轮（OpenCode + 飞书）
async function handleUndo(
  conversation: { key: string },
  chatId: string,
  chatType: 'p2p' | 'group',
  messageId: string
): Promise<void> {
  const sessionId = userSessionStore.getCurrentSessionId(conversation.key);
  if (!sessionId) {
    await feishuClient.reply(messageId, '❌ 没有可撤回的会话');
    return;
  }

  const state = getConversationState(conversation.key);
  const userMessageId = state.lastUserMessageId;
  const hadOpencode = Boolean(state.lastOpencodeMessageId);
  const hadUserMessage = Boolean(userMessageId);
  const hadBotMessage = Boolean(state.lastFeishuReplyMessageId);

  let opencodeOk = false;
  if (state.lastOpencodeMessageId) {
    opencodeOk = await opencodeClient.revertMessage(sessionId, state.lastOpencodeMessageId);
  }

  let deleteUserOk = true;
  if (chatType !== 'p2p' && userMessageId) {
    deleteUserOk = await feishuClient.deleteMessage(userMessageId);
  }

  let deleteBotOk = true;
  if (state.lastFeishuReplyMessageId) {
    deleteBotOk = await feishuClient.deleteMessage(state.lastFeishuReplyMessageId);
  }

  if (opencodeOk) {
    state.lastOpencodeMessageId = undefined;
  }
  if (deleteUserOk && state.lastUserMessageId === userMessageId) {
    state.lastUserMessageId = undefined;
  }
  if (deleteBotOk) {
    state.lastFeishuReplyMessageId = undefined;
  }

  const statusLines = [
    `OpenCode: ${hadOpencode ? (opencodeOk ? '已撤回' : '撤回失败') : '无可撤回'}`,
    `用户消息: ${chatType === 'p2p' ? '跳过' : hadUserMessage ? (deleteUserOk ? '已撤回' : '撤回失败') : '无可撤回'}`,
    `机器人消息: ${hadBotMessage ? (deleteBotOk ? '已撤回' : '撤回失败') : '无可撤回'}`,
  ];

  await feishuClient.reply(messageId, `撤回结果\n${statusLines.join('\n')}`);
}

async function handleUndoFromCard(
  conversationKey: string,
  chatId?: string,
  chatType?: 'p2p' | 'group'
): Promise<void> {
  const sessionId = userSessionStore.getCurrentSessionId(conversationKey);
  if (!sessionId) return;

  const state = getConversationState(conversationKey);
  if (state.lastOpencodeMessageId) {
    const ok = await opencodeClient.revertMessage(sessionId, state.lastOpencodeMessageId);
    if (ok) {
      state.lastOpencodeMessageId = undefined;
    }
  }

  const userMessageId = state.lastUserMessageId;
  if (userMessageId && chatType !== 'p2p') {
    const ok = await feishuClient.deleteMessage(userMessageId);
    if (ok && state.lastUserMessageId === userMessageId) {
      state.lastUserMessageId = undefined;
    }
  }

  if (state.lastFeishuReplyMessageId) {
    const ok = await feishuClient.deleteMessage(state.lastFeishuReplyMessageId);
    if (ok) {
      state.lastFeishuReplyMessageId = undefined;
    }
  }
}

// 处理模型切换
async function handleModel(command: ParsedCommand, messageId: string): Promise<void> {
  if (!command.modelName) {
    // 显示当前模型
    const current = currentModel.providerId && currentModel.modelId
      ? `${currentModel.providerId}/${currentModel.modelId}`
      : '跟随服务器默认';
    await feishuClient.reply(messageId, `当前模型: ${current}`);
    return;
  }

  // 解析模型名称（支持 provider/model 格式）
  const parts = command.modelName.split('/');
  if (parts.length === 2) {
    currentModel.providerId = parts[0];
    currentModel.modelId = parts[1];
  } else {
    // 只指定模型名，保持provider不变
    if (!currentModel.providerId) {
      await feishuClient.reply(messageId, '❌ 请使用 provider/model 格式');
      return;
    }
    currentModel.modelId = command.modelName;
  }

  await feishuClient.reply(
    messageId,
    `✅ 已切换模型: ${currentModel.providerId}/${currentModel.modelId}`
  );
}

// 处理Agent切换
async function handleAgent(
  command: ParsedCommand,
  conversation: { key: string },
  messageId: string
): Promise<void> {
  const state = getConversationState(conversation.key);
  if (!command.agentName) {
    const current = state.agent || '默认';
    await feishuClient.reply(messageId, `当前Agent: ${current}`);
    return;
  }

  const agents = await getAgentOptions();
  const exists = agents.find(a => a.value === command.agentName);
  if (!exists) {
    await feishuClient.reply(messageId, '❌ 未找到该Agent');
    return;
  }

  state.agent = command.agentName;
  await feishuClient.reply(messageId, `✅ 已切换Agent: ${command.agentName}`);
}

// 透传命令
async function handleCommand(
  command: ParsedCommand,
  conversation: { key: string; mode: ConversationMode },
  messageId: string
): Promise<void> {
  if (!command.commandName) {
    await feishuClient.reply(messageId, '❌ 未识别命令');
    return;
  }

  const state = getConversationState(conversation.key);
  state.lastUserMessageId = messageId;

  let sessionId = userSessionStore.getCurrentSessionId(conversation.key);
  if (!sessionId) {
    const title = conversation.mode === 'thread'
      ? buildThreadTitle(`/${command.commandName} ${command.commandArgs || ''}`)
      : '飞书对话';
    const session = await opencodeClient.createSession(title);
    sessionId = session.id;
    userSessionStore.setCurrentSession(conversation.key, sessionId, title);
  }

  const result = await opencodeClient.sendCommand(
    sessionId,
    command.commandName,
    command.commandArgs || ''
  );

  if (result) {
    if (result.info?.id) {
      state.lastOpencodeMessageId = result.info.id;
    }
    await feishuClient.reply(messageId, `✅ 已执行: /${command.commandName}`);
  } else {
    await feishuClient.reply(messageId, `❌ 执行失败: /${command.commandName}`);
  }
}

// 控制面板
async function handlePanel(
  conversation: { key: string },
  chatId: string,
  chatType: 'p2p' | 'group',
  messageId: string
): Promise<void> {
  const modelOptions = await getModelOptions();
  const agentOptions = await getAgentOptions();
  const safeModels = modelOptions.length > 0
    ? modelOptions
    : [{ label: '暂无模型', value: 'none' }];
  const safeAgents = agentOptions.length > 0
    ? agentOptions
    : [{ label: '暂无Agent', value: 'none' }];

  const state = getConversationState(conversation.key);
  const modelLabel = currentModel.providerId && currentModel.modelId
    ? `${currentModel.providerId}/${currentModel.modelId}`
    : undefined;

  const card = buildControlCard({
    conversationKey: conversation.key,
    chatId,
    chatType,
    currentModel: modelLabel,
    currentAgent: state.agent,
    models: safeModels,
    agents: safeAgents,
  });

  await feishuClient.replyCard(messageId, card);
}

// 管理员设置
async function handleAdmin(
  command: ParsedCommand,
  chatId: string,
  messageId: string
): Promise<void> {
  if (command.adminAction !== 'add') {
    await feishuClient.reply(messageId, '❌ 未识别的管理员命令');
    return;
  }

  const ok = await feishuClient.addChatManager(chatId, process.env.FEISHU_APP_ID || '', 'app_id');
  if (ok) {
    await feishuClient.reply(messageId, '✅ 已申请将机器人设为群管理员');
  } else {
    await feishuClient.reply(messageId, '❌ 设置失败：需要群主权限或接口未授权');
  }
}


// 列出会话
async function handleListSessions(conversation: { key: string }, messageId: string): Promise<void> {
  const sessions = userSessionStore.getUserSessions(conversation.key);
  const currentId = userSessionStore.getCurrentSessionId(conversation.key);

  if (sessions.length === 0) {
    await feishuClient.reply(messageId, '📭 暂无对话记录');
    return;
  }

  const lines = sessions.map((s, i) => {
    const current = s.id === currentId ? ' 👈 当前' : '';
    const date = new Date(s.createdAt).toLocaleDateString();
    return `${i + 1}. ${s.title} (${date})${current}\n   ID: ${s.id.slice(0, 8)}...`;
  });

  await feishuClient.reply(messageId, `📋 **对话列表**\n\n${lines.join('\n\n')}`);
}

// 处理会话操作
async function handleSession(
  command: ParsedCommand,
  conversation: { key: string },
  messageId: string
): Promise<void> {
  switch (command.sessionAction) {
    case 'new': {
      const session = await opencodeClient.createSession('飞书对话');
      userSessionStore.setCurrentSession(conversation.key, session.id, '飞书对话');
      await feishuClient.reply(messageId, `✅ 已创建新对话\nID: ${session.id.slice(0, 8)}...`);
      break;
    }

    case 'switch': {
      if (!command.sessionId) {
        await feishuClient.reply(messageId, '❌ 请指定会话ID');
        return;
      }

      // 查找匹配的会话
      const sessions = userSessionStore.getUserSessions(conversation.key);
      const target = sessions.find(
        s => s.id.startsWith(command.sessionId!) || s.id === command.sessionId
      );

      if (target) {
        userSessionStore.setCurrentSession(conversation.key, target.id, target.title);
        await feishuClient.reply(messageId, `✅ 已切换到: ${target.title}`);
      } else {
        await feishuClient.reply(messageId, '❌ 未找到该会话');
      }
      break;
    }

    case 'list':
    default:
      await handleListSessions(conversation, messageId);
      break;
  }
}

// 清空对话
async function handleClear(conversation: { key: string }, messageId: string): Promise<void> {
  const session = await opencodeClient.createSession('飞书对话');
  userSessionStore.setCurrentSession(conversation.key, session.id, '飞书对话');
  await feishuClient.reply(messageId, '🗑️ 已清空对话，开始新会话');
}

// 查看状态
async function handleStatus(conversation: { key: string }, messageId: string): Promise<void> {
  const sessionId = userSessionStore.getCurrentSessionId(conversation.key);
  const sessions = userSessionStore.getUserSessions(conversation.key);

  const current = currentModel.providerId && currentModel.modelId
    ? `${currentModel.providerId}/${currentModel.modelId}`
    : '跟随服务器默认';

  const status = [
    `🤖 **OpenCode 状态**`,
    ``,
    `**当前模型**: ${current}`,
    `**当前会话**: ${sessionId ? sessionId.slice(0, 8) + '...' : '无'}`,
    `**会话数量**: ${sessions.length}`,
  ];

  await feishuClient.reply(messageId, status.join('\n'));
}

// 处理权限响应
async function handlePermissionResponse(
  command: ParsedCommand,
  userId: string,
  messageId: string
): Promise<void> {
  const pending = permissionHandler.getPending(userId);

  if (!pending) {
    await feishuClient.reply(messageId, '❓ 没有待确认的权限请求');
    return;
  }

  const allow = command.permissionResponse === 'y' || command.permissionResponse === 'yes';
  const success = await opencodeClient.respondToPermission(
    pending.sessionId,
    pending.permissionId,
    allow
  );

  permissionHandler.removePending(userId);

  if (success) {
    await feishuClient.reply(messageId, allow ? '✅ 已允许' : '❌ 已拒绝');
  } else {
    await feishuClient.reply(messageId, '⚠️ 响应失败，请求可能已超时');
  }
}

async function refreshControlCard(
  event: FeishuCardActionEvent,
  value: { conversationKey?: string; chatId?: string; chatType?: 'p2p' | 'group' }
): Promise<void> {
  const conversationKey = value.conversationKey;
  const messageId = event.messageId;
  const chatId = value.chatId || event.chatId;
  const chatType = value.chatType || 'group';
  if (!conversationKey || !messageId || !chatId) return;

  const modelOptions = await getModelOptions();
  const agentOptions = await getAgentOptions();
  const safeModels = modelOptions.length > 0
    ? modelOptions
    : [{ label: '暂无模型', value: 'none' }];
  const safeAgents = agentOptions.length > 0
    ? agentOptions
    : [{ label: '暂无Agent', value: 'none' }];

  const state = getConversationState(conversationKey);
  const modelLabel = currentModel.providerId && currentModel.modelId
    ? `${currentModel.providerId}/${currentModel.modelId}`
    : undefined;

  const card = buildControlCard({
    conversationKey,
    chatId,
    chatType,
    currentModel: modelLabel,
    currentAgent: state.agent,
    models: safeModels,
    agents: safeAgents,
  });

  await feishuClient.updateCard(messageId, card);
}

// 声明在 processPrompt 之前或提升到模块顶部
// 但由于 processPrompt 使用了 state，我们需要确保 state 也是可用的
// 实际上 getConversationState 是模块级函数，所以没问题


// 处理卡片动作
async function handleCardAction(event: FeishuCardActionEvent): Promise<FeishuCardActionResponse | void> {
  const { openId, action } = event;
  const rawValue = action.value;
  const value = rawValue && typeof rawValue === 'object'
    ? rawValue as {
        action?: string;
        sessionId?: string;
        permissionId?: string;
        remember?: boolean;
        conversationKey?: string;
        chatId?: string;
        chatType?: 'p2p' | 'group';
      }
    : {};
  const actionType = typeof value.action === 'string' ? value.action : null;
  const selected = getSelectedOption(action) || getSelectedOption(event.rawEvent);
  const fallbackSelectAction = actionType ? null : resolveSelectAction(action.tag, selected);
  const selectTags = new Set(['select_static', 'multi_select_static', 'select', 'multi_select']);
  const inputTags = new Set(['input']);
  let effectiveAction = actionType || fallbackSelectAction;

  if (!effectiveAction && selectTags.has(action.tag)) {
    effectiveAction = 'question_select';
  }

  if (!effectiveAction && inputTags.has(action.tag)) {
    const { pending, requestId } = resolvePendingQuestionFromEvent(event, rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : null);
    if (pending && requestId) {
      updateCustomAnswersFromPayload(requestId, event.rawEvent);
      console.log(`[问题输入] 已缓存: requestId=${requestId.slice(0, 8)}...`);
    }
    return { msg: 'ok' };
  }

  console.log(`[卡片动作] 用户: ${openId}, 类型: ${action.tag}, 动作: ${effectiveAction || 'unknown'}`);

  if (effectiveAction === 'permission_allow' || effectiveAction === 'permission_deny') {
    const allow = effectiveAction === 'permission_allow';
    const success = await opencodeClient.respondToPermission(
      value.sessionId || '',
      value.permissionId || '',
      allow,
      value.remember
    );

    if (success) {
      console.log(`[权限] 已${allow ? '允许' : '拒绝'}，remember: ${value.remember}`);
    }
  } else if (effectiveAction === 'abort') {
    const key = value.conversationKey || '';
    const sessionId = key ? userSessionStore.getCurrentSessionId(key) : value.sessionId;
    if (sessionId) {
      await opencodeClient.abortSession(sessionId);
      console.log('[中断] 已发送中断请求');
    }
  } else if (effectiveAction === 'undo') {
    const key = value.conversationKey || '';
    if (key) {
      await handleUndoFromCard(key, value.chatId, value.chatType);
    }
  } else if (effectiveAction === 'model_select') {
    console.log(`[模型选择] ${selected || '未识别'}`);
    const resolved = selected
      || findMatchingOptionValue(event.rawEvent, modelOptionsCache.items)
      || findMatchingOptionValue(action, modelOptionsCache.items);
    if (resolved) {
      if (resolved.includes('/')) {
        const [providerId, modelId] = resolved.split('/');
        currentModel.providerId = providerId;
        currentModel.modelId = modelId;
        await refreshControlCard(event, value);
        return;
      }

      if (currentModel.providerId) {
        currentModel.modelId = resolved;
        await refreshControlCard(event, value);
      } else {
        console.log('[模型选择] 未识别provider，需 provider/model');
      }
    } else {
      try {
        const raw = JSON.stringify(event.rawEvent);
        console.log(`[模型选择] 原始回调: ${raw.slice(0, 2000)}`);
      } catch {
        console.log('[模型选择] 原始回调无法序列化');
      }
    }
  } else if (effectiveAction === 'agent_select') {
    const resolved = selected
      || findMatchingOptionValue(event.rawEvent, agentOptionsCache.items)
      || findMatchingOptionValue(action, agentOptionsCache.items);
    if (resolved && resolved !== 'none') {
      const key = value.conversationKey || '';
      if (key) {
        const state = getConversationState(key);
        state.agent = resolved;
        await refreshControlCard(event, value);
      }
    } else if (resolved === null) {
      try {
        const raw = JSON.stringify(event.rawEvent);
        console.log(`[Agent选择] 原始回调: ${raw.slice(0, 2000)}`);
      } catch {
        console.log('[Agent选择] 原始回调无法序列化');
      }
    }
  } else if (effectiveAction === 'question_select') {
    // 单选：点击选项按钮（只缓存，不发送到 OpenCode）
    console.log(`[卡片动作] question_select 开始处理`);
    const qValue = rawValue as {
      action?: string;
      requestId?: string;
      sessionId?: string;
      questionIndex?: number;
      conversationKey?: string;
      chatId?: string;
    };

    const { pending, requestId } = resolvePendingQuestionFromEvent(
      event,
      rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : null
    );

    if (!pending || !requestId) {
      console.log(`[卡片动作] question_select 未找到问题`);
      return { msg: 'ok' };
    }

    updateCustomAnswersFromPayload(requestId, event.rawEvent);

    let questionIndex = typeof qValue.questionIndex === 'number' ? qValue.questionIndex : null;
    if (questionIndex === null) {
      questionIndex = extractQuestionIndexFromPayload(event.rawEvent, 'select_q_');
    }

    if (questionIndex === null) {
      console.log(`[卡片动作] question_select 未识别题目索引`);
      return { msg: 'ok' };
    }

    const question = pending.request.questions[questionIndex];
    if (!question) {
      console.log(`[卡片动作] question_select 题目不存在: q=${questionIndex}`);
      return { msg: 'ok' };
    }

    const optionSet = new Set(question.options.map(opt => opt.label));
    const payloadValue = findPayloadValue(event.rawEvent, `select_q_${questionIndex}`);
    const directValues = normalizeSelectedValues(payloadValue, optionSet);
    const selectedResult = collectSelectedOptionsFromAction(action, optionSet);
    const fallback = getSelectedOption(action) || getSelectedOption(event.rawEvent);

    if (question.multiple) {
      if (directValues.length > 0) {
        questionHandler.setDraftAnswer(requestId, questionIndex, directValues);
        console.log(`[问题多选] 已缓存: requestId=${requestId.slice(0, 8)}..., q=${questionIndex}, answers=${JSON.stringify(directValues)}`);
      } else if (selectedResult.values.length > 0) {
        questionHandler.setDraftAnswer(requestId, questionIndex, selectedResult.values);
        console.log(`[问题多选] 已缓存: requestId=${requestId.slice(0, 8)}..., q=${questionIndex}, answers=${JSON.stringify(selectedResult.values)}`);
      } else if (fallback && optionSet.has(fallback)) {
        const existing = pending.draftAnswers[questionIndex] || [];
        const set = new Set(existing);
        if (set.has(fallback)) {
          set.delete(fallback);
        } else {
          set.add(fallback);
        }
        questionHandler.setDraftAnswer(requestId, questionIndex, Array.from(set));
        console.log(`[问题多选] 已缓存: requestId=${requestId.slice(0, 8)}..., q=${questionIndex}, answers=${JSON.stringify(Array.from(set))}`);
      } else {
        console.log(`[问题多选] 未识别选择值`);
      }
    } else {
      const selected = directValues[0]
        || selectedResult.values[0]
        || (fallback && optionSet.has(fallback) ? fallback : null);
      if (selected) {
        questionHandler.setDraftAnswer(requestId, questionIndex, [selected]);
        console.log(`[问题选择] 已缓存: requestId=${requestId.slice(0, 8)}..., q=${questionIndex}, answer=${selected}`);
      } else {
        console.log(`[问题选择] 未识别选择值`);
      }
    }

    console.log(`[卡片动作] question_select 处理完成`);
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_toggle') {
    // 多选：点击选项按钮进行切换（只缓存，不发送到 OpenCode）
    console.log(`[卡片动作] question_toggle 开始处理`);
    const qValue = rawValue as {
      action?: string;
      requestId?: string;
      sessionId?: string;
      questionIndex?: number;
      answer?: string;
      conversationKey?: string;
      chatId?: string;
    };

    const requestId = qValue.requestId;
    const questionIndex = typeof qValue.questionIndex === 'number' ? qValue.questionIndex : null;
    const answer = qValue.answer;
    
    if (!requestId) {
      console.log(`[卡片动作] question_toggle 缺少 requestId`);
      return { msg: 'ok' };
    }
    
    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.log(`[卡片动作] question_toggle 未找到问题: requestId=${requestId.slice(0, 8)}...`);
      return { msg: 'ok' };
    }

    if (questionIndex !== null && answer) {
      const existing = pending.draftAnswers[questionIndex] || [];
      const set = new Set(existing);
      if (set.has(answer)) {
        set.delete(answer);
      } else {
        set.add(answer);
      }
      questionHandler.setDraftAnswer(requestId, questionIndex, Array.from(set));
      questionHandler.setCurrentQuestionIndex(requestId, questionIndex);
      console.log(`[问题多选] 已缓存: requestId=${requestId.slice(0, 8)}..., q=${questionIndex}, answers=${JSON.stringify(Array.from(set))}`);
      console.log(`[卡片动作] question_toggle 处理完成`);
      return { msg: 'ok' };
    } else {
      console.log(`[卡片动作] question_toggle 参数不完整: q=${questionIndex}, answer=${answer}`);
      return { msg: 'ok' };
    }
  } else if (effectiveAction === 'question_clear') {
    console.log(`[卡片动作] question_clear 开始处理`);
    const qValue = rawValue as {
      action?: string;
      requestId?: string;
      questionIndex?: number;
    };
    const requestId = qValue.requestId;
    const questionIndex = typeof qValue.questionIndex === 'number' ? qValue.questionIndex : null;
    if (!requestId || questionIndex === null) {
      console.log(`[卡片动作] question_clear 参数不完整`);
      return { msg: 'ok' };
    }
    questionHandler.setDraftAnswer(requestId, questionIndex, []);
    console.log(`[问题清空] 已清空: requestId=${requestId.slice(0, 8)}..., q=${questionIndex}`);
    console.log(`[卡片动作] question_clear 处理完成`);
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_custom') {
    console.log(`[卡片动作] question_custom 开始处理`);
    const qValue = rawValue as {
      action?: string;
      requestId?: string;
      questionIndex?: number;
      chatId?: string;
    };
    const requestId = qValue.requestId;
    const questionIndex = typeof qValue.questionIndex === 'number' ? qValue.questionIndex : null;
    if (!requestId || questionIndex === null) {
      console.log(`[卡片动作] question_custom 参数不完整`);
      return { msg: 'ok' };
    }
    console.log(`[问题自定义] 已忽略（已改为卡片内输入）: requestId=${requestId.slice(0, 8)}..., q=${questionIndex}`);
    console.log(`[卡片动作] question_custom 处理完成`);
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_prev') {
    const qValue = rawValue as { action?: string; requestId?: string };
    const requestId = qValue.requestId;
    if (!requestId) {
      console.log('[问题导航] 上一题: 缺少 requestId');
      return { msg: 'ok' };
    }
    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.log(`[问题导航] 上一题: 未找到问题 requestId=${requestId.slice(0, 8)}...`);
      return { msg: 'ok' };
    }
    const current = questionHandler.getCurrentQuestionIndex(requestId) ?? 0;
    const nextIndex = Math.max(0, current - 1);
    console.log(`[问题导航] 上一题: requestId=${requestId.slice(0, 8)}..., 当前=${current}, 目标=${nextIndex}`);
    questionHandler.setCurrentQuestionIndex(requestId, nextIndex);
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_next') {
    const qValue = rawValue as { action?: string; requestId?: string };
    const requestId = qValue.requestId;
    if (!requestId) {
      console.log('[问题导航] 下一题: 缺少 requestId');
      return { msg: 'ok' };
    }
    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.log(`[问题导航] 下一题: 未找到问题 requestId=${requestId.slice(0, 8)}...`);
      return { msg: 'ok' };
    }
    const current = questionHandler.getCurrentQuestionIndex(requestId) ?? 0;
    const maxIndex = pending.request.questions.length - 1;
    const nextIndex = Math.min(maxIndex, current + 1);
    console.log(`[问题导航] 下一题: requestId=${requestId.slice(0, 8)}..., 当前=${current}, 目标=${nextIndex}, 总题数=${maxIndex + 1}`);
    questionHandler.setCurrentQuestionIndex(requestId, nextIndex);
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_options_prev') {
    console.log(`[卡片动作] question_options_prev 开始处理`);
    const qValue = rawValue as { action?: string; requestId?: string; questionIndex?: number };
    const requestId = qValue.requestId;
    const questionIndex = typeof qValue.questionIndex === 'number' ? qValue.questionIndex : null;
    if (!requestId || questionIndex === null) {
      console.log(`[卡片动作] question_options_prev 参数不完整`);
      return { msg: 'ok' };
    }
    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.log(`[卡片动作] question_options_prev 未找到问题`);
      return { msg: 'ok' };
    }
    const currentPage = questionHandler.getOptionPageIndex(requestId, questionIndex) ?? 0;
    const totalOptions = pending.request.questions[questionIndex]?.options.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalOptions / QUESTION_OPTION_PAGE_SIZE));
    const nextPage = Math.max(0, currentPage - 1);
    questionHandler.setOptionPageIndex(requestId, questionIndex, Math.min(nextPage, totalPages - 1));
    console.log(`[选项分页] 上一页: q=${questionIndex}, 当前页=${currentPage}, 目标页=${nextPage}`);
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_options_next') {
    console.log(`[卡片动作] question_options_next 开始处理`);
    const qValue = rawValue as { action?: string; requestId?: string; questionIndex?: number };
    const requestId = qValue.requestId;
    const questionIndex = typeof qValue.questionIndex === 'number' ? qValue.questionIndex : null;
    if (!requestId || questionIndex === null) {
      console.log(`[卡片动作] question_options_next 参数不完整`);
      return { msg: 'ok' };
    }
    const pending = questionHandler.get(requestId);
    if (!pending) {
      console.log(`[卡片动作] question_options_next 未找到问题`);
      return { msg: 'ok' };
    }
    const currentPage = questionHandler.getOptionPageIndex(requestId, questionIndex) ?? 0;
    const totalOptions = pending.request.questions[questionIndex]?.options.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalOptions / QUESTION_OPTION_PAGE_SIZE));
    const nextPage = Math.min(totalPages - 1, currentPage + 1);
    questionHandler.setOptionPageIndex(requestId, questionIndex, nextPage);
    console.log(`[选项分页] 下一页: q=${questionIndex}, 当前页=${currentPage}, 目标页=${nextPage}`);
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_submit') {
    // 用户点击提交按钮 - 这是唯一发送到 OpenCode 的时机
    console.log(`[卡片动作] question_submit 开始处理`);
    const qValue = rawValue as {
      action?: string;
      requestId?: string;
      sessionId?: string;
      questionCount?: number;
      conversationKey?: string;
      chatId?: string;
    };

    const { pending, requestId } = resolvePendingQuestionFromEvent(
      event,
      rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : null
    );
    if (!requestId) {
      console.log(`[卡片动作] question_submit 缺少 requestId`);
      return { msg: 'ok' };
    }

    if (!pending) {
      console.log(`[卡片动作] question_submit 未找到问题`);
      return { msg: 'ok' };
    }

    updateCustomAnswersFromPayload(requestId, event.rawEvent);
    const questionCount = pending?.request.questions.length || qValue.questionCount || 1;
    const draftAnswers = questionHandler.getDraftAnswers(requestId);
    const draftCustomAnswers = questionHandler.getDraftCustomAnswers(requestId);
    const answers: string[][] = [];

    for (let i = 0; i < questionCount; i++) {
      const custom = (draftCustomAnswers?.[i] || '').trim();
      if (custom) {
        answers.push([custom]);
      } else {
        const draft = draftAnswers?.[i] || [];
        answers.push(draft);
      }
    }

    console.log(`[问题提交] 准备发送到 OpenCode: requestId=${requestId.slice(0, 8)}..., answers=${JSON.stringify(answers)}`);

    const hasAnyAnswer = answers.some(a => a.length > 0);
    if (!hasAnyAnswer) {
      console.log('[问题提交] 未选择任何答案，拒绝提交');
      return { msg: 'ok' };
    }

    questionHandler.setPendingCustomQuestion(requestId, undefined);
    console.log(`[问题提交] 正在发送到 OpenCode...`);
    const success = await opencodeClient.replyQuestion(requestId, answers);
    
    if (success) {
      console.log('[问题提交] OpenCode 接受回答成功');
      questionHandler.remove(requestId);
      const answeredCard = buildQuestionAnsweredCard(answers);
      console.log(`[卡片动作] question_submit 处理完成`);
      return answeredCard;
    }

    console.log('[问题提交] OpenCode 拒绝回答');
    return { msg: 'ok' };
  } else if (effectiveAction === 'question_answer') {
    // 兼容旧版：用户点击了问题选项（单按钮模式，已废弃）
    const qValue = rawValue as {
      action?: string;
      requestId?: string;
      sessionId?: string;
      questionIndex?: number;
      answer?: string;
      conversationKey?: string;
      chatId?: string;
    };
    
    const requestId = qValue.requestId;
    const answer = qValue.answer;
    
    if (requestId && answer) {
      console.log(`[问题回答] requestId=${requestId.slice(0, 8)}..., answer=${answer}`);
      
      // 回复问题（单个问题，单个答案）
      const success = await opencodeClient.replyQuestion(requestId, [[answer]]);
      
      if (success) {
        console.log('[问题回答] 已发送回答');
        questionHandler.remove(requestId);
        
        const answeredCard = buildQuestionAnsweredCard([[answer]]);
        return answeredCard;
      } else {
        console.log('[问题回答] 回答失败');
        return { msg: 'ok' };
      }
    }
  } else if (effectiveAction === 'question_skip') {
    // 用户跳过问题
    const qValue = rawValue as {
      action?: string;
      requestId?: string;
      sessionId?: string;
      conversationKey?: string;
      chatId?: string;
      questionIndex?: number;
    };
    const { pending, requestId } = resolvePendingQuestionFromEvent(
      event,
      rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : null
    );
    if (!pending || !requestId) {
      console.log('[问题跳过] 未找到待回答问题');
      return { msg: 'ok' };
    }

    const currentIndex = typeof qValue.questionIndex === 'number'
      ? qValue.questionIndex
      : pending.currentQuestionIndex;

    console.log(`[问题跳过] requestId=${requestId.slice(0, 8)}..., q=${currentIndex}`);
    questionHandler.setDraftAnswer(requestId, currentIndex, []);
    questionHandler.setDraftCustomAnswer(requestId, currentIndex, '');

    const nextIndex = currentIndex + 1;
    if (nextIndex < pending.request.questions.length) {
      questionHandler.setCurrentQuestionIndex(requestId, nextIndex);
      const state = getConversationState(pending.conversationKey);
      await sendQuestionCard(pending, state.lastUserMessageId || event.messageId || undefined);
      return { msg: 'ok' };
    }

    await submitQuestionAnswers(pending, event.messageId);
    return { msg: 'ok' };
  }
}

// 启动
main().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
});
