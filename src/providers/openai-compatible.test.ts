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
});
