/**
 * logger 版本号测试（v0.0.36）
 * 锁住：每条日志自动带产生它的应用版本（诊断溯源，区分新旧日志）。
 */
import { describe, expect, it, vi } from 'vitest';

// logger 单例构造访问 window/localStorage：先 stub 再动态 import
vi.stubGlobal('window', { addEventListener: () => undefined });
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { logger } = await import('./logger');
const { VERSION } = await import('./version');

describe('logger 版本号', () => {
  it('log 条目自动带当前版本号', () => {
    logger.info('test', '带版本号的日志');
    const entries = logger.getLogs();
    const last = entries[entries.length - 1];
    expect(last.version).toBe(VERSION);
  });

  it('渲染格式含版本前缀（诊断可溯源）', () => {
    const entries = logger.getLogs();
    const last = entries[entries.length - 1];
    // 与 theme-exdark/kernel-gui/fallback-gui 三处渲染一致：[vX.Y.Z]
    const rendered = `[${new Date(last.time).toLocaleTimeString('zh-CN', { hour12: false })}] [v${last.version}] ${last.level.toUpperCase()} [${last.source}] ${last.message}`;
    expect(rendered).toContain(`[v${VERSION}]`);
  });
});
