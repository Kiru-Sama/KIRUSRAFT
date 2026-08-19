/**
 * 服务商预设表（v0.0.31）
 * 官方服务商 + 聚合中转站预设。每项带 baseURL / 默认模型 / 密钥购买链接（用户要求贴心附上）。
 * 协议：除 Anthropic 外均为 OpenAI 兼容（/chat/completions）；DeepSeek 保留 Responses 专用实现。
 * 数据来源：2026-08 官方文档/OpenAPI/SDK 源码/API 直连核验（见研究记录）。
 */

export type ProviderKind = 'openai' | 'anthropic' | 'deepseek-responses';

export interface ProviderPreset {
  /** 预设 id（= 选它时写入 profile.id，provider 插件按此注册实例） */
  id: string;
  /** 显示名 */
  name: string;
  /** 分组：official = 官方，relay = 聚合/中转 */
  group: 'official' | 'relay';
  /** API baseURL（OpenAI 兼容端点，不含 /chat/completions） */
  baseURL: string;
  /** 默认模型名 */
  model: string;
  /** 密钥购买/申请页面（贴心附上） */
  keyUrl: string;
  /** 协议类型 */
  kind: ProviderKind;
  /** 可选的协议列表（支持双协议时：如 openai 官方可选 responses/chat） */
  protocols?: ('responses' | 'chat')[];
  /** 一句话说明（可选） */
  note?: string;
}

/** 全部预设（官方 19 家 + 聚合中转 2 家 + 自定义中转模板） */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ===== 官方 =====
  { id: 'deepseek', name: 'DeepSeek 深度求索', group: 'official', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', kind: 'deepseek-responses', note: '国产性价比之王，官方 Responses API（支持思考）' },
  { id: 'openai', name: 'OpenAI', group: 'official', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys', kind: 'openai', protocols: ['responses', 'chat'], note: '国际通用，生态最全；支持 Responses API（最新）与 Chat Completions' },
  { id: 'anthropic', name: 'Anthropic Claude', group: 'official', baseURL: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest', keyUrl: 'https://console.anthropic.com/settings/keys', kind: 'anthropic', note: '长文写作/代码强项' },
  { id: 'gemini', name: 'Google Gemini', group: 'official', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/app/apikey', kind: 'openai', note: '免费额度大，OpenAI 兼容端点' },
  { id: 'moonshot', name: 'Moonshot Kimi 月之暗面', group: 'official', baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k2', keyUrl: 'https://platform.kimi.com/console/api-keys', kind: 'openai', note: '长上下文中文强' },
  { id: 'zhipu', name: '智谱 GLM', group: 'official', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', kind: 'openai', note: '国产全能，flash 免费' },
  { id: 'qwen', name: '阿里通义千问', group: 'official', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com', kind: 'openai', note: '阿里百炼平台' },
  { id: 'doubao', name: '字节豆包 火山方舟', group: 'official', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1-5-lite', keyUrl: 'https://console.volcengine.com/ark', kind: 'openai', note: '火山方舟' },
  { id: 'hunyuan', name: '腾讯混元', group: 'official', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-lite', keyUrl: 'https://console.cloud.tencent.com/hunyuan/start', kind: 'openai', note: '腾讯云' },
  { id: 'ernie', name: '百度千帆', group: 'official', baseURL: 'https://qianfan.baidubce.com/v2', model: 'ernie-speed', keyUrl: 'https://console.bce.baidu.com/qianfan', kind: 'openai', note: '百度智能云千帆' },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', group: 'official', baseURL: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', keyUrl: 'https://cloud.siliconflow.cn/account/ak', kind: 'openai', note: '国产模型聚合（官方平台）' },
  { id: 'xai', name: 'xAI Grok', group: 'official', baseURL: 'https://api.x.ai/v1', model: 'grok-2', keyUrl: 'https://console.x.ai', kind: 'openai', note: '马斯克旗下' },
  { id: 'groq', name: 'Groq', group: 'official', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', kind: 'openai', note: '极速推理，免费额度' },
  { id: 'mistral', name: 'Mistral AI', group: 'official', baseURL: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai', kind: 'openai', note: '欧洲开源模型' },
  { id: 'yi', name: '零一万物 Yi', group: 'official', baseURL: 'https://api.lingyiwanwu.com/v1', model: 'yi-lightning', keyUrl: 'https://platform.lingyiwanwu.com/apikeys', kind: 'openai', note: '国产，李开复团队' },
  { id: 'stepfun', name: '阶跃星辰 StepFun', group: 'official', baseURL: 'https://api.stepfun.com/v1', model: 'step-1-8k', keyUrl: 'https://platform.stepfun.com/interface-key', kind: 'openai', note: '国产' },
  { id: 'baichuan', name: '百川 Baichuan', group: 'official', baseURL: 'https://api.baichuan-ai.com/v1', model: 'baichuan4', keyUrl: 'https://platform.baichuan-ai.com/console/apikey', kind: 'openai', note: '国产' },
  { id: 'minimax', name: 'MiniMax', group: 'official', baseURL: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3', keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', kind: 'openai', note: '海螺/星野同源' },
  // ===== 聚合 / 中转 =====
  { id: 'tokenrhythm', name: '基元律动（聚合中转）', group: 'relay', baseURL: 'https://tokenrhythm.studio/v1', model: 'deepseek-v4-flash', keyUrl: 'https://tokenrhythm.studio/account/keys', kind: 'openai', note: '多模型聚合接入：一个 Key 用遍 DeepSeek/GLM/Kimi/Qwen 等，支持 OpenAI + Claude 双协议' },
  { id: 'openrouter', name: 'OpenRouter（国际中转聚合）', group: 'relay', baseURL: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', keyUrl: 'https://openrouter.ai/settings/keys', kind: 'openai', note: '一个密钥用遍全球模型，按量计费' },
  { id: 'custom', name: '自定义中转站（OpenAI 兼容）', group: 'relay', baseURL: 'https://your-proxy.com/v1', model: '', keyUrl: '', kind: 'openai', note: '填入任意 OpenAI 兼容中转的 baseURL 与密钥' },
];

/** 按 id 查预设 */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
