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
    : (() => {
        const result: Record<string, unknown>[] = [];
        for (const m of options.request.messages ?? []) {
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
          // 消息条目（不含 reasoning）
          if (contentParts.length > 0 || typeof m.content === 'string') {
            result.push({
              role: m.role,
              content: contentParts.length > 0
                ? contentParts.map((p) =>
                    p.type === 'text'
                      ? { type: 'input_text', text: p.text }
                      : { type: 'input_image', image_url: p.imageUrl },
                  )
                : [{ type: 'input_text', text: m.content as string }],
            });
          }
          // reasoning 独立顶层条目（Responses API 格式，RikkaHub ResponseAPI.kt:345-402）
          for (const rp of reasoningParts) {
            result.push({
              type: 'reasoning',
              content: [{ type: 'reasoning_text', text: rp.text }],
            });
          }
        }
        return result;
      })();

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
    // v0.0.84：累积本轮 reasoning（DeepSeek thinking 模式工具循环必须回传 reasoning_text，否则报错）
    let stepReasoning = '';

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
      // v0.0.84：累积本轮思考内容，工具回传时作为独立 reasoning 条目回传
      onReasoningDelta: (delta) => {
        stepReasoning += delta;
        handlers.onReasoningDelta(delta);
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

    // 执行工具，回传结果（P2-13：可中断——中止后不再执行排队工具，避免 abort 后仍跑完整批）
    for (const call of toolCalls) {
      if (options.signal?.aborted) break;
      // v0.0.84：回传本轮 reasoning_text（独立顶层条目，跟随第一个 function_call 之前；只回传一次）
      if (stepReasoning.length > 0) {
        input.push({ type: 'reasoning', content: [{ type: 'reasoning_text', text: stepReasoning }] });
        stepReasoning = '';
      }
      const argumentsStr = call.rawArguments ?? JSON.stringify(call.args);
      input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: argumentsStr });
      try {
        const parts = await options.tools.execute(call.name, call.args);
        // v0.0.71：tool 标注 part 不回传（仅 UI 展示），text/image 转文本
        const output = parts
          .filter((p): p is Extract<UIMessagePart, { type: 'text' | 'image' }> => p.type === 'text' || p.type === 'image')
          .map((p) => (p.type === 'text' ? p.text : `[图片: ${p.alt ?? p.imageUrl}]`))
          .join('\n');
        input.push({ type: 'function_call_output', call_id: call.id, output });
        // v0.0.84（主线 B）：工具输出回传 UI 渲染工具卡结果；v0.0.85 带 callId 供按 id 定位（对齐 RikkaHub）
        handlers.onToolDone?.({ name: call.name, output, callId: call.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.push({ type: 'function_call_output', call_id: call.id, output: `工具执行错误: ${message}` });
        handlers.onToolDone?.({ name: call.name, output: `工具执行错误: ${message}`, callId: call.id });
        // v0.0.94：工具执行出错，标记完成并返回，避免循环卡住
        finishOnce();
        handlers.onError(new Error(`工具执行错误: ${message}`));
        return;
      }
    }
  }

  // maxSteps 耗尽仍未完成：给出明确提示
  if (!finished) {
    finishOnce(); // 先触发 onDone，让调用方完成 usage 写入
    handlers.onError(new Error(`已达最大步数 ${maxSteps}，工具循环未完成`));
  }
}
