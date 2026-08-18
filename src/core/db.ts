/**
 * IndexedDB 封装（v0.0.5）
 * 数据层地基：统一封装数据库打开、object store 创建、CRUD、版本迁移。
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

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly stores: StoreDef[],
    private readonly migrations: Migration[] = [],
  ) {}

  /** 打开数据库（首次创建 store + 执行迁移） */
  async open(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion ?? this.version;
        // 创建缺失的 store（幂等）
        for (const store of this.stores) {
          if (!db.objectStoreNames.contains(store.name)) {
            const os = db.createObjectStore(store.name, { keyPath: store.keyPath });
            for (const idx of store.indexes ?? []) {
              os.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
            }
          }
        }
        // 逐版本执行迁移回调
        for (let v = oldVersion + 1; v <= newVersion; v++) {
          const migration = this.migrations[v];
          if (migration) migration(db, v - 1);
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
    });
  }

  private ensureOpen(): IDBDatabase {
    if (!this.db) throw new Error('数据库未打开，先调用 open()');
    return this.db;
  }

  /** 单条写入（插入或更新） */
  async put<T>(store: string, value: T): Promise<void> {
    const db = this.ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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
    });
  }
}
