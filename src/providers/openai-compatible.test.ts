/**
 * openai-compatible provider 测试（v0.0.45）
 * 锁住 P1-3 回归：chat/completions 协议工具调用参数跨多 chunk 分片时，
 * 必须累积完整后在流结束统一触发（旧实现只取首片 args={}，工具能力损坏）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChat } from './openai-compatible';
import type { ChatRequest, ChatStreamHandlers } from '../core/types';

function makeHandlers() {
  return {
    onTextDelta: vi.fn(),
    onReasoningDelta: vi.fn(),
    onToolCall: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };
}

function mockFetchWithEvents(events: string[], status = 200) {
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(new TextEncoder().encode(e));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status })));
}

const baseRequest: ChatRequest = {
  model: 'm',
  apiKey: 'k',
  baseURL: 'https://example.com/v1',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('openai-compatible SSE 解析', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('文本 delta 累积', async () => {
    mockFetchWithEvents([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onTextDelta.mock.calls.map((c) => c[0])).toEqual(['你好', '世界']);
    expect(h.onDone).toHaveBeenCalledTimes(1);
  });

  it('工具调用参数分片：累积完整后统一触发一次（P1-3 回归）', async () => {
    // 典型 OpenAI chat/completions 工具调用：首 chunk 带 id+name+空 arguments，
    // 后续 chunk 只带 arguments 分片（name 为空）——旧实现只取首片 args={}，参数丢失
    mockFetchWithEvents([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"search_web","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"KIRUS"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"RAFT\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    // 只触发一次（不是每个 chunk 都触发）
    expect(h.onToolCall).toHaveBeenCalledTimes(1);
    const call = h.onToolCall.mock.calls[0][0];
    expect(call.id).toBe('call_abc');
    expect(call.name).toBe('search_web');
    // 关键断言：参数是累积后的完整 JSON，不是首片空对象
    expect(call.args).toEqual({ query: 'KIRUSRAFT' });
    expect(call.rawArguments).toBe('{"query":"KIRUSRAFT"}');
  });

  it('单 chunk 完整工具调用（无分片）也正常', async () => {
    mockFetchWithEvents([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_time","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onToolCall).toHaveBeenCalledTimes(1);
    expect(h.onToolCall.mock.calls[0][0].name).toBe('get_time');
    expect(h.onToolCall.mock.calls[0][0].args).toEqual({});
  });

  it('无工具调用时不触发 onToolCall', async () => {
    mockFetchWithEvents([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onToolCall).not.toHaveBeenCalled();
  });

  // ===== v0.0.64：温度 / 思考强度 / 系统提示词 / 多模态 body 映射 =====

  /** 捕获 fetch 请求 body 的变体 */
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

  it('temperature 与思考强度档位写入 body（可空则省略）', async () => {
    let body: Record<string, unknown> = {};
    mockFetchCapture((b) => {
      body = b;
    });
    const h = makeHandlers();
    await streamChat(
      { ...baseRequest, temperature: 0.7, thinkLevel: 3 },
      h,
    );
    expect(body.temperature).toBe(0.7);
    expect(body.reasoning_effort).toBe('medium');
    // 不传时省略（服务商默认）
    await streamChat(baseRequest, makeHandlers());
    // 第二次调用 body 被覆盖为不含参数的版本
    expect(body.temperature).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('思考强度档位映射：2=low 4/5=high 0/1 不写', async () => {
    const levels: Record<string, unknown> = {};
    for (const level of [0, 1, 2, 4, 5]) {
      let body: Record<string, unknown> = {};
      mockFetchCapture((b) => {
        body = b;
      });
      await streamChat({ ...baseRequest, thinkLevel: level }, makeHandlers());
      levels[String(level)] = body.reasoning_effort;
    }
    expect(levels['0']).toBeUndefined();
    expect(levels['1']).toBeUndefined();
    expect(levels['2']).toBe('low');
    expect(levels['4']).toBe('high');
    expect(levels['5']).toBe('high');
  });

  it('systemPrompt 前置为 system 消息（含图片时仍只前置文本）', async () => {
    let body: Record<string, unknown> = {};
    mockFetchCapture((b) => {
      body = b;
    });
    await streamChat({ ...baseRequest, systemPrompt: '你是助手' }, makeHandlers());
    const msgs = body.messages as { role: string; content: string }[];
    expect(msgs[0]).toEqual({ role: 'system', content: '你是助手' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('图片部件映射为 image_url content 数组（data URL 透传）', async () => {
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
              { type: 'image', imageUrl: 'data:image/jpeg;base64,AAA=' },
            ],
          },
        ],
      },
      makeHandlers(),
    );
    const msgs = body.messages as { role: string; content: unknown }[];
    expect(msgs[0].content).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA=' } },
    ]);
  });

  it('工具循环 input 分支的 input_image 也映射为 image_url（防 [object Object] 回归）', async () => {
    let body: Record<string, unknown> = {};
    mockFetchCapture((b) => {
      body = b;
    });
    await streamChat(
      {
        ...baseRequest,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: '看图' },
              { type: 'input_image', image_url: 'data:image/png;base64,CCC=' },
            ],
          },
          { type: 'function_call', call_id: 'c1', name: 'get_time', arguments: '{}' },
        ],
      },
      makeHandlers(),
    );
    const msgs = body.messages as { role: string; content: unknown }[];
    // 工具循环第二轮回传：图片保持 image_url 而非 "[object Object]"
    expect(msgs[0].content).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,CCC=' } },
    ]);
    // function_call 项照旧转 tool_calls
    expect(msgs[1]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'get_time' } }] });
  });

  // ===== v0.0.65：usage 统计 =====
  it('usage chunk（choices 空 + usage）触发 onUsage', async () => {
    mockFetchWithEvents([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    const usageSpy = vi.fn();
    await streamChat(baseRequest, { ...h, onUsage: usageSpy });
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(usageSpy.mock.calls[0][0]).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('请求体带 stream_options.include_usage（计费统计需要）', async () => {
    let body: Record<string, unknown> = {};
    mockFetchCapture((b) => {
      body = b;
    });
    await streamChat(baseRequest, makeHandlers());
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});