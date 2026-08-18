/**
 * KIRUSRAFT 内核入口（v0.0.1）
 * Cordis 装配：上下文 + 插件挂载。
 * 加载顺序与失败隔离由 Cordis 生命周期管理。
 */
import { Context } from '@deepseek-ai/cordis';
import * as FallbackGui from './plugins/fallback-gui';
import * as Deconstruction from './plugins/deconstruction';

export interface BootstrapOptions {
  /** 挂载根节点 */
  root?: HTMLElement;
  /** UI 插件选择 */
  uiPlugin?: string;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<Context> {
  const ctx = new Context();

  // 兜底 GUI：内核自带，永远挂载（保证有界面），保持极简中性样式
  ctx.plugin(FallbackGui, { root: options.root });

  // UI 插件：按配置选择挂载；默认不挂任何主题插件（兜底 GUI 纯净极简）
  // deconstruction（APITOOL 解构风）等主题插件由 uiPlugin 显式指定时启用
  const ui = options.uiPlugin;
  if (ui === 'deconstruction') {
    ctx.plugin(Deconstruction, { enabled: true });
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
