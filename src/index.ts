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
import { buildStreamCard, type StreamCardData } from './feishu/cards-stream.js';

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
  const streamContentMap = new Map<string, { text: string; thinking: string }>();
  const reasoningSnapshotMap = new Map<string, string>();

  const appendReasoningFromPart = (sessionID: string, part: { id?: unknown; text?: unknown }, chatId: string): void => {
    if (typeof part.text !== 'string') return;
    if (typeof part.id !== 'string' || !part.id) {
      outputBuffer.appendThinking(`chat:${chatId}`, part.text);
      return;
    }

    const key = `${sessionID}:${part.id}`;
    const prev = reasoningSnapshotMap.get(key) || '';
    const current = part.text;
    if (current.startsWith(prev)) {
      const deltaText = current.slice(prev.length);
      if (deltaText) {
        outputBuffer.appendThinking(`chat:${chatId}`, deltaText);
      }
    } else if (current !== prev) {
      outputBuffer.appendThinking(`chat:${chatId}`, current);
    }
    reasoningSnapshotMap.set(key, current);
  };

  const clearReasoningSnapshotsForSession = (sessionID: string): void => {
    const prefix = `${sessionID}:`;
    for (const key of reasoningSnapshotMap.keys()) {
      if (key.startsWith(prefix)) {
        reasoningSnapshotMap.delete(key);
      }
    }
  };

  const upsertLiveCardInteraction = (
    chatId: string,
    replyMessageId: string | null,
    cardData: StreamCardData,
    bodyMessageId: string | null,
    thinkingMessageId: string | null,
    openCodeMsgId: string
  ): void => {
    const botMessageIds = [bodyMessageId, thinkingMessageId].filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (botMessageIds.length === 0) {
      return;
    }

    let existing = chatSessionStore.findInteractionByBotMsgId(chatId, botMessageIds[0]);
    if (!existing && botMessageIds.length > 1) {
      existing = chatSessionStore.findInteractionByBotMsgId(chatId, botMessageIds[1]);
    }

    if (existing) {
      chatSessionStore.updateInteraction(
        chatId,
        r => r === existing,
        r => {
          if (!r.userFeishuMsgId && replyMessageId) {
            r.userFeishuMsgId = replyMessageId;
          }

          for (const msgId of botMessageIds) {
            if (!r.botFeishuMsgIds.includes(msgId)) {
              r.botFeishuMsgIds.push(msgId);
            }
          }

          r.cardData = { ...cardData };
          r.type = 'normal';
          if (openCodeMsgId) {
            r.openCodeMsgId = openCodeMsgId;
          }
          r.timestamp = Date.now();
        }
      );
      return;
    }

    chatSessionStore.addInteraction(chatId, {
      userFeishuMsgId: replyMessageId || '',
      openCodeMsgId: openCodeMsgId || '',
      botFeishuMsgIds: botMessageIds,
      type: 'normal',
      cardData: { ...cardData },
      timestamp: Date.now(),
    });
  };

  outputBuffer.setUpdateCallback(async (buffer) => {
    const { text, thinking } = outputBuffer.getAndClear(buffer.key);

    if (!text && !thinking && buffer.status === 'running') return;

    const current = streamContentMap.get(buffer.key) || { text: '', thinking: '' };
    current.text += text;
    current.thinking += thinking;

    if (buffer.status !== 'running') {
      if (buffer.finalText) {
        current.text = buffer.finalText;
      }
      if (buffer.finalThinking) {
        current.thinking = buffer.finalThinking;
      }
    }

    streamContentMap.set(buffer.key, current);

    const hasVisibleContent =
      current.text.trim().length > 0 ||
      current.thinking.trim().length > 0 ||
      buffer.tools.length > 0;

    if (!hasVisibleContent && buffer.status === 'running') return;

    const status: StreamCardData['status'] =
      buffer.status === 'failed' || buffer.status === 'aborted'
        ? 'failed'
        : buffer.status === 'completed'
          ? 'completed'
          : 'processing';

    let messageId = buffer.messageId;

    const cardData: StreamCardData = {
      text: current.text,
      thinking: current.thinking,
      chatId: buffer.chatId,
      messageId: messageId || undefined,
      tools: [...buffer.tools],
      status,
      showThinking: false,
    };

    const buildCard = (): object => {
      return buildStreamCard({
        ...cardData,
        messageId: messageId || undefined,
      });
    };

    if (messageId) {
      const updated = await feishuClient.updateCard(messageId, buildCard());
      if (!updated) {
        const newMessageId = await feishuClient.sendCard(buffer.chatId, buildCard());
        if (newMessageId) {
          void feishuClient.deleteMessage(messageId).catch(() => undefined);
          messageId = newMessageId;
          outputBuffer.setMessageId(buffer.key, newMessageId);
          cardData.messageId = newMessageId;
        }
      }
    } else {
      const newMessageId = await feishuClient.sendCard(buffer.chatId, buildCard());
      if (newMessageId) {
        messageId = newMessageId;
        outputBuffer.setMessageId(buffer.key, newMessageId);
        cardData.messageId = newMessageId;
      }
    }

    cardData.messageId = messageId || undefined;
    cardData.thinkingMessageId = undefined;

    upsertLiveCardInteraction(
      buffer.chatId,
      buffer.replyMessageId,
      cardData,
      messageId,
      null,
      buffer.openCodeMsgId
    );

    if (buffer.status !== 'running') {
      streamContentMap.delete(buffer.key);
      clearReasoningSnapshotsForSession(buffer.sessionId);
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

  feishuClient.on('chatUnavailable', (chatId: string) => {
    console.warn(`[Index] 检测到不可用群聊，移除会话绑定: ${chatId}`);
    chatSessionStore.removeSession(chatId);
  });

  // 5. 监听飞书卡片动作
  feishuClient.setCardActionHandler(async (event) => {
    try {
      const actionValue = event.action.value && typeof event.action.value === 'object'
        ? event.action.value as Record<string, unknown>
        : {};
      const action = typeof actionValue.action === 'string' ? actionValue.action : '';
      const toString = (value: unknown): string | undefined => {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };
      const toInteger = (value: unknown): number | undefined => {
        if (typeof value === 'number' && Number.isInteger(value)) {
          return value;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
          const parsed = Number(value);
          return Number.isInteger(parsed) ? parsed : undefined;
        }
        return undefined;
      };

      // 特殊处理创建会话动作 (P2P)
      if (action === 'create_chat') {
        return await p2pHandler.handleCardAction(event);
      }

      // 处理权限确认
      if (action === 'permission_allow' || action === 'permission_deny') {
        const sessionId = toString(actionValue.sessionId);
        const permissionId = toString(actionValue.permissionId);
        if (!sessionId || !permissionId) {
          return {
            toast: {
              type: 'error',
              content: '权限参数缺失',
              i18n_content: { zh_cn: '权限参数缺失', en_us: 'Missing permission params' }
            }
          };
        }

        const allow = action === 'permission_allow';
        const remember = actionValue.remember === true || actionValue.remember === 'true';
        const responded = await opencodeClient.respondToPermission(
          sessionId,
          permissionId,
          allow,
          remember
        );

        if (!responded) {
          console.error(
            `[权限] 响应失败: session=${sessionId}, permission=${permissionId}, allow=${allow}, remember=${remember}`
          );
          return {
            toast: {
              type: 'error',
              content: '权限响应失败',
              i18n_content: { zh_cn: '权限响应失败', en_us: 'Permission response failed' }
            }
          };
        }

        return {
          toast: {
            type: allow ? 'success' : 'error',
            content: allow ? '已允许' : '已拒绝',
            i18n_content: { zh_cn: allow ? '已允许' : '已拒绝', en_us: allow ? 'Allowed' : 'Denied' }
          }
        };
      }

      // 处理 question 跳过按钮
      if (action === 'question_skip') {
        const chatId = toString(actionValue.chatId) || event.chatId;
        const requestId = toString(actionValue.requestId);
        const questionIndex = toInteger(actionValue.questionIndex);

        if (!chatId) {
          return {
            toast: {
              type: 'error',
              content: '无法定位会话',
              i18n_content: { zh_cn: '无法定位会话', en_us: 'Failed to locate chat' }
            }
          };
        }

        const result = await groupHandler.handleQuestionSkipAction({
          chatId,
          messageId: event.messageId,
          requestId,
          questionIndex,
        });

        if (result === 'applied') {
          return {
            toast: {
              type: 'success',
              content: '已跳过本题',
              i18n_content: { zh_cn: '已跳过本题', en_us: 'Question skipped' }
            }
          };
        }

        if (result === 'stale_card') {
          return {
            toast: {
              type: 'error',
              content: '请操作最新问题卡片',
              i18n_content: { zh_cn: '请操作最新问题卡片', en_us: 'Please use latest question card' }
            }
          };
        }

        if (result === 'not_found') {
          return {
            toast: {
              type: 'error',
              content: '当前没有待回答问题',
              i18n_content: { zh_cn: '当前没有待回答问题', en_us: 'No pending question' }
            }
          };
        }

        return {
          toast: {
            type: 'error',
            content: '跳过失败，请重试',
            i18n_content: { zh_cn: '跳过失败，请重试', en_us: 'Skip failed, try again' }
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
      const part = event?.part;
      const sessionID = event?.sessionID || part?.sessionID;
      const delta = event?.delta;
      if (!sessionID) return;

      const chatId = chatSessionStore.getChatId(sessionID);
      if (!chatId) return;

      if (typeof delta === 'string') {
          if (delta.length > 0) {
            if (part?.type === 'reasoning') {
                outputBuffer.appendThinking(`chat:${chatId}`, delta);
                if (typeof part?.id === 'string') {
                  const key = `${sessionID}:${part.id}`;
                  const prev = reasoningSnapshotMap.get(key) || '';
                  reasoningSnapshotMap.set(key, `${prev}${delta}`);
                }
                return;
            }
            outputBuffer.append(`chat:${chatId}`, delta);
            return;
          }

          if (part?.type === 'reasoning') {
            appendReasoningFromPart(sessionID, part, chatId);
            return;
          }
      }

      if (delta && typeof delta === 'object') {
          if (delta.type === 'reasoning') {
              const reasoningText =
                typeof delta.text === 'string'
                  ? delta.text
                  : typeof delta.reasoning === 'string'
                    ? delta.reasoning
                    : '';
              if (reasoningText) {
                outputBuffer.appendThinking(`chat:${chatId}`, reasoningText);
              }
          } else if (delta.type === 'thinking' && typeof delta.thinking === 'string') {
              outputBuffer.appendThinking(`chat:${chatId}`, delta.thinking);
          } else if (delta.type === 'text' && delta.text) {
              outputBuffer.append(`chat:${chatId}`, delta.text);
          } else if (delta.text) {
              outputBuffer.append(`chat:${chatId}`, delta.text);
          }
          return;
      }

      // 某些事件不带 delta，只带最新 part，做兜底
      if (part?.type === 'reasoning' && typeof part.text === 'string') {
          appendReasoningFromPart(sessionID, part, chatId);
      } else if (part?.type === 'text' && typeof part.text === 'string') {
          outputBuffer.append(`chat:${chatId}`, part.text);
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
              chatSessionStore.addInteraction(chatId, {
                userFeishuMsgId: '',
                openCodeMsgId: '',
                botFeishuMsgIds: [msgId],
                type: 'question_prompt',
                timestamp: Date.now()
              });
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
