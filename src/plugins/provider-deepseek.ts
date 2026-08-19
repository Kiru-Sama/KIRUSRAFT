/**
 * DeepSeek 官方 provider 插件（v0.0.1）
 * 内核抽象层：服务商 = 插件，注册到 providers 服务。
 */
import { Context } from '@deepseek-ai/cordis';
import { DeepSeekProvider } from '../providers/deepseek';

export const name = 'provider-deepseek';
export const inject = ['providers'];

export function apply(ctx: Context): void {
  ctx.providers.register(ctx, DeepSeekProvider);
}
