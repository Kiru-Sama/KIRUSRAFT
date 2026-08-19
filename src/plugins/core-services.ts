/**
 * 内核服务装配（v0.0.1）
 * 注册内核抽象层服务：工具注册表、服务商注册表、配置中心、存储、拓扑。
 * 其他插件 inject: ['tools'] / ['providers'] / ['config'] / ['storage'] / ['topology'] 依赖这里。
 */
import { Context } from '@deepseek-ai/cordis';
import { ToolsService } from '../core/tools';
import { ProviderService } from '../providers/service';
import { ConfigService } from '../core/config';
import { StorageService } from '../core/storage';
import { TopologyService } from '../core/topology';

export const name = 'core-services';

export function apply(ctx: Context): void {
  new ToolsService(ctx);
  new ProviderService(ctx);
  new ConfigService(ctx);
  new StorageService(ctx);
  new TopologyService(ctx);
}
