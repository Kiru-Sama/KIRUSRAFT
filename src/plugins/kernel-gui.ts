/**
 * kernel-gui 插件（v0.0.19）
 * 内核管理界面：全屏面板 + 6 tab（总览/空间站/服务与工具/配置/会话存储/日志）。
 * 独立插件，不侵入各 GUI；同进程直接 inject 内核服务，无需 RPC。
 * 入口统一走 'kernel-gui:open' 事件（由当前激活的 GUI 提供唯一入口按钮，v0.0.19 起无 FAB）。
 */
import { Context } from '@deepseek-ai/cordis';
import { logger } from '../core/logger';
import { createSession } from '../core/session';
import { fetchLatestRelease, downloadApk, isNewer, lastFetchError } from './update-checker';
import { VERSION as CURRENT_VERSION } from '../core/version';
import { GUI_THEMES } from '../core/gui-registry';
import type { TopologyNode } from '../core/topology';
import type { Session } from '../core/types';

export const name = 'kernel-gui';
export const inject = ['tools', 'providers', 'config', 'storage', 'topology'];

const TABS = ['总览', '空间站', '服务与工具', '配置', '会话存储', '日志'] as const;
type Tab = (typeof TABS)[number];

interface FiberLike {
  uid?: number | null;
  state?: number;
  inject?: Record<string, unknown>;
  config?: unknown;
}

interface RuntimeLike {
  name?: string;
  fibers?: { length?: number; [i: number]: FiberLike };
  forEach?(cb: (f: FiberLike) => void): void;
}

export function apply(ctx: Context): void {

  // 全屏面板
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;z-index:60;background:#f7f8fa;display:none;flex-direction:column;font-family:system-ui,sans-serif;';

  let activeTab: Tab = '总览';
  /** 空间站图选中的插件（详情抽屉用） */
  let selectedPlugin: string | null = null;

  function esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderTabNav(): string {
    return TABS.map(
      (t) =>
        `<button data-ktab="${t}" style="padding:10px 16px;border:none;background:${t === activeTab ? '#4f6ef7' : 'transparent'};color:${t === activeTab ? '#fff' : '#5a6172'};font-size:14px;cursor:pointer;border-radius:10px 10px 0 0;white-space:nowrap;">${t}</button>`,
    ).join('');
  }

  function renderOverview(): string {
    const plugins = [...(ctx.registry.values() as unknown as RuntimeLike[])].length;
    const tools = ctx.tools.list().length;
    const providers = ctx.providers.list().length;
    const sections = ctx.config.list().length;
    return `
      <div style="padding:20px;">
        <div style="font-size:20px;font-weight:700;color:#1f2328;margin-bottom:16px;">内核状态</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">
          ${[
            ['插件', String(plugins)],
            ['工具', String(tools)],
            ['服务商', String(providers)],
            ['配置分节', String(sections)],
          ]
            .map(
              ([label, value]) =>
                `<div style="background:#fff;border:1px solid #ececf1;border-radius:14px;padding:16px;text-align:center;">
                  <div style="font-size:26px;font-weight:700;color:#4f6ef7;">${value}</div>
                  <div style="font-size:12px;color:#8a90a0;margin-top:4px;">${label}</div>
                </div>`,
            )
            .join('')}
        </div>
        <div style="background:#fff;border:1px solid #ececf1;border-radius:14px;padding:16px;margin-top:16px;">
          <div style="font-size:14px;font-weight:600;color:#1f2328;margin-bottom:8px;">版本更新</div>
          <div style="font-size:13px;color:#5a6172;">当前版本：<strong>${esc(CURRENT_VERSION)}</strong></div>
          <div data-kupdate="result" style="font-size:13px;color:#5a6172;margin-top:8px;"></div>
          <button data-kcheckupdate style="margin-top:10px;padding:8px 16px;background:#4f6ef7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">检查更新</button>
        </div>
        <div style="background:#fff;border:1px solid #ececf1;border-radius:14px;padding:16px;margin-top:16px;">
          <div style="font-size:14px;font-weight:600;color:#1f2328;margin-bottom:8px;">主题</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${(() => {
              const activeThemeId =
                ctx.topology
                  .getTopology()
                  .nodes.find((n) => n.kind === 'theme' && n.stateCode === 2)?.id ?? '';
              const btn = (id: string, label: string) => {
                const active = id === activeThemeId;
                return `<button data-ktheme="${esc(id)}" style="padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;border:1px solid ${active ? '#4f6ef7' : '#d9dce3'};background:${active ? '#eef1ff' : '#fff'};color:${active ? '#4f6ef7' : '#3c4353'};">${esc(label)}</button>`;
              };
              return (
                btn('', '默认') +
                Object.entries(GUI_THEMES)
                  .map(([id, meta]) => btn(id, meta.label))
                  .join('')
              );
            })()}
          </div>
        </div>
      </div>`;
  }

  function renderTopology(): string {
    const topo = ctx.topology.getTopology();
    const active = topo.nodes.filter((n) => n.kind !== 'core' && n.stateCode === 2);
    // 停靠可达性：从核心沿 dockParent 链可达的 ACTIVE 插件才算贴靠；环/父未加载 → 进未加载区
    const dockedIds = new Set<string>();
    const reachable = (id: string, seen: Set<string>): boolean => {
      if (id === 'core') return true;
      if (seen.has(id)) return false; // 依赖环，防死循环
      seen.add(id);
      const node = active.find((n) => n.id === id);
      return node ? reachable(node.dockParent, seen) : false;
    };
    for (const n of active) {
      if (reachable(n.id, new Set())) dockedIds.add(n.id);
    }
    const docked = active.filter((n) => dockedIds.has(n.id));
    const undocked = [
      ...active.filter((n) => !dockedIds.has(n.id)),
      ...topo.nodes.filter((n) => n.kind !== 'core' && n.stateCode !== 2),
    ];

    const W = 340;
    const H = 420;
    const cx = W / 2;
    const cy = H / 2;
    const coreR = 44;

    // 贴靠半径：卡片紧贴核心（间距 6），插件多时卡片缩窄（防互相遮挡）
    const k = docked.length;
    const cardW = Math.max(72, Math.min(104, 104 - Math.max(0, k - 6) * 6));
    const moduleR = Math.max(coreR + 6 + cardW / 2, 96);

    // 停靠布局：ACTIVE 插件贴靠核心（或其依赖的已贴靠插件），贴靠 = 已加载，不画线
    const pos = new Map<string, { x: number; y: number; angle: number }>();
    pos.set('core', { x: cx, y: cy, angle: -Math.PI / 2 });
    const kidsOf = (id: string) => docked.filter((n) => n.dockParent === id);
    const placedIds = new Set<string>();
    const place = (id: string, level: number): void => {
      if (placedIds.has(id)) return;
      placedIds.add(id);
      const kids = kidsOf(id);
      const parent = pos.get(id)!;
      const n = kids.length;
      kids.forEach((kid, i) => {
        let angle: number;
        if (level === 0) {
          // 核心的孩子：绕核心等角（12 点方向起）
          angle = (-90 + (i * 360) / Math.max(n, 1)) * (Math.PI / 180);
        } else {
          // 贴靠子层：沿父方向两侧展开
          const spread = n > 1 ? (n - 1) * 0.45 : 0.5;
          angle = parent.angle + (i - (n - 1) / 2) * Math.min(spread / Math.max(n - 1, 1), 0.9);
        }
        const R = level === 0 ? moduleR : 62;
        const x = parent.x + R * Math.cos(angle);
        const y = parent.y + R * Math.sin(angle);
        pos.set(kid.id, { x, y, angle });
        place(kid.id, level + 1);
      });
    };
    place('core', 0);

    const stateColor = (code: number) => (code === 2 ? '#1a9e6b' : code === 3 ? '#e5484d' : code === 0 || code === 1 ? '#e8912d' : '#8a90a0');

    // 过桥管线：只有依赖越过停靠邻接的插件才画线（一般插件没有）
    const edgesSvg = topo.edges
      .map((e) => {
        const from = pos.get(e.from);
        const to = pos.get(e.to);
        if (!from || !to) return '';
        const color = e.status === 'failed' ? '#e5484d' : '#e8912d';
        const dash = e.status === 'active' ? ' stroke-dasharray="6 4"' : ' stroke-dasharray="2 4"';
        const opacity = e.status === 'active' ? 0.9 : 0.5;
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        return `<path d="M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}" stroke="${color}" stroke-width="1.5" fill="none" opacity="${opacity}"${dash}/>`;
      })
      .join('');

    // 核心舱
    const coreHtml = `
      <div style="position:absolute;left:${cx - coreR}px;top:${cy - coreR}px;width:${coreR * 2}px;height:${coreR * 2}px;border-radius:50%;background:#1f2328;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(31,35,40,.35);z-index:2;">
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:600;">内核</div>
          <div style="font-size:10px;opacity:.7;">核心舱</div>
        </div>
      </div>`;

    // 舱段卡片（贴靠核心 / 贴靠已贴靠插件的都算已加载）
    const cardHtml = (m: TopologyNode, x: number, y: number, style: string, width: number) => {
      const sc = stateColor(m.stateCode);
      const protectedP = ctx.topology.isProtected(m.id);
      const toggleLabel = protectedP ? '受保护' : m.stateCode === 2 ? '禁用' : '启用';
      const toggleStyle = protectedP
        ? 'margin-top:6px;padding:3px 10px;border:none;border-radius:6px;font-size:10px;background:#eef0f5;color:#8a90a0;'
        : `margin-top:6px;padding:3px 10px;border:none;border-radius:6px;font-size:10px;cursor:pointer;background:${m.stateCode === 2 ? '#fdecec;color:#e5484d' : '#e8f4ef;color:#1a9e6b'};`;
      return `
      <div data-kdetail="${esc(m.id)}" style="position:absolute;left:${x - width / 2}px;top:${y - 24}px;width:${width}px;background:#fff;border:2px solid ${sc};border-radius:12px;padding:8px 10px;box-shadow:0 2px 10px rgba(31,35,40,.12);z-index:2;cursor:pointer;${style}">
        <div style="font-size:12px;font-weight:600;color:#1f2328;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(m.name)}">${esc(m.name)}</div>
        <div style="display:flex;align-items:center;gap:5px;margin-top:3px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${sc};"></span>
          <span style="font-size:10px;color:${sc};">${esc(m.state)}</span>
        </div>
        <button data-ktoggle="${esc(m.id)}" style="${toggleStyle}" ${protectedP ? 'disabled' : ''}>${toggleLabel}</button>
      </div>`;
    };
    const modulesHtml = docked
      .map((m) => {
        const p = pos.get(m.id)!;
        return cardHtml(m, p.x, p.y, m.kind === 'theme' ? 'opacity:.85;border-style:dashed;' : '', cardW);
      })
      .join('');

    // 未加载区：非 ACTIVE 插件（失败/禁用/等待）放进底部停靠区
    const undockedHtml =
      undocked.length > 0
        ? `<div style="margin-top:10px;padding:0 4px;">
             <div style="font-size:11px;color:#8a90a0;margin-bottom:6px;">未加载区（${undocked.length}）· 修复或启用后自动贴靠核心</div>
             <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
               ${undocked
                 .map((m) => {
                   const sc = stateColor(m.stateCode);
                   const protectedP = ctx.topology.isProtected(m.id);
                   return `<div data-kdetail="${esc(m.id)}" style="flex:0 0 96px;background:#fafbfc;border:2px dashed ${sc};border-radius:10px;padding:6px 8px;cursor:pointer;">
                     <div style="font-size:11px;font-weight:600;color:#5a6172;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(m.name)}">${esc(m.name)}</div>
                     <div style="display:flex;align-items:center;gap:4px;margin-top:3px;">
                       <span style="width:7px;height:7px;border-radius:50%;background:${sc};"></span>
                       <span style="font-size:9px;color:${sc};">${esc(m.state)}</span>
                     </div>
                     <button data-ktoggle="${esc(m.id)}" style="margin-top:4px;padding:2px 8px;border:none;border-radius:6px;font-size:9px;cursor:pointer;background:#e8f4ef;color:#1a9e6b;" ${protectedP ? 'disabled' : ''}>${protectedP ? '受保护' : '启用'}</button>
                   </div>`;
                 })
                 .join('')}
             </div>
           </div>`
        : '';

    return `
      <div style="padding:10px;overflow-x:auto;">
        <div style="position:relative;width:${W}px;height:${H}px;margin:0 auto;background:linear-gradient(180deg,#f7f8fa,#eef0f5);border:1px solid #ececf1;border-radius:16px;overflow:hidden;">
          ${edgesSvg ? `<svg width="${W}" height="${H}" style="position:absolute;inset:0;pointer-events:none;">${edgesSvg}</svg>` : ''}
          ${coreHtml}
          ${modulesHtml}
        </div>
        ${undockedHtml}
      </div>
      ${renderPluginDetail()}
      <div style="padding:4px 16px 12px;font-size:11px;color:#8a90a0;text-align:center;">空间站 · 贴靠核心 = 已加载（${active.length}）· 过桥管线 ${topo.edges.length} 条 · 未加载 ${undocked.length}</div>`;
  }

  /** 详情抽屉：点击舱段卡片后展示插件详情 */
  function renderPluginDetail(): string {
    if (!selectedPlugin) return '';
    const topo = ctx.topology.getTopology();
    const node = topo.nodes.find((n) => n.id === selectedPlugin);
    if (!node) return '';
    const kindLabel = node.kind === 'core' ? '核心舱' : node.kind === 'theme' ? '主题插件' : '功能插件';
    const deps =
      node.injectServices.length > 0
        ? node.injectServices
            .map(
              (s) =>
                `<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:6px;background:#eef1ff;color:#4f6ef7;font-size:11px;">${esc(s)}</span>`,
            )
            .join('')
        : '<span style="color:#9aa1b0;">（无）</span>';
    return `
      <div style="background:#fff;border:1px solid #ececf1;border-radius:14px;padding:16px;margin:12px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <strong style="font-size:15px;color:#1f2328;">${esc(node.name)}</strong>
          <button data-kdetailclose style="background:none;border:none;font-size:18px;color:#8a90a0;cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="font-size:13px;color:#5a6172;margin-bottom:6px;">状态：<strong>${esc(node.state)}</strong></div>
        <div style="font-size:13px;color:#5a6172;margin-bottom:6px;">类型：${kindLabel}</div>
        <div style="font-size:13px;color:#5a6172;">依赖服务：</div>
        <div style="margin-top:2px;">${deps}</div>
        <button data-kdetailcfg style="margin-top:12px;padding:7px 14px;background:#4f6ef7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">打开配置</button>
      </div>`;
  }

  function renderServices(): string {
    const tools = ctx.tools.list();
    const providers = ctx.providers.list();
    const section = (title: string, items: string[]) =>
      `<div style="font-size:14px;font-weight:600;color:#1f2328;margin:16px 0 8px;">${title}</div>` +
      (items.length > 0
        ? items.map((i) => `<div style="font-size:13px;color:#5a6172;padding:6px 0;border-bottom:1px solid #f0f1f5;">${esc(i)}</div>`).join('')
        : `<div style="font-size:12px;color:#9aa1b0;">（无）</div>`);
    return `
      <div style="padding:20px;">
        ${section(
          `工具 (${tools.length})`,
          tools.map((t) => `${t.name} — ${t.description.slice(0, 40)}`),
        )}
        ${section(
          `服务商 (${providers.length})`,
          providers.map((p) => `${p.id} (${p.displayName})`),
        )}
      </div>`;
  }

  function renderConfig(): string {
    const sections = ctx.config.list();
    return `
      <div style="padding:20px;">
        ${sections
          .map(
            (s) =>
              `<div style="font-size:14px;font-weight:600;color:#1f2328;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #ececf1;">${esc(s.displayName)}</div>
               <div data-kcfg="${esc(s.namespace)}"></div>`,
          )
          .join('') || '<div style="color:#8a90a0;">（无配置分节）</div>'}
      </div>`;
  }

  function renderSessions(): string {
    return `<div style="padding:20px;" data-ksessions="1">加载中...</div>`;
  }

  function renderLogs(): string {
    const entries = logger.getLogs();
    return `
      <div style="padding:20px;display:flex;flex-direction:column;height:100%;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="font-size:14px;font-weight:600;color:#1f2328;">日志（${entries.length} 条）</span>
          <button data-kclearlog style="background:#e5484d;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">清空</button>
        </div>
        <div style="flex:1;overflow-y:auto;background:#1e1e1e;color:#d4d4d4;font-family:monospace;font-size:12px;border-radius:12px;padding:14px;white-space:pre-wrap;word-break:break-all;">
          ${entries
            .map((e) => {
              const t = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false });
              return `[${t}] ${esc(e.level.toUpperCase())} [${esc(e.source)}] ${esc(e.message)}`;
            })
            .join('\n')}
        </div>
      </div>`;
  }

  function renderTab(): string {
    switch (activeTab) {
      case '总览':
        return renderOverview();
      case '空间站':
        return renderTopology();
      case '服务与工具':
        return renderServices();
      case '配置':
        return renderConfig();
      case '会话存储':
        return renderSessions();
      case '日志':
        return renderLogs();
    }
  }

  function renderPanel(): void {
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#fff;border-bottom:1px solid #ececf1;">
        <strong style="font-size:16px;color:#1f2328;">内核中心</strong>
        <button data-kclose style="background:none;border:none;font-size:22px;cursor:pointer;color:#8a90a0;line-height:1;">×</button>
      </div>
      <div style="display:flex;gap:2px;padding:8px 16px 0;background:#fff;border-bottom:1px solid #ececf1;overflow-x:auto;">
        ${renderTabNav()}
      </div>
      <div style="flex:1;overflow-y:auto;">${renderTab()}</div>
    `;

    // 绑定 tab 切换
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

    // 总览 tab：检查更新按钮
    panel.querySelector('[data-kcheckupdate]')?.addEventListener('click', () => {
      void checkUpdate();
    });

    // 总览 tab：主题切换（P3）
    panel.querySelectorAll<HTMLButtonElement>('[data-ktheme]').forEach((el) => {
      el.addEventListener('click', async () => {
        const theme = el.dataset.ktheme ?? '';
        const r = await ctx.topology.switchTheme(theme);
        if (!r.ok) {
          logger.error('topology', r.message ?? '切换主题失败');
        }
        renderPanel();
      });
    });

    // 空间站 tab：插件启停开关
    panel.querySelectorAll<HTMLButtonElement>('[data-ktoggle]').forEach((el) => {
      el.addEventListener('click', async () => {
        const name = el.dataset.ktoggle;
        if (!name || ctx.topology.isProtected(name)) return;
        el.disabled = true;
        const r = await ctx.topology.togglePlugin(name);
        if (!r.ok) {
          logger.error('topology', r.message ?? `切换 ${name} 失败`);
          el.disabled = false;
        }
        renderPanel();
      });
    });

    // 空间站 tab：点击舱段卡片打开详情抽屉
    panel.querySelectorAll<HTMLElement>('[data-kdetail]').forEach((el) => {
      el.addEventListener('click', () => {
        selectedPlugin = el.dataset.kdetail ?? null;
        renderPanel();
      });
    });
    panel.querySelector('[data-kdetailclose]')?.addEventListener('click', () => {
      selectedPlugin = null;
      renderPanel();
    });
    // 详情抽屉：打开配置（切到配置 tab）
    panel.querySelector('[data-kdetailcfg]')?.addEventListener('click', () => {
      activeTab = '配置';
      renderPanel();
    });

    // 配置 tab：为每个分节调用 render 回调（用 dataset 匹配，避免选择器转义问题）
    if (activeTab === '配置') {
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

    // 会话 tab：异步加载会话列表
    if (activeTab === '会话存储') {
      void renderSessionList();
    }
  }

  async function checkUpdate(): Promise<void> {
    const resultEl = panel.querySelector('[data-kupdate="result"]') as HTMLElement | null;
    if (resultEl) resultEl.textContent = '检查中...';
    const latest = await fetchLatestRelease();
    // await 后重新查询（DOM 可能已重建），失效则放弃
    const currentEl = panel.querySelector('[data-kupdate="result"]') as HTMLElement | null;
    if (!currentEl || !currentEl.isConnected) return;
    if (!latest || !latest.tagName) {
      currentEl.textContent = `检查失败：${lastFetchError || '无法访问 GitHub'}`;
      return;
    }
    if (isNewer(latest.tagName, CURRENT_VERSION)) {
      currentEl.innerHTML = `发现新版本 <strong style="color:#4f6ef7;">${esc(latest.tagName)}</strong>`;
      if (latest.apkUrl) {
        // 重复点击时先清空旧按钮（L2）
        const oldBtn = currentEl.querySelector<HTMLElement>('[data-kdl]');
        if (oldBtn) oldBtn.remove();
        const dlBtn = document.createElement('button');
        dlBtn.dataset.kdl = '1';
        dlBtn.textContent = '下载 APK';
        dlBtn.style.cssText = 'margin-top:8px;padding:8px 16px;background:#1a9e6b;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;';
        dlBtn.addEventListener('click', () => {
          void (async () => {
            dlBtn.textContent = '下载中...';
            const result = await downloadApk(latest.apkUrl!);
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
            // 延迟释放 Blob URL，避免下载未完成就被回收（M1）
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            dlBtn.textContent = '已下载';
          })();
        });
        currentEl.appendChild(dlBtn);
      }
    } else {
      currentEl.textContent = `已是最新版本（远端 ${latest.tagName}）`;
    }
  }

  async function renderSessionList(): Promise<void> {
    const sessions = await ctx.storage.listConversations();
    // await 后重新查询（DOM 可能已重建），失效则放弃
    const container = panel.querySelector('[data-ksessions]') as HTMLElement | null;
    if (!container || !container.isConnected) return;
    try {
      if (sessions.length === 0) {
        container.innerHTML = `<div style="color:#8a90a0;margin-bottom:12px;">（无会话）</div>`;
      } else {
        container.innerHTML = sessions
          .map(
            (s) => {
              const valid = !!s.node && Array.isArray(s.node.messages);
              const count = valid ? s.node.messages.length : 0;
              const badge = valid ? '' : ' <span style="color:#e5484d;font-size:11px;">[损坏]</span>';
              return `
            <div style="background:#fff;border:1px solid #ececf1;border-radius:12px;padding:12px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
              <div style="min-width:0;">
                <div style="font-size:14px;font-weight:600;color:#1f2328;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.title || '新对话')}${badge}</div>
                <div style="font-size:12px;color:#8a90a0;margin-top:2px;">${count} 条消息 · ${new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
              </div>
              <div style="flex-shrink:0;display:flex;gap:6px;">
                <button data-kswitch="${esc(s.id)}" style="background:#4f6ef7;color:#fff;border:none;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:12px;">切换</button>
                <button data-kdelete="${esc(s.id)}" style="background:#fff;color:#e5484d;border:1px solid #f3c1c4;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:12px;">删除</button>
              </div>
            </div>`;
            },
          )
          .join('');
      }
      // 新建按钮
      const newBtn = document.createElement('button');
      newBtn.textContent = '+ 新建会话';
      newBtn.style.cssText = 'width:100%;padding:10px;background:#f0f1f5;color:#4f6ef7;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:500;';
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
      container.innerHTML = `<div style="color:#e5484d;">加载失败: ${esc(String(error))}</div>`;
    }
  }

  function openPanel(tab?: string): void {
    panel.style.display = 'flex';
    activeTab = TABS.includes(tab as Tab) ? (tab as Tab) : '总览';
    renderPanel();
  }

  ctx.effect(() => {
    document.body.appendChild(panel);
    // 跨插件唤起：当前激活 GUI 的唯一"内核"入口按钮 emit 'kernel-gui:open'
    // （v0.0.19 起无 FAB，避免双入口；tab 参数支持直接打开指定页）
    ctx.on('kernel-gui:open', (tab?: unknown) => openPanel(typeof tab === 'string' ? tab : undefined));
    return () => {
      panel.remove();
    };
  });
}
