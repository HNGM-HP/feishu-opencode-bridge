// OpenCode question 处理器 - 处理 AI 向用户提问的场景

// 问题选项类型
export interface QuestionOption {
  label: string;
  description: string;
}

// 单个问题信息
export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

// 问题请求
export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: {
    messageID: string;
    callID: string;
  };
}

// 待回答的问题上下文
export interface PendingQuestion {
  request: QuestionRequest;
  conversationKey: string;
  chatId: string;
  feishuCardMessageId?: string;
  draftAnswers: string[][];
  draftCustomAnswers: string[];
  pendingCustomQuestionIndex?: number;
  currentQuestionIndex: number;
  optionPageIndexes: number[];
  createdAt: number;
}

class QuestionHandler {
  // 按 requestID 索引待回答的问题
  private pending = new Map<string, PendingQuestion>();
  
  // 按 sessionID 索引，用于查找会话对应的问题
  private sessionIndex = new Map<string, string>();

  // 注册待回答的问题
  register(
    request: QuestionRequest,
    conversationKey: string,
    chatId: string
  ): void {
    const pending: PendingQuestion = {
      request,
      conversationKey,
      chatId,
      draftAnswers: Array.from({ length: request.questions.length }, () => []),
      draftCustomAnswers: Array.from({ length: request.questions.length }, () => ''),
      pendingCustomQuestionIndex: undefined,
      currentQuestionIndex: 0,
      optionPageIndexes: Array.from({ length: request.questions.length }, () => 0),
      createdAt: Date.now(),
    };
    
    this.pending.set(request.id, pending);
    this.sessionIndex.set(request.sessionID, request.id);
    
    console.log(`[问题] 注册: requestId=${request.id.slice(0, 8)}..., session=${request.sessionID.slice(0, 8)}...`);
  }

  // 设置飞书卡片消息 ID（用于后续更新）
  setCardMessageId(requestId: string, messageId: string): void {
    const pending = this.pending.get(requestId);
    if (pending) {
      pending.feishuCardMessageId = messageId;
    }
  }

  // 获取待回答的问题
  get(requestId: string): PendingQuestion | undefined {
    return this.pending.get(requestId);
  }

  // 按会话 ID 获取
  getBySession(sessionId: string): PendingQuestion | undefined {
    const requestId = this.sessionIndex.get(sessionId);
    return requestId ? this.pending.get(requestId) : undefined;
  }

  // 按卡片消息 ID 获取
  getByCardMessageId(messageId: string): PendingQuestion | undefined {
    for (const pending of this.pending.values()) {
      if (pending.feishuCardMessageId === messageId) {
        return pending;
      }
    }
    return undefined;
  }

  // 按 conversationKey 获取（用于检测文字回复）
  getByConversationKey(conversationKey: string): PendingQuestion | undefined {
    for (const pending of this.pending.values()) {
      if (pending.conversationKey === conversationKey) {
        return pending;
      }
    }
    return undefined;
  }

  // 设置某个问题的草稿答案
  setDraftAnswer(requestId: string, questionIndex: number, answers: string[]): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (questionIndex < 0 || questionIndex >= pending.request.questions.length) return;
    pending.draftAnswers[questionIndex] = answers;
  }

  setPendingCustomQuestion(requestId: string, questionIndex: number | undefined): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (questionIndex === undefined) {
      pending.pendingCustomQuestionIndex = undefined;
      return;
    }
    if (questionIndex < 0 || questionIndex >= pending.request.questions.length) return;
    pending.pendingCustomQuestionIndex = questionIndex;
  }

  getPendingCustomQuestionIndex(requestId: string): number | undefined {
    const pending = this.pending.get(requestId);
    return pending?.pendingCustomQuestionIndex;
  }

  // 获取草稿答案
  getDraftAnswers(requestId: string): string[][] | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    return pending.draftAnswers;
  }

  // 设置某个问题的自定义答案
  setDraftCustomAnswer(requestId: string, questionIndex: number, answer: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (questionIndex < 0 || questionIndex >= pending.request.questions.length) return;
    pending.draftCustomAnswers[questionIndex] = answer;
  }

  // 获取自定义答案
  getDraftCustomAnswers(requestId: string): string[] | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    return pending.draftCustomAnswers;
  }

  setCurrentQuestionIndex(requestId: string, index: number): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (index < 0 || index >= pending.request.questions.length) return;
    pending.currentQuestionIndex = index;
  }

  getCurrentQuestionIndex(requestId: string): number | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    return pending.currentQuestionIndex;
  }

  setOptionPageIndex(requestId: string, questionIndex: number, pageIndex: number): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (questionIndex < 0 || questionIndex >= pending.request.questions.length) return;
    if (pageIndex < 0) return;
    pending.optionPageIndexes[questionIndex] = pageIndex;
  }

  getOptionPageIndex(requestId: string, questionIndex: number): number | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    if (questionIndex < 0 || questionIndex >= pending.request.questions.length) return null;
    return pending.optionPageIndexes[questionIndex];
  }

  // 移除问题
  remove(requestId: string): PendingQuestion | undefined {
    const pending = this.pending.get(requestId);
    if (pending) {
      this.pending.delete(requestId);
      this.sessionIndex.delete(pending.request.sessionID);
      console.log(`[问题] 移除: requestId=${requestId.slice(0, 8)}...`);
    }
    return pending;
  }

  // 检查是否有待回答的问题
  has(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  // 按会话 ID 检查
  hasForSession(sessionId: string): boolean {
    return this.sessionIndex.has(sessionId);
  }

  // 获取所有待回答的问题
  getAll(): PendingQuestion[] {
    return Array.from(this.pending.values());
  }

  // 清理超时的问题
  cleanupExpired(timeoutMs: number): PendingQuestion[] {
    const now = Date.now();
    const expired: PendingQuestion[] = [];

    for (const [requestId, pending] of this.pending.entries()) {
      if (now - pending.createdAt > timeoutMs) {
        expired.push(pending);
        this.pending.delete(requestId);
        this.sessionIndex.delete(pending.request.sessionID);
      }
    }

    if (expired.length > 0) {
      console.log(`[问题] 清理过期问题: ${expired.length} 个`);
    }

    return expired;
  }

  // 待回答数量
  get size(): number {
    return this.pending.size;
  }
}

// 单例导出
export const questionHandler = new QuestionHandler();
