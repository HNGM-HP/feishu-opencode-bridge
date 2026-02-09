
import { cardActionHandler } from '../src/handlers/card-action.js';
import { questionHandler } from '../src/opencode/question-handler.js';
import { feishuClient } from '../src/feishu/client.js';
import { opencodeClient } from '../src/opencode/client.js';

// Mock dependencies
const mockUpdateCard = jest.fn();
feishuClient.updateCard = mockUpdateCard;

const mockReplyQuestion = jest.fn();
opencodeClient.replyQuestion = mockReplyQuestion;

describe('CardActionHandler - Question Skip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    questionHandler['pending'].clear(); // Clear internal map
  });

  it('should update to next question on skip', async () => {
    // Setup pending question
    const requestId = 'req-123';
    questionHandler.register({
      id: requestId,
      sessionID: 'sess-123',
      questions: [
        { question: 'Q1', header: '', options: [] },
        { question: 'Q2', header: '', options: [] }
      ]
    }, 'key-123', 'chat-123');

    // Initial state
    let pending = questionHandler.get(requestId);
    expect(pending?.currentQuestionIndex).toBe(0);

    // Simulate Skip Action on Q1 (index 0)
    const event = {
      action: {
        value: {
          action: 'question_skip',
          requestId,
          conversationKey: 'key-123',
          questionIndex: 0
        }
      },
      messageId: 'msg-123'
    };

    const result = await cardActionHandler.handle(event as any);

    // Verify state update
    pending = questionHandler.get(requestId);
    expect(pending?.currentQuestionIndex).toBe(1);

    // Verify updateCard was called
    expect(mockUpdateCard).toHaveBeenCalledTimes(1);
    const cardArg = mockUpdateCard.mock.calls[0][1];
    // Check if card content contains Q2 info (title usually has index)
    // The buildQuestionCardV2 puts "**问题 2/2**" in title
    const cardStr = JSON.stringify(cardArg);
    expect(cardStr).toContain('问题 2/2');

    // Verify toast return
    expect(result).toHaveProperty('toast');
    expect((result as any).toast.type).toBe('success');
  });

  it('should submit answers when last question skipped', async () => {
     // Setup pending question (1 question)
     const requestId = 'req-single';
     questionHandler.register({
       id: requestId,
       sessionID: 'sess-single',
       questions: [
         { question: 'Q1', header: '', options: [] }
       ]
     }, 'key-single', 'chat-single');
 
     mockReplyQuestion.mockResolvedValue(true);
 
     // Simulate Skip Action on Q1 (index 0)
     const event = {
       action: {
         value: {
           action: 'question_skip',
           requestId,
           conversationKey: 'key-single',
           questionIndex: 0
         }
       },
       messageId: 'msg-single'
     };
 
     const result = await cardActionHandler.handle(event as any);
 
     // Verify submission
     expect(mockReplyQuestion).toHaveBeenCalledWith(requestId, [['']]); // Empty answer for skip
     
     // Verify cleanup
     expect(questionHandler.get(requestId)).toBeUndefined();
 
     // Verify updateCard (to answered state)
     expect(mockUpdateCard).toHaveBeenCalledTimes(1);
     const cardArg = mockUpdateCard.mock.calls[0][1];
     expect(JSON.stringify(cardArg)).toContain('已回答');
   });
});
