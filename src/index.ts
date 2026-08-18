/**
 * KIRUSRAFT 内核入口（v0.0.1）
 * Cordis 装配：核心服务 + 插件挂载。
 * 依赖顺序由 Cordis inject 声明自动推导，加载顺序无关紧要。
 */
import { Context } from '@deepseek-ai/cordis';
import * as CoreServices from './plugins/core-services';
import * as ProviderDeepseek from './plugins/provider-deepseek';
import * as ToolTime from './plugins/tool-time';
import * as FallbackGui from './plugins/fallback-gui';
import * as PluginOverview from './plugins/plugin-overview';
import * as Deconstruction from './plugins/deconstruction';

export interface BootstrapOptions {
  /** 挂载根节点 */
  root?: HTMLElement;
  /** UI 插件选择（可选，默认无主题插件，兜底 GUI 保持现代简洁） */
  uiPlugin?: string;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<Context> {
  const ctx = new Context();

  // 内核服务（工具注册表 + 服务商注册表），最先挂载
  await ctx.plugin(CoreServices);

  // 服务商插件：DeepSeek 官方标准（Responses API）
  await ctx.plugin(ProviderDeepseek);

  // 工具插件：get_time_info（本地工具验证 agent 循环）
  await ctx.plugin(ToolTime);

  // 插件总览：右下角按钮 + 面板，展示插件/工具/服务商
  await ctx.plugin(PluginOverview);

  // 兜底 GUI：内核自带，永远挂载（保证有界面）
  await ctx.plugin(FallbackGui, { root: options.root });

  // UI 插件：显式指定才挂载（APITOOL 解构风等）
  if (options.uiPlugin === 'deconstruction') {
    await ctx.plugin(Deconstruction, { enabled: true });
  }

  return ctx;
}

// 浏览器入口
declare global {
  interface Window {
    KIRUSRAFT?: { bootstrap: typeof bootstrap };
  }
}

if (typeof window !== 'undefined') {
  window.KIRUSRAFT = { bootstrap };
}
