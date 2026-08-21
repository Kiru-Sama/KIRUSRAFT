/**
 * 通用 OpenAI 兼容 provider（v0.0.31）
 * 覆盖绝大多数官方服务商（DeepSeek chat 版/OpenAI/Moonshot/智谱/通义/豆包/SiliconFlow/OpenRouter 等）
 * 与 OpenAI 兼容中转站。协议：POST {baseURL}/chat/completions，SSE 流式解析 choices[].delta。
 * 纯 ECMAScript fetch，无 Node 依赖。
 */
import type { ChatMessagePart, ChatRequest, ChatStreamHandlers } from '../core/types';
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

/** 构造 chat/completions 消息：普通消息数组或完整 input（工具循环用）。
 *  content 为字符串时原样；为部件数组时映射 text→text、image→image_url（data URL）。 */
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
      // input_text / input_image 等 → 简化（input_image 图片必须映射为 image_url，否则 String() 得到 "[object Object]"）
      const content = Array.isArray(it.content)
        ? (it.content as Record<string, unknown>[]).map((p): Record<string, unknown> =>
            p.type === 'input_text'
              ? { type: 'text', text: String(p.text ?? '') }
              : { type: 'image_url', image_url: { url: String(p.image_url ?? '') } },
          )
        : String(it.content ?? '');
      return { role: it.role === 'ai' ? 'assistant' : it.role === 'user' ? 'user' : it.role, content };
    });
  }
  const messages = (request.messages ?? []).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: Array.isArray(m.content) ? contentToChatParts(m.content) : m.content,
  }));
  // systemPrompt（全局或会话级）→ 前置 system 消息（RikkaHub：chat 版保留在 messages 数组）
  const system = request.systemPrompt?.trim();
  if (system && messages[0]?.role !== 'system') {
    messages.unshift({ role: 'system', content: system });
  }
  return messages;
}

/** ChatMessagePart[] → OpenAI chat 格式 content 数组（image_url 传 data URL，参考 RikkaHub ChatCompletionsAPI 631-644 行） */
function contentToChatParts(parts: ChatMessagePart[]): Record<string, unknown>[] {
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : p.type === 'image'
        ? { type: 'image_url', image_url: { url: p.imageUrl } }
        : { type: 'text', text: p.text },
  );
}

/** 思考强度档位 → OpenAI chat 官方 reasoning_effort（RikkaHub ChatCompletionsAPI 396-402 行：
 *  官方只支持 low/medium/high；AUTO 省略；OFF 落最低档。KIRUSRAFT 档位 0=OFF 1=AUTO 2~5=低/中/高/最大） */
function thinkToEffort(level: number | undefined): string | undefined {
  if (level === undefined || level <= 1) return undefined; // 不思考/自动 → 不写（服务商默认）
  if (level === 2) return 'low';
  if (level === 3) return 'medium';
  return 'high'; // 4=高 5=最大 → 官方无更高档，落 high
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
  // 请求 usage（计费统计 v0.0.65）：chat/completions 需显式 stream_options.include_usage 才返回
  body.stream_options = { include_usage: true };
  // 采样温度（可空则省略，服务商默认；参考 RikkaHub ChatCompletionsAPI 240-244）
  if (request.temperature !== undefined) body.temperature = request.temperature;
  // 思考强度：官方 reasoning_effort（AUTO/不思考不写，服务商默认）
  const effort = thinkToEffort(request.thinkLevel);
  if (effort) body.reasoning_effort = effort;
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
  // 工具参数缓存：多个 delta 片段累积（idx → args 字符串）
  const toolArgs = new Map<string, string>();
  // 工具元信息：idx → { id, name }（name 只在首个 chunk 出现，需记录供流结束后统一触发）
  const toolMeta = new Map<string, { id: string; name: string }>();

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
        dispatch(ev.data, handlers, toolArgs, toolMeta);
      }
    }
    // 流结束：统一触发累积完整的工具调用（参数跨多个 chunk 分片，只有结束时才完整）
    for (const [idx, meta] of toolMeta) {
      const full = toolArgs.get(idx) ?? '';
      handlers.onToolCall({
        id: meta.id,
        name: meta.name,
        args: full.length > 0 ? safeParse(full) : {},
        rawArguments: full.length > 0 ? full : undefined,
      });
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
function dispatch(data: unknown, handlers: ChatStreamHandlers, toolArgs: Map<string, string>, toolMeta: Map<string, { id: string; name: string }>): void {
  if (typeof data !== 'object' || data === null) return;
  const record = data as Record<string, unknown>;
  const choices = record.choices;
  // usage chunk：choices 为空数组、usage 有值（include_usage 时流末尾返回，v0.0.65 计费统计）
  if ((!Array.isArray(choices) || choices.length === 0) && record.usage && typeof record.usage === 'object') {
    const u = record.usage as Record<string, unknown>;
    const input = Number(u.prompt_tokens ?? 0);
    const output = Number(u.completion_tokens ?? 0);
    const cache = Number(u.prompt_cache_hit_tokens ?? 0); // v0.0.67：缓存命中 token（DeepSeek 等）
    handlers.onUsage?.({ inputTokens: input, outputTokens: output, totalTokens: input + output, cacheInputTokens: cache });
    return;
  }
  if (!Array.isArray(choices) || choices.length === 0) return;
  const choice = choices[0] as Record<string, unknown>;
  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  // reasoning_content（DeepSeek/智谱/通义等）→ 推理增量
  if (typeof delta.reasoning_content === 'string') handlers.onReasoningDelta(delta.reasoning_content);
  if (typeof delta.reasoning === 'string') handlers.onReasoningDelta(delta.reasoning);
  if (typeof delta.content === 'string' && delta.content.length > 0) handlers.onTextDelta(delta.content);
  // 工具调用：只累积（参数分片跨 chunk），流结束统一触发（避免 args 只取到首片）
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
        // 首个带 name 的 chunk：记录元信息（后续纯参数分片 name 为空，不重复触发）
        toolMeta.set(idx, { id, name });
        // 工作思维流（v0.0.70）：工具调用开始——"正在调用工具 X"
        handlers.onToolStart?.(name);
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
