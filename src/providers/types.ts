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
  /** 可用性检查（本地，无网络） */
  available(): boolean;
}
