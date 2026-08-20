/**
 * 界面/主题插件判定（v0.0.41 收敛版）
 * 单一来源：主题判定全部读 manifest（kind==='ui-theme' + providesGui），
 * 删除旧 GUI_THEMES 硬编码名单。加新主题无需改任何表。
 * 消费方：topology.ts（GUI 仲裁）、kernel-gui.ts（主题按钮）经此函数 + manifest 查询。
 */
import type { Context } from '@deepseek-ai/cordis';
import { isGuiThemePlugin } from './manifest';

/**
 * 主题是否自带完整 GUI（GUI 仲裁用）。
 * 从 topology 的登记表读 manifest（index.ts 启动时 registerPlugin 登记了全部插件）。
 * ctx 传入是避免模块级循环依赖；判定规则收敛在 manifest.isGuiThemePlugin。
 */
export function isGuiTheme(ctx: Context, name: string): boolean {
  try {
    return isGuiThemePlugin(ctx.topology.getManifest(name));
  } catch {
    return false;
  }
}

/** 主题插件模块类型（静态导入的插件对象：name/kind/apply） */
export interface ThemePluginModule {
  name: string;
  kind?: string;
  apply: (ctx: Context, config?: Record<string, unknown>) => unknown;
}
