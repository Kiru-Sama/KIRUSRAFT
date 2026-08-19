import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from './agent-loop';
import type { ChatProvider } from '../providers/types';
import type { ChatRequest, ChatStreamHandlers, UIMessagePart } from './types';

function makeProvider(impl: (request: ChatRequest, handlers: ChatStreamHandlers, signal?: AbortSignal) => Promise<void>): ChatProvider {
  return { id: 'test', displayName: '测试服务商', streamChat: impl };
}

function makeHandlers() {
  return {
    onTextDelta: vi.fn(),
    onReasoningDelta: vi.fn(),
    onToolCall: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn<(error: Error) => void>(),
  };
}

const baseRequest: ChatRequest = {
  model: 'm',
  apiKey: 'k',
  baseURL: 'https://example.com/v1',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('agent-loop', () => {
  it('无工具调用时 onDone 触发一次', async () => {
    const provider = makeProvider(async (_req, handlers) => {
      handlers.onTextDelta('你好');
    });
    const tools = { declarations: () => [], execute: vi.fn() };
    const h = makeHandlers();
    await runAgentLoop({ provider, request: baseRequest, tools }, h);
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onTextDelta).toHaveBeenCalledWith('你好');
  });

  it('工具调用：执行工具并回传，onDone 仍只触发一次', async () => {
    let round = 0;
    const provider = makeProvider(async (req, handlers) => {
      round += 1;
      if (round === 1) {
        handlers.onToolCall({ id: 'call1', name: 'get_time', args: {} });
      } else {
        handlers.onTextDelta('现在是12点');
      }
    });
    const execute = vi.fn(async (): Promise<UIMessagePart[]> => [{ type: 'text', text: '12:00' }]);
    const tools = {
      declarations: () => [{ type: 'function', name: 'get_time', description: '获取时间', parameters: {} }],
      execute,
    };
    const h = makeHandlers();
    await runAgentLoop({ provider, request: baseRequest, tools, maxSteps: 4 }, h);
    expect(h.onToolCall).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('get_time', {});
    expect(h.onDone).toHaveBeenCalledTimes(1);
  });

  it('工具回传的 function_call_output 出现在下一轮 input', async () => {
    const seenInputs: Record<string, unknown>[][] = [];
    const provider = makeProvider(async (req, handlers) => {
      seenInputs.push(req.input ?? []);
      if (seenInputs.length === 1) {
        handlers.onToolCall({ id: 'c1', name: 't', args: { x: 1 } });
      } else {
        handlers.onTextDelta('done');
      }
    });
    const tools = {
      declarations: () => [{ type: 'function', name: 't', description: '', parameters: {} }],
      execute: async (): Promise<UIMessagePart[]> => [{ type: 'text', text: '结果' }],
    };
    const h = makeHandlers();
    await runAgentLoop({ provider, request: baseRequest, tools, maxSteps: 4 }, h);
    expect(seenInputs).toHaveLength(2);
    const second = seenInputs[1];
    expect(second.some((i) => i.type === 'function_call' && i.call_id === 'c1')).toBe(true);
    expect(second.some((i) => i.type === 'function_call_output' && i.call_id === 'c1')).toBe(true);
  });

  it('maxSteps 耗尽且仍有工具调用时报错', async () => {
    const provider = makeProvider(async (_req, handlers) => {
      handlers.onToolCall({ id: 'c', name: 'loop', args: {} });
    });
    const tools = {
      declarations: () => [{ type: 'function', name: 'loop', description: '', parameters: {} }],
      execute: async (): Promise<UIMessagePart[]> => [{ type: 'text', text: 'x' }],
    };
    const h = makeHandlers();
    await runAgentLoop({ provider, request: baseRequest, tools, maxSteps: 2 }, h);
    expect(h.onError).toHaveBeenCalled();
    expect(String(h.onError.mock.calls[0][0])).toContain('最大步数');
  });

  it('provider 单轮 onError 立即终止循环并转发', async () => {
    const provider = makeProvider(async (_req, handlers) => {
      handlers.onError(new Error('API 挂了'));
      handlers.onDone();
    });
    const tools = { declarations: () => [], execute: vi.fn() };
    const h = makeHandlers();
    await runAgentLoop({ provider, request: baseRequest, tools }, h);
    expect(h.onError).toHaveBeenCalled();
    // 单轮 onDone 不应转发给调用方（修复后语义）
    expect(h.onDone).not.toHaveBeenCalled();
  });
});
