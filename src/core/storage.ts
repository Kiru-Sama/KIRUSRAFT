/**
 * 存储服务（v0.0.6）
 * 内核抽象层：把 IndexedDB 封装成 Cordis 服务，插件 inject: ['storage'] 使用。
 * 会话持久化走这里（IndexedDB），不是 localStorage——避免 APITOOL 的暴死问题。
 * 内部 store 结构参考 RikkaHub 实体（消息节点独立存储，conversationId 外键）。
 */
import { Service, Context } from '@deepseek-ai/cordis';
import { Db } from './db';
import { logger } from './logger';
import type { Session, MessageNode } from './types';

const DB_NAME = 'kirusraft';
const DB_VERSION = 1;

export class StorageService extends Service {
  private db: Db;
  private ready: Promise<void>;
  private memoryFallback = false;
  private memorySessions = new Map<string, Session>();

  constructor(ctx: Context) {
    super(ctx, 'storage');
    this.db = new Db(DB_NAME, DB_VERSION, [
      { name: 'conversations', keyPath: 'id', indexes: [{ name: 'createdAt', keyPath: 'createdAt' }] },
      {
        name: 'messageNodes',
        keyPath: 'id',
        indexes: [
          { name: 'byConversationIndex', keyPath: ['conversationId', 'nodeIndex'] },
          { name: 'byConversation', keyPath: 'conversationId' },
        ],
      },
    ]);
    // 打开失败时降级为内存模式（会话仅本次有效），不静默失效；2s 后重试一次（P2-18），
    // 成功则退出内存模式（后续读写走 IDB）
    this.ready = this.db.open().catch((error) => {
      this.memoryFallback = true;
      logger.warn('storage', `IndexedDB 不可用，会话仅保存在内存: ${String(error)}`);
      // 重试一次：临时故障（如存储被占用）恢复后能自动切回持久化
      setTimeout(() => {
        this.db.open().then(() => {
          this.memoryFallback = false;
          logger.info('storage', 'IndexedDB 重试成功，恢复持久化');
        }).catch(() => {
          /* 重试仍失败：保持内存模式 */
        });
      }, 2000);
    });
  }

  /** 保存会话 + 消息节点（跨 store 单事务，保证原子性） */
  async saveConversation(session: Session): Promise<void> {
    await this.ready;
    if (this.memoryFallback) {
      this.memorySessions.set(session.id, session);
      return;
    }
    await this.db.transaction(['conversations', 'messageNodes'], 'readwrite', (tx) => {
      tx.objectStore('conversations').put(session);
      if (session.node) tx.objectStore('messageNodes').put(session.node);
    });
  }

  async listConversations(): Promise<Session[]> {
    await this.ready;
    if (this.memoryFallback) {
      return [...this.memorySessions.values()].sort((a, b) => b.createdAt - a.createdAt);
    }
    const sessions = await this.db.getAll<Session>('conversations');
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getConversation(id: string): Promise<Session | undefined> {
    await this.ready;
    if (this.memoryFallback) return this.memorySessions.get(id);
    return this.db.get<Session>('conversations', id);
  }

  async getMessageNode(nodeId: string): Promise<MessageNode | undefined> {
    await this.ready;
    if (this.memoryFallback) return undefined;
    return this.db.get<MessageNode>('messageNodes', nodeId);
  }

  /** 删除会话 + 级联删除其消息节点（同事务，避免孤儿记录） */
  async deleteConversation(id: string): Promise<void> {
    await this.ready;
    if (this.memoryFallback) {
      this.memorySessions.delete(id);
      return;
    }
    const nodes = await this.db.getByIndex<MessageNode>('messageNodes', 'byConversation', id);
    const nodeIds = nodes.map((n) => n.id);
    await this.db.transaction(['conversations', 'messageNodes'], 'readwrite', (tx) => {
      tx.objectStore('conversations').delete(id);
      for (const nodeId of nodeIds) {
        tx.objectStore('messageNodes').delete(nodeId);
      }
    });
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: StorageService;
  }
}
