/**
 * 界面/主题插件注册表（v0.0.20）
 * 主题插件的集中登记：显示名 + 是否自带完整 GUI。
 * 只登记真正的主题（完整设计语言的 GUI，如 Exdark）；样式覆盖实验不算主题。
 * index.ts（挂载）、topology.ts（GUI 仲裁）、kernel-gui.ts（主题按钮）共用，保证单点一致。
 */
import type { Context } from '@deepseek-ai/cordis';

export interface GuiThemeMeta {
  /** 显示名（内核中心主题按钮、总览展示用） */
  label: string;
  /**
   * 是否自带完整 GUI：
   * true = 进软件直接进该主题界面，兜底 GUI 不挂载；
   * false = 样式覆盖层，叠在兜底 GUI 上。
   */
  providesGui: boolean;
}

/** 主题插件注册表：插件 runtime 名 → 元数据 */
export const GUI_THEMES: Record<string, GuiThemeMeta> = {
  'ui-exdark': { label: 'Exdark', providesGui: true },
};

/** 主题是否自带完整 GUI */
export function isGuiTheme(name: string): boolean {
  return GUI_THEMES[name]?.providesGui ?? false;
}

/** 主题显示名（未知主题回退原名） */
export function themeLabel(name: string): string {
  return GUI_THEMES[name]?.label ?? name;
}

/** 主题插件模块类型（静态导入的插件对象：name/kind/apply） */
export interface ThemePluginModule {
  name: string;
  kind?: string;
  apply: (ctx: Context, config?: Record<string, unknown>) => unknown;
}
