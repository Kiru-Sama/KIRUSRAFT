/**
 * DeepSeek Responses API provider（v0.0.1）
 * 内核抽象层：实现 ChatProvider 契约，支持服务端 web_search 工具与 function 工具循环。
 * 纯 ECMAScript fetch，无 Node 依赖。
 */
import type { ChatRequest, ChatStreamHandlers } from '../core/types';
import type { ChatProvider } from './types';

/** Responses API input 项（支持 function_call / function_call_output 回传） */
export type ResponsesInputItem = Record<string, unknown>;

/** 解析 SSE 行 */
function parseSseEvent(line: string): { data: unknown } | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]') return { data: null };
  try {
    return { data: JSON.parse(data) };
  } catch {
    return null;
  }
}

/** 构造 Responses input：普通消息数组或完整 input（工具循环用） */
function buildInput(request: ChatRequest): ResponsesInputItem[] {
  if (request.input && request.input.length > 0) return request.input;
  return (request.messages ?? []).map((m) => ({
    role: m.role,
    content: [{ type: 'input_text', text: m.content }],
  }));
}

/** 发起流式聊天，分发增量；收集 function 工具调用 */
export async function streamChat(request: ChatRequest, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  // 校验 endpoint（空值/相对路径会拼出非法 URL）
  let endpoint: string;
  try {
    endpoint = `${request.baseURL.replace(/\/+$/, '')}/responses`;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') {
      handlers.onError(new Error('Base URL 必须是 https'));
      return;
    }
  } catch {
    handlers.onError(new Error(`Base URL 非法: ${request.baseURL || '(空)'}`));
    return;
  }

  const body: Record<string, unknown> = {
    model: request.model,
    input: buildInput(request),
    stream: true,
    max_output_tokens: request.maxTokens ?? 4096,
  };
  if (request.tools && request.tools.length > 0) body.tools = request.tools;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    handlers.onError(new Error(`请求失败: ${String(error)}`));
    return;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const parsed = await response.json();
      message = parsed.error?.message ?? parsed.message ?? message;
    } catch {
      /* 忽略 */
    }
    handlers.onError(new Error(`API 错误: ${message}`));
    return;
  }

  if (!response.body) {
    handlers.onError(new Error('响应无数据流'));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  // 空闲超时：60s 无数据则中止，防止服务端半开挂死
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void reader.cancel().catch(() => {});
    }, 60000);
  };
  resetIdle();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const ev = parseSseEvent(trimmed);
        if (!ev || ev.data === null) continue;
        dispatch(ev.data, handlers);
      }
    }
    handlers.onDone();
  } catch (error) {
    if (signal?.aborted) return;
    handlers.onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (idleTimer !== null) clearTimeout(idleTimer);
    void reader.cancel().catch(() => {});
  }
}

/** 事件分发 */
function dispatch(data: unknown, handlers: ChatStreamHandlers): void {
  if (typeof data !== 'object' || data === null) return;
  const record = data as Record<string, unknown>;
  const type = record.type as string;
  switch (type) {
    case 'response.output_text.delta':
      if (typeof record.delta === 'string') handlers.onTextDelta(record.delta);
      break;
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta':
      if (typeof record.delta === 'string') handlers.onReasoningDelta(record.delta);
      break;
    case 'response.function_call_arguments.done':
      // name/call_id 在 output_item.done 事件里，这里不处理
      break;
    case 'response.output_item.done': {
      const item = record.item as Record<string, unknown> | undefined;
      // call_id 为空时跳过（无法回传 function_call_output）
      if (item && item.type === 'function_call' && typeof item.name === 'string' && item.call_id) {
        let args: Record<string, unknown> = {};
        try {
          if (typeof item.arguments === 'string' && item.arguments.length > 0) {
            args = JSON.parse(item.arguments);
          }
        } catch {
          /* 参数解析失败用空对象 */
        }
        handlers.onToolCall({
          id: String(item.call_id),
          name: item.name,
          args,
          rawArguments: typeof item.arguments === 'string' ? item.arguments : undefined,
        });
      }
      break;
    }
    case 'response.completed':
      // 流结束会统一调 onDone，这里不重复触发
      break;
    default:
      break;
  }
}

/** DeepSeek 官方标准 provider */
export const DeepSeekProvider: ChatProvider = {
  id: 'deepseek',
  displayName: 'DeepSeek 官方',
  streamChat,
  available() {
    return true;
  },
};
