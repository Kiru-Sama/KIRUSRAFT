/**
 * 服务商 provider 抽象（v0.0.1）
 * 内核抽象层：统一聊天契约，DeepSeek 官方 / 自定义 OpenAI 兼容端点都是 provider 插件。
 */
import type { ChatRequest, ChatStreamHandlers } from '../core/types';

/** 聊天 provider 契约 */
export interface ChatProvider {
  id: string;
  displayName: string;
  /** 发起流式聊天 */
  streamChat(request: ChatRequest, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void>;
  /** 可选：拉取可用模型列表（右上角模型下拉用；不实现则 UI 用内置预设模型） */
  listModels?(baseURL: string, apiKey: string, signal?: AbortSignal): Promise<string[]>;
}
