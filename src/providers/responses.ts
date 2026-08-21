/**
 * 通用 OpenAI Responses API provider（v0.0.38）
 * 协议：POST {baseURL}/responses，SSE 解析 response.output_text.delta / function_call 等。
 * DeepSeek 官方与 OpenAI 官方共用本实现（Responses API 是两者共同标准）。
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

/** 构造 Responses input：普通消息数组或完整 input（工具循环用）。
 *  content 字符串→input_text；部件数组→text→input_text/output_text、image→input_image。
 *  reasoning（v0.0.80）为独立顶层 input 条目 {type:"reasoning", content:[{type:"reasoning_text", text}]}，不嵌入消息 content。
 *  assistant 消息用 output_text（RikkaHub ResponseAPI.kt:512 规范）。 */
function buildInput(request: ChatRequest): ResponsesInputItem[] {
  if (request.input && request.input.length > 0) return request.input;
  const result: ResponsesInputItem[] = [];
  for (const m of request.messages ?? []) {
    const contentParts: { type: string; text?: string; imageUrl?: string }[] = [];
    const reasoningParts: { text: string }[] = [];
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'reasoning') {
          reasoningParts.push({ text: p.text });
        } else {
          contentParts.push(p);
        }
      }
    }
    // 消息条目（含文本/图片，不含 reasoning）
    if (contentParts.length > 0 || typeof m.content === 'string') {
      result.push({
        role: m.role,
        content: Array.isArray(m.content)
          ? contentParts.map((p) =>
              p.type === 'text'
                ? { type: m.role === 'user' ? 'input_text' : 'output_text', text: p.text }
                : { type: 'input_image', image_url: p.imageUrl },
            )
          : [{ type: m.role === 'user' ? 'input_text' : 'output_text', text: m.content }],
      });
    }
    // reasoning 独立条目（assistant 后才跟，RikkaHub ResponseAPI.kt:345-402）
    for (const rp of reasoningParts) {
      result.push({
        type: 'reasoning',
        content: [{ type: 'reasoning_text', text: rp.text }],
      });
    }
  }
  return result;
}

/** 思考强度档位 → Responses reasoning.effort（RikkaHub ResponseAPI 233-249：AUTO 省略 effort；
 *  OFF→"none"；LOW/MEDIUM/HIGH/MAX 原样。KIRUSRAFT 档位 0=OFF 1=AUTO 2~5=低/中/高/最大） */
function thinkToEffort(level: number | undefined): string | undefined {
  if (level === undefined || level === 1) return undefined; // 自动 → 不写（模型默认）
  if (level === 0) return 'none'; // 不思考
  if (level === 2) return 'low';
  if (level === 3) return 'medium';
  if (level === 4) return 'high';
  return 'max'; // 5=最大
}

/** 发起流式聊天，分发增量；收集 function 工具调用 */
export async function responsesStreamChat(request: ChatRequest, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  // 校验 endpoint
  let endpoint: string;
  try {
    endpoint = `${request.baseURL.replace(/\/+$/, '')}/responses`;
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
    input: buildInput(request),
    stream: true,
    max_output_tokens: request.maxTokens ?? 4096,
  };
  // 采样温度（可空则省略；参考 RikkaHub ResponseAPI 216-220）
  if (request.temperature !== undefined) body.temperature = request.temperature;
  // systemPrompt → 顶层 instructions（Responses API 惯例，RikkaHub ResponseAPI 222-228）
  const system = request.systemPrompt?.trim();
  if (system) body.instructions = system;
  // 思考强度：reasoning.effort（AUTO 不写，模型默认；RikkaHub ResponseAPI 233-249）
  const effort = thinkToEffort(request.thinkLevel);
  if (effort) body.reasoning = { effort };
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
  // 工具参数缓存：function_call_arguments.done 先给参数，output_item.done 兜底合并
  const argCache = new Map<string, string>();

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
        dispatch(ev.data, handlers, argCache);
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

/** 事件分发（Responses API SSE） */
function dispatch(data: unknown, handlers: ChatStreamHandlers, argCache: Map<string, string>): void {
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
      if (typeof record.call_id === 'string' && typeof record.arguments === 'string') {
        argCache.set(record.call_id, record.arguments);
      }
      break;
    case 'response.output_item.added': {
      // 工作思维流（v0.0.70）：工具条目"开始"——"正在调用工具 X"状态行触发点
      const item = record.item as Record<string, unknown> | undefined;
      if (item && item.type === 'function_call' && typeof item.name === 'string') {
        handlers.onToolStart?.(item.name);
      }
      break;
    }
    case 'response.output_item.done': {
      const item = record.item as Record<string, unknown> | undefined;
      if (item && item.type === 'function_call' && typeof item.name === 'string' && item.call_id) {
        let args: Record<string, unknown> = {};
        const argumentsStr =
          typeof item.arguments === 'string' && item.arguments.length > 0
            ? item.arguments
            : argCache.get(String(item.call_id)) ?? '';
        try {
          if (argumentsStr.length > 0) {
            args = JSON.parse(argumentsStr);
          }
        } catch {
          /* 参数解析失败用空对象 */
        }
        handlers.onToolCall({
          id: String(item.call_id),
          name: item.name,
          args,
          rawArguments: argumentsStr.length > 0 ? argumentsStr : undefined,
        });
      }
      break;
    }
    case 'response.web_search_call.in_progress':
    case 'response.web_search_call.searching':
      // 联网搜索状态（v0.0.69，APITOOL 同款）：模型发起搜索 → 右上角提示
      handlers.onWebSearch?.('searching');
      break;
    case 'response.web_search_call.completed':
      handlers.onWebSearch?.('completed');
      break;
    case 'response.completed': {
      // usage 统计（v0.0.65 计费 + v0.0.67 缓存命中）：Responses API 在 completed 事件携带 usage
      const u = record.usage as Record<string, unknown> | undefined;
      if (u) {
        const input = Number(u.input_tokens ?? 0);
        const output = Number(u.output_tokens ?? 0);
        const details = u.input_tokens_details as Record<string, unknown> | undefined;
        const cache = Number(details?.cached_tokens ?? 0);
        handlers.onUsage?.({ inputTokens: input, outputTokens: output, totalTokens: input + output, cacheInputTokens: cache });
      }
      break;
    }
    default:
      break;
  }
}

/** 工厂：按预设生成 Responses API provider 实例 */
export function createResponsesProvider(id: string, displayName: string): ChatProvider {
  return { id, displayName, streamChat: responsesStreamChat };
}
