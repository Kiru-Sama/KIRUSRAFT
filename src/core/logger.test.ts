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

const { logger, dayKeyFor, filterByRange, trimEntries, renderEntry, LEVEL_RANK } = await import('./logger');
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
    const rendered = renderEntry(last);
    expect(rendered).toContain(`[v${VERSION}]`);
  });
});

describe('logger 日志管理（v0.0.43）', () => {
  it('dayKeyFor 生成 YYYY-MM-DD 本地日期键（按天分片）', () => {
    const ts = new Date(2026, 7, 20, 12, 30, 0).getTime(); // 2026-08-20
    expect(dayKeyFor(ts)).toBe('2026-08-20');
  });

  it('filterByRange 按范围过滤（today 当天 / 3d 最近72小时 / all 全部）', () => {
    const now = new Date(2026, 7, 20, 12, 0, 0).getTime();
    const today = { id: 'a', time: now - 1000, level: 'info' as const, source: 't', message: 'a' };
    const yesterday = { id: 'b', time: now - 20 * 3600000, level: 'info' as const, source: 't', message: 'b' };
    const old = { id: 'c', time: now - 10 * 86400000, level: 'info' as const, source: 't', message: 'c' };
    expect(filterByRange([today, yesterday, old], 'today', now)).toHaveLength(1);
    expect(filterByRange([today, yesterday, old], '3d', now)).toHaveLength(2);
    expect(filterByRange([today, yesterday, old], 'all', now)).toHaveLength(3);
  });

  it('trimEntries 轮转：超限保留最近 max 条（按 time 升序）', () => {
    const mk = (t: number) => ({ id: `k${t}`, time: t, level: 'info' as const, source: 't', message: String(t) });
    const entries = [mk(1), mk(5), mk(3), mk(2), mk(4)];
    const kept = trimEntries(entries, 3);
    expect(kept).toHaveLength(3);
    expect(kept.map((e) => e.time).sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it('级别过滤：低于阈值的日志不记', () => {
    logger.setLevel('warn');
    logger.info('test', '这条 info 不应被记');
    const afterInfo = logger.getLogs();
    expect(afterInfo.some((e) => e.message === '这条 info 不应被记')).toBe(false);
    logger.error('test', '这条 error 应被记');
    expect(logger.getLogs().some((e) => e.message === '这条 error 应被记')).toBe(true);
    logger.setLevel('info'); // 复位，避免影响其他测试
  });

  it('id 全局唯一（导出合并去重依据）', () => {
    logger.debug('test', 'id 唯一性 A');
    logger.debug('test', 'id 唯一性 B');
    const ids = logger.getLogs().filter((e) => e.message.startsWith('id 唯一性')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exportText 头部含版本/范围/条数', () => {
    const text = logger.exportText('today');
    expect(text).toContain('KIRUSRAFT 日志导出');
    expect(text).toContain(`版本: v${VERSION}`);
    expect(text).toContain('范围: 今天');
  });

  it('LEVEL_RANK 排序正确', () => {
    expect(LEVEL_RANK.debug).toBeLessThan(LEVEL_RANK.info);
    expect(LEVEL_RANK.info).toBeLessThan(LEVEL_RANK.warn);
    expect(LEVEL_RANK.warn).toBeLessThan(LEVEL_RANK.error);
  });
});
