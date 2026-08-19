/**
 * DeepSeek Responses API provider（v0.0.38）
 * 复用通用 Responses 实现（src/providers/responses.ts）。
 * DeepSeek 官方协议 = OpenAI Responses API 标准，思考流/工具调用原生支持。
 */
import { responsesStreamChat, createResponsesProvider } from './responses';

/** 兼容导出（deepseek.test.ts 直接 import streamChat） */
export const streamChat = responsesStreamChat;
export type { ResponsesInputItem } from './responses';

/** DeepSeek 官方标准 provider */
export const DeepSeekProvider = createResponsesProvider('deepseek', 'DeepSeek 官方');
