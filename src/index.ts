import { feishuClient } from './feishu/client.js';
import { opencodeClient } from './opencode/client.js';
import { outputBuffer } from './opencode/output-buffer.js';
import { delayedResponseHandler } from './opencode/delayed-handler.js';
import { questionHandler } from './opencode/question-handler.js';
import { permissionHandler } from './permissions/handler.js';
import { chatSessionStore } from './store/chat-session.js';
import { p2pHandler } from './handlers/p2p.js';
import { groupHandler } from './handlers/group.js';
import { lifecycleHandler } from './handlers/lifecycle.js';
import { commandHandler } from './handlers/command.js';
import { cardActionHandler } from './handlers/card-action.js';
import { validateConfig } from './config.js';
import { buildStreamCard } from './feishu/cards-stream.js';

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
  const streamContentMap = new Map<string, { text: string; thinking: string; isCard: boolean }>();

  outputBuffer.setUpdateCallback(async (buffer) => {
    // 获取增量内容
    const { text, thinking } = outputBuffer.getAndClear(buffer.key);
    
    // 如果没有新内容且不是状态变化，跳过
    if (!text && !thinking && buffer.status === 'running') return;

    // 更新全量内容
    const current = streamContentMap.get(buffer.key) || { text: '', thinking: '', isCard: false };
    current.text += text;
    current.thinking += thinking;
    
    // 如果有思考内容，强制使用卡片模式
    if (current.thinking) {
        current.isCard = true;
        outputBuffer.setIsCard(buffer.key, true);
    }
    
    streamContentMap.set(buffer.key, current);

    // 如果任务完成或失败，清理缓存
    if (buffer.status !== 'running') {
        streamContentMap.delete(buffer.key);
    }

    if (!current.text.trim() && !current.thinking.trim()) return;

    // 发送或更新消息
    if (current.isCard) {
        const card = buildStreamCard({
            text: current.text,
            thinking: current.thinking,
            tools: [], // 流式阶段暂不展示工具状态
            status: buffer.status === 'completed' ? 'completed' : 'processing',
            showThinking: false // 默认折叠
        });

        if (buffer.messageId) {
             await feishuClient.updateCard(buffer.messageId, card);
        } else {
             const msgId = await feishuClient.sendCard(buffer.chatId, card);
             if (msgId) outputBuffer.setMessageId(buffer.key, msgId);
        }
    } else {
        // 纯文本模式
        if (buffer.messageId) {
            await feishuClient.updateMessage(buffer.messageId, current.text);
        } else {
            let msgId;
            if (buffer.replyMessageId) {
                msgId = await feishuClient.reply(buffer.replyMessageId, current.text);
            } else {
                msgId = await feishuClient.sendText(buffer.chatId, current.text);
            }
            if (msgId) {
                outputBuffer.setMessageId(buffer.key, msgId);
            }
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
      const actionValue = event.action.value as any;

      // 特殊处理创建会话动作 (P2P)
      if (actionValue?.action === 'create_chat') {
        return await p2pHandler.handleCardAction(event);
      }

      // 处理权限确认
      if (actionValue?.action === 'permission_allow' || actionValue?.action === 'permission_deny') {
        const allow = actionValue.action === 'permission_allow';
        await opencodeClient.respondToPermission(
          actionValue.sessionId,
          actionValue.permissionId,
          allow,
          actionValue.remember
        );
        return {
          toast: {
            type: allow ? 'success' : 'error',
            content: allow ? '已允许' : '已拒绝',
            i18n_content: { zh_cn: allow ? '已允许' : '已拒绝', en_us: allow ? 'Allowed' : 'Denied' }
          }
        };
      }

      // 其他卡片动作统一由 cardActionHandler 处理
      return await cardActionHandler.handle(event);

    } catch (error) {
      console.error('[Index] 卡片动作处理异常:', error);
      return {
        toast: {
          type: 'error',
          content: '处理失败',
          i18n_content: { zh_cn: '处理失败', en_us: 'Failed' }
        }
      };
    }
  });

  // 6. 监听 OpenCode 事件
  // 监听权限请求
  opencodeClient.on('permissionRequest', async (event: any) => {
      console.log(`[权限] 收到请求: ${event.tool}, ID: ${event.permissionId}, Session: ${event.sessionId}`);

      // 1. Check Whitelist
      if (permissionHandler.isToolWhitelisted(event.tool)) {
          console.log(`[权限] 工具 ${event.tool} 在白名单中，自动允许`);
          await opencodeClient.respondToPermission(event.sessionId, event.permissionId, true);
          return;
      }

      // 2. Find Chat ID
      const chatId = chatSessionStore.getChatId(event.sessionId);
      if (chatId) {
          console.log(`[权限] 发送确认卡片 -> Chat: ${chatId}`);
          
          const { buildPermissionCard } = await import('./feishu/cards.js');
          const card = buildPermissionCard({
              tool: event.tool,
              description: event.description,
              risk: event.risk,
              sessionId: event.sessionId,
              permissionId: event.permissionId
          });
          await feishuClient.sendCard(chatId, card);
      } else {
          console.warn(`[权限] ⚠️ 未找到关联的群聊 (Session: ${event.sessionId})，无法发送确认卡片`);
      }
  });
  
  // 监听流式输出
  opencodeClient.on('messagePartUpdated', (event: any) => {
      const { sessionID, delta } = event;
      if (!delta) return;
      
      const chatId = chatSessionStore.getChatId(sessionID);
      if (chatId) {
          if (typeof delta === 'string') {
              outputBuffer.append(`chat:${chatId}`, delta);
          } else if (typeof delta === 'object') {
              if ((delta.type === 'reasoning' && delta.reasoning) || (delta.type === 'thinking' && delta.thinking)) {
                  outputBuffer.appendThinking(`chat:${chatId}`, delta.reasoning || delta.thinking);
              } else if (delta.type === 'text' && delta.text) {
                  outputBuffer.append(`chat:${chatId}`, delta.text);
              } else if (delta.text) {
                   // Fallback for objects with just text
                  outputBuffer.append(`chat:${chatId}`, delta.text);
              }
          }
      }
  });

  // 监听 AI 提问事件
  opencodeClient.on('questionAsked', async (event: any) => {
      // event is QuestionRequest properties
      // need to cast or use as is
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
  
  // 优雅退出处理
  const gracefulShutdown = (signal: string) => {
    console.log(`\n[${signal}] 正在关闭服务...`);

    // 停止飞书连接
    try {
      feishuClient.stop();
    } catch (e) {
      console.error('停止飞书连接失败:', e);
    }

    // 断开 OpenCode 连接
    try {
      opencodeClient.disconnect();
    } catch (e) {
      console.error('断开 OpenCode 失败:', e);
    }

    // 清理所有缓冲区和定时器
    try {
      outputBuffer.clearAll();
      delayedResponseHandler.cleanupExpired(0);
      questionHandler.cleanupExpired(0);
    } catch (e) {
      console.error('清理资源失败:', e);
    }

    // 延迟退出以确保所有清理完成
    setTimeout(() => {
      console.log('✅ 服务已安全关闭');
      process.exit(0);
    }, 500);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon 重启信号
}

main().catch(error => {
  console.error('Fatal Error:', error);
  process.exit(1);
});
