// 平台通用事件与适配器接口定义
// 保持最小化字段集合，支持 Feishu 事件 1:1 映射

/**
 * 平台标识符
 */
export type PlatformId = 'feishu' | 'discord' | 'wecom' | 'telegram' | 'qq' | 'whatsapp' | string;

/**
 * 聊天类型
 */
export type ChatType = 'p2p' | 'group';

/**
 * 发送者类型
 */
export type SenderType = 'user' | 'bot';

/**
 * 平台消息事件（入站消息的通用抽象）
 */
export interface PlatformMessageEvent {
  // 平台标识
  platform: PlatformId;

  // 会话标识（平台原生 ID，非命名空间键）
  conversationId: string;

  // 消息唯一标识
  messageId: string;

  // 发送者标识
  senderId: string;

  // 发送者类型
  senderType: SenderType;

  // 消息内容（纯文本，已去除 @ 机器人等）
  content: string;

  // 消息类型（text, image, file, post 等）
  msgType: string;

  // 可选：线程/话题 ID
  threadId?: string;

  // 可选：聊天类型
  chatType?: ChatType;

  // 可选：附件
  attachments?: PlatformAttachment[];

  // 可选：提及信息
  mentions?: PlatformMention[];

  // 原始平台事件（用于调试和平台特定处理）
  rawEvent: unknown;
}

/**
 * 平台附件
 */
export interface PlatformAttachment {
  type: 'image' | 'file';
  fileKey: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
}

/**
 * 平台提及信息
 */
export interface PlatformMention {
  key: string;
  id: { [key: string]: string };
  name: string;
}

/**
 * 平台动作事件（卡片/按钮点击等交互）
 */
export interface PlatformActionEvent {
  // 平台标识
  platform: PlatformId;

  // 操作者标识
  senderId: string;

  // 动作数据
  action: {
    tag: string;
    value: Record<string, unknown>;
  };

  // 动作令牌（用于回调验证）
  token: string;

  // 可选：关联消息 ID
  messageId?: string;

  // 可选：关联会话 ID
  conversationId?: string;

  // 可选：线程 ID
  threadId?: string;

  // 原始平台事件
  rawEvent: unknown;
}

/**
 * 平台输出发送器接口（出站消息抽象）
 */
export interface PlatformSender {
  // 发送文本消息
  sendText(conversationId: string, text: string): Promise<string | null>;

  // 发送卡片/富媒体消息
  sendCard(conversationId: string, card: object): Promise<string | null>;

  // 更新卡片/消息
  updateCard(messageId: string, card: object): Promise<boolean>;

  // 删除消息
  deleteMessage(messageId: string): Promise<boolean>;

  // 可选：回复消息
  reply?(messageId: string, text: string): Promise<string | null>;

  // 可选：回复卡片
  replyCard?(messageId: string, card: object): Promise<string | null>;
}

/**
 * 平台适配器接口（入站事件接收 + 出站发送）
 */
export interface PlatformAdapter {
  // 平台标识
  readonly platform: PlatformId;

  // 启动适配器（建立连接）
  start(): Promise<void>;

  // 停止适配器（断开连接）
  stop(): void;

  // 获取输出发送器
  getSender(): PlatformSender;

  // 监听消息事件
  onMessage(callback: (event: PlatformMessageEvent) => void): void;

  // 监听动作事件
  onAction(callback: (event: PlatformActionEvent) => void): void;

  // 监听会话不可用事件（群解散等）
  onChatUnavailable?(callback: (conversationId: string) => void): void;

  // 监听消息撤回事件
  onMessageRecalled?(callback: (event: unknown) => void): void;

  // 监听成员退群事件
  onMemberLeft?(callback: (conversationId: string, memberId: string) => void): void;

  // 监听群解散事件
  onChatDisbanded?(callback: (conversationId: string) => void): void;
}