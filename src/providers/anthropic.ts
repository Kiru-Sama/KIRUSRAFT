/**
 * Anthropic Claude provider（v0.0.31）
 * 协议：POST {baseURL}/messages，X-Api-Key 认证 + anthropic-version 头，SSE 解析 content_block_delta。
 * 纯 ECMAScript fetch，无 Node 依赖。
 */
import type { ChatRequest, ChatStreamHandlers } from '../core/types';
import type { ChatProvider } from './types';

/** 解析 SSE 行 */
function parseSseEvent(line: string): { event: string; data: unknown } | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('event:')) return { event: trimmed.slice(6).trim(), data: null };
  if (trimmed.startsWith('data:')) {
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return { event: 'done', data: null };
    try {
      return { event: 'message', data: JSON.parse(data) };
    } catch {
      return null;
    }
  }
  return null;
}

/** 构造 messages（user/assistant，Anthropic 格式） */
function buildMessages(request: ChatRequest): { role: string; content: string }[] {
  return (request.messages ?? []).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.content,
  }));
}

/** 发起流式聊天 */
export async function streamChat(request: ChatRequest, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  // 校验 endpoint
  let endpoint: string;
  try {
    endpoint = `${request.baseURL.replace(/\/+$/, '')}/messages`;
    const url = new URL(endpoint);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !isLocal) {
      handlers.onError(new Error('Base URL 必须是 https（本地 http 端点除外）'));
      return;
    }
  } catch {
    handlers.onError(new Error(`Base URL 非法: ${request.baseURL || '(空)'}`));
    return;
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages: buildMessages(request),
    stream: true,
    max_tokens: request.maxTokens ?? 4096,
  };
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      name: t.name,
      description: '',
      input_schema: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'x-api-key': request.apiKey,
        'anthropic-version': '2023-06-01',
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
  // 工具调用累积（input_json_delta 分片）
  let toolName = '';
  let toolId = '';
  let toolArgs = '';

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const resetIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
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
      let pendingEvent = '';
      for (const line of lines) {
        const ev = parseSseEvent(line);
        if (!ev) continue;
        if (ev.event && ev.data === null) {
          pendingEvent = ev.event; // event: xxx 行
          continue;
        }
        dispatch(ev.data, handlers, pendingEvent, () => ({ toolName, toolId, toolArgs }), (n, i, a) => {
          toolName = n;
          toolId = i;
          toolArgs = a;
        });
        pendingEvent = '';
      }
    }
    handlers.onDone();
  } catch (error) {
    if (signal?.aborted) return;
    if (timedOut) {
      handlers.onError(new Error('请求超时（60 秒无数据）'));
      return;
    }
    handlers.onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (idleTimer !== null) clearTimeout(idleTimer);
    void reader.cancel().catch(() => {});
  }
}

/** 事件分发（Anthropic SSE：message_start / content_block_delta / content_block_stop / message_delta） */
function dispatch(
  data: unknown,
  handlers: ChatStreamHandlers,
  _event: string,
  getTool: () => { toolName: string; toolId: string; toolArgs: string },
  setTool: (name: string, id: string, args: string) => void,
): void {
  if (typeof data !== 'object' || data === null) return;
  const record = data as Record<string, unknown>;
  const type = record.type as string;
  switch (type) {
    case 'content_block_delta': {
      const delta = record.delta as Record<string, unknown> | undefined;
      if (!delta) break;
      const t = delta.type as string;
      if (t === 'text_delta' && typeof delta.text === 'string') handlers.onTextDelta(delta.text);
      if (t === 'thinking_delta' && typeof delta.thinking === 'string') handlers.onReasoningDelta(delta.thinking);
      if (t === 'input_json_delta') {
        const { toolName, toolId, toolArgs } = getTool();
        const partial = typeof delta.partial_json === 'string' ? delta.partial_json : '';
        setTool(toolName, toolId, toolArgs + partial);
      }
      break;
    }
    case 'content_block_start': {
      const block = record.content_block as Record<string, unknown> | undefined;
      if (block && block.type === 'tool_use') {
        const { toolArgs } = getTool();
        setTool(String(block.name ?? ''), String(block.id ?? ''), toolArgs);
      }
      break;
    }
    case 'content_block_stop': {
      const { toolName, toolId, toolArgs } = getTool();
      if (toolName && toolId) {
        let args: Record<string, unknown> = {};
        try {
          if (toolArgs.length > 0) args = JSON.parse(toolArgs) as Record<string, unknown>;
        } catch {
          /* 忽略 */
        }
        handlers.onToolCall({ id: toolId, name: toolName, args, rawArguments: toolArgs.length > 0 ? toolArgs : undefined });
        setTool('', '', '');
      }
      break;
    }
    default:
      break;
  }
}

/** Anthropic Claude provider 实例 */
export const AnthropicProvider: ChatProvider = {
  id: 'anthropic',
  displayName: 'Anthropic Claude',
  streamChat,
};
