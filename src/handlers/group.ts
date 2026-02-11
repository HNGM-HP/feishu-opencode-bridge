import { feishuClient, type FeishuMessageEvent, type FeishuCardActionEvent, type FeishuAttachment } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { questionHandler } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import { buildQuestionCardV2, buildQuestionAnsweredCard } from '../feishu/cards.js';
import { type StreamCardData } from '../feishu/cards-stream.js';
import { parseCommand } from '../commands/parser.js';
import { commandHandler } from './command.js';
import { modelConfig, attachmentConfig } from '../config.js';

import { randomUUID } from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

// 附件相关配置
const ATTACHMENT_BASE_DIR = path.resolve(process.cwd(), 'tmp', 'feishu-uploads');
const OPENCODE_WAIT_REMINDER_MS = 180000;
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.pjp', '.pjpeg', '.jfif', '.jpe'
]);

// Helper functions for file type detection
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

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'attachment';
}

type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };

type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

export type QuestionSkipActionResult = 'applied' | 'not_found' | 'stale_card' | 'invalid_state';

export class GroupHandler {
  // 处理群聊消息
  async handleMessage(event: FeishuMessageEvent): Promise<void> {
    const { chatId, content, messageId, senderId, attachments } = event;
    const trimmed = content.trim();

    // 1. 优先处理命令
    const command = parseCommand(trimmed);
    if (command.type !== 'prompt') {
      console.log(`[Group] 收到命令: ${command.type}`);
      await commandHandler.handle(command, {
        chatId,
        messageId,
        senderId,
        chatType: 'group'
      });
      return;
    }

    // 2. 检查是否有待回答的问题
    const hasPending = await this.checkPendingQuestion(chatId, trimmed, messageId, attachments);
    if (hasPending) return;

    // 3. 获取或创建会话
    let sessionId = chatSessionStore.getSessionId(chatId);
    if (!sessionId) {
      // 如果没有绑定会话，自动创建一个
      const title = `群聊会话-${chatId.slice(-4)}`;
      const session = await opencodeClient.createSession(title);
      if (session) {
        sessionId = session.id;
        // 尝试获取群名作为 title，或者用默认的
        chatSessionStore.setSession(chatId, sessionId, senderId, title); // senderId 暂时作为 creator
      } else {
        await feishuClient.reply(messageId, '❌ 无法创建 OpenCode 会话');
        return;
      }
    }

    // 4. 处理 Prompt
    // 记录用户消息ID
    chatSessionStore.updateLastInteraction(chatId, messageId);
    
    // 获取当前会话配置
    const sessionConfig = chatSessionStore.getSession(chatId);
    await this.processPrompt(sessionId, trimmed, chatId, messageId, attachments, sessionConfig);
  }

  // 检查待回答问题
  private async checkPendingQuestion(
    chatId: string, 
    text: string, 
    messageId: string, 
    attachments?: FeishuAttachment[],
    source: 'text' | 'button' = 'text'
  ): Promise<boolean> {
    const pending = questionHandler.getByConversationKey(`chat:${chatId}`);
    if (!pending) return false;

    // 如果有附件，提示先完成回答
    if (attachments && attachments.length > 0) {
      await feishuClient.reply(messageId, '当前有待回答问题，请先完成问题回答');
      return true;
    }

    const currentIndex = pending.currentQuestionIndex;
    const question = pending.request.questions[currentIndex];
    
    // 解析答案
    const parsed = parseQuestionAnswerText(text, question);
    if (!parsed) {
        await feishuClient.reply(messageId, '未识别答案，请回复选项编号/字母，或直接输入自定义内容。');
        return true;
    }

    // 更新草稿
    if (parsed.type === 'skip') {
        questionHandler.setDraftAnswer(pending.request.id, currentIndex, []);
        questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, '');
    } else if (parsed.type === 'custom') {
        questionHandler.setDraftAnswer(pending.request.id, currentIndex, []);
        questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, parsed.custom || text);
    } else {
        questionHandler.setDraftCustomAnswer(pending.request.id, currentIndex, '');
        questionHandler.setDraftAnswer(pending.request.id, currentIndex, parsed.values || []);
    }

    // 进入下一题或提交
    const nextIndex = currentIndex + 1;
    if (nextIndex < pending.request.questions.length) {
        questionHandler.setCurrentQuestionIndex(pending.request.id, nextIndex);
        
        // 发送下一题卡片
        const card = buildQuestionCardV2({
            requestId: pending.request.id,
            sessionId: pending.request.sessionID,
            questions: pending.request.questions,
            conversationKey: pending.conversationKey,
            chatId: pending.chatId,
            draftAnswers: pending.draftAnswers,
            draftCustomAnswers: pending.draftCustomAnswers,
            currentQuestionIndex: nextIndex
        });
        
        const cardMsgId = await feishuClient.sendCard(chatId, card);
        if (cardMsgId) {
            questionHandler.setCardMessageId(pending.request.id, cardMsgId);
            chatSessionStore.addInteraction(chatId, {
              userFeishuMsgId: '',
              openCodeMsgId: '',
              botFeishuMsgIds: [cardMsgId],
              type: 'question_prompt',
              timestamp: Date.now()
            });
        }
    } else {
      // 提交所有答案
      const interactionUserMessageId = source === 'text' ? messageId : '';
      await this.submitQuestionAnswers(pending, messageId, chatId, interactionUserMessageId);
    }

    return true;
  }

  // 处理题目卡片中的“跳过本题”按钮
  async handleQuestionSkipAction(params: {
    chatId: string;
    messageId?: string;
    requestId?: string;
    questionIndex?: number;
  }): Promise<QuestionSkipActionResult> {
    const pending = questionHandler.getByConversationKey(`chat:${params.chatId}`);
    if (!pending) {
      return 'not_found';
    }

    if (params.requestId && params.requestId !== pending.request.id) {
      return 'stale_card';
    }

    if (typeof params.questionIndex === 'number' && params.questionIndex !== pending.currentQuestionIndex) {
      return 'stale_card';
    }

    const messageId = params.messageId || pending.feishuCardMessageId;
    if (!messageId) {
      return 'invalid_state';
    }

    try {
      const handled = await this.checkPendingQuestion(params.chatId, '跳过', messageId, undefined, 'button');
      return handled ? 'applied' : 'not_found';
    } catch (error) {
      console.error('[Group] 处理跳过按钮失败:', error);
      return 'invalid_state';
    }
  }

  // 提交问题答案
  private async submitQuestionAnswers(
    pending: any,
    replyMessageId: string,
    chatId: string,
    interactionUserMessageId: string
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

      console.log(`[Group] 提交问题回答: requestId=${pending.request.id.slice(0, 8)}...`);
      const success = await opencodeClient.replyQuestion(pending.request.id, answers);
      
      if (success) {
          questionHandler.remove(pending.request.id);
          const answeredCard = buildQuestionAnsweredCard(answers);
          const msgId = await feishuClient.sendCard(pending.chatId, answeredCard);
          
           if (msgId) {
              // 记录交互历史
              chatSessionStore.addInteraction(chatId, {
                  userFeishuMsgId: interactionUserMessageId,
                  openCodeMsgId: '', // 暂时无法获取，Undo时需动态查找
                  botFeishuMsgIds: [msgId],
                  type: 'question_answer',
                  timestamp: Date.now()
             });
          }
      } else {
          await feishuClient.reply(replyMessageId, '⚠️ 回答提交失败，请重试');
      }
  }


  // 清除上下文
  private async handleClear(chatId: string, messageId: string): Promise<void> {
    const sessionId = chatSessionStore.getSessionId(chatId);
    if (sessionId) {
      // OpenCode 目前可能没有 deleteSession 接口，或者仅仅是解绑？
      // 按照之前的逻辑，可能是 deleteSession
      await opencodeClient.deleteSession(sessionId);
      chatSessionStore.removeSession(chatId);
      await feishuClient.reply(messageId, '🧹 会话上下文已清除，新消息将开启新会话。');
    } else {
      await feishuClient.reply(messageId, '当前没有活跃的会话。');
    }
  }

  // 处理消息发送
  private async processPrompt(
    sessionId: string,
    text: string,
    chatId: string,
    messageId: string,
    attachments?: FeishuAttachment[],
    config?: { preferredModel?: string; preferredAgent?: string }
  ): Promise<void> {
    // 注册输出缓冲
    outputBuffer.getOrCreate(`chat:${chatId}`, chatId, sessionId, messageId);
    let waitReminderTimer: NodeJS.Timeout | null = null;

    try {
      console.log(`[Group] 发送消息: chat=${chatId}, session=${sessionId.slice(0, 8)}...`);

      const parts: OpencodePartInput[] = [];
      if (text) {
        parts.push({ type: 'text', text });
      }

      if (attachments && attachments.length > 0) {
        const prepared = await this.prepareAttachmentParts(messageId, attachments);
        if (prepared.warnings.length > 0) {
          await feishuClient.reply(messageId, `⚠️ 附件警告:\n${prepared.warnings.join('\n')}`);
        }
        parts.push(...prepared.parts);
      }

      if (parts.length === 0) {
        await feishuClient.reply(messageId, '未检测到有效内容');
        outputBuffer.setStatus(`chat:${chatId}`, 'completed');
        return;
      }

      // 提取 providerId 和 modelId
      let providerId: string | undefined;
      let modelId: string | undefined;

      if (modelConfig.defaultProvider && modelConfig.defaultModel) {
        providerId = modelConfig.defaultProvider;
        modelId = modelConfig.defaultModel;
      }

      if (config?.preferredModel) {
        const [p, m] = config.preferredModel.split(':');
        if (p && m) {
          providerId = p;
          modelId = m;
        } else {
            // 兼容历史数据：仅模型名时，尝试复用环境中声明的 provider
            // 若未声明 provider，则不显式传 model，交由 OpenCode 默认模型决策
          if (providerId) {
            modelId = config.preferredModel;
          }
        }
      }

      // 发送请求（不中断主请求，仅在等待过久时提示）
      waitReminderTimer = setTimeout(() => {
        void feishuClient.reply(messageId, '⏳ OpenCode 正在处理中，请稍候...').catch(() => undefined);
      }, OPENCODE_WAIT_REMINDER_MS);

      const result = await opencodeClient.sendMessageParts(
        sessionId,
        parts,
        {
          providerId,
          modelId,
          agent: config?.preferredAgent
        },
        messageId
      );

      if (waitReminderTimer) {
        clearTimeout(waitReminderTimer);
        waitReminderTimer = null;
      }

      // 处理结果：只更新缓冲区元数据，由统一的流式渲染器输出卡片
      const finalData: StreamCardData = {
        thinking: '',
        text: '',
        tools: [],
        status: 'completed',
        showThinking: false,
      };

      if (result.parts) {
        for (const part of result.parts) {
          if (part.type === 'reasoning') {
            const reasoningText =
              typeof (part as { text?: unknown }).text === 'string'
                ? (part as { text: string }).text
                : '';
            if (reasoningText) {
              finalData.thinking += reasoningText;
            }
            continue;
          }

          if (part.type === 'text') {
            const textPart = part as { text?: unknown };
            if (typeof textPart.text === 'string') {
              finalData.text += textPart.text;
            }
            continue;
          }

          if (part.type === 'tool') {
            const toolPart = part as {
              tool?: unknown;
              state?: {
                status?: unknown;
                output?: unknown;
              };
            };

            const toolName = typeof toolPart.tool === 'string' ? toolPart.tool : 'tool';
            const rawStatus = toolPart.state?.status;
            const toolStatus =
              rawStatus === 'pending' || rawStatus === 'running' || rawStatus === 'completed' || rawStatus === 'failed'
                ? rawStatus
                : 'completed';

            let toolOutput: string | undefined;
            if (typeof toolPart.state?.output === 'string') {
              toolOutput = toolPart.state.output;
            } else if (toolPart.state?.output !== undefined) {
              try {
                toolOutput = JSON.stringify(toolPart.state.output);
              } catch {
                toolOutput = String(toolPart.state.output);
              }
            }

            finalData.tools.push({
              name: toolName,
              status: toolStatus,
              ...(toolOutput ? { output: toolOutput } : {}),
            });
          }
        }
      }

      const bufferKey = `chat:${chatId}`;
      outputBuffer.setTools(bufferKey, finalData.tools);
      outputBuffer.setFinalSnapshot(bufferKey, finalData.text, finalData.thinking);
      outputBuffer.setOpenCodeMsgId(bufferKey, result.info?.id || '');
      outputBuffer.setStatus(bufferKey, 'completed');

    } catch (error) {

      const message = error instanceof Error ? error.message : String(error);
      console.error('[Group] 处理失败:', message);

      await feishuClient.reply(messageId, `❌ 处理出错: ${message}`);
      
      outputBuffer.setStatus(`chat:${chatId}`, 'completed'); // 即使出错也标记完成以清理 buffer
    } finally {
      if (waitReminderTimer) {
        clearTimeout(waitReminderTimer);
        waitReminderTimer = null;
      }
      outputBuffer.clear(`chat:${chatId}`);
    }
  }

  // 处理附件
  private async prepareAttachmentParts(
    messageId: string,
    attachments: FeishuAttachment[]
  ): Promise<{ parts: OpencodeFilePartInput[]; warnings: string[] }> {
    const parts: OpencodeFilePartInput[] = [];
    const warnings: string[] = [];

    await fs.mkdir(ATTACHMENT_BASE_DIR, { recursive: true }).catch(() => undefined);

    for (const attachment of attachments) {
        if (attachment.fileSize && attachment.fileSize > attachmentConfig.maxSize) {
            warnings.push(`附件 ${attachment.fileName} 过大，已跳过`);
            continue;
        }

        const resource = await feishuClient.downloadMessageResource(messageId, attachment.fileKey, attachment.type);
        if (!resource) {
            warnings.push(`附件 ${attachment.fileName || '未知'} 下载失败`);
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
            warnings.push(`附件格式不支持 (${ext || 'unknown'})，已跳过`);
            continue;
        }

        const fileId = randomUUID();
        const filePath = path.join(ATTACHMENT_BASE_DIR, `${fileId}${ext}`);
        const rawName = attachment.fileName || `attachment${ext}`;
        const safeName = sanitizeFilename(rawName.endsWith(ext) ? rawName : `${rawName}${ext}`);

        try {
            await resource.writeFile(filePath);
            const buffer = await fs.readFile(filePath);
            const base64 = buffer.toString('base64');
            
            let mime = contentType ? contentType.split(';')[0].trim() : '';
            if (!mime || mime === 'application/octet-stream') {
                mime = mimeFromExtension(ext);
            }
            
            const dataUrl = `data:${mime};base64,${base64}`;
            
            parts.push({
                type: 'file',
                mime,
                url: dataUrl,
                filename: safeName
            });
        } catch (e) {
            warnings.push(`附件处理失败: ${attachment.fileName}`);
        } finally {
            fs.unlink(filePath).catch(() => {});
        }
    }

    return { parts, warnings };

  }
}

export const groupHandler = new GroupHandler();
