/**
 * 服务商预设插件（v0.0.31，原名 provider-deepseek 保留兼容）
 * 内核抽象层：服务商 = 插件。注册全部预设 provider 实例：
 *   - DeepSeek 官方（Responses API，支持思考）
 *   - Anthropic Claude（/v1/messages）
 *   - 其余全部 OpenAI 兼容（/chat/completions），含官方与聚合中转
 * 预设数据在 src/providers/presets.ts（含密钥购买链接，UI 可展示）。
 */
import { Context } from '@deepseek-ai/cordis';
import { DeepSeekProvider } from '../providers/deepseek';
import { AnthropicProvider } from '../providers/anthropic';
import { createOpenAICompatibleProvider, createDualProtocolProvider } from '../providers/openai-compatible';
import { PROVIDER_PRESETS } from '../providers/presets';
import type { PluginManifest } from '../core/manifest';

export const name = 'provider-deepseek';
export const inject = ['providers'];

export const manifest: PluginManifest = {
  name,
  kind: 'provider',
  label: { zh: '服务商预设', en: 'Provider Presets' },
  group: '服务商',
  inject,
  configSection: 'profile',
  description: '官方 + 中转站服务商预设：DeepSeek/OpenAI/Claude/Gemini/智谱/通义/豆包等（附密钥购买链接）',
  apply,
};

export function apply(ctx: Context): void {
  // 按协议类型分发：deepseek-responses 用专用实现，anthropic 用 Claude 实现，
  // 支持双协议（openai 官方 protocols 含 responses）用双协议 provider，其余 OpenAI 兼容
  for (const preset of PROVIDER_PRESETS) {
    let provider;
    if (preset.kind === 'deepseek-responses') {
      provider = DeepSeekProvider;
    } else if (preset.kind === 'anthropic') {
      provider = AnthropicProvider;
    } else if (preset.protocols && preset.protocols.length > 1) {
      // 双协议：按 profile.protocol 在 Responses / chat 间切换（默认 responses）
      provider = createDualProtocolProvider(preset.id, preset.name);
    } else {
      provider = createOpenAICompatibleProvider(preset.id, preset.name);
    }
    try {
      ctx.providers.register(ctx, provider);
    } catch (error) {
      // 单预设注册失败不阻断其余（如 id 冲突），记录即可
      // eslint-disable-next-line no-console
      console.error(`[providers] 注册 ${preset.id} 失败:`, error);
    }
  }
}
