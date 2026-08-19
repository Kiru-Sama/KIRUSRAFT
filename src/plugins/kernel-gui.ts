/**
 * kernel-gui 插件（v0.0.20 · Exdark 设计语言重构版）
 * 管理中心（人话设置页）：全屏深色面板，Exdark 设计语言统一。
 *  - 独立插件不在 .kr-exdark 作用域内，面板根元素自定同名 --ex-* 变量（复制 Exdark 色值，见 STYLE）。
 *  - 6 个 tab（人话命名）：首页 / 功能开关 / AI 连接 / 外观 / 聊天记录 / 运行记录。
 *  - 布局：桌面 = 左侧文字列表导航 + 右侧内容区（当前项青绿左边框高亮）；手机 = 顶部横滑 tabs。
 *  - 功能开关 = 插件卡片列表（删除拖拽拓扑画布；topology 的贴靠/数据层保留，UI 不再画），
 *    就地展开详情（accordion），受保护插件显示"内置"徽标且无停用按钮。
 *  - 全部直角（border-radius:0）、无图标（状态/操作全用汉字文字表达）、无浅色残留。
 * 入口统一走 'kernel-gui:open' 事件（由当前激活的 GUI 提供唯一入口按钮）。
 */
import { Context } from '@deepseek-ai/cordis';
import { logger } from '../core/logger';
import { createSession } from '../core/session';
import { VERSION as CURRENT_VERSION } from '../core/version';
import { GUI_THEMES } from '../core/gui-registry';
import type { TopologyNode } from '../core/topology';
import type { PluginManifest } from '../core/manifest';

export const name = 'kernel-gui';
export const inject = ['tools', 'providers', 'config', 'storage', 'topology', 'update'];

export const manifest: PluginManifest = {
  name,
  kind: 'gui',
  label: { zh: '管理中心', en: 'Kernel GUI' },
  group: '界面',
  inject,
  protected: true,
  description: '全屏管理中心：首页/功能开关/AI 连接/外观/聊天记录/运行记录',
  apply,
};

const TABS = ['首页', '功能开关', 'AI 连接', '外观', '聊天记录', '运行记录'] as const;
type Tab = (typeof TABS)[number];

/** 功能开关页按 manifest.group 的功能区排序 */
const GROUP_ORDER: string[] = ['基础', '界面', '主题', '服务商', '工具'];

/** 插件 → 配置分节映射（卡片"设置"跳到外观页对应分节；无分节的插件按钮置灰） */
const CONFIG_SECTION_BY_PLUGIN: Record<string, string> = {
  'provider-deepseek': 'profile',
  'ui-exdark': 'ui',
};

interface RuntimeLike {
  name?: string;
}

/** Exdark 设计令牌（APITOOL .theme-exdark 原样复制；kernel-gui 独立插件拿不到 .kr-exdark 作用域，故自定同名变量） */
const STYLE = `
.kr-kgui,.kg-toast{
  --ex-bg:#1A1A1A; --ex-bg2:#2A2A2A; --ex-bg3:#3D3D3D;
  --ex-accent:#00FFD1; --ex-accent2:#FF8800; --ex-accent3:#FFB04D;
  --ex-surface:#2A2A2A; --ex-surface2:#3D3D3D;
  --ex-text:#F0EDE8; --ex-text2:#A0A0A0; --ex-text3:#666666;
  --ex-border:#3D3D3D; --ex-border2:#00FFD1;
  --ex-shadow:4px 4px 0 #FF8800;
  --ex-font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  position:fixed; inset:0; z-index:60; display:none; flex-direction:column;
  background:var(--ex-bg); color:var(--ex-text); font-family:var(--ex-font); overflow:hidden;
}
.kr-kgui *{margin:0;padding:0;box-sizing:border-box;border-radius:0;}
.kr-kgui ::selection{background:var(--ex-accent);color:var(--ex-bg);}
.kr-kgui button{font-family:var(--ex-font);border-radius:0;cursor:pointer;}
.kr-kgui input,.kr-kgui textarea,.kr-kgui select{font-family:var(--ex-font);border-radius:0;}
.kr-kgui ::-webkit-scrollbar{width:6px;height:6px;}
.kr-kgui ::-webkit-scrollbar-track{background:var(--ex-bg2);}
.kr-kgui ::-webkit-scrollbar-thumb{background:var(--ex-border2);}
.kr-kgui ::-webkit-scrollbar-thumb:hover{background:var(--ex-accent);}
/* ---- 顶栏：粗底边框 + 青绿标题（Exdark 签名特征） ---- */
.kg-header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:calc(12px + env(safe-area-inset-top,0px)) 20px 12px;background:var(--ex-surface);border-bottom:4px solid var(--ex-border);flex-shrink:0;}
.kg-header h1{font-size:18px;letter-spacing:4px;color:var(--ex-accent);font-weight:900;}
.kg-header .kg-sub{font-size:10px;color:var(--ex-text3);font-weight:bold;letter-spacing:1px;margin-top:2px;}
.kg-close{background:var(--ex-surface2);color:var(--ex-text);border:2px solid var(--ex-border2);width:34px;height:34px;font-size:18px;font-weight:900;line-height:1;box-shadow:2px 2px 0 var(--ex-border);transition:all .2s;}
.kg-close:hover{background:var(--ex-border2);color:var(--ex-bg);}
/* ---- 主体：左导航 + 右内容 ---- */
.kg-body{flex:1;display:flex;min-height:0;}
.kg-nav{width:150px;flex-shrink:0;border-right:4px solid var(--ex-border);background:var(--ex-surface2);overflow-y:auto;padding:14px 10px;}
.kg-nav-item{display:block;width:100%;text-align:left;padding:10px 12px;margin-bottom:6px;border:2px solid transparent;border-left:4px solid transparent;background:transparent;color:var(--ex-text2);font-size:13px;font-weight:bold;letter-spacing:1px;transition:all .2s;}
.kg-nav-item:hover{border-color:var(--ex-border2);background:var(--ex-surface);color:var(--ex-text);}
.kg-nav-item.active{background:var(--ex-surface);color:var(--ex-accent);border-left:4px solid var(--ex-accent);box-shadow:2px 2px 0 var(--ex-border);}
.kg-content{flex:1;overflow-y:auto;padding:20px;min-width:0;}
.kg-content.has-fill{display:flex;flex-direction:column;overflow:hidden;}
.kg-fill{display:flex;flex-direction:column;flex:1;min-height:0;}
/* ---- 通用 ---- */
.kg-text{font-size:13px;color:var(--ex-text2);line-height:1.6;}
.kg-text-dim{font-size:12px;color:var(--ex-text3);}
.kg-accent{color:var(--ex-accent);}
.kg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.kg-section{background:var(--ex-surface);border:2px solid var(--ex-border);box-shadow:var(--ex-shadow);padding:16px;margin-bottom:16px;}
.kg-section h3{font-size:14px;color:var(--ex-accent);font-weight:900;letter-spacing:1px;padding-bottom:6px;border-bottom:2px solid var(--ex-border);margin-bottom:10px;}
.kg-list-item{font-size:12px;color:var(--ex-text2);padding:6px 0;border-bottom:1px solid var(--ex-border);}
.kg-list-item:last-child{border-bottom:none;}
.kg-cfg-section{margin-bottom:14px;}
.kg-cfg-title{font-size:13px;font-weight:900;color:var(--ex-text);padding:6px 0 8px;border-bottom:2px solid var(--ex-border);margin-bottom:6px;letter-spacing:1px;}
.kg-empty{padding:32px;text-align:center;font-size:13px;color:var(--ex-text3);}
/* ---- 按钮（全直角、硬阴影、汉字文字） ---- */
.kg-btn{display:inline-block;padding:8px 16px;background:var(--ex-accent);color:var(--ex-bg);border:2px solid var(--ex-border);font-weight:900;font-size:13px;letter-spacing:1px;box-shadow:2px 2px 0 var(--ex-border);transition:all .2s;line-height:1.2;}
.kg-btn:hover{background:var(--ex-accent2);transform:translateY(-1px);box-shadow:4px 4px 0 var(--ex-border);}
.kg-btn:active{transform:translateY(0);box-shadow:1px 1px 0 var(--ex-border);}
.kg-btn.ghost{background:var(--ex-surface2);color:var(--ex-text);border-color:var(--ex-border2);box-shadow:2px 2px 0 var(--ex-border);}
.kg-btn.ghost:hover{background:var(--ex-border2);color:var(--ex-bg);}
.kg-btn.danger{background:var(--ex-accent2);color:var(--ex-bg);border-color:var(--ex-border);}
.kg-btn.danger:hover{background:var(--ex-accent3);}
.kg-btn.mini{padding:5px 12px;font-size:12px;box-shadow:2px 2px 0 var(--ex-border);}
.kg-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none;}
/* ---- 首页统计 ---- */
.kg-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-bottom:16px;}
.kg-stat{background:var(--ex-surface);border:2px solid var(--ex-border);box-shadow:2px 2px 0 var(--ex-border);padding:14px;text-align:center;}
.kg-stat b{display:block;font-size:26px;color:var(--ex-accent);font-weight:900;font-variant-numeric:tabular-nums;}
.kg-stat span{display:block;font-size:12px;color:var(--ex-text2);margin-top:4px;}
.kg-update-result{font-size:13px;color:var(--ex-text2);margin-top:10px;min-height:18px;}
/* ---- 功能开关：插件卡片列表（accordion 就地展开） ---- */
.kg-group{margin-bottom:18px;}
.kg-group-title{font-size:13px;font-weight:900;color:var(--ex-accent);border-left:4px solid var(--ex-accent);padding-left:8px;margin-bottom:10px;letter-spacing:2px;}
.kg-card{background:var(--ex-surface);border:2px solid var(--ex-border);box-shadow:2px 2px 0 var(--ex-border);margin-bottom:12px;transition:all .2s;cursor:pointer;}
.kg-card:hover{border-color:var(--ex-border2);box-shadow:4px 4px 0 var(--ex-border);}
.kg-card.open{border-color:var(--ex-accent);}
.kg-card-inner{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;}
.kg-card-main{min-width:0;}
.kg-card-name{font-size:16px;font-weight:700;color:var(--ex-text);line-height:1.4;}
.kg-card-name .kg-en{font-size:11px;color:var(--ex-text3);font-weight:normal;margin-left:8px;letter-spacing:.5px;}
.kg-card-desc{font-size:12px;color:var(--ex-text3);margin-top:4px;line-height:1.5;}
.kg-card-perms{font-size:11px;color:var(--ex-text2);margin-top:6px;letter-spacing:.5px;}
.kg-card-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;}
.kg-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
.kg-badge{display:inline-block;padding:2px 8px;font-size:11px;font-weight:900;border:2px solid;letter-spacing:1px;white-space:nowrap;line-height:1.3;}
.kg-badge.on{color:var(--ex-accent);border-color:var(--ex-accent);}
.kg-badge.off{color:var(--ex-text3);border-color:var(--ex-border);}
.kg-badge.err{color:var(--ex-accent2);border-color:var(--ex-accent2);}
.kg-badge.core{color:var(--ex-bg);background:var(--ex-accent);border-color:var(--ex-accent);}
/* "有新版"橙点（方形，Exdark 无圆角）；当前各插件无版本号数据源，该徽标预留在下方徽标分支但暂不渲染 */
.kg-badge-dot{display:inline-block;width:8px;height:8px;background:var(--ex-accent2);border:2px solid var(--ex-accent2);}
.kg-card-detail{display:none;border-top:2px solid var(--ex-border);padding:14px 16px;background:var(--ex-bg2);}
.kg-card.open .kg-card-detail{display:block;}
.kg-detail-row{font-size:12px;color:var(--ex-text2);line-height:1.7;margin-bottom:8px;}
.kg-detail-row b{color:var(--ex-text);}
.kg-tag{display:inline-block;padding:2px 8px;margin:2px;background:var(--ex-surface2);border:2px solid var(--ex-border2);color:var(--ex-accent);font-size:11px;}
/* ---- 聊天记录 ---- */
.kg-sessions{padding-top:4px;}
.kg-session{background:var(--ex-surface);border:2px solid var(--ex-border);box-shadow:2px 2px 0 var(--ex-border);padding:12px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;}
/* ---- 运行记录 ---- */
.kg-log-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-shrink:0;}
.kg-log{flex:1;overflow-y:auto;background:var(--ex-bg2);border:2px solid var(--ex-border);color:var(--ex-text);font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:12px;padding:14px;white-space:pre-wrap;word-break:break-all;line-height:1.6;}
/* ---- 共享配置表单（.ks-*，Exdark 风格；覆盖其它主题对 .ks-* 的定义，避免浅色残留） ---- */
.kr-kgui .ks-label{display:block;font-size:12px;color:var(--ex-text2);margin:12px 0 4px;font-weight:bold;letter-spacing:.5px;}
.kr-kgui .ks-input{width:100%;padding:10px;border:2px solid var(--ex-border2);background:var(--ex-bg);color:var(--ex-text);font-family:var(--ex-font);font-size:13px;box-sizing:border-box;outline:none;transition:border-color .2s;}
.kr-kgui .ks-input:focus{border-color:var(--ex-accent);box-shadow:2px 2px 0 var(--ex-accent);}
.kr-kgui .ks-input::placeholder{color:var(--ex-text3);}
/* ---- toast（挂在 body，面板重建不影响） ---- */
.kg-toast{position:fixed;left:50%;bottom:32px;top:auto;right:auto;transform:translateX(-50%);background:var(--ex-surface2);color:var(--ex-accent);border:2px solid var(--ex-accent);box-shadow:var(--ex-shadow);padding:10px 18px;font-size:13px;font-weight:900;letter-spacing:1px;z-index:70;display:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;}
.kg-toast.show{display:block;}
/* ---- 移动端：导航变顶部横滑 tabs ---- */
@media (max-width:640px){
  .kg-header{padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;}
  .kg-body{flex-direction:column;}
  .kg-nav{width:100%;display:flex;flex-direction:row;overflow-x:auto;border-right:none;border-bottom:4px solid var(--ex-border);padding:8px;gap:4px;flex-shrink:0;}
  .kg-nav-item{flex-shrink:0;white-space:nowrap;width:auto;margin-bottom:0;text-align:center;padding:8px 14px;border-left:2px solid transparent;border-bottom:4px solid transparent;}
  .kg-nav-item.active{border-left:2px solid transparent;border-bottom:4px solid var(--ex-accent);box-shadow:none;}
  .kg-content{padding:14px;}
  .kg-card-inner{flex-direction:column;align-items:flex-start;}
  .kg-card-actions{justify-content:flex-start;}
}`;

export function apply(ctx: Context): void {
  // 全屏面板（Exdark 深色）
  const panel = document.createElement('div');
  panel.className = 'kr-kgui';
  panel.style.cssText = 'position:fixed;inset:0;z-index:60;display:none;flex-direction:column;';

  let activeTab: Tab = '首页';
  /** 就地展开的插件卡（accordion 状态） */
  let expanded = new Set<string>();
  /** "设置"按钮跳转：渲染完成后滚动到该配置分节 */
  let pendingScrollNs: string | null = null;
  let toastTimer: number | undefined;

  function esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 从 manifest 派生权限词（无显式声明默认"网络"） */
  function derivePermissions(id: string, meta: PluginManifest | undefined, injectServices: string[]): string[] {
    if (meta?.kind === 'core') return ['网络', '存储', '读写文件'];
    const perms = new Set<string>();
    const inject = meta?.inject ?? injectServices;
    if (meta?.kind === 'provider' || id === 'update-checker' || inject.includes('providers')) perms.add('网络');
    if (inject.includes('storage')) perms.add('存储');
    if (meta?.kind === 'tool' || inject.includes('tools')) perms.add('读写文件');
    if (perms.size === 0) perms.add('网络');
    return [...perms];
  }

  /** 插件是否有对应配置分节（决定"设置"按钮可用） */
  function hasConfigSection(id: string): boolean {
    const ns = CONFIG_SECTION_BY_PLUGIN[id];
    return !!ns && ctx.config.list().some((s) => s.namespace === ns);
  }

  /** 轻量 toast 反馈（挂 body，面板内 renderPanel 重建不影响） */
  function kgToast(message: string): void {
    let el = document.querySelector<HTMLElement>('.kg-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'kg-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el?.classList.remove('show'), 2400);
  }

  function renderNav(): string {
    return TABS.map(
      (t) => `<button type="button" class="kg-nav-item${t === activeTab ? ' active' : ''}" data-ktab="${t}">${t}</button>`,
    ).join('');
  }

  function renderHome(): string {
    const plugins = [...(ctx.registry.values() as unknown as RuntimeLike[])].length;
    const tools = ctx.tools.list().length;
    const providers = ctx.providers.list().length;
    const sections = ctx.config.list().length;
    return `
      <div class="kg-stats">
        ${[
          ['插件', String(plugins)],
          ['工具', String(tools)],
          ['服务商', String(providers)],
          ['配置分节', String(sections)],
        ]
          .map(
            ([label, value]) =>
              `<div class="kg-stat"><b>${value}</b><span>${label}</span></div>`,
          )
          .join('')}
      </div>
      <div class="kg-section">
        <h3>版本更新</h3>
        <div class="kg-row">
          <span class="kg-text">当前版本：<strong class="kg-accent">${esc(CURRENT_VERSION)}</strong></span>
          <button type="button" class="kg-btn" data-kcheckupdate>检查更新</button>
        </div>
        <div data-kupdate="result" class="kg-update-result"></div>
      </div>
      <div class="kg-section">
        <h3>说明</h3>
        <div class="kg-text">管理中心 = 人话设置页：功能开关（插件启停）、AI 连接（服务商与工具）、外观（主题与配置）、聊天记录、运行记录。改动即时生效。</div>
      </div>`;
  }

  /** 功能开关页：插件卡片列表（无拖拽画布），点击就地展开详情 */
  function renderPlugins(): string {
    const topo = ctx.topology.getTopology();
    const nodes = topo.nodes.filter((n) => n.kind !== 'core');
    if (nodes.length === 0) return '<div class="kg-empty">（无插件）</div>';
    const groups = new Map<string, TopologyNode[]>();
    for (const n of nodes) {
      const g = ctx.topology.getManifest(n.id)?.group ?? '工具';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(n);
    }
    const groupHtml = GROUP_ORDER.filter((g) => groups.has(g))
      .map(
        (g) =>
          `<div class="kg-group"><div class="kg-group-title">${g}</div>${groups
            .get(g)!
            .map((n) => renderPluginCard(n))
            .join('')}</div>`,
      )
      .join('');
    return `<div class="kg-text-dim" style="margin-bottom:12px;">点卡片就地展开详情 · 内置插件不可停用 · 各插件均为功能开关，无拖拽布局</div>${groupHtml}`;
  }

  function renderPluginCard(node: TopologyNode): string {
    const meta = ctx.topology.getManifest(node.id);
    const zh = meta?.label?.zh ?? node.name;
    const en = meta?.label?.en ?? node.id;
    const desc = meta?.description;
    const protectedP = ctx.topology.isProtected(node.id);
    const active = node.stateCode === 2;
    const failed = node.stateCode === 3;
    const open = expanded.has(node.id);
    const perms = derivePermissions(node.id, meta, node.injectServices);
    // 状态文字徽标：已开启=青绿 / 已关闭=灰 / 出问题=橙 / 内置=青底黑字。
    // "有新版=橙点"：当前各插件无版本号数据源（仅内核整体 VERSION），无法逐插件判断新版本，
    // 徽标类型已预留（.kg-badge-dot，橙色方形点），待插件市场引入版本号后启用。
    const badge = protectedP
      ? '<span class="kg-badge core">内置</span>'
      : active
        ? '<span class="kg-badge on">已开启</span>'
        : failed
          ? '<span class="kg-badge err">出问题</span>'
          : '<span class="kg-badge off">已关闭</span>';
    const hasCfg = hasConfigSection(node.id);
    // 操作按钮：受保护无停用按钮（只有设置）；正常给 停用/启用 + 设置
    const toggleBtn = protectedP
      ? ''
      : `<button type="button" class="kg-btn mini${active ? ' danger' : ''}" data-kgtoggle="${esc(node.id)}">${active ? '停用' : '启用'}</button>`;
    const settingsAttr = `${hasCfg ? '' : ' disabled title="该插件没有设置项"'}`;
    const deps = meta?.inject ?? node.injectServices;
    const depsHtml =
      deps.length > 0 ? deps.map((d) => `<span class="kg-tag">${esc(d)}</span>`).join('') : '<span class="kg-text-dim">（无依赖）</span>';
    return `
      <div class="kg-card${open ? ' open' : ''}" data-kgcard="${esc(node.id)}">
        <div class="kg-card-inner">
          <div class="kg-card-main">
            <div class="kg-card-name">${esc(zh)}<span class="kg-en">${esc(en)}</span></div>
            ${desc ? `<div class="kg-card-desc">${esc(desc)}</div>` : ''}
            <div class="kg-card-perms">需要：${perms.join(' / ')}</div>
          </div>
          <div class="kg-card-actions">
            <span class="kg-badges">${badge}</span>
            ${toggleBtn}
            <button type="button" class="kg-btn mini ghost" data-kgsettings="${esc(node.id)}"${settingsAttr}>设置</button>
          </div>
        </div>
        <div class="kg-card-detail">
          <div class="kg-detail-row"><b>状态：</b>${esc(node.state)}</div>
          ${desc ? `<div class="kg-detail-row"><b>描述：</b>${esc(desc)}</div>` : ''}
          <div class="kg-detail-row"><b>权限：</b>${perms.join(' / ')}</div>
          <div class="kg-detail-row"><b>依赖：</b>${depsHtml}</div>
          ${node.kind === 'theme' ? '<div class="kg-detail-row"><b>说明：</b>主题插件，切换后替换整个界面（在外观页选择）。</div>' : ''}
          <div class="kg-detail-row">
            <button type="button" class="kg-btn mini ghost" data-kgsettings="${esc(node.id)}"${settingsAttr}>设置表单入口</button>
          </div>
        </div>
      </div>`;
  }

  /** AI 连接页：服务商 + 可用工具 */
  function renderConnections(): string {
    const tools = ctx.tools.list();
    const providers = ctx.providers.list();
    // 当前激活的服务商（profile.id）
    let active = '（未配置）';
    try {
      const profile = ctx.config.get('profile') as { id?: string } | undefined;
      if (profile?.id) {
        const p = ctx.providers.get(profile.id);
        active = p ? `${p.displayName}（${p.id}）` : `${profile.id}（未注册）`;
      }
    } catch {
      /* 忽略 */
    }
    return `
      <div class="kg-section">
        <h3>AI 服务商（共 ${providers.length} 个预设）</h3>
        <div class="kg-list-item">当前：${esc(active)}</div>
        <div class="kg-text-dim">在"服务商设置"下拉中选择预设，自动填入 Base URL / 模型 / 密钥购买链接。</div>
        <div style="margin-top:10px;">
          <button type="button" class="kg-btn" data-ksetservice>服务商设置</button>
        </div>
      </div>
      <div class="kg-section">
        <h3>可用工具（${tools.length}）</h3>
        ${tools.length > 0
          ? tools
              .map((t) => `<div class="kg-list-item">${esc(t.name)} — ${esc((t.description ?? '').slice(0, 60))}</div>`)
              .join('')
          : '<div class="kg-text-dim">（无工具）</div>'}
      </div>`;
  }

  /** 外观页：主题切换 + 配置分节聚合渲染 */
  function renderAppearance(): string {
    const sections = ctx.config.list();
    const activeThemeId =
      ctx.topology
        .getTopology()
        .nodes.find((n) => n.kind === 'theme' && n.stateCode === 2)?.id ?? '';
    const themeBtn = (id: string, label: string) => {
      const active = id === activeThemeId;
      return `<button type="button" class="kg-btn mini${active ? '' : ' ghost'}" data-ktheme="${esc(id)}">${esc(label)}</button>`;
    };
    const themes =
      Object.entries(GUI_THEMES)
        .map(([id, meta]) => themeBtn(id, meta.label))
        .join('') + themeBtn('', '默认');
    return `
      <div class="kg-section">
        <h3>主题</h3>
        <div class="kg-text" style="margin-bottom:10px;">Exdark：深黑底 + 青绿强调 + 橙影 + 全直角。选「默认」恢复兜底界面。</div>
        <div class="kg-row">${themes}</div>
      </div>
      <div class="kg-section">
        <h3>配置</h3>
        ${sections.length > 0
          ? sections
              .map(
                (s) =>
                  `<div class="kg-cfg-section"><div class="kg-cfg-title">${esc(s.displayName)}</div><div data-kcfg="${esc(s.namespace)}"></div></div>`,
              )
              .join('')
          : '<div class="kg-text-dim">（无配置分节）</div>'}
      </div>`;
  }

  /** 聊天记录页：会话列表（异步加载） */
  function renderSessions(): string {
    return `<div class="kg-sessions" data-ksessions="1"><div class="kg-text-dim">加载中...</div></div>`;
  }

  /** 运行记录页：日志查看 + 清空 */
  function renderLogs(): string {
    const entries = logger.getLogs();
    return `
      <div class="kg-fill">
        <div class="kg-log-head">
          <span class="kg-text">运行记录（${entries.length} 条）</span>
          <button type="button" class="kg-btn danger" data-kclearlog>清空</button>
        </div>
        <div class="kg-log">${
          entries
            .map((e) => {
              const t = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false });
              return `[${t}] ${esc(e.level.toUpperCase())} [${esc(e.source)}] ${esc(e.message)}`;
            })
            .join('\n') || '（暂无日志）'
        }</div>
      </div>`;
  }

  function renderTab(): string {
    switch (activeTab) {
      case '首页':
        return renderHome();
      case '功能开关':
        return renderPlugins();
      case 'AI 连接':
        return renderConnections();
      case '外观':
        return renderAppearance();
      case '聊天记录':
        return renderSessions();
      case '运行记录':
        return renderLogs();
    }
  }

  function renderPanel(): void {
    const fill = activeTab === '运行记录';
    panel.innerHTML = `
      <style>${STYLE}</style>
      <div class="kg-header">
        <div>
          <h1>管理中心</h1>
          <div class="kg-sub">人话设置页 · KIRUSRAFT 内核管理</div>
        </div>
        <button type="button" class="kg-close" data-kclose title="关闭">×</button>
      </div>
      <div class="kg-body">
        <nav class="kg-nav">${renderNav()}</nav>
        <main class="kg-content${fill ? ' has-fill' : ''}">${renderTab()}</main>
      </div>`;

    bindEvents();

    // "设置"跳转：渲染完成后滚动到目标配置分节
    if (pendingScrollNs) {
      const target = [...panel.querySelectorAll<HTMLElement>('[data-kcfg]')].find(
        (el) => el.dataset.kcfg === pendingScrollNs,
      );
      pendingScrollNs = null;
      if (target) {
        requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    }
  }

  function bindEvents(): void {
    // 导航切换
    panel.querySelectorAll<HTMLElement>('[data-ktab]').forEach((el) => {
      el.addEventListener('click', () => {
        activeTab = el.dataset.ktab as Tab;
        renderPanel();
      });
    });

    // 关闭
    panel.querySelector('[data-kclose]')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });

    // 清空日志
    panel.querySelector('[data-kclearlog]')?.addEventListener('click', () => {
      logger.clear();
      renderPanel();
    });

    // 首页：检查更新
    panel.querySelector('[data-kcheckupdate]')?.addEventListener('click', () => {
      void checkUpdate();
    });

    // 外观页：主题切换
    panel.querySelectorAll<HTMLButtonElement>('[data-ktheme]').forEach((el) => {
      el.addEventListener('click', async () => {
        const theme = el.dataset.ktheme ?? '';
        const r = await ctx.topology.switchTheme(theme);
        if (!r.ok) {
          logger.error('topology', r.message ?? '切换主题失败');
          kgToast(r.message ?? '切换主题失败');
        } else {
          kgToast(theme ? '已切换主题' : '已恢复默认界面');
        }
        renderPanel();
      });
    });

    // AI 连接页：服务商设置入口（跳外观页 profile 分节）
    panel.querySelector('[data-ksetservice]')?.addEventListener('click', () => {
      activeTab = '外观';
      pendingScrollNs = 'profile';
      renderPanel();
    });

    // 功能开关页：插件启停（受保护拦截 + toast 反馈）
    panel.querySelectorAll<HTMLButtonElement>('[data-kgtoggle]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = el.dataset.kgtoggle;
        if (!id || ctx.topology.isProtected(id)) return;
        const wasActive = el.textContent === '停用';
        el.disabled = true;
        const r = await ctx.topology.togglePlugin(id);
        if (!r.ok) {
          logger.error('topology', r.message ?? `切换 ${id} 失败`);
          kgToast(r.message ?? `切换 ${id} 失败`);
        } else {
          kgToast(wasActive ? '已停用' : '已启用');
        }
        renderPanel();
      });
    });

    // 功能开关页：卡片就地展开（accordion；点按钮不展开）
    panel.querySelectorAll<HTMLElement>('[data-kgcard]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const id = el.dataset.kgcard;
        if (!id) return;
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        renderPanel();
      });
    });

    // 功能开关页：设置按钮（卡片 + 详情内入口）→ 外观页对应分节
    panel.querySelectorAll<HTMLButtonElement>('[data-kgsettings]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.kgsettings;
        if (!id) return;
        const ns = CONFIG_SECTION_BY_PLUGIN[id];
        if (!ns || !ctx.config.list().some((s) => s.namespace === ns)) return;
        activeTab = '外观';
        pendingScrollNs = ns;
        renderPanel();
      });
    });

    // 外观页：配置分节渲染（profile/ui/docking 等，有 render 才调用）
    if (activeTab === '外观') {
      for (const section of ctx.config.list()) {
        const container = [...panel.querySelectorAll<HTMLElement>('[data-kcfg]')].find(
          (el) => el.dataset.kcfg === section.namespace,
        );
        if (container && section.render) {
          section.render(
            container as HTMLElement,
            () => ctx.config.get(section.namespace),
            (value) => ctx.config.set(section.namespace, value),
          );
        }
      }
    }

    // 聊天记录页：异步加载会话列表
    if (activeTab === '聊天记录') {
      void renderSessionList();
    }
  }

  async function checkUpdate(): Promise<void> {
    const resultEl = panel.querySelector('[data-kupdate="result"]') as HTMLElement | null;
    if (resultEl) resultEl.textContent = '检查中...';
    const latest = await ctx.update.checkLatest();
    // await 后重新查询（DOM 可能已重建），失效则放弃
    const currentEl = panel.querySelector('[data-kupdate="result"]') as HTMLElement | null;
    if (!currentEl || !currentEl.isConnected) return;
    if (!latest.info) {
      currentEl.textContent = latest.error ? `检查失败：${latest.error}` : '未找到版本信息';
      return;
    }
    const info = latest.info; // 提取局部变量：闭包内 TS narrowing 对 latest.info 失效
    if (!info.tagName) {
      currentEl.textContent = '未找到版本信息';
      return;
    }
    if (ctx.update.compareVersion(info.tagName, CURRENT_VERSION)) {
      currentEl.innerHTML = `发现新版本 <strong class="kg-accent">${esc(info.tagName)}</strong>`;
      if (info.apkUrl) {
        // 重复点击时先清空旧按钮
        const oldBtn = currentEl.querySelector<HTMLElement>('[data-kdl]');
        if (oldBtn) oldBtn.remove();
        const dlBtn = document.createElement('button');
        dlBtn.dataset.kdl = '1';
        dlBtn.type = 'button';
        dlBtn.textContent = '下载 APK';
        dlBtn.className = 'kg-btn';
        dlBtn.style.marginTop = '8px';
        dlBtn.addEventListener('click', () => {
          void (async () => {
            dlBtn.textContent = '下载中...';
            const result = await ctx.update.download(info.apkUrl!);
            if (!result) {
              dlBtn.textContent = '下载失败';
              return;
            }
            const url = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // 延迟释放 Blob URL，避免下载未完成就被回收
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            dlBtn.textContent = '已下载';
          })();
        });
        currentEl.appendChild(dlBtn);
      }
    } else {
      currentEl.textContent = `已是最新版本（远端 ${info.tagName}）`;
    }
  }

  async function renderSessionList(): Promise<void> {
    const sessions = await ctx.storage.listConversations();
    // await 后重新查询（DOM 可能已重建），失效则放弃
    const container = panel.querySelector('[data-ksessions]') as HTMLElement | null;
    if (!container || !container.isConnected) return;
    try {
      if (sessions.length === 0) {
        container.innerHTML = `<div class="kg-text-dim" style="margin-bottom:12px;">（无会话）</div>`;
      } else {
        container.innerHTML = sessions
          .map((s) => {
            const valid = !!s.node && Array.isArray(s.node.messages);
            const count = valid ? s.node.messages.length : 0;
            const badge = valid ? '' : ' <span class="kg-badge err">损坏</span>';
            return `
            <div class="kg-session">
              <div style="min-width:0;">
                <div class="kg-card-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.title || '新对话')}${badge}</div>
                <div class="kg-text-dim" style="margin-top:2px;">${count} 条消息 · ${new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
              </div>
              <div class="kg-card-actions">
                <button type="button" class="kg-btn mini" data-kswitch="${esc(s.id)}">切换</button>
                <button type="button" class="kg-btn mini danger" data-kdelete="${esc(s.id)}">删除</button>
              </div>
            </div>`;
          })
          .join('');
      }
      // 新建按钮
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.textContent = '新建会话';
      newBtn.className = 'kg-btn';
      newBtn.style.width = '100%';
      newBtn.addEventListener('click', async () => {
        const s = createSession();
        await ctx.storage.saveConversation(s);
        ctx.emit('session-switch', s.id);
        renderPanel();
      });
      container.appendChild(newBtn);

      // 绑定切换/删除
      container.querySelectorAll<HTMLElement>('[data-kswitch]').forEach((el) => {
        el.addEventListener('click', () => {
          if (el.dataset.kswitch) ctx.emit('session-switch', el.dataset.kswitch);
          renderPanel();
        });
      });
      container.querySelectorAll<HTMLElement>('[data-kdelete]').forEach((el) => {
        el.addEventListener('click', async () => {
          const id = el.dataset.kdelete;
          if (id && confirm('确定删除该会话？')) {
            await ctx.storage.deleteConversation(id);
            ctx.emit('session-deleted', id);
            renderPanel();
          }
        });
      });
    } catch (error) {
      container.innerHTML = `<div class="kg-badge err">加载失败: ${esc(String(error))}</div>`;
    }
  }

  function openPanel(tab?: string): void {
    panel.style.display = 'flex';
    // 瞬态 UI 状态：打开时重置展开/滚动，避免关闭再打开残留旧状态
    activeTab = TABS.includes(tab as Tab) ? (tab as Tab) : '首页';
    expanded = new Set();
    pendingScrollNs = null;
    renderPanel();
  }

  ctx.effect(() => {
    document.body.appendChild(panel);
    // 跨插件唤起：当前激活 GUI 的唯一"管理"入口按钮 emit 'kernel-gui:open'
    // （tab 参数支持直接打开指定页）
    ctx.on('kernel-gui:open', (tab?: unknown) => openPanel(typeof tab === 'string' ? tab : undefined));
    return () => {
      panel.remove();
    };
  });
}
