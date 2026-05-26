export interface Message {
  readonly fromUserId: string;
  readonly fromUserName: string;
  readonly content: string;
  readonly timestamp: Date;
  readonly conversationId: string;
  readonly contextToken?: string;
}

export interface BotPlatform {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(conversationId: string, content: string): Promise<void>;
  sendTyping(conversationId: string): Promise<void>;
  onMessage(callback: (msg: Message) => void): () => void;
}
