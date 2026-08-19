/**
 * 内核日志系统（v0.0.1）
 * 环形缓冲 + localStorage 持久化 + 全局错误捕获。
 * 崩溃后进入兜底模式可查询历史日志。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  time: number;
  level: LogLevel;
  source: string;
  message: string;
}

const STORAGE_KEY = 'kirusraft.logs.v1';
const MAX_MEMORY = 500;
const MAX_STORED = 2000;

/** 单例日志器 */
class Logger {
  private memory: LogEntry[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.installGlobalHooks();
  }

  /** 节流持久化：500ms 内合并写一次，避免高频日志时每次都全量写 localStorage */
  private persist(): void {
    if (this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersist();
    }, 500);
  }

  private flushPersist(): void {
    if (this.memory.length === 0) return;
    // 只落盘增量：写成功后才清空内存，失败则日志留在内存不丢失
    const fresh = this.memory;
    let merged: LogEntry[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const old = JSON.parse(raw) as LogEntry[];
          merged = [...old, ...fresh];
        } catch {
          /* 忽略损坏日志 */
        }
      } else {
        merged = [...fresh];
      }
    } catch {
      /* 读取失败不阻断写入 */
    }
    const trimmed = merged.slice(-MAX_STORED);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      this.memory = [];
    } catch {
      /* 写失败：fresh 留在 memory，getLogs 仍能读到，不丢 */
    }
  }

  log(level: LogLevel, source: string, message: string): void {
    const entry: LogEntry = { time: Date.now(), level, source, message };
    this.memory.push(entry);
    if (this.memory.length > MAX_MEMORY) this.memory.shift();
    this.persist();
  }

  debug(source: string, message: string): void {
    this.log('debug', source, message);
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

  /** 获取全部日志（历史 + 内存，按时间排序） */
  getLogs(): LogEntry[] {
    const all: LogEntry[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          all.push(...(JSON.parse(raw) as LogEntry[]));
        } catch {
          /* 忽略损坏 */
        }
      }
    } catch {
      /* 忽略 */
    }
    all.push(...this.memory);
    return all.sort((a, b) => a.time - b.time);
  }

  clear(): void {
    this.memory = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
  }

  private installGlobalHooks(): void {
    // 未捕获异常
    window.addEventListener('error', (e) => {
      this.error('window', e.message ?? String(e.error ?? ''));
    });
    // 未处理的 Promise 拒绝
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason;
      this.error('promise', reason instanceof Error ? reason.message : String(reason));
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
  if (arg instanceof Error) return arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** 全局单例 */
export const logger = new Logger();
