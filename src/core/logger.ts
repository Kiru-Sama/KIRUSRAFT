/**
 * 内核日志系统（v0.0.43 重构）
 * 理念抄 pino/loglevel（结构化字段、级别阈值、sink 可替换），但零依赖自研：
 *  - 按天分片存储（IDB key = `YYYY-MM-DD:id`）：导出按天隔离，几天日志不再被一次复制混在一起；
 *  - 轮转：保留最近 MAX_DAYS 天 + 上限 MAX_ENTRIES 条，超限删最旧（防无限增长）；
 *  - 级别过滤：threshold 持久化，低于阈值的日志不记；
 *  - 异常捕获（error/unhandledrejection）+ console 捕获（防循环）；
 *  - 导出：文本生成（带版本前缀可溯源）+ 复制剪贴板 + 文件下载；
 *  - IDB 不可用降级内存环形缓冲（应急控制台仍可查最近日志）。
 * 旧版 localStorage(kirusraft.logs.v1) 首次启动迁移到 IDB 后删除。
 */

import { VERSION } from './version';

/** 日志级别（rank 越大越严重） */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** 日志条目（id 全局唯一：导出合并时按 id 去重，防重复复制） */
export interface LogEntry {
  id: string;
  time: number;
  level: LogLevel;
  source: string;
  message: string;
  /** 产生本条日志时的应用版本（诊断溯源用，老日志无此字段） */
  version?: string;
}

/** 导出时间范围 */
export type LogRange = 'today' | '3d' | 'all';

const IDB_NAME = 'kirusraft-logs';
const IDB_VERSION = 1;
const STORE = 'logs';
const LEGACY_STORAGE_KEY = 'kirusraft.logs.v1';
const LEVEL_KEY = 'kirusraft.log.level';
const MAX_MEMORY = 500; // 未落盘内存缓冲上限（IDB 挂掉时兜底）
const MAX_DAYS = 7; // 轮转：保留最近天数
const MAX_ENTRIES = 5000; // 轮转：保留上限条数

/** 本地日期键 YYYY-MM-DD（按天分片） */
export function dayKeyFor(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** IDB 记录键：`day:id`（按天分片，天然按天隔离） */
function recordKey(day: string, id: string): string {
  return `${day}:${id}`;
}

/** 单条渲染（导出/查看共用格式，含版本前缀可溯源） */
export function renderEntry(e: LogEntry): string {
  const d = new Date(e.time);
  const p = (n: number): string => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const ver = e.version ? `[v${e.version}] ` : '';
  return `[${ts}] ${ver}${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}`;
}

/** 按时间范围过滤（today=当天，3d=最近 72 小时，all=全部） */
export function filterByRange(entries: LogEntry[], range: LogRange, now = Date.now()): LogEntry[] {
  if (range === 'all') return entries;
  const cutoff = range === 'today' ? now - (now % 86400000) : now - 3 * 86400000;
  return entries.filter((e) => e.time >= cutoff);
}

/** 轮转修剪（纯函数，便于测试）：按 time 升序保留最近 max 条 */
export function trimEntries(entries: LogEntry[], max: number): LogEntry[] {
  if (entries.length <= max) return entries;
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  return sorted.slice(-max);
}

/** IDB 存取封装（日志独立库，不依赖 Db 类：logger 是模块顶层单例，不能 await open） */
class LogStore {
  private db: IDBDatabase | null = null;
  private ready: Promise<void> | null = null;
  /** 打开是否彻底失败（降级内存模式） */
  failed = false;

  open(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(IDB_NAME, IDB_VERSION);
      } catch {
        this.failed = true;
        resolve();
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE); // out-of-line key：put 时显式传 key
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => {
        this.failed = true;
        resolve(); // 降级内存，不抛
      };
      req.onblocked = () => {
        this.failed = true;
        resolve();
      };
    });
    return this.ready;
  }

  private ensure(): IDBDatabase {
    if (!this.db) throw new Error('log store 未就绪');
    return this.db;
  }

  /** 批量写入（out-of-line key = day:id）；返回实际写入的条目 */
  async putAll(entries: LogEntry[]): Promise<void> {
    if (this.failed || !this.db || entries.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = this.ensure().transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      for (const e of entries) os.put(e, recordKey(dayKeyFor(e.time), e.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('日志写入中止'));
    });
  }

  /** 全量读取（按 time 排序由调用方做） */
  async getAll(): Promise<LogEntry[]> {
    if (this.failed || !this.db) return [];
    return new Promise((resolve, reject) => {
      const tx = this.ensure().transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as LogEntry[]);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error ?? new Error('日志读取中止'));
    });
  }

  /** 删除指定 key（轮转用） */
  async deleteKeys(keys: string[]): Promise<void> {
    if (this.failed || !this.db || keys.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = this.ensure().transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      for (const k of keys) os.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('日志删除中止'));
    });
  }

  /** 清空全部日志（"清空日志"按钮） */
  async clearAll(): Promise<void> {
    if (this.failed || !this.db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = this.ensure().transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('日志清空中止'));
    });
  }
}

/** 单例日志器 */
class Logger {
  private memory: LogEntry[] = [];
  /** IDB 全量快照（getLogs 同步返回用；refresh 后更新） */
  private snapshot: LogEntry[] = [];
  private store = new LogStore();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private level: LogLevel = 'info';
  /** 旧版 localStorage 是否已迁移 */
  private legacyMigrated = false;

  constructor() {
    // 级别阈值持久化
    try {
      const saved = localStorage.getItem(LEVEL_KEY);
      if (saved === 'debug' || saved === 'info' || saved === 'warn' || saved === 'error') this.level = saved;
    } catch {
      /* 忽略 */
    }
    // 异步打开 IDB（不阻塞构造；打开成功后触发一次补写未落盘日志）
    this.store.open().then(() => {
      if (!this.store.failed) {
        this.migrateLegacy();
        this.flushPersist(); // 补写 open 期间产生的内存日志
      }
    });
    this.installGlobalHooks();
    // 页面隐藏/卸载前同步 flush：崩溃/杀进程瞬间不丢最近日志
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushPersist();
      });
      window.addEventListener('pagehide', () => this.flushPersist());
    }
  }

  /** 旧版 localStorage 日志迁移到 IDB（一次性） */
  private migrateLegacy(): void {
    if (this.legacyMigrated) return;
    this.legacyMigrated = true;
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const old = JSON.parse(raw) as Array<Partial<LogEntry> & { time: number; level: LogLevel; source: string; message: string }>;
      if (Array.isArray(old) && old.length > 0) {
        const migrated: LogEntry[] = old.map((e) => ({
          id: `legacy-${e.time}-${Math.random().toString(36).slice(2, 8)}`,
          time: e.time,
          level: e.level,
          source: e.source,
          message: e.message,
          version: e.version,
        }));
        // 迁移并入快照（不经过内存缓冲，直接落盘 + 快照合并）
        this.store.putAll(migrated).then(() => {
          this.snapshot = [...this.snapshot, ...migrated].sort((a, b) => a.time - b.time);
        });
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* 旧日志损坏则丢弃，不阻断 */
    }
  }

  /** 节流持久化：500ms 内合并写一次 */
  private persist(): void {
    if (this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersist();
    }, 500);
  }

  private flushPersist(): void {
    if (this.memory.length === 0) return;
    // 只落盘增量：写成功后才清空内存；失败则把该批放回内存前部（P2-15：不丢日志），
    // 下次 flush 重试。内存有 MAX_MEMORY 上限，持续失败时最旧的会被挤出（优雅降级，不无限膨胀）
    const fresh = this.memory;
    this.memory = [];
    this.store.putAll(fresh).then(() => {
      // 更新快照（增量合并）
      this.snapshot = [...this.snapshot, ...fresh].sort((a, b) => a.time - b.time);
      // 轮转：超限删最旧（按天分片 + 上限条数双保险）
      this.rotate();
    }).catch(() => {
      // 写失败：批放回内存（保留），避免日志永久丢失
      this.memory = [...fresh, ...this.memory].slice(0, MAX_MEMORY);
      const origWarn = console.warn;
      origWarn('[logger] 日志持久化失败（IndexedDB 不可用），批次暂存内存待重试');
    });
  }

  /** 轮转：超过 MAX_DAYS 天或 MAX_ENTRIES 条的旧日志删除（保留最近，按天分片 → 整段删除） */
  private rotate(): void {
    if (this.store.failed) return;
    const dayCutoff = Date.now() - MAX_DAYS * 86400000;
    const doomed: string[] = [];
    // snapshot 按 time 升序：先剔除超时的，再对剩余保留最新 MAX_ENTRIES 条（老日志删、新日志留）
    const fresh = this.snapshot.filter((e) => e.time >= dayCutoff);
    const overflow = fresh.length - MAX_ENTRIES;
    if (overflow > 0) {
      // 升序数组前 overflow 条是最旧的 → 删
      for (let i = 0; i < overflow; i++) {
        doomed.push(recordKey(dayKeyFor(fresh[i].time), fresh[i].id));
      }
    }
    // 超时的也删
    for (const e of this.snapshot) {
      if (e.time < dayCutoff) doomed.push(recordKey(dayKeyFor(e.time), e.id));
    }
    if (doomed.length === 0) return;
    this.snapshot = this.snapshot.filter((e) => !doomed.includes(recordKey(dayKeyFor(e.time), e.id)));
    this.store.deleteKeys(doomed).catch(() => {
      /* 删除失败不影响本次会话 */
    });
  }

  /** 级别阈值设置（持久化） */
  setLevel(level: LogLevel): void {
    this.level = level;
    try {
      localStorage.setItem(LEVEL_KEY, level);
    } catch {
      /* 忽略 */
    }
  }

  getLevel(): LogLevel {
    return this.level;
  }

  log(level: LogLevel, source: string, message: string): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return; // 级别过滤
    const entry: LogEntry = {
      id: `t-${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      time: Date.now(),
      level,
      source,
      message,
      version: VERSION,
    };
    this.memory.push(entry);
    if (this.memory.length > MAX_MEMORY) this.memory.shift();
    this.persist();
  }

  info(source: string, message: string): void {
    this.log('info', source, message);
  }

  warn(source: string, message: string): void {
    this.log('warn', source, message);
  }

  error(source: string, message: string): void {
    this.log('error', source, message);
  }

  debug(source: string, message: string): void {
    this.log('debug', source, message);
  }

  /** 同步获取已知日志（内存 + IDB 快照；如需最新先 await refresh()） */
  getLogs(): LogEntry[] {
    return [...this.snapshot, ...this.memory].sort((a, b) => a.time - b.time);
  }

  /** 从 IDB 刷新全量快照（GUI 打开日志视图前调用，保证拿到最新） */
  async refresh(): Promise<void> {
    if (this.store.failed) return;
    try {
      const all = await this.store.getAll();
      this.snapshot = all.sort((a, b) => a.time - b.time);
    } catch {
      /* 读取失败用现有快照 */
    }
  }

  /** 异步获取全部日志（refresh + 内存合并） */
  async getLogsAsync(): Promise<LogEntry[]> {
    await this.refresh();
    return this.getLogs();
  }

  /** 生成导出文本（头部 + 按时间范围过滤的条目） */
  exportText(range: LogRange = 'today'): string {
    const entries = filterByRange(this.getLogs(), range);
    const header = [
      'KIRUSRAFT 日志导出',
      `版本: v${VERSION}`,
      `导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `范围: ${range === 'today' ? `今天（${dayKeyFor(Date.now())}）` : range === '3d' ? '最近 3 天' : '全部'}`,
      `条数: ${entries.length}`,
      '----------------------------------------',
    ].join('\n');
    return `${header}\n${entries.map(renderEntry).join('\n')}`;
  }

  /** 复制日志到剪贴板（返回是否成功；失败时调用方提示） */
  async copy(range: LogRange = 'today'): Promise<boolean> {
    const text = this.exportText(range);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级：textarea + execCommand（非 https/无用户手势时 clipboard API 不可用）
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  /** 下载日志文件（Blob + a[download]） */
  download(range: LogRange = 'today'): void {
    const text = this.exportText(range);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = dayKeyFor(Date.now()).replace(/-/g, '');
    a.href = url;
    a.download = `kirusraft-logs-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 清空全部日志（内存 + IDB 异步清；GUI 按钮保持同步调用） */
  clear(): void {
    this.memory = [];
    this.snapshot = [];
    this.store.clearAll().catch(() => {
      /* 忽略 */
    });
  }

  private installGlobalHooks(): void {
    // 未捕获异常（结构化 Error 序列化，pino stdSerializers.err 理念）
    window.addEventListener('error', (e) => {
      const err = e.error instanceof Error ? e.error : null;
      this.error('window', err ? `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}` : (e.message ?? String(e.error ?? '')));
    });
    // 未处理的 Promise 拒绝
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason;
      if (reason instanceof Error) {
        this.error('promise', `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`);
      } else {
        this.error('promise', String(reason));
      }
    });
    // 捕获 console 输出（不含我们自己的写日志调用，避免死循环）
    const orig = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    };
    console.log = (...args: unknown[]) => {
      orig.log(...args);
      this.log('info', 'console', args.map(formatArg).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      orig.warn(...args);
      this.log('warn', 'console', args.map(formatArg).join(' '));
    };
    console.error = (...args: unknown[]) => {
      orig.error(...args);
      this.log('error', 'console', args.map(formatArg).join(' '));
    };
    console.info = (...args: unknown[]) => {
      orig.info(...args);
      this.log('info', 'console', args.map(formatArg).join(' '));
    };
  }
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** 全局单例 */
export const logger = new Logger();
