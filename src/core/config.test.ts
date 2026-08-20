import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ConfigService } from './config';

function mockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
  };
}

describe('config 配置中心', () => {
  let ctx: Context;
  let ls: ReturnType<typeof mockLocalStorage>;

  beforeEach(() => {
    ls = mockLocalStorage();
    vi.stubGlobal('localStorage', ls);
    ctx = new Context();
  });

  it('register 后 get 返回默认值', () => {
    const cfg = new ConfigService(ctx);
    cfg.register(ctx, { namespace: 'test', displayName: '测试', defaults: { a: 1, b: 'x' } });
    expect(cfg.get('test')).toEqual({ a: 1, b: 'x' });
  });

  it('get 返回浅拷贝，改返回值不影响内部状态', () => {
    const cfg = new ConfigService(ctx);
    cfg.register(ctx, { namespace: 'test', displayName: '测试', defaults: { a: 1 } });
    const v = cfg.get('test');
    v.a = 999;
    expect(cfg.get('test').a).toBe(1);
  });

  it('set 合并 defaults，部分写入不丢字段', () => {
    const cfg = new ConfigService(ctx);
    cfg.register(ctx, { namespace: 'test', displayName: '测试', defaults: { a: 1, b: 'x' } });
    cfg.set('test', { a: 5 });
    expect(cfg.get('test')).toEqual({ a: 5, b: 'x' });
  });

  it('onChange 通知订阅者', () => {
    const cfg = new ConfigService(ctx);
    cfg.register(ctx, { namespace: 'test', displayName: '测试', defaults: { a: 1 } });
    const cb = vi.fn();
    cfg.onChange('test', cb);
    cfg.set('test', { a: 2 });
    expect(cb).toHaveBeenCalledWith({ a: 2 });
  });

  it('set 持久化到 localStorage', () => {
    const cfg = new ConfigService(ctx);
    cfg.register(ctx, { namespace: 'test', displayName: '测试', defaults: { a: 1 } });
    cfg.set('test', { a: 3 });
    expect(ls.setItem).toHaveBeenCalled();
  });

  it('register 从 localStorage 加载并合并默认', () => {
    ls.getItem.mockReturnValue(JSON.stringify({ a: 42 }));
    const cfg = new ConfigService(ctx);
    cfg.register(ctx, { namespace: 'test', displayName: '测试', defaults: { a: 1, b: 'y' } });
    expect(cfg.get('test')).toEqual({ a: 42, b: 'y' });
  });

  it('register 重复命名空间不抛错，返回 no-op disposer（P2-9 降级）', () => {
    const cfg = new ConfigService(ctx);
    cfg.register(ctx, { namespace: 'dup', displayName: '测试', defaults: {} });
    const d = cfg.register(ctx, { namespace: 'dup', displayName: '测试2', defaults: {} });
    expect(typeof d).toBe('function');
    // 不抛错、不覆盖原分节
    expect(cfg.list().filter((s) => s.namespace === 'dup')).toHaveLength(1);
  });

  it('set 未注册 namespace 不抛错（容错不丢数据，P2-10）', () => {
    const cfg = new ConfigService(ctx);
    expect(() => cfg.set('ghost', { a: 1 })).not.toThrow();
    expect(cfg.get('ghost')).toEqual({ a: 1 });
  });
});
