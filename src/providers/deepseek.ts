/**
 * DeepSeek Responses API 流式适配器（v0.0.1）
 * 基于已验证的方案：POST {baseURL}/responses + tools:[{type:'web_search'}]。
 * 纯 ECMAScript fetch，无 Node 依赖，QuickJS/浏览器/WebView 通用。
 */
import type { ChatRequest, ChatStreamHandlers } from '../core/types';

/** 解析 SSE 行，返回事件对象 */
function parseSseEvent(line: string): { event?: string; data: unknown } | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]') return { data: null };
  try {
    return { data: JSON.parse(data) };
  } catch {
    return null;
  }
}

/** 发起流式聊天，通过回调分发增量 */
export async function streamChat(request: ChatRequest, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  const endpoint = `${request.baseURL.replace(/\/+$/, '')}/responses`;
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.messages.map((m) => ({ role: m.role, content: [{ type: 'input_text', text: m.content }] })),
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
      /* 忽略解析失败 */
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
  }
}

/** 按 Responses 事件类型分发 */
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
      if (typeof record.name === 'string' && typeof record.arguments === 'string') {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(record.arguments);
        } catch {
          /* 参数解析失败用空对象 */
        }
        handlers.onToolCall({ id: String(record.call_id ?? ''), name: record.name, args });
      }
      break;
    case 'response.completed':
      handlers.onDone();
      break;
    default:
      break;
  }
}
