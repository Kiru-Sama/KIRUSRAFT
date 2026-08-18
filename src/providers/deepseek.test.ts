import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChat } from './deepseek';
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

describe('deepseek provider SSE 解析', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('解析文本 delta', async () => {
    mockFetchWithEvents([
      'data: {"type":"response.output_text.delta","delta":"你好"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"世界"}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onTextDelta).toHaveBeenCalledTimes(2);
    expect(h.onTextDelta.mock.calls.map((c) => c[0])).toEqual(['你好', '世界']);
    expect(h.onDone).toHaveBeenCalledTimes(1);
  });

  it('解析推理 delta', async () => {
    mockFetchWithEvents([
      'data: {"type":"response.reasoning_text.delta","delta":"思考中"}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onReasoningDelta).toHaveBeenCalledWith('思考中');
  });

  it('解析工具调用（output_item.done 的 function_call）', async () => {
    mockFetchWithEvents([
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"get_time","arguments":"{}"}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onToolCall).toHaveBeenCalledTimes(1);
    const call = h.onToolCall.mock.calls[0][0];
    expect(call.id).toBe('c1');
    expect(call.name).toBe('get_time');
    expect(call.args).toEqual({});
  });

  it('空 call_id 的工具调用被跳过', async () => {
    mockFetchWithEvents([
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"get_time","arguments":"{}"}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onToolCall).not.toHaveBeenCalled();
  });

  it('baseURL 非法时报错', async () => {
    const h = makeHandlers();
    await streamChat({ ...baseRequest, baseURL: '' }, h);
    expect(h.onError).toHaveBeenCalled();
    expect(String(h.onError.mock.calls[0][0])).toContain('Base URL');
  });

  it('非 https baseURL 报错', async () => {
    const h = makeHandlers();
    await streamChat({ ...baseRequest, baseURL: 'http://example.com/v1' }, h);
    expect(h.onError).toHaveBeenCalled();
    expect(String(h.onError.mock.calls[0][0])).toContain('https');
  });

  it('HTTP 错误状态上报错误', async () => {
    mockFetchWithEvents([], 401);
    const h = makeHandlers();
    await streamChat(baseRequest, h);
    expect(h.onError).toHaveBeenCalled();
  });
});
