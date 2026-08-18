/**
 * agent 循环（v0.0.1）
 * 内核抽象层：模型调工具 → 执行 → 回传 → 继续生成，直到无工具调用或达 maxSteps。
 */
import type { ChatRequest, ChatStreamHandlers, UIMessagePart } from './types';
import type { ChatProvider } from '../providers/types';

/** agent 循环对工具服务的最小依赖（不依赖整个 ToolsService，便于测试与解耦） */
export interface ToolExecutor {
  declarations(): { type: string; name: string; description: string; parameters: unknown }[];
  execute(name: string, args: Record<string, unknown>): Promise<UIMessagePart[]>;
}

export interface AgentLoopOptions {
  provider: ChatProvider;
  request: ChatRequest;
  tools: ToolExecutor;
  maxSteps?: number;
  signal?: AbortSignal;
}

/** 执行一次完整 agent 循环 */
export async function runAgentLoop(options: AgentLoopOptions, handlers: ChatStreamHandlers): Promise<void> {
  const maxSteps = options.maxSteps ?? 8;
  const input: Record<string, unknown>[] = options.request.input
    ? [...options.request.input]
    : (options.request.messages ?? []).map((m) => ({
        role: m.role,
        content: [{ type: 'input_text', text: m.content }],
      }));

  // 工具声明：已注册的 function 工具 + 可选服务端 web_search
  const functionTools = options.tools.declarations();
  const serverTools = options.request.tools ?? [];

  let finished = false;
  const finishOnce = () => {
    if (!finished) {
      finished = true;
      handlers.onDone();
    }
  };

  for (let step = 0; step < maxSteps; step++) {
    const toolCalls: { id: string; name: string; args: Record<string, unknown>; rawArguments?: string }[] = [];

    const stepHandlers: ChatStreamHandlers = {
      ...handlers,
      // 关键：单轮流结束不通知调用方（onDone 只在整个循环结束时触发一次）
      onDone: () => {
        /* 单轮结束，忽略 */
      },
      onError: (error) => {
        finished = true;
        handlers.onError(error);
      },
      onToolCall: (call) => {
        toolCalls.push(call);
        handlers.onToolCall(call);
      },
    };

    await options.provider.streamChat(
      {
        ...options.request,
        input,
        tools: [...serverTools, ...functionTools],
      },
      stepHandlers,
      options.signal,
    );

    if (options.signal?.aborted || finished) return;
    if (toolCalls.length === 0) {
      finishOnce();
      return;
    }

    // 执行工具，回传结果
    for (const call of toolCalls) {
      const argumentsStr = call.rawArguments ?? JSON.stringify(call.args);
      input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: argumentsStr });
      try {
        const parts = await options.tools.execute(call.name, call.args);
        const output = parts.map((p) => (p.type === 'text' ? p.text : `[图片: ${p.alt ?? p.imageUrl}]`)).join('\n');
        input.push({ type: 'function_call_output', call_id: call.id, output });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.push({ type: 'function_call_output', call_id: call.id, output: `工具执行错误: ${message}` });
      }
    }
  }

  // maxSteps 耗尽仍未完成：给出明确提示
  if (!finished) {
    handlers.onError(new Error(`已达最大步数 ${maxSteps}，工具循环未完成`));
  }
}
