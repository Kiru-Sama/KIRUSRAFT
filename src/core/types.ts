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
  /** 用户就地编辑过（AI 回复修改标记，v0.0.66）：UI 在时间旁标"已修改"，标记本身不进 AI 上下文 */
  editedByUser?: boolean;
  /** AI 思考过程（推理文本，v0.0.66）：流式时累积、气泡内展示；不进 AI 上下文（toChatContent 只取 parts） */
  reasoning?: string;
}

/** 消息节点（RikkaHub MessageNode 对齐版）：会话内一个"位置"，可含多个候选消息（regen/编辑产生），selectIndex 选中当前展示哪个 */
export interface MessageNode {
  id: string;
  /** 所属会话 id（外键关联，参考 RikkaHub message_node.conversation_id） */
  conversationId: string;
  /** 节点在会话链内的排序位置（0 起，参考 node_index；可由数组下标推导，持久化更稳） */
  nodeIndex: number;
  /** 该位置的候选消息列表（通常 1 个；regenerate/编辑后 push 新候选，旧候选保留可切回） */
  messages: Message[];
  /** 当前选中的候选下标（切换分支只改这里，后续节点链不动 = 共享链语义） */
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

/** 会话（RikkaHub 消息树对齐版）：有序节点链 + 每节点内多候选；systemPrompt 为当前对话级系统提示词（覆盖全局，留空=用全局） */
export interface Session {
  id: string;
  title: string;
  /** 节点链（每条消息一个节点；节点内多候选表达分支） */
  nodes: MessageNode[];
  createdAt: number;
  systemPrompt?: string;
  /** 用量统计（v0.0.65：计费卡数据源；可选，旧数据无此字段） */
  stats?: SessionStats;
}

/** 消息内容部件（provider 层）：文本或图片（图片为 dataURL 或 URL，参考 RikkaHub UIMessagePart.Image 三态 url） */
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string; alt?: string };

/** provider 消息：纯文本保持字符串（兼容旧链路），含图片时用部件数组（各 provider 再映射成自己的格式） */
export type ChatMessageContent = string | ChatMessagePart[];

/** 聊天请求（DeepSeek Responses 适配层） */
export interface ChatRequest {
  model: string;
  apiKey: string;
  baseURL: string;
  /** 协议选择：responses（OpenAI Responses API）或 chat（chat/completions，默认） */
  protocol?: 'responses' | 'chat';
  messages?: { role: string; content: ChatMessageContent }[];
  /** Responses API 完整 input（工具循环回传 function_call/function_call_output 用） */
  input?: Record<string, unknown>[];
  tools?: { type: string; name?: string; parameters?: unknown; max_uses?: number }[];
  maxTokens?: number;
  /** 采样温度（0~2；不传=服务商默认） */
  temperature?: number;
  /** 系统提示词（全局或会话级，各 provider 映射到自己的 system 位置） */
  systemPrompt?: string;
  /** 上下文轮数限制（0=不限；1 轮=1 条用户消息+其后所有回复），发送前按轮截断历史 */
  maxRounds?: number;
  /** 思考强度档位（0=不思考 1=自动 2=低 3=中 4=高 5=最大），各 provider 映射到自己的 reasoning 参数 */
  thinkLevel?: number;
}

/** 流式聊天回调 */
export interface ChatStreamHandlers {
  onTextDelta(text: string): void;
  onReasoningDelta(text: string): void;
  onToolCall(call: { id: string; name: string; args: Record<string, unknown>; rawArguments?: string }): void;
  onDone(): void;
  onError(error: Error): void;
  /** 可选：流结束收到 usage（token 统计；chat/completions 需 stream_options.include_usage，responses 在 completed 事件，claude 在 message_start/message_delta）
   *  cacheInputTokens：输入中命中缓存的 token 数（v0.0.67 缓存命中统计；chat=prompt_cache_hit_tokens，responses=input_tokens_details.cached_tokens，claude=cache_read_input_tokens） */
  onUsage?(usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheInputTokens?: number }): void;
}

/** 会话级用量统计（v0.0.65：计费卡数据源，随会话落盘） */
export interface SessionStats {
  requestCount: number;
  totalTokens: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  /** 本场估算费用（美元，按 chat 分节单价折算；无单价时 0） */
  totalCost: number;
  /** 最近一次请求的缓存命中 token（v0.0.67 缓存命中统计；无明细=0） */
  lastCacheInputTokens: number;
}

/** 服务商 profile（可插件化扩展） */
export interface ProviderProfile {
  id: string;
  displayName: string;
  baseURL: string;
  model: string;
  apiKey: string;
  /** 可选：余额查询接口（缺省 = DeepSeek 官方 /user/balance；非 DeepSeek 显示 —） */
  balanceUrl?: string;
}
