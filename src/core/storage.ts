/**
 * 存储服务（v0.0.5）
 * 内核抽象层：把 IndexedDB 封装成 Cordis 服务，插件 inject: ['storage'] 使用。
 * 会话持久化走这里（IndexedDB），不是 localStorage——避免 APITOOL 的暴死问题。
 * 内部 store 结构参考 RikkaHub 实体（消息节点独立存储），待对齐后细化。
 */
import { Service, Context } from '@deepseek-ai/cordis';
import { Db } from './db';
import type { Session, MessageNode } from './types';

const DB_NAME = 'kirusraft';
const DB_VERSION = 1;

export class StorageService extends Service {
  private db: Db;
  private ready: Promise<void>;

  constructor(ctx: Context) {
    super(ctx, 'storage');
    this.db = new Db(DB_NAME, DB_VERSION, [
      // 会话：独立 store
      { name: 'conversations', keyPath: 'id', indexes: [{ name: 'createdAt', keyPath: 'createdAt' }] },
      // 消息节点：独立 store（参考 RikkaHub message_node），复合索引会话内排序
      {
        name: 'messageNodes',
        keyPath: 'id',
        indexes: [
          { name: 'byConversationIndex', keyPath: ['conversationId', 'nodeIndex'] },
          { name: 'byConversation', keyPath: 'conversationId' },
        ],
      },
    ]);
    this.ready = this.db.open();
  }

  async saveConversation(session: Session): Promise<void> {
    await this.ready;
    await this.db.put('conversations', session);
    if (session.node) {
      await this.db.put('messageNodes', session.node);
    }
  }

  async listConversations(): Promise<Session[]> {
    await this.ready;
    const sessions = await this.db.getAll<Session>('conversations');
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getConversation(id: string): Promise<Session | undefined> {
    await this.ready;
    return this.db.get<Session>('conversations', id);
  }

  async getMessageNode(nodeId: string): Promise<MessageNode | undefined> {
    await this.ready;
    return this.db.get<MessageNode>('messageNodes', nodeId);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.ready;
    await this.db.delete('conversations', id);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: StorageService;
  }
}
