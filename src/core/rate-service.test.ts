/**
 * 汇率同步服务测试（v0.0.35）
 * 锁住：多源回退、取值路径（open.er-api 的 rates.CNY / jsdelivr 的 usd.cny）、缓存命中。
 */
import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateService } from './rate-service';

// 内存 localStorage stub（node 环境）
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

afterEach(() => {
  store.clear();
  // 不调用 vi.unstubAllGlobals()：它会移除文件顶层的 localStorage stub（getCached 依赖）
  vi.restoreAllMocks();
});

function mockFetchOnce(json: unknown, ok = true, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, json: async () => json }) as Response));
}

describe('汇率同步服务', () => {
  it('open.er-api 源：取 rates.CNY', async () => {
    mockFetchOnce({ result: 'success', rates: { CNY: 6.756911 } });
    const ctx = new Context();
    const svc = new RateService(ctx);
    const r = await svc.sync();
    expect(r.rate).toBe(6.7569); // 4 位小数
    expect(r.source).toBe('api');
  });

  it('主源失败回退到 jsdelivr 镜像（usd.cny 小写）', async () => {
    // 第一次调用（主源）失败 → 第二次（jsdelivr fastly）成功
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++;
        if (call === 1) return { ok: false, status: 500, json: async () => ({}) } as Response;
        return { ok: true, status: 200, json: async () => ({ date: 'x', usd: { cny: 7.12345 } }) } as Response;
      }),
    );
    const ctx = new Context();
    const svc = new RateService(ctx);
    const r = await svc.sync();
    expect(r.rate).toBe(7.1235);
    expect(call).toBe(2);
  });

  it('全部源失败抛错', async () => {
    mockFetchOnce(null, false, 403);
    const ctx = new Context();
    const svc = new RateService(ctx);
    await expect(svc.sync()).rejects.toThrow(/汇率拉取失败/);
  });

  it('缓存命中（6 小时内不重复拉 API）', async () => {
    let fetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount++;
        return { ok: true, status: 200, json: async () => ({ rates: { CNY: 6.5 } }) } as Response;
      }),
    );
    const ctx = new Context();
    const svc = new RateService(ctx);
    await svc.sync();
    expect(fetchCount).toBe(1);
    const second = await svc.sync();
    expect(second.source).toBe('cache');
    expect(fetchCount).toBe(1); // 未再拉 API
  });
});
