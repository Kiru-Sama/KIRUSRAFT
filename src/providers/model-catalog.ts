/**
 * 模型能力目录（v0.0.84，主线 A）
 * 把 RikkaHub 的 Model{type, inputModalities, outputModalities, abilities} 声明式标注映射成 JS 结构：
 * 用正则/子串从模型 id 推导能力（id 变化自动命中，不用手维护 id→能力 映射表）。
 * 用途：①模型选择 UI 渲染能力标签（📷🔧🧠）②发送前校验当前模型是否支持图片。
 */
export type ModelModality = 'text' | 'image';
export type ModelAbility = 'tool' | 'reasoning';

export interface ModelCapability {
  /** 显示名 */
  name: string;
  /** 输入模态（text / image） */
  input: ModelModality[];
  /** 输出模态 */
  output: ModelModality[];
  /** 能力标注（tool / reasoning） */
  abilities: ModelAbility[];
  /** 一句话说明（可选） */
  note?: string;
}

/** 能力目录：按数组顺序匹配，首个命中即用；视觉模型规则必须放在同前缀纯文本规则之前 */
const MODEL_CATALOG: { match: RegExp; cap: ModelCapability }[] = [
  // DeepSeek 新视觉实验版（用户实测 deepseek-v4-flash-vision-exp）
  { match: /^deepseek-v4-flash-vision/i, cap: { name: 'DeepSeek V4 Flash Vision', input: ['text', 'image'], output: ['text'], abilities: ['tool', 'reasoning'], note: '支持图片输入（JPEG/PNG/GIF/WebP）' } },
  // DeepSeek V4 系列（纯文本）
  { match: /^deepseek-v4-(pro|flash|re)/i, cap: { name: 'DeepSeek V4', input: ['text'], output: ['text'], abilities: ['tool', 'reasoning'] } },
  // DeepSeek 经典
  { match: /^deepseek-(chat|reasoner)/i, cap: { name: 'DeepSeek 经典', input: ['text'], output: ['text'], abilities: ['tool'] } },
  // OpenAI 旗舰（GPT-5 / o 系列支持看图+推理）
  { match: /^gpt-5|^o\d/i, cap: { name: 'OpenAI 旗舰', input: ['text', 'image'], output: ['text'], abilities: ['tool', 'reasoning'] } },
  { match: /^gpt-4[o-]/i, cap: { name: 'GPT-4o', input: ['text', 'image'], output: ['text'], abilities: ['tool'] } },
  // 视觉模型通用兜底：名称含 vision / vl / visual 一律标为支持图片
  { match: /vision|vl|visual/i, cap: { name: '视觉模型', input: ['text', 'image'], output: ['text'], abilities: ['tool'] } },
  // Claude
  { match: /^claude/i, cap: { name: 'Claude', input: ['text'], output: ['text'], abilities: ['tool', 'reasoning'] } },
  // Gemini（支持多模态）
  { match: /^gemini/i, cap: { name: 'Gemini', input: ['text', 'image'], output: ['text'], abilities: ['tool', 'reasoning'] } },
];

/** 从模型 id 推导能力（未命中回退纯文本） */
export function resolveModelCapabilities(modelId: string): ModelCapability {
  for (const c of MODEL_CATALOG) {
    if (c.match.test(modelId)) return c.cap;
  }
  return { name: modelId, input: ['text'], output: ['text'], abilities: [] };
}

/** 该模型是否支持图片输入 */
export function supportsImage(modelId: string): boolean {
  return resolveModelCapabilities(modelId).input.includes('image');
}
