/**
 * Anthropic Claude provider 测试（v0.0.64）
 * 锁住 v0.0.64 新增 body 映射：system 顶层数组、thinking 档位（0=disabled / 2~5=enabled+budget / 1 不写）、
 * thinking 开启时禁写 temperature（Claude 规则）、图片部件→image source（裸 base64）。
 */
import { describe, expect, it, vi } from 'vitest';
import { streamChat } from './anthropic';
import type { ChatRequest } from '../core/types';

function makeHandlers() {
  return {
    onTextDelta: () => undefined,
    onReasoningDelta: () => undefined,
    onToolCall: () => undefined,
    onDone: () => undefined,
    onError: () => undefined,
  };
}

/** 捕获 fetch 请求 body 的 mock */
function mockFetchCapture(callback: (body: Record<string, unknown>) => void) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      callback(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return { ok: true, status: 200, body: stream } as Response;
    }),
  );
}

const baseRequest: ChatRequest = {
  model: 'claude-sonnet-4-5',
  apiKey: 'k',
  baseURL: 'https://api.anthropic.com/v1',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('anthropic provider body 映射（v0.0.64）', () => {
  it('systemPrompt 写入顶层 system 数组', async () => {
    let body: Record<string, unknown> = {};
    mockFetchCapture((b) => {
      body = b;
    });
    await streamChat({ ...baseRequest, systemPrompt: '你是助手' }, makeHandlers());
    expect(body.system).toEqual([{ type: 'text', text: '你是助手' }]);
    // 不传 system 时省略
    await streamChat(baseRequest, makeHandlers());
    expect(body.system).toBeUndefined();
  });

  it('thinking 档位映射：0=disabled、3=enabled+budget 2048、1=不写', async () => {
    const results: Record<string, unknown> = {};
    for (const level of [0, 1, 3]) {
      let body: Record<string, unknown> = {};
      mockFetchCapture((b) => {
        body = b;
      });
      await streamChat({ ...baseRequest, thinkLevel: level }, makeHandlers());
      results[String(level)] = body.thinking;
    }
    expect(results['0']).toEqual({ type: 'disabled' });
    expect(results['1']).toBeUndefined();
    expect(results['3']).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('thinking 档位 2=低 预算 1024（不低于 Anthropic API 下限，防 400）', async () => {
    let body: Record<string, unknown> = {};
    mockFetchCapture((b) => {
      body = b;
    });
    await streamChat({ ...baseRequest, thinkLevel: 2 }, makeHandlers());
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('thinking 开启时禁写 temperature；关闭/自动时写 temperature', async () => {
    const results: Record<string, unknown> = {};
    for (const level of [0, 1, 4]) {
      let body: Record<string, unknown> = {};
      mockFetchCapture((b) => {
        body = b;
      });
      await streamChat({ ...baseRequest, temperature: 0.8, thinkLevel: level }, makeHandlers());
      results[String(level)] = body.temperature;
    }
    expect(results['0']).toBe(0.8); // 显式 disabled → 温度允许
    expect(results['1']).toBe(0.8); // 自动（不写 thinking）→ 温度允许
    expect(results['4']).toBeUndefined(); // enabled → 禁写温度
  });

  it('图片部件映射为 image/source（data URL 拆成 media_type + 裸 base64）', async () => {
    let body: Record<string, unknown> = {};
    mockFetchCapture((b) => {
      body = b;
    });
    await streamChat(
      {
        ...baseRequest,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '看图' },
              { type: 'image', imageUrl: 'data:image/jpeg;base64,AAA=BB=' },
            ],
          },
        ],
      },
      makeHandlers(),
    );
    const msgs = body.messages as { role: string; content: unknown[] }[];
    expect(msgs[0].content).toEqual([
      { type: 'text', text: '看图' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA=BB=' },
      },
    ]);
  });
});
