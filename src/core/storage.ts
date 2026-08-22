/**
 * 存储服务（v0.0.6）
 * 内核抽象层：把 IndexedDB 封装成 Cordis 服务，插件 inject: ['storage'] 使用。
 * 会话持久化走这里（IndexedDB），不是 localStorage——避免 APITOOL 的暴死问题。
 * 内部 store 结构参考 RikkaHub 实体（消息节点独立存储，conversationId 外键）。
 */
import { Service, Context } from '@deepseek-ai/cordis';
import { Db } from './db';
import { logger } from './logger';
import { migrateLegacySession } from './session';
import type { Session, MessageNode } from './types';

const DB_NAME = 'kirusraft';
const DB_VERSION = 2;

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
    { name: 'keyvalue', keyPath: 'key' },
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

  /** 保存会话 + 全部消息节点（跨 store 单事务，保证原子性；nodes 链全量重写）
   *  v0.0.65：节点链模型，Session.nodes 逐个写 messageNodes store（按 nodeIndex 排序） */
  async saveConversation(session: Session): Promise<void> {
    await this.ready;
    if (this.memoryFallback) {
      this.memorySessions.set(session.id, session);
      return;
    }
    const nodes = Array.isArray(session.nodes) ? session.nodes : [];
    // 先取旧节点 id（事务外查询），事务内删旧写新——防节点链缩短时留下孤儿节点
    const oldNodes = await this.db.getByIndex<MessageNode>('messageNodes', 'byConversation', session.id);
    const oldIds = new Set(oldNodes.map((n) => n.id));
    for (const n of nodes) oldIds.delete(n.id);
    await this.db.transaction(['conversations', 'messageNodes'], 'readwrite', (tx) => {
      tx.objectStore('conversations').put(session);
      for (const id of oldIds) tx.objectStore('messageNodes').delete(id);
      for (const n of nodes) tx.objectStore('messageNodes').put(n);
    });
  }

  async listConversations(): Promise<Session[]> {
    await this.ready;
    if (this.memoryFallback) {
      return [...this.memorySessions.values()].map((s) => migrateLegacySession(s)).sort((a, b) => b.createdAt - a.createdAt);
    }
    const sessions = await this.db.getAll<Session>('conversations');
    const withNodes = await Promise.all(sessions.map((s) => this.attachNodes(s)));
    return withNodes.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getConversation(id: string): Promise<Session | undefined> {
    await this.ready;
    if (this.memoryFallback) return migrateLegacySession(this.memorySessions.get(id) as Session & { node?: MessageNode });
    const session = await this.db.get<Session>('conversations', id);
    if (!session) return undefined;
    return this.attachNodes(session);
  }

  /** 把会话的 nodes 链从 messageNodes store 组装回来（按 nodeIndex 排序）；兼容旧数据（单节点平铺）迁移 */
  private async attachNodes(session: Session & { node?: MessageNode }): Promise<Session> {
    const migrated = migrateLegacySession(session);
    if (migrated.nodes) return migrated;
    const nodes = await this.db.getByIndex<MessageNode>('messageNodes', 'byConversation', session.id);
    migrated.nodes = nodes.sort((a, b) => a.nodeIndex - b.nodeIndex);
    return migrated;
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

  /** 清空全部会话与消息节点（重置数据用；两 store 同事务，保证不留孤儿） */
  async clearAll(): Promise<void> {
    await this.ready;
    if (this.memoryFallback) {
      this.memorySessions.clear();
      return;
    }
    await this.db.transaction(['conversations', 'messageNodes'], 'readwrite', (tx) => {
      tx.objectStore('conversations').clear();
      tx.objectStore('messageNodes').clear();
    });
  }

  /** 通用键值读取（供插件存取工作区等非会话数据，IndexedDB 替代 localStorage/Preferences） */
  async getItem<T>(key: string): Promise<T | undefined> {
    await this.ready;
    if (this.memoryFallback) return undefined;
    return this.db.get<T>('keyvalue', key);
  }

  /** 通用键值写入 */
  async setItem(key: string, value: unknown): Promise<void> {
    await this.ready;
    if (this.memoryFallback) return;
    await this.db.transaction(['keyvalue'], 'readwrite', (tx) => {
      tx.objectStore('keyvalue').put({ key, value });
    });
  }

  /** 全量导出（存档）：返回可序列化的会话数组（不含 apiKey 等敏感配置，config 走 localStorage 不带出） */
  async exportAll(): Promise<Session[]> {
    return this.listConversations();
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: StorageService;
  }
}
