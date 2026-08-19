/**
 * ui-exdark 主题 GUI 插件（v0.0.19）
 * APITOOL Exdark 设计语言的完整迁移版：暗色底 + 青绿强调 + 橙色硬阴影 + 玻璃侧边栏 + 视差背景。
 * 自带完整聊天 GUI（侧边栏会话 + 顶栏 + 消息区 + 输入区），进软件直接进入本界面。
 * 主题系统约定：kind='ui-theme'，gui-registry 登记 providesGui=true → 挂载时兜底 GUI 不挂载。
 */
import { Context } from '@deepseek-ai/cordis';
import { createChatController } from '../core/chat-controller';
import { registerProfileConfig } from '../core/profile-config';
import { createSession } from '../core/session';
import { logger } from '../core/logger';
import type { UIMessagePart } from '../core/types';

export const name = 'ui-exdark';
/** UI 主题插件元数据：可运行时切换的主题 */
export const kind = 'ui-theme';
/** 依赖的内核服务（不声明 inject 会解析不到服务，主题永远挂载失败） */
export const inject = ['providers', 'tools', 'config', 'storage', 'topology'];

export interface Config {
  /** 默认启用 */
  enabled?: boolean;
  /** 挂载根节点，缺省取 #app */
  root?: HTMLElement;
}

/** Exdark 设计令牌（APITOOL .theme-exdark 原样迁移） */
const STYLE = `
.kr-exdark {
  --ex-bg:#1A1A1A; --ex-bg2:#2A2A2A; --ex-bg3:#3D3D3D;
  --ex-accent:#00FFD1; --ex-accent2:#FF8800; --ex-accent3:#FFB04D;
  --ex-surface:#2A2A2A; --ex-surface2:#3D3D3D;
  --ex-text:#F0EDE8; --ex-text2:#A0A0A0; --ex-text3:#666666;
  --ex-border:#3D3D3D; --ex-border2:#00FFD1;
  --ex-shadow:4px 4px 0 #FF8800;
  --ex-sidebar-glass: rgba(42,42,42,0.5);
  --ex-sidebar-transition: 0.35s cubic-bezier(0.68,-0.55,0.27,1.55);
  --ex-font: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  height:100%; position:relative; font-family:var(--ex-font);
  color:var(--ex-text); background:var(--ex-bg);
}
.kr-exdark * { margin:0; padding:0; box-sizing:border-box; }
.kr-exdark ::selection { background:var(--ex-accent); color:var(--ex-bg); }
/* ---- 应用框架：粗边框 + 橙色硬阴影（Exdark 签名特征） ---- */
.ex-app { width:100%; height:100%; background:var(--ex-bg); display:flex; border:4px solid var(--ex-border); box-shadow:var(--ex-shadow); overflow:hidden; position:relative; z-index:1; }
.ex-app .ex-parallax { position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:0; overflow:visible; }
/* ---- 侧边栏：玻璃拟态 + 右侧粗边框，绝对定位抽屉 ---- */
.ex-sidebar { width:260px; background:var(--ex-sidebar-glass); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); color:var(--ex-text); display:flex; flex-direction:column; border-right:4px solid var(--ex-border); position:absolute; top:0; left:0; bottom:0; z-index:50; transform:translateX(0); transition:transform var(--ex-sidebar-transition); will-change:transform; }
.ex-sidebar.hidden { transform:translateX(-100%); }
.ex-sidebar-header { padding:calc(16px + env(safe-area-inset-top,0px)) 16px 12px; border-bottom:4px solid var(--ex-border); background:var(--ex-surface); }
.ex-sidebar-header h2 { font-size:18px; text-transform:uppercase; letter-spacing:3px; color:var(--ex-accent); font-weight:900; }
.ex-sidebar-sub { font-size:11px; color:var(--ex-text2); margin-top:2px; font-weight:bold; letter-spacing:1px; }
.ex-sidebar-actions { padding:10px 12px; display:flex; flex-direction:column; gap:8px; border-bottom:4px solid var(--ex-border); background:var(--ex-surface); }
/* ---- 主按钮（APITOOL .btn-new）：青绿底 + 粗边框 + 硬阴影 ---- */
.ex-btn-new { width:100%; padding:10px; background:var(--ex-accent); color:var(--ex-bg); border:3px solid var(--ex-border); font-weight:900; text-transform:uppercase; letter-spacing:2px; box-shadow:var(--ex-shadow); cursor:pointer; transition:all .2s; font-family:var(--ex-font); font-size:13px; }
.ex-btn-new:hover { background:var(--ex-accent2); transform:translateY(-2px); box-shadow:6px 6px 0 var(--ex-border); }
.ex-btn-new:active { transform:translateY(0); box-shadow:2px 2px 0 var(--ex-border); }
/* ---- 次按钮（APITOOL .btn-manage）：暗底 + 青绿描边 ---- */
.ex-btn-manage { position:relative; width:100%; padding:10px 12px; background:var(--ex-surface2); color:var(--ex-text2); border:3px solid var(--ex-border2); font-weight:900; text-transform:uppercase; letter-spacing:1px; box-shadow:2px 2px 0 var(--ex-border); cursor:pointer; transition:all .2s; font-family:var(--ex-font); font-size:11px; }
.ex-btn-manage:hover { background:var(--ex-border2); border-color:var(--ex-accent); color:var(--ex-bg); transform:translateY(-2px); box-shadow:4px 4px 0 var(--ex-border); }
.ex-btn-manage:active { transform:translateY(0); box-shadow:1px 1px 0 var(--ex-border); }
/* 异常红点：有 FAILED 插件时内核按钮显示 */
.ex-reddot { position:absolute; top:-4px; right:-4px; width:12px; height:12px; border-radius:50%; background:#e5484d; border:2px solid var(--ex-bg); display:none; }
/* ---- 会话列表：叠卡效果（APITOOL .conv-item 原样） ---- */
.ex-conv-list { flex:1; overflow-y:auto; padding:12px 8px 20px; perspective:600px; }
.ex-conv-item { position:relative; background:var(--ex-surface); border:2px solid var(--ex-border); box-shadow:2px 2px 0 var(--ex-border); padding:10px 12px; margin-top:-6px; cursor:pointer; transition:transform .25s cubic-bezier(.22,.61,.36,1),box-shadow .25s; transform:translateY(0) rotateX(0deg); z-index:1; }
.ex-conv-item:first-child { margin-top:0; }
.ex-conv-item:nth-child(1) { transform:translateY(0) rotateX(1.5deg); }
.ex-conv-item:nth-child(2) { transform:translateY(-2px) rotateX(2deg); }
.ex-conv-item:nth-child(3) { transform:translateY(-4px) rotateX(2.5deg); }
.ex-conv-item:nth-child(4) { transform:translateY(-6px) rotateX(3deg); }
.ex-conv-item:nth-child(n+5) { transform:translateY(-8px) rotateX(3.5deg); }
.ex-conv-item:hover { transform:translateX(10px) scale(1.02) !important; box-shadow:6px 6px 0 var(--ex-border); background:var(--ex-surface2); border-color:var(--ex-accent); z-index:20; }
.ex-conv-item.active { background:var(--ex-accent); color:var(--ex-bg); border-color:var(--ex-accent); box-shadow:var(--ex-shadow); transform:translateX(2px) scale(1.01); }
.ex-conv-title { font-size:12px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ex-conv-info { font-size:9px; color:var(--ex-text2); display:flex; justify-content:space-between; margin-top:2px; }
.ex-conv-item.active .ex-conv-info { color:var(--ex-bg); }
.ex-conv-del { background:none; border:none; color:var(--ex-accent2); font-weight:bold; cursor:pointer; position:absolute; right:6px; top:6px; opacity:0; transition:opacity .2s; font-size:14px; line-height:1; }
.ex-conv-item:hover .ex-conv-del { opacity:1; }
.ex-conv-item.active .ex-conv-del { color:var(--ex-bg); opacity:1; }
/* ---- 主区 ---- */
.ex-main { flex:1; display:flex; flex-direction:column; position:relative; overflow:hidden; padding-left:260px; transition:padding-left var(--ex-sidebar-transition); will-change:padding-left; }
.ex-main.full { padding-left:0; }
/* 侧边栏抽屉开关（贴侧边栏右缘，APITOOL .float-toggle-btn） */
.ex-toggle { position:absolute; top:70px; left:264px; z-index:60; background:var(--ex-surface); border:2px solid var(--ex-border); padding:4px 12px; font-size:18px; font-weight:bold; cursor:pointer; box-shadow:var(--ex-shadow); font-family:var(--ex-font); transition:left var(--ex-sidebar-transition),background .2s; display:block; line-height:1.4; }
.ex-toggle.hidden-state { left:16px; }
.ex-toggle:hover { background:var(--ex-bg2); }
/* ---- 顶栏：粗底边框 + 青绿标题；顶部安全区（状态栏/刘海）适配 ---- */
.ex-topbar { padding:calc(12px + env(safe-area-inset-top,0px)) 20px 12px; display:flex; justify-content:space-between; align-items:center; border-bottom:4px solid var(--ex-border); z-index:5; background:var(--ex-surface); flex-wrap:nowrap; gap:8px; }
.ex-topbar-left { display:flex; align-items:center; gap:10px; min-width:0; flex:1 1 auto; }
.ex-topbar-left h1 { font-size:20px; letter-spacing:4px; color:var(--ex-accent); font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
.ex-topbar-right { display:flex; gap:8px; align-items:center; flex-shrink:0; }
.ex-api-status { font-size:10px; padding:4px 10px; border:2px solid var(--ex-border2); background:var(--ex-surface2); font-weight:bold; white-space:nowrap; flex-shrink:0; color:var(--ex-text2); }
/* ---- 消息区（APITOOL .message-content 原样；气泡即消息元素，流式更新 textContent 不丢样式） ---- */
.ex-messages { flex:1; overflow-y:auto; padding:24px 16px 8px; display:flex; flex-direction:column; position:relative; z-index:1; }
.ex-message { max-width:88%; margin-bottom:30px; border:3px solid var(--ex-border); background:var(--ex-surface); color:var(--ex-text); line-height:1.6; font-size:13px; box-shadow:var(--ex-shadow); position:relative; padding:12px 16px; min-width:80px; word-wrap:break-word; word-break:break-word; white-space:pre-wrap; }
.ex-message.ex-user { margin-left:auto; background:var(--ex-accent); color:var(--ex-bg); }
.ex-message.ex-ai { margin-right:auto; border-left:5px solid var(--ex-accent); }
.ex-status { padding:6px 16px 4px; font-size:11px; color:var(--ex-text2); min-height:20px; text-align:center; position:relative; z-index:1; }
/* ---- 输入区（APITOOL .input-area + .input-container + .send-btn 原样） ---- */
.ex-input-area { padding:10px 16px; padding-bottom:calc(10px + env(safe-area-inset-bottom,0px)); background:var(--ex-surface); border-top:4px solid var(--ex-border); box-shadow:var(--ex-shadow); z-index:5; display:flex; align-items:center; gap:10px; }
.ex-input-row { display:flex; align-items:center; gap:10px; flex:1; min-width:0; }
.ex-search-toggle { display:flex; align-items:center; gap:5px; font-size:12px; color:var(--ex-text2); cursor:pointer; user-select:none; white-space:nowrap; font-weight:bold; }
.ex-search-toggle input { accent-color:var(--ex-accent); width:14px; height:14px; cursor:pointer; }
.ex-input-area textarea { flex:1; padding:10px; background:var(--ex-bg); border:3px solid var(--ex-border2); resize:none; height:50px; font-size:13px; outline:none; font-family:var(--ex-font); transition:border-color .2s; color:var(--ex-text); min-width:0; }
.ex-input-area textarea:focus { border-color:var(--ex-accent); }
.ex-input-area textarea::placeholder { color:var(--ex-text3); }
.ex-send-btn { padding:10px 22px; background:var(--ex-accent); color:var(--ex-bg); border:3px solid var(--ex-border); font-weight:900; text-transform:uppercase; cursor:pointer; box-shadow:var(--ex-shadow); transition:all .2s; min-width:80px; font-family:var(--ex-font); font-size:13px; }
.ex-send-btn:hover { background:var(--ex-accent2); transform:translateY(-2px); box-shadow:6px 6px 0 var(--ex-border); }
.ex-send-btn:active { transform:translateY(0); box-shadow:2px 2px 0 var(--ex-border); }
.ex-send-btn:disabled { opacity:.5; cursor:not-allowed; box-shadow:none; transform:none; }
.ex-stop-btn { background:var(--ex-accent2); }
/* ---- 滚动条（APITOOL 风格：细轨 + 青绿滑块） ---- */
.ex-conv-list::-webkit-scrollbar, .ex-messages::-webkit-scrollbar { width:6px; }
.ex-conv-list::-webkit-scrollbar-track, .ex-messages::-webkit-scrollbar-track { background:var(--ex-bg2); border-radius:3px; }
.ex-conv-list::-webkit-scrollbar-thumb, .ex-messages::-webkit-scrollbar-thumb { background:var(--ex-border2); border-radius:3px; }
.ex-conv-list::-webkit-scrollbar-thumb:hover, .ex-messages::-webkit-scrollbar-thumb:hover { background:var(--ex-accent); }
/* ---- 共享设置表单（.ks-*，profile 配置分节；可能渲染在内核中心浅色面板外，用显式 Exdark 色值） ---- */
.ks-label { display:block; font-size:12px; color:#A0A0A0; margin:12px 0 4px; }
.ks-input { width:100%; padding:10px; border:2px solid #00FFD1; background:#1A1A1A; color:#F0EDE8; font-family:var(--ex-font); font-size:13px; box-sizing:border-box; outline:none; transition:border-color .2s; }
.ks-input:focus { border-color:#00FFD1; box-shadow:2px 2px 0 #00FFD1; }
/* ---- 移动端适配（APITOOL @media max-width:768px 对齐） ---- */
@media (max-width:768px){
  .kr-exdark .ex-app { border-width:2px; box-shadow:3px 3px 0 #FF8800; }
  .ex-main { padding-left:0; }
  .ex-sidebar { transform:translateX(-100%); }
  .ex-sidebar.open { transform:translateX(0); }
  .ex-toggle { display:block; }
  .ex-message { max-width:92%; font-size:12px; padding:10px 12px; margin-bottom:22px; }
  .ex-topbar-left h1 { font-size:16px; letter-spacing:2px; }
  .ex-input-area textarea { font-size:12px; height:44px; }
  .ex-send-btn { font-size:12px; padding:8px 16px; min-width:64px; }
  .ex-conv-item { padding:8px 10px; }
  .ex-conv-title { font-size:11px; }
  .ex-conv-info { font-size:8px; }
  .ex-toggle { top:62px; }
}
@media (min-width:769px){
  .ex-toggle { display:none; }
}
@media (hover:none){
  .ex-conv-del { opacity:1; }
}
`;

export function apply(ctx: Context, config: Config): void {
  // 防御：重挂时可能收到空配置（TopologyService 已给 {}，这里再兜一层）
  const enabled = config?.enabled ?? true;
  if (!enabled) return;
  const root = config?.root ?? document.getElementById('app');
  if (!root) throw new Error('ui-exdark: 找不到挂载节点');

  // 服务商配置分节（共享实现，样式类 .ks-* 由本主题样式表提供暗色外观）
  registerProfileConfig(ctx);

  const container = document.createElement('div');
  container.className = 'kr-exdark';
  container.innerHTML = `
    <style>${STYLE}</style>
    <div class="ex-app">
      <svg class="ex-parallax" data-ex="parallax" aria-hidden="true"></svg>
      <aside class="ex-sidebar" data-ex="sidebar">
        <div class="ex-sidebar-header">
          <h2>KIRUSRAFT</h2>
          <div class="ex-sidebar-sub">EXDARK 主题</div>
        </div>
        <div class="ex-sidebar-actions">
          <button class="ex-btn-new" data-ex="newchat">+ 新对话</button>
        </div>
        <div class="ex-conv-list" data-ex="convlist">
          <div data-ex="convempty" style="padding:14px;font-size:11px;color:var(--ex-text3);text-align:center;">（暂无会话）</div>
        </div>
        <div class="ex-sidebar-actions" style="border-bottom:none;">
          <button class="ex-btn-manage" data-ex="kernel">内核<span class="ex-reddot"></span></button>
          <button class="ex-btn-manage" data-ex="settings">设置</button>
        </div>
      </aside>
      <main class="ex-main" data-ex="main">
        <div class="ex-topbar">
          <div class="ex-topbar-left">
            <h1>KIRUSRAFT</h1>
          </div>
          <div class="ex-topbar-right">
            <span class="ex-api-status" data-ex="model">deepseek-chat</span>
          </div>
        </div>
        <div class="ex-messages" data-ex="messages"></div>
        <div class="ex-status" data-ex="status"></div>
        <div class="ex-input-area">
          <label class="ex-search-toggle"><input data-ex="websearch" type="checkbox" /> 联网</label>
          <textarea data-ex="input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
          <button class="ex-send-btn" data-ex="send">发送</button>
          <button class="ex-send-btn ex-stop-btn" data-ex="stop" style="display:none;">中止</button>
        </div>
      </main>
      <button class="ex-toggle hidden-state" data-ex="toggle" title="会话列表">≡</button>
    </div>
  `;
  root.appendChild(container);

  const sidebar = container.querySelector('[data-ex="sidebar"]') as HTMLElement;
  const mainEl = container.querySelector('[data-ex="main"]') as HTMLElement;
  const toggleBtn = container.querySelector('[data-ex="toggle"]') as HTMLButtonElement;
  const messagesEl = container.querySelector('[data-ex="messages"]') as HTMLElement;
  const inputEl = container.querySelector('[data-ex="input"]') as HTMLTextAreaElement;
  const sendEl = container.querySelector('[data-ex="send"]') as HTMLButtonElement;
  const stopEl = container.querySelector('[data-ex="stop"]') as HTMLButtonElement;
  const statusEl = container.querySelector('[data-ex="status"]') as HTMLElement;
  const webSearchEl = container.querySelector('[data-ex="websearch"]') as HTMLInputElement;
  const newChatBtn = container.querySelector('[data-ex="newchat"]') as HTMLButtonElement;
  const kernelBtn = container.querySelector('[data-ex="kernel"]') as HTMLButtonElement;
  const redDot = kernelBtn.querySelector('.ex-reddot') as HTMLElement;
  const settingsBtn = container.querySelector('[data-ex="settings"]') as HTMLButtonElement;
  const convList = container.querySelector('[data-ex="convlist"]') as HTMLElement;
  const modelStatus = container.querySelector('[data-ex="model"]') as HTMLElement;
  const parallaxSvg = container.querySelector('[data-ex="parallax"]') as SVGSVGElement;

  function esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- 视差背景（APITOOL initSVGParallax 简化版：Exdark 色相 160-190 的漂浮几何） ----
  function initParallax(svg: SVGSVGElement): () => void {
    const NS = 'http://www.w3.org/2000/svg';
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const colors = [
      'hsla(170, 60%, 42%, 0.30)',
      'hsla(178, 55%, 36%, 0.24)',
      'hsla(162, 48%, 30%, 0.20)',
      'hsla(186, 52%, 46%, 0.22)',
      'hsla(165, 42%, 26%, 0.16)',
    ];
    const pick = () => colors[Math.floor(Math.random() * colors.length)];
    interface Blob {
      el: SVGElement;
      x: number;
      y: number;
      depth: number;
      speed: number;
      rot: number;
      rotSpeed: number;
    }
    const blobs: Blob[] = [];
    const count = 26;
    for (let i = 0; i < count; i++) {
      let el: SVGElement;
      const type = i % 3;
      if (type === 0) {
        el = document.createElementNS(NS, 'rect');
        el.setAttribute('width', String(rand(10, 90)));
        el.setAttribute('height', String(rand(10, 160)));
        el.setAttribute('fill', pick());
      } else if (type === 1) {
        el = document.createElementNS(NS, 'rect');
        el.setAttribute('width', String(rand(12, 80)));
        el.setAttribute('height', String(rand(12, 120)));
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', pick());
        el.setAttribute('stroke-width', String(rand(0.6, 2.4)));
      } else {
        el = document.createElementNS(NS, 'line');
        const len = rand(20, 140);
        el.setAttribute('x1', String(-len / 2));
        el.setAttribute('y1', '0');
        el.setAttribute('x2', String(len / 2));
        el.setAttribute('y2', '0');
        el.setAttribute('stroke', pick());
        el.setAttribute('stroke-width', String(rand(0.6, 2.2)));
        el.setAttribute('stroke-linecap', 'round');
      }
      svg.appendChild(el);
      blobs.push({
        el,
        x: rand(0, window.innerWidth),
        y: rand(0, window.innerHeight),
        depth: rand(0.25, 1),
        speed: rand(0.2, 1),
        rot: rand(0, 360),
        rotSpeed: rand(-0.35, 0.35),
      });
    }
    let raf = 0;
    let t0 = performance.now();
    const tick = (t: number): void => {
      const dt = Math.min((t - t0) / 1000, 0.05);
      t0 = t;
      const W = window.innerWidth;
      const H = window.innerHeight;
      for (const b of blobs) {
        b.x += b.speed * 10 * dt * b.depth;
        b.y -= b.speed * 6 * dt * b.depth;
        if (b.x > W + 220) b.x = -220;
        if (b.y < -220) b.y = H + 220;
        b.rot += b.rotSpeed * dt * 30;
        b.el.setAttribute(
          'transform',
          `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.rot.toFixed(1)}) scale(${(0.5 + b.depth).toFixed(2)})`,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }

  // ---- 会话列表 ----
  async function renderSessionList(activeId: string): Promise<void> {
    let sessions;
    try {
      sessions = await ctx.storage.listConversations();
    } catch (error) {
      logger.error('storage', `会话列表加载失败: ${String(error)}`);
      return;
    }
    // await 后 DOM 可能已重建（主题切换），失效则放弃
    if (!convList.isConnected) return;
    convList.innerHTML = '';
    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '（暂无会话）';
      empty.style.cssText = 'padding:14px;font-size:11px;color:var(--ex-text3);text-align:center;';
      convList.appendChild(empty);
      return;
    }
    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = 'ex-conv-item' + (s.id === activeId ? ' active' : '');
      item.dataset.exSwitch = s.id;
      const count = s.node && Array.isArray(s.node.messages) ? s.node.messages.length : 0;
      const time = new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric' });
      item.innerHTML = `
        <button class="ex-conv-del" data-ex-del="${esc(s.id)}" title="删除">×</button>
        <div class="ex-conv-title">${esc(s.title || '新对话')}</div>
        <div class="ex-conv-info"><span>${count} 条</span><span>${esc(time)}</span></div>
      `;
      convList.appendChild(item);
    }
  }

  function updateModelStatus(): void {
    const profile = ctx.config.get('profile') as { model?: string };
    modelStatus.textContent = String(profile.model ?? 'deepseek-chat');
  }

  // ---- 聊天状态机（共享控制器） ----
  const controller = createChatController(ctx, {
    messages: messagesEl,
    input: inputEl,
    send: sendEl,
    stop: stopEl,
    status: statusEl,
    webSearch: webSearchEl,
    renderMessage: (role: 'user' | 'ai', parts: UIMessagePart[]): HTMLElement => {
      const bubble = document.createElement('div');
      bubble.className = `ex-message ex-${role}`;
      bubble.textContent = parts.map((p) => (p.type === 'text' ? p.text : '[图片]')).join('\n');
      return bubble;
    },
    onRequireSettings: () => ctx.emit('kernel-gui:open', '配置'),
    onSessionChange: (id) => {
      void renderSessionList(id);
    },
  });

  logger.info('gui', 'Exdark 主题 GUI 已挂载');

  // ---- 生命周期 ----
  ctx.effect(() => {
    const stopParallax = initParallax(parallaxSvg);
    updateModelStatus();

    // 发送 / 中止 / Enter（中文输入法组合态回车不发送）
    sendEl.addEventListener('click', controller.send);
    stopEl.addEventListener('click', controller.stop);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        controller.send();
      }
    });

    // 侧边栏抽屉（移动端）：开关按钮
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      toggleBtn.classList.toggle('hidden-state', !sidebar.classList.contains('open'));
    });
    const closeSidebar = () => {
      if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        toggleBtn.classList.add('hidden-state');
      }
    };

    // 新对话
    newChatBtn.addEventListener('click', () => {
      const s = createSession();
      void ctx.storage.saveConversation(s).then(() => {
        ctx.emit('session-switch', s.id);
        void renderSessionList(controller.getSessionId());
        closeSidebar();
      });
    });

    // 会话列表：切换 / 删除
    convList.addEventListener('click', (e) => {
      const delBtn = (e.target as HTMLElement).closest('[data-ex-del]') as HTMLElement | null;
      if (delBtn) {
        const id = delBtn.dataset.exDel;
        if (id && confirm('确定删除该会话？')) {
          void ctx.storage.deleteConversation(id).then(() => {
            ctx.emit('session-deleted', id);
            void renderSessionList(controller.getSessionId());
          });
        }
        return;
      }
      const item = (e.target as HTMLElement).closest('[data-ex-switch]') as HTMLElement | null;
      if (item && item.dataset.exSwitch) {
        ctx.emit('session-switch', item.dataset.exSwitch);
        void renderSessionList(controller.getSessionId());
        closeSidebar();
      }
    });

    // 内核入口（唯一）：管理中心；设置直接进配置页
    kernelBtn.addEventListener('click', () => {
      ctx.emit('kernel-gui:open');
      closeSidebar();
    });
    settingsBtn.addEventListener('click', () => {
      ctx.emit('kernel-gui:open', '配置');
      closeSidebar();
    });
    // 异常红点：有 FAILED 插件时内核按钮显示
    const updateDot = () => {
      try {
        const topo = ctx.topology.getTopology();
        redDot.style.display = topo.nodes.some((n) => n.stateCode === 3) ? 'block' : 'none';
      } catch {
        redDot.style.display = 'none';
      }
    };
    ctx.on('internal/status', updateDot);
    ctx.on('internal/plugin', updateDot);
    updateDot();

    // 模型显示：配置变化时刷新
    const offModel = ctx.config.onChange('profile', updateModelStatus);

    // 初次渲染会话列表
    void renderSessionList(controller.getSessionId());

    return () => {
      stopParallax();
      offModel();
      controller.dispose();
      container.remove();
    };
  });
}
