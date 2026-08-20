/**
 * 兜底 GUI（应急控制台，v0.0.29）
 * 定位：不带任何设计风格、不提供对话。仅保证所有插件/主题 GUI 崩了之后，
 * 用户仍能 ①查看并启停插件（应急恢复）②查看日志（排障）。
 * 属内核本体（受保护），不依赖任何 UI 插件，自包含实现。
 */
import { Context } from '@deepseek-ai/cordis';
import { logger, filterByRange, renderEntry, type LogRange } from '../core/logger';
import { VERSION } from '../core/version';
import type { PluginManifest } from '../core/manifest';

export const name = 'fallback-gui';
export const inject = ['providers', 'tools', 'config', 'storage', 'topology'];

export const manifest: PluginManifest = {
  name,
  kind: 'gui',
  label: { zh: '应急控制台', en: 'Fallback Console' },
  group: '界面',
  inject,
  providesGui: true,
  protected: true,
  description: '内核应急控制台：插件全崩时仍可启停插件、查看日志（无设计风格、无对话）',
  apply,
};

export interface Config {
  /** 挂载根节点，缺省取 #app */
  root?: HTMLElement;
}

/** 状态码 → 文字（与 topology 的 FiberState 对齐：2=ACTIVE，3=FAILED） */
const STATE_TEXT: Record<number, string> = {
  0: '等待',
  1: '加载中',
  2: '已启用',
  3: '出问题',
  4: '卸载中',
  5: '已停用',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function apply(ctx: Context, config: Record<string, unknown> = {}): void {
  // 双保险：默认参数兜 undefined，这里再兜 null/脏值（旧版曾因 config undefined 读 .root 崩）
  config = config ?? {};
  const root = (config.root as HTMLElement | undefined) ?? document.getElementById('app');
  if (!root) throw new Error('fallback-gui: 找不到挂载节点');
  // 热备模式（H1）：bootstrap 常驻挂载但初始隐藏（hidden=true），由 fallback:show/hide 事件切显隐。
  // 应急台作为内核兜底，始终挂载保证"关键时刻无需挂载操作"，只切 display。
  const hiddenByDefault = config.hidden === true;

  // 中性极简样式：无设计风格（无圆角/无阴影/无图标/无彩色强调），纯功能可读
  const container = document.createElement('div');
  container.className = 'fg-console';
  container.innerHTML = `
    <style>
      .fg-console{display:flex;flex-direction:column;height:100%;position:relative;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;background:#fff;color:#111;box-sizing:border-box;}
      .fg-console *{box-sizing:border-box;margin:0;padding:0;border-radius:0;}
      .fg-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;background:#f5f5f5;border-bottom:1px solid #ccc;flex-shrink:0;}
      .fg-head strong{font-size:14px;color:#111;}
      .fg-head .fg-sub{font-size:11px;color:#666;margin-left:8px;}
      .fg-head .fg-tabs{display:flex;gap:4px;flex-shrink:0;}
      .fg-tab{background:#fff;border:1px solid #999;color:#111;padding:5px 14px;font-size:12px;cursor:pointer;font-family:inherit;}
      .fg-tab.active{background:#111;color:#fff;border-color:#111;}
      .fg-body{flex:1;overflow-y:auto;padding:14px;}
      /* 插件列表 */
      .fg-plugin{border:1px solid #ccc;margin-bottom:8px;padding:10px 12px;background:#fafafa;}
      .fg-plugin .fg-prow{display:flex;justify-content:space-between;align-items:center;gap:10px;}
      .fg-plugin .fg-pname{font-size:13px;font-weight:bold;color:#111;}
      .fg-plugin .fg-pdesc{font-size:11px;color:#666;margin-top:2px;}
      .fg-plugin .fg-pstate{font-size:11px;color:#555;white-space:nowrap;}
      .fg-plugin .fg-pstate.err{color:#b00;}
      .fg-plugin .fg-pstate.ok{color:#060;}
      .fg-plugin .fg-pactions{margin-top:8px;}
      .fg-btn{background:#fff;border:1px solid #666;color:#111;padding:4px 12px;font-size:12px;cursor:pointer;font-family:inherit;}
      .fg-btn:hover{background:#eee;}
      .fg-btn:disabled{opacity:.5;cursor:not-allowed;}
      .fg-btn.danger{color:#b00;border-color:#b00;}
      /* 日志 */
      .fg-logbar{display:flex;gap:6px;margin-bottom:8px;}
      .fg-logview{background:#1e1e1e;color:#d4d4d4;font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;padding:10px;border:1px solid #444;min-height:200px;max-height:calc(100vh - 220px);overflow-y:auto;}
      .fg-hint{font-size:11px;color:#888;margin-bottom:10px;}
      @media (max-width:640px){ .fg-head{padding:calc(8px + env(safe-area-inset-top,0px)) 10px 8px;gap:6px;} .fg-tab{padding:4px 10px;font-size:11px;} }
    </style>
    <div class="fg-head">
      <div style="display:flex;align-items:center;min-width:0;">
        <strong>KIRUSRAFT</strong><span class="fg-sub">应急控制台 v${esc(VERSION)}</span>
      </div>
      <div class="fg-tabs">
        <button type="button" class="fg-tab active" data-fg-tab="plugins">插件控制</button>
        <button type="button" class="fg-tab" data-fg-tab="logs">日志</button>
      </div>
    </div>
    <div class="fg-body">
      <div data-fg-view="plugins">
        <div class="fg-hint">所有主题/界面插件崩了之后，从这里启停插件应急恢复。受保护插件不可停用。</div>
        <div data-fg="pluginList"></div>
      </div>
      <div data-fg-view="logs" style="display:none;">
        <div class="fg-logbar">
          <span class="fg-logrange" data-fg="logRange">
            <button type="button" class="fg-btn active" data-fg-range="today">今天</button>
            <button type="button" class="fg-btn" data-fg-range="3d">3天</button>
            <button type="button" class="fg-btn" data-fg-range="all">全部</button>
          </span>
          <button type="button" class="fg-btn" data-fg="logCopy">复制</button>
          <button type="button" class="fg-btn" data-fg="logExport">导出</button>
          <button type="button" class="fg-btn" data-fg="logRefresh">刷新</button>
          <button type="button" class="fg-btn danger" data-fg="logClear">清空日志</button>
        </div>
        <div class="fg-logview" data-fg="logBody"></div>
      </div>
    </div>
  `;
  root.appendChild(container);
  // 热备初始隐藏（H1）：display:none 不布局不绘制，但 DOM/事件/监听全部就绪
  if (hiddenByDefault) {
    container.style.display = 'none';
  }

  const pluginListEl = container.querySelector('[data-fg="pluginList"]') as HTMLElement;
  const logBodyEl = container.querySelector('[data-fg="logBody"]') as HTMLElement;
  const tabBtns = [...container.querySelectorAll<HTMLButtonElement>('[data-fg-tab]')];
  const views = {
    plugins: container.querySelector('[data-fg-view="plugins"]') as HTMLElement,
    logs: container.querySelector('[data-fg-view="logs"]') as HTMLElement,
  };
  const logRefreshBtn = container.querySelector('[data-fg="logRefresh"]') as HTMLButtonElement;
  const logClearBtn = container.querySelector('[data-fg="logClear"]') as HTMLButtonElement;
  const logCopyBtn = container.querySelector('[data-fg="logCopy"]') as HTMLButtonElement;
  const logExportBtn = container.querySelector('[data-fg="logExport"]') as HTMLButtonElement;
  const logRangeEl = container.querySelector('[data-fg="logRange"]') as HTMLElement;
  let logRange: LogRange = 'today';

  /** 渲染插件列表（应急控制：启停 + 状态） */
  function renderPlugins(): void {
    let topo;
    try {
      topo = ctx.topology.getTopology();
    } catch {
      pluginListEl.textContent = '拓扑服务不可用';
      return;
    }
    const nodes = topo.nodes.filter((n) => n.kind !== 'core');
    if (nodes.length === 0) {
      pluginListEl.textContent = '（无插件）';
      return;
    }
    pluginListEl.innerHTML = nodes
      .map((n) => {
        const meta = ctx.topology.getManifest(n.id);
        const zh = meta?.label?.zh ?? n.id;
        const desc = meta?.description ?? '';
        const protectedP = ctx.topology.isProtected(n.id);
        const active = n.stateCode === 2;
        const stateCls = n.stateCode === 3 ? 'err' : n.stateCode === 2 ? 'ok' : '';
        const stateText = protectedP && active ? '内置' : (STATE_TEXT[n.stateCode] ?? String(n.stateCode));
        // 主题类插件启用走 switchTheme（自动卸载本控制台换主题 GUI）；其余直接 togglePlugin
        const isTheme = n.kind === 'theme';
        const btnHtml = protectedP
          ? '<button type="button" class="fg-btn" disabled>内置</button>'
          : active
            ? `<button type="button" class="fg-btn danger" data-fg-toggle="${esc(n.id)}" data-fg-switch="${isTheme ? '1' : ''}">停用</button>`
            : `<button type="button" class="fg-btn" data-fg-toggle="${esc(n.id)}" data-fg-switch="${isTheme ? '1' : ''}">启用</button>`;
        return `<div class="fg-plugin">
          <div class="fg-prow">
            <div style="min-width:0;">
              <div class="fg-pname">${esc(zh)}</div>
              ${desc ? `<div class="fg-pdesc">${esc(desc)}</div>` : ''}
            </div>
            <span class="fg-pstate ${stateCls}">${esc(stateText)}</span>
          </div>
          <div class="fg-pactions">${btnHtml}</div>
        </div>`;
      })
      .join('');
  }

  /** 渲染日志（读持久化日志；每条带产生它的版本号，白屏排障可溯源；按范围过滤防几天日志混抄） */
  async function renderLogs(): Promise<void> {
    const entries = filterByRange(await logger.getLogsAsync(), logRange);
    logBodyEl.textContent = entries
      .map((e) => renderEntry(e))
      .join('\n') || '（暂无日志）';
    logBodyEl.scrollTop = logBodyEl.scrollHeight;
  }

  // tab 切换
  const switchView = (name: 'plugins' | 'logs'): void => {
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.fgTab === name));
    views.plugins.style.display = name === 'plugins' ? 'block' : 'none';
    views.logs.style.display = name === 'logs' ? 'block' : 'none';
    if (name === 'logs') void renderLogs();
    if (name === 'plugins') renderPlugins();
  };
  tabBtns.forEach((b) => b.addEventListener('click', () => switchView((b.dataset.fgTab as 'plugins' | 'logs') ?? 'plugins')));

  // 插件启停（事件委托）
  pluginListEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fg-toggle]');
    if (!btn?.dataset.fgToggle) return;
    const id = btn.dataset.fgToggle;
    const isTheme = btn.dataset.fgSwitch === '1';
    const doToggle = async (): Promise<void> => {
      let r: { ok: boolean; message?: string };
      if (isTheme) {
        // 主题启用走 switchTheme：成功则本控制台被卸载换主题 GUI；停用走 togglePlugin（回控制台）
        const topo = ctx.topology.getTopology();
        const themeActive = topo.nodes.some((n) => n.kind === 'theme' && n.stateCode === 2 && n.id === id);
        r = themeActive ? await ctx.topology.togglePlugin(id) : await ctx.topology.switchTheme(id);
      } else {
        r = await ctx.topology.togglePlugin(id);
      }
      if (!r.ok) {
        logBodyEl.textContent = `操作失败：${r.message ?? ''}`;
        switchView('logs');
      }
      renderPlugins();
    };
    void doToggle();
  });

  logRefreshBtn.addEventListener('click', () => void renderLogs());
  logClearBtn.addEventListener('click', () => {
    logger.clear();
    void renderLogs();
  });
  logCopyBtn.addEventListener('click', () => {
    void logger.copy(logRange).then((ok) => {
      logBodyEl.textContent = ok ? `已复制 ${logRangeLabel(logRange)}日志到剪贴板` : '复制失败（剪贴板不可用），请用导出下载文件';
    });
  });
  logExportBtn.addEventListener('click', () => {
    logger.download(logRange);
    logBodyEl.textContent = `已导出 ${logRangeLabel(logRange)}日志文件`;
  });
  logRangeEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-fg-range]') as HTMLElement | null;
    if (!btn) return;
    logRange = btn.dataset.fgRange as LogRange;
    logRangeEl.querySelectorAll('[data-fg-range]').forEach((b) => b.classList.toggle('active', b === btn));
    void renderLogs();
  });

  function logRangeLabel(range: LogRange): string {
    return range === 'today' ? '今天' : range === '3d' ? '最近3天' : '全部';
  }

  logger.info('gui', `应急控制台已挂载${hiddenByDefault ? '（热备隐藏）' : ''}`);
  renderPlugins();

  // H1 热备显隐：由 GUI 仲裁（topology ensureGui/switchTheme）emit 控制，应急台自身不决策
  ctx.on('fallback:show', () => {
    container.style.display = 'flex';
    renderPlugins(); // 显示时刷新插件列表，保证最新状态
    logger.info('gui', '应急控制台已显示');
  });
  ctx.on('fallback:hide', () => {
    container.style.display = 'none';
    logger.info('gui', '应急控制台已隐藏');
  });

  ctx.effect(() => {
    return () => {
      container.remove();
    };
  });
}
