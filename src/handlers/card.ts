import { feishuClient } from '../feishu/client.js';
import { opencodeClient } from '../opencode/client.js';
import { chatSessionStore } from '../store/chat-session.js';
import { commandHandler } from './command.js';
import { p2pHandler } from './p2p.js';

export class CardHandler {
  async handle(event: any): Promise<{ msg: string } | object | undefined> {
    const actionValue = event.action.value as any;
    const chatId = event.chatId;
    const messageId = event.messageId;

    console.log(`[CardHandler] 收到动作: ${JSON.stringify(actionValue)}`);

    // 0. 特殊处理 P2P 创建会话 (委托给 p2pHandler)
    if (actionValue?.action === 'create_chat') {
        await p2pHandler.handleCardAction(event);
        return;
    }

    // 1. 权限确认
    if (actionValue?.action === 'permission_allow' || actionValue?.action === 'permission_deny') {
        const allow = actionValue.action === 'permission_allow';
        await opencodeClient.respondToPermission(
            actionValue.sessionId, 
            actionValue.permissionId, 
            allow, 
            actionValue.remember
        );
        return { msg: 'ok' }; 
    }

    // 2. 面板控制 (停止/撤回)
    if (actionValue?.action === 'stop') {
        if (chatId && messageId) {
            await commandHandler.handleStop(chatId, messageId);
        }
        return { msg: 'ok' };
    }

    if (actionValue?.action === 'undo') {
        if (chatId && messageId) {
            await commandHandler.handleUndo(chatId, messageId);
        }
        return { msg: 'ok' };
    }

    // 3. 面板配置 (切换模型/Agent)
    if (actionValue?.action === 'model_select') {
        const selected = event.action.tag === 'select_static' 
            ? (event.action as any).option 
            : null;
        
        if (selected && chatId && messageId) {
            const modelValue = selected;
            chatSessionStore.updateConfig(chatId, { preferredModel: modelValue });
            await feishuClient.reply(messageId, `✅ 已切换模型: ${modelValue}`);
            // 刷新面板
            await commandHandler.handlePanel(chatId, messageId);
        }
        return { msg: 'ok' };
    }

    if (actionValue?.action === 'agent_select') {
        const selected = event.action.tag === 'select_static' 
            ? (event.action as any).option 
            : null;

        if (selected && chatId && messageId) {
            const agentValue = selected === 'none' ? undefined : selected;
            chatSessionStore.updateConfig(chatId, { preferredAgent: agentValue });
            await feishuClient.reply(messageId, `✅ 已切换 Agent: ${agentValue || '无'}`);
            // 刷新面板
            await commandHandler.handlePanel(chatId, messageId);
        }
        return { msg: 'ok' };
    }

    // 4. 问题回答 (跳过)
    if (actionValue?.action === 'question_skip') {
        const success = await opencodeClient.rejectQuestion(actionValue.requestId);
        if (messageId) {
            if (success) {
                await feishuClient.reply(messageId, '✅ 已跳过该问题');
            } else {
                await feishuClient.reply(messageId, '❌ 跳过失败，请重试');
            }
        }
        return { msg: 'ok' };
    }
    
    return { msg: 'ok' };
  }
}

export const cardHandler = new CardHandler();
