/**
 * plugin-overview 插件（v0.0.1b）
 * 插件总览：像 APITOOL 状态栏，展示当前加载的插件、工具、服务商。
 * 独立 UI（右下角固定按钮 + 面板），不侵入兜底 GUI。
 */
import { Context } from '@deepseek-ai/cordis';

export const name = 'plugin-overview';
export const inject = ['tools', 'providers', 'config'];

interface PluginRuntime {
  name?: string;
  fibers?: { size?: number };
}

export function apply(ctx: Context): void {
  // 创建右下角固定按钮
  const btn = document.createElement('button');
  btn.textContent = '插件';
  btn.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:50;padding:10px 16px;background:#4f6ef7;color:#fff;border:none;border-radius:999px;font-size:13px;font-weight:500;cursor:pointer;box-shadow:0 2px 12px rgba(79,110,247,.4);';

  // 面板（初始隐藏）
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;right:16px;bottom:72px;z-index:50;width:320px;max-height:70vh;overflow-y:auto;background:#fff;border:1px solid #ececf1;border-radius:16px;box-shadow:0 8px 32px rgba(31,35,40,.15);padding:16px;display:none;font-family:system-ui,sans-serif;';

  function renderOverview(): string {
    // 插件列表
    const plugins: string[] = [];
    try {
      const values = ctx.registry.values();
      for (const runtime of values) {
        const r = runtime as PluginRuntime;
        const fiberCount = r.fibers?.size ?? 1;
        plugins.push(`${r.name ?? '(匿名)'}${fiberCount > 0 ? ' [已挂载]' : ''}`);
      }
    } catch {
      plugins.push('（无法枚举插件）');
    }

    // 工具列表
    const tools = ctx.tools.list().map((t) => `${t.name}: ${t.description.slice(0, 30)}`);
    // 服务商列表
    const providers = ctx.providers.list().map((p) => `${p.id} (${p.displayName})`);
    // 配置分节列表
    const configSections = ctx.config.list().map((s) => `${s.namespace} (${s.displayName})`);

    const section = (title: string, items: string[]) =>
      `<div style="font-size:13px;font-weight:600;color:#1f2328;margin:12px 0 6px;">${title}</div>` +
      (items.length > 0
        ? `<div style="font-size:12px;color:#5a6172;line-height:1.8;">${items.map((i) => `<div>· ${escapeHtml(i)}</div>`).join('')}</div>`
        : `<div style="font-size:12px;color:#9aa1b0;">（无）</div>`);

    return `
      <div style="font-size:15px;font-weight:700;color:#1f2328;border-bottom:1px solid #ececf1;padding-bottom:8px;">插件总览</div>
      ${section(`插件 (${plugins.length})`, plugins)}
      ${section(`工具 (${tools.length})`, tools)}
      ${section(`服务商 (${providers.length})`, providers)}
      ${section(`配置 (${configSections.length})`, configSections)}
    `;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function togglePanel(): void {
    if (panel.style.display === 'none' || panel.style.display === '') {
      panel.innerHTML = renderOverview();
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  }

  ctx.effect(() => {
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    btn.addEventListener('click', togglePanel);
    return () => {
      btn.remove();
      panel.remove();
    };
  });
}
