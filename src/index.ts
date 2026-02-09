import { feishuClient } from './feishu/client.js';
import { opencodeClient } from './opencode/client.js';
import { outputBuffer } from './opencode/output-buffer.js';
import { chatSessionStore } from './store/chat-session.js';
import { p2pHandler } from './handlers/p2p.js';
import { groupHandler } from './handlers/group.js';
import { lifecycleHandler } from './handlers/lifecycle.js';
import { commandHandler } from './handlers/command.js';
import { cardHandler } from './handlers/card.js';
import { validateConfig } from './config.js';

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     飞书 × OpenCode 桥接服务 v2.0 (Group)      ║');
  console.log('╚════════════════════════════════════════════════╝');

  // 1. 验证配置
  try {
    validateConfig();
  } catch (error) {
    console.error('配置错误:', error);
    process.exit(1);
  }

  // 2. 连接 OpenCode
  const connected = await opencodeClient.connect();
  if (!connected) {
    console.error('无法连接到OpenCode服务器，请确保 opencode serve 已运行');
    process.exit(1);
  }

  // 3. 配置输出缓冲 (流式响应)
  const streamContentMap = new Map<string, string>();

  outputBuffer.setUpdateCallback(async (buffer) => {
    // 获取增量内容
    const delta = outputBuffer.getAndClear(buffer.key);
    
    // 如果没有新内容且不是状态变化，跳过
    if (!delta && buffer.status === 'running') return;

    // 更新全量内容
    const currentFull = (streamContentMap.get(buffer.key) || '') + delta;
    streamContentMap.set(buffer.key, currentFull);

    // 如果任务完成或失败，清理缓存
    if (buffer.status !== 'running') {
        streamContentMap.delete(buffer.key);
    }

    if (!currentFull.trim()) return;

    // 发送或更新消息
    if (buffer.messageId) {
      // 已有消息，进行更新
      await feishuClient.updateMessage(buffer.messageId, currentFull);
    } else {
      // 第一次发送
      let msgId;
      if (buffer.replyMessageId) {
        msgId = await feishuClient.reply(buffer.replyMessageId, currentFull);
      } else {
        msgId = await feishuClient.sendText(buffer.chatId, currentFull);
      }
      
      if (msgId) {
        outputBuffer.setMessageId(buffer.key, msgId);
      }
    }
  });

  // 4. 监听飞书消息
  feishuClient.on('message', async (event) => {
    try {
      if (event.chatType === 'p2p') {
        await p2pHandler.handleMessage(event);
      } else if (event.chatType === 'group') {
        await groupHandler.handleMessage(event);
      }
    } catch (error) {
      console.error('[Index] 消息处理异常:', error);
    }
  });

  // 5. 监听飞书卡片动作
  feishuClient.setCardActionHandler(async (event) => {
    try {
      const response = await cardHandler.handle(event);
      return response as { msg: string } | object | undefined;
    } catch (error) {
      console.error('[Index] 卡片动作处理异常:', error);
      return { msg: 'error' };
    }
  });

  // 6. 监听 OpenCode 事件
  // 监听权限请求
  opencodeClient.on('permissionRequest', async (event: any) => {
      // 找到对应的 chatId
      const chatId = chatSessionStore.getChatId(event.sessionId);
      if (chatId) {
          console.log(`[权限] 收到权限请求: ${event.tool} (Session: ${event.sessionId}) -> Chat: ${chatId}`);
          
          const { buildPermissionCard } = await import('./feishu/cards.js');
          const card = buildPermissionCard({
              tool: event.tool,
              description: event.description,
              risk: event.risk,
              sessionId: event.sessionId,
              permissionId: event.permissionId
          });
          await feishuClient.sendCard(chatId, card);
      }
  });
  
  // 监听流式输出
  opencodeClient.on('messagePartUpdated', (event: any) => {
      const { sessionID, delta } = event;
      if (!delta) return;
      
      const chatId = chatSessionStore.getChatId(sessionID);
      if (chatId) {
          // 只处理文本增量
          if (typeof delta === 'string') {
              outputBuffer.append(`chat:${chatId}`, delta);
          } else if (typeof delta === 'object' && delta.text) {
              outputBuffer.append(`chat:${chatId}`, delta.text);
          }
      }
  });

  // 监听 AI 提问事件
  opencodeClient.on('questionAsked', async (event: any) => {
      // event is QuestionRequest properties
      const request = event as import('./opencode/question-handler.js').QuestionRequest;
      const chatId = chatSessionStore.getChatId(request.sessionID);
      
      if (chatId) {
          console.log(`[问题] 收到提问: ${request.id} (Chat: ${chatId})`);
          const { questionHandler } = await import('./opencode/question-handler.js');
          const { buildQuestionCardV2 } = await import('./feishu/cards.js');
          
          questionHandler.register(request, `chat:${chatId}`, chatId);
          
          // 发送提问卡片
          const card = buildQuestionCardV2({
              requestId: request.id,
              sessionId: request.sessionID,
              questions: request.questions,
              conversationKey: `chat:${chatId}`,
              chatId: chatId,
              draftAnswers: questionHandler.get(request.id)?.draftAnswers,
              draftCustomAnswers: questionHandler.get(request.id)?.draftCustomAnswers,
              currentQuestionIndex: 0
          });
          
          const msgId = await feishuClient.sendCard(chatId, card);
          if (msgId) {
              questionHandler.setCardMessageId(request.id, msgId);
          }
      }
  });

  // 7. 监听生命周期事件 (需要在启动后注册)
  feishuClient.onMemberLeft(async (chatId, memberId) => {
    await lifecycleHandler.handleMemberLeft(chatId, memberId);
  });

  feishuClient.onChatDisbanded(async (chatId) => {
    console.log(`[Index] 群 ${chatId} 已解散`);
    chatSessionStore.removeSession(chatId);
  });
  
  feishuClient.onMessageRecalled(async (event) => {
    // 处理撤回
    // event.message_id, event.chat_id
    // 如果撤回的消息是该会话最后一条 User Message，则触发 Undo
    const chatId = event.chat_id;
    const recalledMsgId = event.message_id;
    
    if (chatId && recalledMsgId) {
       const session = chatSessionStore.getSession(chatId);
       if (session && session.lastFeishuUserMsgId === recalledMsgId) {
          console.log(`[Index] 检测到用户撤回最后一条消息: ${recalledMsgId}`);
          await commandHandler.handleUndo(chatId);
       }
    }
  });

  // 8. 启动飞书客户端
  await feishuClient.start();

  // 9. 启动清理检查
  await lifecycleHandler.cleanUpOnStart();

  console.log('✅ 服务已就绪');
  
  // 优雅退出
  process.on('SIGINT', () => {
    console.log('正在关闭...');
    feishuClient.stop();
    opencodeClient.disconnect();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal Error:', error);
  process.exit(1);
});
