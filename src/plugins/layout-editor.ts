/**
 * layout-editor 插件（v0.0.84）
 * 可视化布局编辑器：浮窗切换「启用 / 调整」模式。调整模式下所有 UI 元素可选中、拖拽移动/缩放，
 * 只记录相对默认变化过的样式（diff），可导出（复制 / 下载 json）与导入。
 * 仅预览：退出调整模式恢复默认，导入才持久应用。
 * 操作主题 GUI 的 .kr-exdark 容器（依赖 ui-exdark 已挂载）。
 */
import { Context } from '@deepseek-ai/cordis';
import type { PluginManifest } from '../core/manifest';

export const name = 'layout-editor';
export const inject: string[] = [];

export const manifest: PluginManifest = {
  name,
  kind: 'tool',
  label: { zh: '布局编辑', en: 'Layout Editor' },
  group: '工具',
  description: '可视化布局编辑器：浮窗切换启用/调整，拖拽移动/缩放元素，只记变化并导出/导入',
  configSection: 'ui',
  apply,
};

/** 相对默认的变化：{ top, left, width, height, ... } */
type StyleChanges = Record<string, string>;
/** 导出结构：data-le-id -> { selector, changes } */
interface LayoutEntry {
  selector: string;
  changes: StyleChanges;
}
type LayoutData = Record<string, LayoutEntry>;

const STYLE = `
.le-fab { position:fixed; left:16px; bottom:16px; z-index:99999; display:flex; flex-direction:column; gap:6px;
  background:var(--ex-surface2); border:1px solid var(--ex-border); box-shadow:0 8px 32px rgba(0,0,0,.5);
  padding:8px; border-radius:4px; pointer-events:auto; font-family:var(--ex-font); }
.le-fab .le-title { font-size:10px; font-weight:900; letter-spacing:1px; color:var(--ex-accent); text-transform:uppercase; }
.le-fab button { font-size:11px; padding:5px 10px; background:transparent; border:1px solid var(--ex-border2);
  color:var(--ex-text); cursor:pointer; text-align:left; font-family:var(--ex-font); }
.le-fab button:hover { background:var(--ex-border2); }
.le-fab button.le-on { border-color:var(--ex-accent); color:var(--ex-accent); }
body.le-edit .ex-app { outline:1px dashed var(--ex-accent); }
.le-selected { position:absolute; z-index:99998; border:1px solid var(--ex-accent); pointer-events:none; }
.le-selected .le-handle { position:absolute; width:8px; height:8px; background:var(--ex-accent); pointer-events:auto; }
.le-selected .le-handle.le-move { width:auto; height:auto; inset:0; background:transparent; cursor:move; }
.le-selected .le-handle.le-nw { left:-4px; top:-4px; cursor:nwse-resize; }
.le-selected .le-handle.le-ne { right:-4px; top:-4px; cursor:nesw-resize; }
.le-selected .le-handle.le-sw { left:-4px; bottom:-4px; cursor:nesw-resize; }
.le-selected .le-handle.le-se { right:-4px; bottom:-4px; cursor:nwse-resize; }
`;

interface DragState {
  mode: 'move' | 'resize';
  dir?: string;
  startX: number;
  startY: number;
  el: HTMLElement;
  orig: { left: number; top: number; width: number; height: number };
  origStyle: { top?: string; left?: string; width?: string; height?: string };
}

let idSeq = 0;

function cssPath(el: Element, root: Element): string {
  if (el.id) return '#' + CSS.escape(el.id);
  let cur: Element | null = el;
  const parts: string[] = [];
  while (cur && cur !== root && cur !== document.body) {
    let sel = cur.tagName.toLowerCase();
    const cls = Array.from(cur.classList).filter((c) => c.startsWith('ex-') || c.startsWith('le-') || c === 'kr-exdark');
    if (cls.length) sel += '.' + cls.map((c) => CSS.escape(c)).join('.');
    // 同一父级下同 tag 有多个时加 nth-child
    if (cur.parentElement) {
      const same = Array.from(cur.parentElement.children).filter((s) => s.tagName === cur!.tagName);
      if (same.length > 1) sel += `:nth-child(${Array.from(cur.parentElement.children).indexOf(cur) + 1})`;
    }
    parts.unshift(sel);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function apply(ctx: Context): void {
  const setup = (appRoot: HTMLElement): void => {
    appRoot.insertAdjacentHTML('beforeend', `<style>${STYLE}</style>`);
    const fab = document.createElement('div');
    fab.className = 'le-fab';
    fab.innerHTML = `
      <div class="le-title">布局编辑</div>
      <button type="button" data-le="toggle">调整模式</button>
      <button type="button" data-le="export-copy">复制 diff</button>
      <button type="button" data-le="export-file">下载 json</button>
      <button type="button" data-le="import">导入</button>
      <button type="button" data-le="reset">清空</button>
    `;
    document.body.appendChild(fab);

    let editMode = false;
    let tracked = new Map<number, { el: HTMLElement; changes: StyleChanges }>();
    let current: { id: number; el: HTMLElement } | null = null;
    let selectedBox: HTMLElement | null = null;
    let drag: DragState | null = null;

    const dataKey = (el: HTMLElement): number => {
      const id = el.getAttribute('data-le-id');
      if (id) return Number(id);
      idSeq += 1;
      el.setAttribute('data-le-id', String(idSeq));
      return idSeq;
    };

    const getBoxes = (el: HTMLElement): StyleChanges => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const changes: StyleChanges = {};
      // 位置用相对 .ex-app 的偏移（避免坐标受滚动影响）
      const anchor = appRoot.querySelector('.ex-app') as HTMLElement;
      const base = anchor ? anchor.getBoundingClientRect() : { left: 0, top: 0 } as DOMRect;
      changes.left = String(Math.round(r.left - base.left));
      changes.top = String(Math.round(r.top - base.top));
      changes.width = String(Math.round(r.width));
      changes.height = String(Math.round(r.height));
      // 保留原始定位方式引用
      return changes;
    };

    const makeBox = (el: HTMLElement): void => {
      removeBox();
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'le-selected';
      box.style.display = 'none'; // 用 fixed 定位但先隐藏，统一由 move 逻辑刷新
      box.dataset.leTarget = String(dataKey(el));
      box.innerHTML = `<div class="le-handle le-move"></div><div class="le-handle le-nw"></div><div class="le-handle le-ne"></div><div class="le-handle le-sw"></div><div class="le-handle le-se"></div>`;
      document.body.appendChild(box);
      selectedBox = box;
      // fixed 定位到元素位置
      const pos = (): void => {
        const rr = el.getBoundingClientRect();
        box.style.display = 'block';
        box.style.left = `${rr.left}px`;
        box.style.top = `${rr.top}px`;
        box.style.width = `${rr.width}px`;
        box.style.height = `${rr.height}px`;
      };
      pos();
      // 跟随元素滚动/尺寸变化（简化：每次拖拽后刷新）
      (box as unknown as { __pos: () => void }).__pos = pos;

      // 移动 / 缩放
      box.querySelectorAll('.le-handle').forEach((h) => {
        (h as HTMLElement).addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dir = (h as HTMLElement).className.replace('le-handle', '').replace('le-move', 'move').trim() || 'move';
          const r = el.getBoundingClientRect();
          drag = {
            mode: dir === 'move' ? 'move' : 'resize',
            dir,
            startX: e.clientX,
            startY: e.clientY,
            el,
            orig: { left: r.left, top: r.top, width: r.width, height: r.height },
            origStyle: { width: el.style.width, height: el.style.height },
          };
          (document as unknown as { __leDrag?: DragState }).__leDrag = drag;
        });
      });
    };

    const removeBox = (): void => {
      selectedBox?.remove();
      selectedBox = null;
    };

    const refreshBox = (): void => {
      if (selectedBox && (selectedBox as unknown as { __pos?: () => void }).__pos) {
        (selectedBox as unknown as { __pos: () => void }).__pos();
      }
    };

    // 记录变化（只存调整过的元素，相对默认 = 当前 rect）
    const trackChange = (el: HTMLElement): void => {
      const id = dataKey(el);
      const changes = getBoxes(el);
      if (!tracked.has(id)) tracked.set(id, { el, changes });
      else tracked.get(id)!.changes = changes;
    };

    // 全局事件：调整模式下拦截点击选中 + 拖拽
    const onMouseDown = (e: MouseEvent): void => {
      if (!editMode) return;
      // 拖拽由 handle 的 mousedown 处理，这里只处理"点击元素选中"
      if ((e.target as HTMLElement).closest('.le-fab') || (e.target as HTMLElement).closest('.le-selected')) return;
      const target = e.target as HTMLElement;
      if (!appRoot.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      const id = dataKey(target);
      current = { id, el: target };
      makeBox(target);
    };

    const onMouseMove = (e: MouseEvent): void => {
      const d = (document as unknown as { __leDrag?: DragState }).__leDrag;
      if (!d) return;
      e.preventDefault();
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const el = d.el;
      if (d.mode === 'move') {
        el.style.position = 'fixed';
        el.style.left = `${d.orig.left + dx}px`;
        el.style.top = `${d.orig.top + dy}px`;
      } else {
        const dir = d.dir ?? 'se';
        el.style.position = 'fixed';
        if (dir.includes('e')) el.style.width = `${Math.max(20, d.orig.width + dx)}px`;
        if (dir.includes('s')) el.style.height = `${Math.max(20, d.orig.height + dy)}px`;
        if (dir.includes('w')) { el.style.left = `${Math.min(d.orig.left + dx, d.orig.left + d.orig.width - 20)}px`; el.style.width = `${Math.max(20, d.orig.width - dx)}px`; }
        if (dir.includes('n')) { el.style.top = `${Math.min(d.orig.top + dy, d.orig.top + d.orig.height - 20)}px`; el.style.height = `${Math.max(20, d.orig.height - dy)}px`; }
      }
      trackChange(el);
      refreshBox();
    };

    const onMouseUp = (e: MouseEvent): void => {
      const d = (document as unknown as { __leDrag?: DragState }).__leDrag;
      if (!d) return;
      e.preventDefault();
      (document as unknown as { __leDrag?: DragState }).__leDrag = undefined;
      trackChange(d.el);
    };

    const setEditMode = (on: boolean): void => {
      editMode = on;
      document.body.classList.toggle('le-edit', on);
      document.querySelector<HTMLButtonElement>('[data-le="toggle"]')!.textContent = on ? '退出调整' : '调整模式';
      document.querySelector<HTMLButtonElement>('[data-le="toggle"]')!.classList.toggle('le-on', on);
      if (!on) {
        removeBox();
        // 仅预览：退出清空内联样式
        for (const [, t] of tracked) {
          t.el.style.left = '';
          t.el.style.top = '';
          t.el.style.width = '';
          t.el.style.height = '';
          t.el.style.position = '';
        }
        tracked.clear();
      }
    };

    const collect = (): LayoutData => {
      const data: LayoutData = {};
      for (const [id, t] of tracked) {
        data[String(id)] = { selector: cssPath(t.el, appRoot), changes: t.changes };
      }
      return data;
    };

    const copyText = (text: string): void => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* 忽略 */ }
      ta.remove();
    };

    fab.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      const act = btn.dataset.le;
      if (act === 'toggle') setEditMode(!editMode);
      else if (act === 'export-copy') {
        const json = JSON.stringify(collect(), null, 2);
        copyText(json);
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = '复制 diff'), 1200);
      } else if (act === 'export-file') {
        const json = JSON.stringify(collect(), null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `kirusraft-layout-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (act === 'import') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const data = JSON.parse(String(reader.result)) as LayoutData;
              for (const [, entry] of Object.entries(data)) {
                const el = document.querySelector<HTMLElement>(entry.selector);
                if (!el) continue;
                el.style.position = 'fixed';
                for (const [k, v] of Object.entries(entry.changes)) {
                  el.style.setProperty(k, v);
                }
              }
              btn.textContent = '已导入';
              setTimeout(() => (btn.textContent = '导入'), 1200);
            } catch {
              btn.textContent = '导入失败';
              setTimeout(() => (btn.textContent = '导入'), 1200);
            }
          };
          reader.readAsText(f);
        };
        input.click();
      } else if (act === 'reset') {
        for (const [, t] of tracked) {
          t.el.style.left = ''; t.el.style.top = ''; t.el.style.width = ''; t.el.style.height = ''; t.el.style.position = '';
        }
        tracked.clear();
        removeBox();
      }
    });

    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  };

  // 等主题 GUI 容器 .kr-exdark 出现
  const trySetup = (): void => {
    const appRoot = document.querySelector<HTMLElement>('.kr-exdark');
    if (appRoot) setup(appRoot);
  };
  if (document.querySelector('.kr-exdark')) trySetup();
  else {
    const obs = new MutationObserver(() => {
      if (document.querySelector('.kr-exdark')) { obs.disconnect(); trySetup(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
}
