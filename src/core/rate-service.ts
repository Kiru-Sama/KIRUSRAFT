/**
 * 汇率同步服务（v0.0.35）
 * 利用免费汇率 API 自动同步 USD→CNY，替代 APITOOL"调用 AI 问汇率"的慢/费做法。
 * 主选 open.er-api.com（CORS 明确、6 位小数、无 key）；备选 jsDelivr currency-api 国内镜像
 * （fastly/gcore/cdn 依次尝试，键名小写 data.usd.cny）。两级数据源相互独立，单点故障不双挂。
 * 结果缓存 6 小时（汇率每日变动，无需高频拉取）。
 */
import { Context, Service } from '@deepseek-ai/cordis';

const SOURCES: { name: string; url: string; pick: (data: Record<string, unknown>) => number | null }[] = [
  {
    name: 'open.er-api',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (d) => {
      const rates = d.rates as Record<string, unknown> | undefined;
      const v = rates?.CNY;
      return typeof v === 'number' ? v : null;
    },
  },
  {
    name: 'jsdelivr(fastly)',
    url: 'https://fastly.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    pick: (d) => {
      const usd = d.usd as Record<string, unknown> | undefined;
      const v = usd?.cny;
      return typeof v === 'number' ? v : null;
    },
  },
  {
    name: 'jsdelivr(gcore)',
    url: 'https://gcore.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    pick: (d) => {
      const usd = d.usd as Record<string, unknown> | undefined;
      const v = usd?.cny;
      return typeof v === 'number' ? v : null;
    },
  },
  {
    name: 'jsdelivr(cdn)',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    pick: (d) => {
      const usd = d.usd as Record<string, unknown> | undefined;
      const v = usd?.cny;
      return typeof v === 'number' ? v : null;
    },
  },
];

const CACHE_KEY = 'kirusraft.rate.usdcny';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小时

export class RateService extends Service {
  /** 并发去重：同一时刻多个 sync() 只发一次 API（P2-12） */
  private inFlight: Promise<number> | null = null;

  constructor(ctx: Context) {
    super(ctx, 'rate');
  }

  /** 拉取最新 USD→CNY 汇率（多源依次尝试，返回 4 位小数；全失败抛错）
   *  每个源 8s 超时（AbortSignal.timeout），与调用方 signal 合并（P2-12） */
  async fetchUsdToCny(signal?: AbortSignal): Promise<number> {
    let lastErr = '';
    for (const src of SOURCES) {
      // 调用方已中止 → 直接抛，不再继续尝试
      if (signal?.aborted) throw new Error('汇率拉取已中止');
      try {
        const res = await fetch(src.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
        if (!res.ok) {
          lastErr = `${src.name} HTTP ${res.status}`;
          continue;
        }
        const data = (await res.json()) as Record<string, unknown>;
        const v = src.pick(data);
        if (v === null || !Number.isFinite(v) || v <= 0) {
          lastErr = `${src.name} 数据异常`;
          continue;
        }
        return Math.round(v * 10000) / 10000;
      } catch (error) {
        lastErr = `${src.name}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    throw new Error(`汇率拉取失败：${lastErr || '未知错误'}`);
  }

  /** 读取缓存（未过期返回，过期/缺失返回 null） */
  getCached(): number | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { value, time } = JSON.parse(raw) as { value: number; time: number };
      if (Date.now() - time > CACHE_TTL) return null;
      return value;
    } catch {
      return null;
    }
  }

  /** 写缓存 */
  private setCache(value: number): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ value, time: Date.now() }));
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 同步汇率：优先缓存（未过期），否则拉 API。
   * 返回 { rate, source: 'cache' | 'api', updatedAt }；失败抛错由调用方提示。
   */
  async sync(): Promise<{ rate: number; source: 'cache' | 'api'; updatedAt: number }> {
    const cached = this.getCached();
    if (cached !== null) return { rate: cached, source: 'cache', updatedAt: Date.now() };
    // 并发去重：已有 in-flight 拉取则复用其结果（P2-12），避免多调用方同时打 API
    if (!this.inFlight) {
      this.inFlight = this.fetchUsdToCny().finally(() => {
        this.inFlight = null;
      });
    }
    const rate = await this.inFlight;
    this.setCache(rate);
    return { rate, source: 'api', updatedAt: Date.now() };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    rate: RateService;
  }
}
