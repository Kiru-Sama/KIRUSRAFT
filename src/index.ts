/**
 * KIRUSRAFT 内核入口（v0.0.27）
 * Cordis 装配：核心服务 + 插件挂载（全插件设计：统一 manifest 插槽遍历装配）。
 * GUI 仲裁（v0.0.19）：默认直接进主题插件 GUI（ui-exdark）；主题加载失败或用户选"默认"时挂兜底 GUI。
 * 新增插件 = 一个插件文件（含 manifest）+ PLUGINS 数组加一行，不再手改挂载/登记多处。
 */
import { Context } from '@deepseek-ai/cordis';
import * as CoreServices from './plugins/core-services';
import * as ProviderDeepseek from './plugins/provider-deepseek';
import * as ToolTime from './plugins/tool-time';
import * as FallbackGui from './plugins/fallback-gui';
import * as KernelGui from './plugins/kernel-gui';
import * as UpdateChecker from './plugins/update-checker';
import * as Exdark from './plugins/theme-exdark';
import { logger } from './core/logger';
import type { PluginManifest } from './core/manifest';
import { toCordisPlugin } from './core/manifest';

export interface BootstrapOptions {
  /** 挂载根节点 */
  root?: HTMLElement;
}

/**
 * 全部插件清单（统一 manifest 插槽）。
 * 顺序：core-services 必须最先（注册内核服务）；主题与兜底由 GUI 仲裁决定挂载；其余按需挂载。
 * 新增插件：import 插件模块 + 这里加一行 manifest 即可。
 */
const PLUGINS: PluginManifest[] = [
  CoreServices.manifest,
  ProviderDeepseek.manifest,
  ToolTime.manifest,
  KernelGui.manifest,
  UpdateChecker.manifest,
  Exdark.manifest,
  FallbackGui.manifest,
];

export async function bootstrap(options: BootstrapOptions = {}): Promise<Context> {
  const ctx = new Context();

  // 1. 核心服务（工具注册表 + 服务商注册表），最先挂载
  await ctx.plugin(toCordisPlugin(CoreServices.manifest));

  // 2. 登记可重载插件（TopologyService 重挂用；Cordis 卸载最后一个 fiber 会从 registry 删除 runtime）
  for (const m of PLUGINS) {
    ctx.topology.registerPlugin(m.name, m);
  }

  // 3. 配置分节
  // ui 配置分节：当前主题（默认进主题 GUI，v0.0.19 起默认 ui-exdark）
  ctx.config.register(ctx, { namespace: 'ui', displayName: '界面', defaults: { theme: 'ui-exdark' } });
  // docking 配置分节：空间站贴靠关系（用户拖拽布局，导体模型持久化；无表单，仅存储）
  ctx.config.register(ctx, { namespace: 'docking', displayName: '插件装载布局', defaults: {} });

  // 4. 主题恢复 + GUI 仲裁（读 manifest 的 providesGui，替代旧 GUI_THEMES 硬编码）
  const themeManifests = PLUGINS.filter((m) => m.kind === 'ui-theme');
  const themeByName = new Map(themeManifests.map((m) => [m.name, m]));
  const storedTheme = String(ctx.config.get('ui').theme ?? '');
  const theme = themeByName.has(storedTheme) ? storedTheme : 'ui-exdark';
  let guiReady = false;
  const themeMod = themeByName.get(theme);
  if (themeMod) {
    try {
      await ctx.plugin(toCordisPlugin(themeMod), { enabled: true });
      guiReady = themeMod.providesGui ?? false;
    } catch (error) {
      logger.error('gui', `主题 ${theme} 加载失败，回退兜底 GUI: ${String(error)}`);
    }
  }

  // 5. 兜底 GUI：主题未提供完整 GUI（覆盖层主题/加载失败/未选主题）时挂兜底（属内核，受保护）
  if (!guiReady) {
    try {
      await ctx.plugin(toCordisPlugin(FallbackGui.manifest), { root: options.root });
    } catch (error) {
      // 双保险兜底也失败：不崩 bootstrap，留控制台错误（此时确实无 GUI，用户可开 Web 控制台排查）
      logger.error('gui', `兜底 GUI 挂载失败: ${String(error)}`);
    }
  }

  // 6. 其余插件（服务商/工具/管理/更新检测）：遍历 manifest 挂载（跳过已挂载的 core/主题/兜底）
  //    guiReady=true 时也必须跳过 fallback-gui：否则双挂载 → profile 分节被主题占坑、fallback 注册被吞、
  //    禁用主题后兜底 GUI 早已在跑但功能残缺（白屏 bug 根因，子代理审查确认）
  const mounted = new Set(['core-services', theme, 'fallback-gui']);
  for (const m of PLUGINS) {
    if (mounted.has(m.name)) continue;
    await ctx.plugin(toCordisPlugin(m));
  }

  // 7. 崩溃自动拉起应急控制台（白屏终极保险）：
  //    任何未捕获异常/未处理 Promise 拒绝后，若当前没有 GUI 提供者（主题/应急控制台），
  //    自动挂载 fallback-gui。这样无论什么原因导致白屏，只要 JS 还在跑就能救回界面。
  //    logger 已先记录原始错误（window error hook），此处只做界面恢复，不重复记日志。
  const crashRecovery = (): void => {
    void ctx.topology.ensureGui().then((r) => {
      if (!r.ok) logger.error('gui', r.message ?? '崩溃恢复：应急控制台拉起失败');
    });
  };
  window.addEventListener('error', crashRecovery);
  window.addEventListener('unhandledrejection', crashRecovery);
  // 随 ctx 生命周期清理（防止重复 bootstrap 叠加监听器）
  ctx.effect(() => () => {
    window.removeEventListener('error', crashRecovery);
    window.removeEventListener('unhandledrejection', crashRecovery);
  });

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
