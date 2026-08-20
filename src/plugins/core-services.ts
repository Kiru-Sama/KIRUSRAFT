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
import { registerProfileConfig } from '../core/profile-config';
import { RateService } from '../core/rate-service';
import type { PluginManifest } from '../core/manifest';

export const name = 'core-services';

export const manifest: PluginManifest = {
  name,
  kind: 'core',
  label: { zh: '核心服务', en: 'Core Services' },
  group: '基础',
  protected: true,
  provide: ['tools', 'providers', 'config', 'storage', 'topology', 'rate'],
  description: '内核抽象层服务装配：工具注册表、服务商注册表、配置中心、存储、拓扑',
  apply,
};

export function apply(ctx: Context): void {
  // 逐个服务独立 try/catch：某个服务初始化失败（如 IndexedDB 不可用）不影响其余服务注册，
  // 避免 core-services 整体挂掉导致依赖它的全部插件 PENDING、应用白屏（RikkaHub 条件注册思路）。
  const services: Array<[string, () => void]> = [
    ['tools', () => new ToolsService(ctx)],
    ['providers', () => new ProviderService(ctx)],
    ['config', () => new ConfigService(ctx)],
    ['storage', () => new StorageService(ctx)],
    ['topology', () => new TopologyService(ctx)],
    // profile 配置分节（服务商设置）：生命周期跟内核，GUI 卸载不反注册。
    // 若 GUI 各自注册会"谁先注册谁占坑"，切换后分节消失 → 兜底 GUI 设置面板缺服务商（白屏 bug 伴生根因）
    ['profile', () => registerProfileConfig(ctx)],
    // 汇率同步服务（免费 API 拉取 USD→CNY，计费显示用）
    ['rate', () => new RateService(ctx)],
  ];
  for (const [name, init] of services) {
    try {
      init();
    } catch (error) {
      // 单服务失败不致命：logger 记录，其余服务照常注册
      // eslint-disable-next-line no-console
      console.error(`[core-services] 服务 ${name} 初始化失败:`, error);
    }
  }
}
