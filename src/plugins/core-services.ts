/**
 * 内核服务装配（v0.0.1）
 * 注册内核抽象层服务：ToolsService（工具注册表）、ProviderService（服务商注册表）。
 * 其他插件 inject: ['tools'] / ['providers'] 依赖这里。
 */
import { Context } from '@deepseek-ai/cordis';
import { ToolsService } from '../core/tools';
import { ProviderService } from '../providers/service';
import { ConfigService } from '../core/config';
import { StorageService } from '../core/storage';

export const name = 'core-services';

export function apply(ctx: Context): void {
  new ToolsService(ctx);
  new ProviderService(ctx);
  new ConfigService(ctx);
  new StorageService(ctx);
}
