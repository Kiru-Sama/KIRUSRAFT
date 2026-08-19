/**
 * KIRUSRAFT 内核入口（v0.0.19）
 * Cordis 装配：核心服务 + 插件挂载。
 * GUI 仲裁（v0.0.19）：默认直接进主题插件 GUI（ui-exdark）；主题加载失败或用户选"默认"时挂兜底 GUI。
 */
import { Context } from '@deepseek-ai/cordis';
import * as CoreServices from './plugins/core-services';
import * as ProviderDeepseek from './plugins/provider-deepseek';
import * as ToolTime from './plugins/tool-time';
import * as FallbackGui from './plugins/fallback-gui';
import * as KernelGui from './plugins/kernel-gui';
import * as UpdateChecker from './plugins/update-checker';
import * as Exdark from './plugins/theme-exdark';
import { GUI_THEMES } from './core/gui-registry';
import { logger } from './core/logger';
import type { ThemePluginModule } from './core/gui-registry';

export interface BootstrapOptions {
  /** 挂载根节点 */
  root?: HTMLElement;
  /** UI 插件选择（可选，默认无主题插件，兜底 GUI 保持现代简洁） */
  uiPlugin?: string;
}

/** 主题插件模块注册表：runtime 名 → 静态导入的插件模块（与 gui-registry 的元数据一一对应） */
const THEME_MODULES: Record<string, ThemePluginModule> = {
  'ui-exdark': Exdark as unknown as ThemePluginModule,
};

export async function bootstrap(options: BootstrapOptions = {}): Promise<Context> {
  const ctx = new Context();

  // 内核服务（工具注册表 + 服务商注册表），最先挂载
  await ctx.plugin(CoreServices);

  // 登记可重载插件（TopologyService 重挂用；Cordis 卸载最后一个 fiber 会从 registry 删除 runtime）
  const registerAll = (): void => {
    for (const [name, mod] of Object.entries(THEME_MODULES)) {
      ctx.topology.registerPlugin(name, mod);
    }
    for (const [name, mod] of Object.entries({
      'core-services': CoreServices,
      'provider-deepseek': ProviderDeepseek,
      'tool-time': ToolTime,
      'fallback-gui': FallbackGui,
      'kernel-gui': KernelGui,
      'update-checker': UpdateChecker,
    })) {
      ctx.topology.registerPlugin(name, mod as unknown as ThemePluginModule);
    }
  };
  registerAll();

  // ui 配置分节：当前主题（默认进主题 GUI，v0.0.19 起默认 ui-exdark）
  ctx.config.register(ctx, { namespace: 'ui', displayName: '界面', defaults: { theme: 'ui-exdark' } });

  // 主题恢复：读 config.ui.theme 挂载对应主题（默认直接进主题插件 GUI）。
  // 存过已下架/未知主题（如旧版 ui-deconstruction）时回退默认主题，避免直接掉进兜底 GUI
  const storedTheme = String(ctx.config.get('ui').theme ?? '');
  const theme = THEME_MODULES[storedTheme] ? storedTheme : 'ui-exdark';
  let guiReady = false;
  const themeMod = THEME_MODULES[theme];
  if (themeMod) {
    try {
      await ctx.plugin(themeMod as never, { enabled: true } as never);
      guiReady = GUI_THEMES[theme]?.providesGui ?? false;
    } catch (error) {
      logger.error('gui', `主题 ${theme} 加载失败，回退兜底 GUI: ${String(error)}`);
    }
  }

  // GUI 仲裁：主题未提供完整 GUI（覆盖层主题/加载失败/未选主题）时挂兜底 GUI
  if (!guiReady) {
    await ctx.plugin(FallbackGui, { root: options.root });
  }

  // 服务商插件：DeepSeek 官方标准（Responses API）
  await ctx.plugin(ProviderDeepseek);

  // 工具插件：get_time_info（本地工具验证 agent 循环）
  await ctx.plugin(ToolTime);

  // 内核中心：管理界面（6 tab 全屏面板），入口由当前激活 GUI 提供
  await ctx.plugin(KernelGui);

  // 更新检测：check_update 工具 + 下载 APK
  await ctx.plugin(UpdateChecker);

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
