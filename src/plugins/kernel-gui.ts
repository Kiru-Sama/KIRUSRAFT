/**
 * kernel-gui 插件（v0.0.9）
 * 内核管理界面：全屏面板 + 6 tab（总览/插件/服务与工具/配置/会话存储/日志）。
 * 独立插件，不侵入 fallback-gui；同进程直接 inject 内核服务，无需 RPC。
 * 参考 dsh web GUI（槽位 + 面板服务）+ RikkaHub（分区卡片）+ 市面插件管理共性。
 */
import { Context } from '@deepseek-ai/cordis';
import { logger } from '../core/logger';
import { createSession } from '../core/session';
import { fetchLatestRelease, downloadApk, isNewer, lastFetchError } from './update-checker';
import { VERSION as CURRENT_VERSION } from '../core/version';
import type { Session } from '../core/types';

export const name = 'kernel-gui';
export const inject = ['tools', 'providers', 'config', 'storage'];

const TABS = ['总览', '插件', '服务与工具', '配置', '会话存储', '日志'] as const;
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

const FIBER_STATE_LABEL: Record<number, string> = {
  0: '等待',
  1: '加载中',
  2: '运行中',
  3: '失败',
  4: '已禁用',
  5: '卸载中',
};

export function apply(ctx: Context): void {
  // 右下角 FAB（上移到输入区之上，避免与发送按钮重叠）
  const fab = document.createElement('button');
  fab.textContent = '内核';
  fab.style.cssText =
    'position:fixed;right:16px;bottom:88px;z-index:50;padding:8px 14px;background:#1f2328;color:#fff;border:none;border-radius:999px;font-size:12px;font-weight:500;cursor:pointer;box-shadow:0 2px 12px rgba(31,35,40,.3);';

  // 全屏面板
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;z-index:60;background:#f7f8fa;display:none;flex-direction:column;font-family:system-ui,sans-serif;';

  let activeTab: Tab = '总览';

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
      </div>`;
  }

  function renderPlugins(): string {
    const runtimes = [...(ctx.registry.values() as unknown as RuntimeLike[])];
    if (runtimes.length === 0) return `<div style="padding:20px;color:#8a90a0;">（无插件）</div>`;
    return `
      <div style="padding:20px;">
        ${runtimes
          .map((r) => {
            const fiberCount = r.fibers?.length ?? 0;
            const first = r.fibers?.[0] as FiberLike | undefined;
            const state = first?.state ?? (fiberCount > 0 ? 2 : 4);
            const stateLabel = FIBER_STATE_LABEL[state] ?? '未知';
            const stateColor = state === 2 ? '#1a9e6b' : state === 3 ? '#e5484d' : '#8a90a0';
            return `<div style="background:#fff;border:1px solid #ececf1;border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:14px;font-weight:600;color:#1f2328;">${esc(r.name ?? '(匿名)')}</div>
                <div style="font-size:12px;color:#8a90a0;margin-top:2px;">${fiberCount} 个实例</div>
              </div>
              <span style="font-size:12px;padding:3px 10px;border-radius:999px;background:${stateColor}18;color:${stateColor};">${stateLabel}</span>
            </div>`;
          })
          .join('')}
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
      case '插件':
        return renderPlugins();
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

  ctx.effect(() => {
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    fab.addEventListener('click', () => {
      panel.style.display = 'flex';
      activeTab = '总览';
      renderPanel();
    });
    return () => {
      fab.remove();
      panel.remove();
    };
  });
}
