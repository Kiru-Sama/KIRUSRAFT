/**
 * KIRUSRAFT 核心类型契约（v0.0.1）
 * 参考 RikkaHub：Tool 六字段契约、UIMessagePart 贯穿内核/UI/线上
 */

/** 跨插件事件词汇（扩展 Cordis Events 接口） */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'session-switch'(id: string): void;
    'session-deleted'(id: string): void;
  }
}

/** 消息部件：模型回传与 UI 渲染共用（Text/Image 双用途） */
export type UIMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string; alt?: string };

/** 消息角色 */
export type MessageRole = 'user' | 'ai';

/** 单条消息 */
export interface Message {
  id: string;
  role: MessageRole;
  parts: UIMessagePart[];
  createdAt: number;
}

/** 消息节点（RikkaHub MessageNodeEntity 对齐版）：会话内节点，多候选消息 + 选中索引表达分支 */
export interface MessageNode {
  id: string;
  /** 所属会话 id（外键关联，参考 RikkaHub message_node.conversation_id） */
  conversationId: string;
  /** 节点在会话内的排序位置（0 起，参考 node_index） */
  nodeIndex: number;
  messages: Message[];
  selectIndex: number;
}

/** 工具契约（六字段，参考 RikkaHub Tool） */
export interface Tool {
  name: string;
  description: string;
  /** 参数 schema（简化 object 型 JSON Schema） */
  parameters?: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** 是否需要用户审批 */
  needsApproval?: boolean;
  /** 动态提示注入 */
  systemPrompt?: () => string;
  /** 执行工具，返回消息部件 */
  execute(args: Record<string, unknown>): Promise<UIMessagePart[]>;
}

/** 工具审批请求 */
export interface ToolApprovalRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  approved: boolean;
  reason?: string;
}

/** 会话（简化：单节点起步，分叉后续扩展） */
export interface Session {
  id: string;
  title: string;
  node: MessageNode;
  createdAt: number;
}

/** 聊天请求（DeepSeek Responses 适配层） */
export interface ChatRequest {
  model: string;
  apiKey: string;
  baseURL: string;
  messages?: { role: string; content: string }[];
  /** Responses API 完整 input（工具循环回传 function_call/function_call_output 用） */
  input?: Record<string, unknown>[];
  tools?: { type: string; name?: string; parameters?: unknown; max_uses?: number }[];
  maxTokens?: number;
}

/** 流式聊天回调 */
export interface ChatStreamHandlers {
  onTextDelta(text: string): void;
  onReasoningDelta(text: string): void;
  onToolCall(call: { id: string; name: string; args: Record<string, unknown>; rawArguments?: string }): void;
  onDone(): void;
  onError(error: Error): void;
}

/** 服务商 profile（可插件化扩展） */
export interface ProviderProfile {
  id: string;
  displayName: string;
  baseURL: string;
  model: string;
  apiKey: string;
}
