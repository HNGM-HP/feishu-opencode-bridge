
import { opencodeClient } from '../src/opencode/client.js';
import { commandHandler } from '../src/handlers/command.js';
import { cardHandler } from '../src/handlers/card.js';
import { feishuClient } from '../src/feishu/client.js';

async function testPanel() {
    console.log('--- Starting Test Panel ---');
    
    // 1. Connect
    const connected = await opencodeClient.connect();
    if (!connected) {
        console.error('Failed to connect to OpenCode');
        process.exit(1);
    }

    // 2. Mock Feishu Client methods
    feishuClient.reply = async (msgId, text) => {
        console.log(`[Mock] feishuClient.reply called with msgId=${msgId}, text=${text.substring(0, 50)}...`);
        return 'mock_reply_id';
    };
    
    feishuClient.replyCard = async (msgId, card) => {
        console.log(`[Mock] feishuClient.replyCard called with msgId=${msgId}`);
        // console.log(JSON.stringify(card, null, 2));
        return 'mock_card_id';
    };

    // 3. Test /panel command
    console.log('\n--- Testing /panel command ---');
    await commandHandler.handlePanel('mock_chat_id', 'mock_msg_id');

    // 4. Test Card Action: Model Select
    console.log('\n--- Testing Card Action: Model Select ---');
    await cardHandler.handle({
        chatId: 'mock_chat_id',
        messageId: 'mock_msg_id',
        action: {
            tag: 'select_static',
            option: 'openai:gpt-4',
            value: { action: 'model_select' }
        }
    });

    console.log('\n--- Test Completed ---');
    process.exit(0);
}

testPanel().catch(console.error);
