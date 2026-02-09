import { feishuClient, type FeishuMessageEvent, type FeishuCardActionEvent, type FeishuAttachment } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { outputBuffer } from '../opencode/output-buffer.js';
import { delayedResponseHandler } from '../opencode/delayed-handler.js';
import { questionHandler } from '../opencode/question-handler.js';
import { parseQuestionAnswerText } from '../opencode/question-parser.js';
import { buildQuestionCardV2, buildQuestionAnsweredCard } from '../feishu/cards.js';
import { parseCommand } from '../commands/parser.js';
import { commandHandler } from './command.js';
import { modelConfig, attachmentConfig, outputConfig } from '../config.js';
import { randomUUID } from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import type { Part } from '@opencode-ai/sdk';

// 附件相关配置
const ATTACHMENT_BASE_DIR = path.resolve(process.cwd(), 'tmp', 'feishu-uploads');
const OPENCODE_WAIT_REMINDER_MS = 180000;
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.pjp', '.pjpeg', '.jfif', '.jpe'
]);

type OpencodeFilePartInput = { type: 'file'; mime: string; url: string; filename?: string };
type OpencodePartInput = { type: 'text'; text: string } | OpencodeFilePartInput;

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
    attachments?: FeishuAttachment[]
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
        }
    } else {
        // 提交所有答案
        await this.submitQuestionAnswers(pending, messageId);
    }

    return true;
  }

  // 提交问题答案
  private async submitQuestionAnswers(pending: any, replyMessageId: string): Promise<void> {
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
          await feishuClient.sendCard(pending.chatId, answeredCard);
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
      let providerId = modelConfig.defaultProvider;
      let modelId = modelConfig.defaultModel;
      
      if (config?.preferredModel) {
        const [p, m] = config.preferredModel.split(':');
        if (p && m) {
          providerId = p;
          modelId = m;
        } else {
            // 简单的模型名，默认provider?
            modelId = config.preferredModel;
        }
      }

      // 发送请求
      const result = await Promise.race([
        opencodeClient.sendMessageParts(sessionId, parts, {
          providerId,
          modelId,
          agent: config?.preferredAgent
        }, messageId),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('OpenCode响应超时')), OPENCODE_WAIT_REMINDER_MS);
        }),
      ]);

      // 处理结果
      const finalOutput = this.formatOutput(result.parts);
      
      const buffer = outputBuffer.get(`chat:${chatId}`);
      if (buffer?.messageId) {
        // 如果已经有流式消息，更新它为最终结果
        await feishuClient.updateMessage(buffer.messageId, finalOutput);
        chatSessionStore.pushInteraction(chatId, messageId, buffer.messageId);
      } else {
        // 否则发送新消息
        let replyId = await feishuClient.reply(messageId, finalOutput);
        if (!replyId) {
          replyId = await feishuClient.sendText(chatId, finalOutput);
        }
        if (replyId) {
          chatSessionStore.pushInteraction(chatId, messageId, replyId);
        }
      }

      outputBuffer.setStatus(`chat:${chatId}`, 'completed');

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Group] 处理失败:', message);

      if (message === 'OpenCode响应超时') {
        // 注册延迟响应
        delayedResponseHandler.register({
          conversationKey: `chat:${chatId}`,
          chatId,
          sessionId,
          messageId, // OpenCode message ID (not available yet?), wait, strictly speaking this is parent ID
          feishuMessageId: messageId,
          createdAt: Date.now(),
          callback: async (result) => {
             const output = this.formatOutput(result.parts);
             await feishuClient.reply(messageId, output);
          }
        });
        await feishuClient.reply(messageId, '⏳ 请求已发送，正在等待 OpenCode 处理...');
      } else {
        await feishuClient.reply(messageId, `❌ 处理出错: ${message}`);
      }
      
      outputBuffer.setStatus(`chat:${chatId}`, 'completed'); // 即使出错也标记完成以清理 buffer
    } finally {
      outputBuffer.clear(`chat:${chatId}`);
    }
  }

  // 格式化输出
  private formatOutput(parts: Part[] | undefined): string {
    if (!parts || !Array.isArray(parts)) return '(无输出)';
    
    const output: string[] = [];
    for (const part of parts) {
      if (part.type === 'text' && 'text' in part) {
        output.push(part.text as string);
      } else if (part.type === 'tool' && 'state' in part) {
        const toolPart = part as any;
        if (toolPart.state.status === 'completed' && toolPart.state.output) {
          output.push(`📎 [${toolPart.tool}]\n${toolPart.state.output.slice(0, 1000)}`);
        }
      }
    }

    let result = output.join('\n\n');
    if (result.length > outputConfig.maxMessageLength) {
      result = result.slice(0, outputConfig.maxMessageLength) + '\n\n... (内容过长，已截断)';
    }
    return result || '(无输出)';
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

        const fileId = randomUUID();
        // 简单处理扩展名，更严谨的逻辑在 index.ts 里有，这里简化一下
        const ext = path.extname(attachment.fileName || '') || '.bin';
        const filePath = path.join(ATTACHMENT_BASE_DIR, `${fileId}${ext}`);

        try {
            await resource.writeFile(filePath);
            const buffer = await fs.readFile(filePath);
            const base64 = buffer.toString('base64');
            // 简单的 mime 推断
            const mime = 'application/octet-stream'; 
            const dataUrl = `data:${mime};base64,${base64}`;
            
            parts.push({
                type: 'file',
                mime,
                url: dataUrl,
                filename: attachment.fileName || `file${ext}`
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
