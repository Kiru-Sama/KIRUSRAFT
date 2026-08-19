/**
 * IndexedDB 封装（v0.0.6）
 * 数据层地基：统一封装数据库打开、object store 创建、CRUD、版本迁移、事务。
 * 内核通过它做持久化，不直接碰 IndexedDB API（未来可替换存储后端）。
 */

export interface StoreIndexDef {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
}

export interface StoreDef {
  name: string;
  keyPath: string;
  indexes?: StoreIndexDef[];
}

/** 单步迁移：从 oldVersion 升到 oldVersion+1 时执行 */
export type Migration = (db: IDBDatabase, oldVersion: number) => void;

export class Db {
  private db: IDBDatabase | null = null;
  private opening: Promise<void> | null = null;

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly stores: StoreDef[],
    /** key 是目标版本号 v（从 v-1 升到 v 时执行该迁移） */
    private readonly migrations: Record<number, Migration> = {},
  ) {}

  /** 打开数据库（首次创建 store + 补索引 + 执行迁移；并发调用去重） */
  async open(): Promise<void> {
    if (this.db) return;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion ?? this.version;
        // 创建缺失 store + 对已存在 store 补建缺失索引（幂等）
        for (const store of this.stores) {
          let os: IDBObjectStore;
          if (db.objectStoreNames.contains(store.name)) {
            os = req.transaction!.objectStore(store.name);
          } else {
            os = db.createObjectStore(store.name, { keyPath: store.keyPath });
          }
          for (const idx of store.indexes ?? []) {
            if (!os.indexNames.contains(idx.name)) {
              os.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
            }
          }
        }
        // 逐版本执行迁移回调（key 为目标版本号）
        for (let v = oldVersion + 1; v <= newVersion; v++) {
          const migration = this.migrations[v];
          if (migration) migration(db, v - 1);
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => {
        // 失败重置 opening，允许后续重试
        this.opening = null;
        reject(req.error ?? new Error('IndexedDB 打开失败'));
      };
      req.onblocked = () => {
        this.opening = null;
        reject(new Error('IndexedDB 打开被阻塞（版本回退或有旧连接未关闭）'));
      };
    });
    return this.opening;
  }

  private ensureOpen(): IDBDatabase {
    if (!this.db) throw new Error('数据库未打开，先调用 open()');
    return this.db;
  }

  /**
   * 跨 store 事务：保证多写原子性。
   * 注意：fn 必须同步执行（不得 await/跨越事件循环），否则事务在 oncomplete 后才完成会丢结果。
   */
  async transaction(
    stores: string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => void,
  ): Promise<void> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let settled = false;
      try {
        fn(tx);
      } catch (error) {
        settled = true;
        try {
          tx.abort();
        } catch {
          /* 忽略 */
        }
        reject(error);
        return;
      }
      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      tx.onerror = () => {
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error('事务失败'));
        }
      };
      tx.onabort = () => {
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error('事务中止'));
        }
      };
    });
  }

  /** 单条写入（插入或更新） */
  async put<T>(store: string, value: T): Promise<void> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
    });
  }

  /** 单条读取 */
  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
    });
  }

  /** 全量读取 */
  async getAll<T>(store: string): Promise<T[]> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
    });
  }

  /** 按索引查询 */
  async getByIndex<T>(store: string, index: string, value: IDBValidKey): Promise<T[]> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).index(index).getAll(value);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
    });
  }

  /** 删除单条 */
  async delete(store: string, key: IDBValidKey): Promise<void> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
    });
  }

  /** 清空 store */
  async clear(store: string): Promise<void> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
    });
  }
}
