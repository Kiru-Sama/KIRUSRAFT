/**
 * deconstruction UI 插件（v0.0.1）
 * APITOOL 解构主义设计语言的迁移版：米白底、红色强调、粗边框、硬阴影。
 * 作为 KIRUSRAFT 的第一个 UI/UX 插件（注册表 + 样式包模型）。
 */
import { Context } from '@deepseek-ai/cordis';

export const name = 'ui-deconstruction';

export interface Config {
  /** 默认启用 */
  enabled?: boolean;
}

/** 解构风样式包：CSS 变量 + 组件类 */
const STYLE = `
:root {
  --kr-bg: #F3EFE6;
  --kr-bg2: #EAE3D5;
  --kr-bg3: #D9CFBB;
  --kr-accent: #CC1319;
  --kr-accent2: #E60012;
  --kr-surface: #FFFFFF;
  --kr-surface2: #F7F3EC;
  --kr-text: #1D1D1D;
  --kr-text2: #4A4A4A;
  --kr-border: #1D1D1D;
  --kr-shadow: 4px 4px 0 #1D1D1D;
  --kr-font: -apple-system, "Microsoft YaHei", sans-serif;
}
body.kr-deconstruction {
  background: var(--kr-bg);
  font-family: var(--kr-font);
}
.kr-deconstruction [data-fg="messages"] { background: var(--kr-bg); }
.kr-deconstruction [data-fg="messages"] > div[style*="background: #fff"] {
  background: var(--kr-surface) !important;
  border: 2px solid var(--kr-border) !important;
  box-shadow: var(--kr-shadow) !important;
  border-radius: 2px !important;
}
.kr-deconstruction [data-fg="input"] {
  background: var(--kr-surface) !important;
  border: 2px solid var(--kr-border) !important;
  box-shadow: var(--kr-shadow) !important;
  border-radius: 2px !important;
  color: var(--kr-text) !important;
}
.kr-deconstruction [data-fg="send"] {
  background: var(--kr-accent) !important;
  border: 2px solid var(--kr-border) !important;
  box-shadow: var(--kr-shadow) !important;
  border-radius: 2px !important;
}
.kr-deconstruction [data-fg="header"] {
  background: var(--kr-accent) !important;
  border-bottom: 3px solid var(--kr-border) !important;
}
`;

export function apply(ctx: Context, config: Config): void {
  const enabled = config.enabled ?? true;
  if (!enabled) return;

  const styleEl = document.createElement('style');
  styleEl.dataset.plugin = 'ui-deconstruction';
  styleEl.textContent = STYLE;

  // 副作用回收：卸载时移除样式（Cordis effect 模式）
  ctx.effect(() => {
    document.head.appendChild(styleEl);
    document.body.classList.add('kr-deconstruction');
    return () => {
      styleEl.remove();
      document.body.classList.remove('kr-deconstruction');
    };
  });
}
