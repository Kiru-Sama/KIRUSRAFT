/**
 * 通用 OpenAI 兼容 provider（v0.0.31）
 * 覆盖绝大多数官方服务商（DeepSeek chat 版/OpenAI/Moonshot/智谱/通义/豆包/SiliconFlow/OpenRouter 等）
 * 与 OpenAI 兼容中转站。协议：POST {baseURL}/chat/completions，SSE 流式解析 choices[].delta。
 * 纯 ECMAScript fetch，无 Node 依赖。
 */
import type { ChatRequest, ChatStreamHandlers } from '../core/types';
import type { ChatProvider } from './types';
import { responsesStreamChat } from './responses';

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

/** 构造 chat/completions 消息：普通消息数组或完整 input（工具循环用） */
function buildMessages(request: ChatRequest): Record<string, unknown>[] {
  if (request.input && request.input.length > 0) {
    // Responses input → OpenAI messages 的近似转换（工具回传）
    return request.input.map((item) => {
      const it = item as Record<string, unknown>;
      if (it.type === 'function_call') {
        return { role: 'assistant', content: null, tool_calls: [{ id: it.call_id, type: 'function', function: { name: it.name, arguments: typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments ?? {}) } }] };
      }
      if (it.type === 'function_call_output') {
        return { role: 'tool', tool_call_id: it.call_id, content: typeof it.output === 'string' ? it.output : JSON.stringify(it.output ?? '') };
      }
      // input_text / input_image 等 → 简化
      const text = (Array.isArray(it.content) ? it.content.map((c) => (typeof c === 'object' && c && 'text' in (c as object) ? (c as { text: string }).text : String(c))).join(' ') : String(it.content ?? ''));
      return { role: it.role === 'ai' ? 'assistant' : it.role === 'user' ? 'user' : it.role, content: text };
    });
  }
  return (request.messages ?? []).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.content,
  }));
}

/** 发起流式聊天，分发增量；收集工具调用 */
export async function streamChat(request: ChatRequest, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  // 校验 endpoint
  let endpoint: string;
  try {
    endpoint = `${request.baseURL.replace(/\/+$/, '')}/chat/completions`;
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
      type: 'function',
      function: { name: t.name, parameters: t.parameters ?? { type: 'object', properties: {} } },
    }));
  }

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
  // 工具参数缓存：多个 delta 片段累积
  const toolArgs = new Map<string, string>();

  // 空闲超时：60s 无数据则中止
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
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const ev = parseSseEvent(trimmed);
        if (!ev || ev.data === null) continue;
        dispatch(ev.data, handlers, toolArgs);
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

/** 事件分发（OpenAI chat/completions chunk） */
function dispatch(data: unknown, handlers: ChatStreamHandlers, toolArgs: Map<string, string>): void {
  if (typeof data !== 'object' || data === null) return;
  const record = data as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return;
  const choice = choices[0] as Record<string, unknown>;
  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  // reasoning_content（DeepSeek/智谱/通义等）→ 推理增量
  if (typeof delta.reasoning_content === 'string') handlers.onReasoningDelta(delta.reasoning_content);
  if (typeof delta.reasoning === 'string') handlers.onReasoningDelta(delta.reasoning);
  if (typeof delta.content === 'string' && delta.content.length > 0) handlers.onTextDelta(delta.content);
  // 工具调用
  const toolCalls = delta.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const t = tc as Record<string, unknown>;
      const idx = String(t.index ?? 0);
      const fn = (t.function ?? {}) as Record<string, unknown>;
      const id = String(t.id ?? `call_${idx}`);
      const name = typeof fn.name === 'string' ? fn.name : '';
      const args = typeof fn.arguments === 'string' ? fn.arguments : '';
      // 累积参数片段
      const prev = toolArgs.get(idx) ?? '';
      toolArgs.set(idx, prev + args);
      if (name) {
        handlers.onToolCall({
          id,
          name,
          args: args.length > 0 ? safeParse(args) : {},
          rawArguments: args.length > 0 ? args : undefined,
        });
      }
    }
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 工厂：按预设生成 OpenAI 兼容 provider 实例 */
export function createOpenAICompatibleProvider(id: string, displayName: string): ChatProvider {
  return {
    id,
    displayName,
    streamChat,
    // 自动检测模型：GET {baseURL}/models（OpenAI 兼容标准端点）
    async listModels(baseURL: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
      try {
        const url = `${baseURL.replace(/\/+$/, '')}/models`;
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal,
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { data?: { id?: string }[] };
        return (data.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string' && x.length > 0);
      } catch {
        return [];
      }
    },
  };
}

/**
 * 双协议 provider（OpenAI 官方用）：按 request.protocol 分发。
 * - 'responses' → OpenAI Responses API（最新，POST /responses）
 * - 'chat' / 缺省 → chat/completions（兼容生态）
 */
export function createDualProtocolProvider(id: string, displayName: string): ChatProvider {
  const base = createOpenAICompatibleProvider(id, displayName);
  return {
    id,
    displayName,
    streamChat: (request, handlers, signal) => {
      if (request.protocol === 'responses') return responsesStreamChat(request, handlers, signal);
      return streamChat(request, handlers, signal);
    },
    listModels: base.listModels,
  };
}
