/**
 * 内核拓扑服务（v0.0.19）
 * 聚合 Cordis registry + fiber.inject/store，产出"核心舱 + 插件舱段 + 过桥管线"拓扑快照。
 * 空间站语义（v0.0.19 改版）：
 *  - 贴靠 = 已加载：ACTIVE 插件卡片贴靠核心（或贴靠已贴靠的插件），无需连线；
 *  - 过桥管线 = 依赖越过停靠邻接的跨舱段连接（一般插件无，只有需要"过桥"的插件才有）。
 * UI 只消费快照，订阅状态变化失效缓存。
 */
import { Service, Context } from '@deepseek-ai/cordis';
import { logger } from './logger';
import { isGuiTheme } from './gui-registry';
import type { ThemePluginModule } from './gui-registry';

export type NodeKind = 'core' | 'module' | 'theme';

export interface TopologyNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** 状态标签（中文） */
  state: string;
  /** 状态码（FiberState 六态） */
  stateCode: number;
  /** 依赖的内核服务/插件名（inject 的服务，用于判定停靠与过桥） */
  injectServices: string[];
  /**
   * 停靠父节点 id：依赖里的第一个插件（否则 'core'）。
   * 贴靠核心（或贴靠已贴靠的插件）= 已加载，是默认加载语义，不画线。
   */
  dockParent: string;
}

/** 过桥管线：依赖越过停靠邻接的跨舱段连接（from 插件 → to 插件） */
export interface TopologyEdge {
  from: string;
  to: string;
  status: 'active' | 'failed' | 'pending' | 'disabled';
}

export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

interface FiberLike {
  state?: number;
  inject?: Record<string, unknown>;
  config?: unknown;
  dispose?: () => Promise<void>;
}

interface RuntimeLike {
  name?: string;
  /** 真实类型是 DisposableList<Fiber>（只有迭代器+length），标成 Iterable 防误当下标数组 */
  fibers?: Iterable<FiberLike>;
  callback?: unknown;
}

/** 受保护插件：禁用会破坏内核/兜底，需二次确认（系统级切换仍可卸下/恢复） */
const PROTECTED_PLUGINS = new Set(['core-services', 'fallback-gui']);

const STATE_LABEL: Record<number, string> = {
  0: '等待',
  1: '加载中',
  2: '运行中',
  3: '失败',
  4: '已禁用',
  5: '卸载中',
};

function edgeStatus(stateCode: number): TopologyEdge['status'] {
  if (stateCode === 2) return 'active';
  if (stateCode === 3) return 'failed';
  if (stateCode === 0 || stateCode === 1) return 'pending';
  return 'disabled';
}

export class TopologyService extends Service {
  private cache: Topology | null = null;
  /** 切换主题进行中标记（防连点重入，M4） */
  private switching = false;
  /**
   * 可重载插件模块表：name → 插件模块（index.ts 启动时登记）。
   * Cordis 卸载某个插件的最后一个 fiber 时会从 registry 删除 runtime（lib/index.js:1081），
   * 重挂不能依赖 registry 里的 callback，必须用登记过的模块直接 ctx.plugin(module, config)。
   */
  private modules = new Map<string, ThemePluginModule>();
  /** 各插件最后一次挂载配置（重挂时恢复） */
  private lastConfigs = new Map<string, unknown>();

  constructor(ctx: Context) {
    super(ctx, 'topology');
    // 订阅 fiber 状态变化，失效缓存（增量刷新）。
    // 用 root 订阅：internal/status 从各 fiber 冒泡到 root，挂 root 才能收到全部插件的状态变化
    ctx.root.on('internal/status', () => {
      this.cache = null;
    });
    ctx.root.on('internal/plugin', () => {
      this.cache = null;
      // 插件挂载时抓取 config，供重挂恢复
      this.captureConfigs();
    });
    this.captureConfigs();
  }

  /** 登记可重载插件模块（index.ts bootstrap 时调用；主题 + 全部内置插件） */
  registerPlugin(name: string, module: ThemePluginModule): void {
    this.modules.set(name, module);
  }

  /** 抓取当前 registry 中已挂载插件的 config，补全 lastConfigs */
  private captureConfigs(): void {
    for (const runtime of this.ctx.registry.values() as unknown as RuntimeLike[]) {
      const name = runtime.name;
      if (!name) continue;
      if (this.lastConfigs.has(name)) continue;
      const first = [...(runtime.fibers ?? [])][0] as FiberLike | undefined;
      if (first) this.lastConfigs.set(name, first.config);
    }
  }

  /** 获取拓扑快照（有缓存则直接用） */
  getTopology(): Topology {
    if (this.cache) return this.cache;
    this.cache = this.build();
    return this.cache;
  }

  /** 插件是否受保护（禁用会破坏内核/兜底） */
  isProtected(name: string): boolean {
    return PROTECTED_PLUGINS.has(name);
  }

  /** 按名字查找插件 runtime */
  private findRuntime(name: string): RuntimeLike | undefined {
    for (const runtime of this.ctx.registry.values() as unknown as RuntimeLike[]) {
      if (runtime.name === name) return runtime;
    }
    return undefined;
  }

  /** 系统级卸下插件（不受保护限制，GUI 仲裁用） */
  private async disposePlugin(name: string): Promise<void> {
    const runtime = this.findRuntime(name);
    if (!runtime) return;
    for (const f of [...(runtime.fibers ?? [])]) {
      try {
        await f.dispose?.();
      } catch {
        /* 单个 fiber 清理失败不阻断 */
      }
    }
  }

  /** 重挂插件：优先用登记的模块（保留 runtime 名字），否则用 registry 的 callback 包一层名字 */
  private async mountPlugin(name: string, config: unknown): Promise<void> {
    const module = this.modules.get(name);
    if (module) {
      await this.ctx.plugin(module as never, config as never);
    } else {
      const runtime = this.findRuntime(name);
      const cb = runtime?.callback;
      if (typeof cb !== 'function') {
        throw new Error(`插件 ${name} 无可用回调，无法重挂`);
      }
      // 用 { name, apply } 包一层：直接挂裸 apply 会丢 runtime 名字（变成匿名）
      await this.ctx.plugin({ name, apply: cb as (c: Context, cfg?: unknown) => unknown } as never, config as never);
    }
    this.lastConfigs.set(name, config);
  }

  /** 系统级确保插件在（未激活则用上次配置重载，GUI 仲裁用） */
  private async ensurePlugin(name: string): Promise<void> {
    const runtime = this.findRuntime(name);
    if (runtime && [...(runtime.fibers ?? [])].some((f) => f.state === 2)) return;
    const lastConfig = this.lastConfigs.has(name)
      ? this.lastConfigs.get(name)
      : runtime
        ? [...(runtime.fibers ?? [])][0]?.config
        : undefined;
    try {
      await this.mountPlugin(name, lastConfig);
    } catch (error) {
      logger.error('topology', `${name} 重载失败: ${String(error)}`);
    }
  }

  /**
   * 启用/禁用插件（P1 卡片主开关）。
   * 禁用：dispose 所有 fiber；启用：用登记的模块重挂（registry 的 runtime 在卸载后会
   * 被 Cordis 删除，不能依赖 findRuntime）。DISPOSED fiber 不能 restart，必须重挂。
   */
  async togglePlugin(name: string): Promise<{ ok: boolean; message?: string }> {
    if (PROTECTED_PLUGINS.has(name)) {
      return { ok: false, message: `${name} 是受保护插件，不能禁用` };
    }
    const runtime = this.findRuntime(name);
    const fibers = runtime ? [...(runtime.fibers ?? [])] : [];
    const hasActive = fibers.some((f) => f.state === 2);
    if (hasActive) {
      // 禁用：dispose 所有 fiber
      for (const f of fibers) {
        try {
          await f.dispose?.();
        } catch {
          /* 单个 fiber 清理失败不阻断 */
        }
      }
      // GUI 仲裁安全网：禁用的是当前提供界面的 GUI 主题 → 立刻恢复兜底 GUI，避免白屏
      if (isGuiTheme(name)) {
        await this.ensurePlugin('fallback-gui');
      }
    } else {
      // 启用：重新挂载
      const lastConfig = this.lastConfigs.has(name)
        ? this.lastConfigs.get(name)
        : fibers[0]?.config;
      try {
        await this.mountPlugin(name, lastConfig);
      } catch (error) {
        return { ok: false, message: `启用失败: ${String(error)}` };
      }
    }
    this.cache = null;
    return { ok: true };
  }

  /**
   * 切换 UI 主题（P3 + v0.0.19 GUI 仲裁）：
   * 禁用旧主题 → 启用目标主题 → 按目标是否自带 GUI 决定兜底 GUI 去留 → 持久化。
   * themeName 传 '' 表示恢复默认（无主题插件，兜底 GUI 接管）。
   */
  async switchTheme(themeName: string): Promise<{ ok: boolean; message?: string }> {
    if (this.switching) {
      return { ok: false, message: '主题切换进行中，请稍候' };
    }
    this.switching = true;
    try {
      const topo = this.getTopology();
      // 当前激活的主题（kind=theme 且 stateCode=2）
      const activeThemes = topo.nodes.filter((n) => n.kind === 'theme' && n.stateCode === 2);
      const targetIsGui = isGuiTheme(themeName);

      // 0. GUI 仲裁先行：目标自带 GUI 且尚未激活 → 先卸下兜底 GUI
      //    （兜底 GUI 与 GUI 主题都注册 profile 分节，同 namespace 不能并存）
      if (targetIsGui && !activeThemes.some((t) => t.id === themeName)) {
        await this.disposePlugin('fallback-gui');
      }

      // 1. 禁用旧主题（除目标外）
      for (const t of activeThemes) {
        if (t.id === themeName) continue;
        const r = await this.togglePlugin(t.id);
        if (!r.ok) return r;
      }
      // 2. 启用目标主题（如果存在且未激活）
      if (themeName && !activeThemes.some((t) => t.id === themeName)) {
        const r = await this.togglePlugin(themeName);
        if (!r.ok) {
          // 目标主题加载失败：恢复兜底 GUI，保证有界面
          await this.ensurePlugin('fallback-gui');
          return r;
        }
      }
      // 3. 兜底 GUI 仲裁：目标不提供完整 GUI → 保证兜底 GUI 在
      if (!targetIsGui) {
        await this.ensurePlugin('fallback-gui');
      }
      // 4. 持久化
      this.ctx.config.set('ui', { theme: themeName });
      return { ok: true };
    } finally {
      this.switching = false;
    }
  }

  private build(): Topology {
    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];

    // 核心舱（聚合节点）
    nodes.push({
      id: 'core',
      kind: 'core',
      name: '内核',
      state: '运行中',
      stateCode: 2,
      injectServices: [],
      dockParent: 'core',
    });

    // 插件舱段
    const runtimes = [...(this.ctx.registry.values() as unknown as RuntimeLike[])];
    const runtimeNames = new Set(runtimes.map((r) => r.name).filter(Boolean));
    let anonCounter = 0;
    for (const runtime of runtimes) {
      const name = runtime.name ?? '(匿名)';
      // 匿名插件 id 要唯一，避免 edge 错接（L3）
      const id = runtime.name ?? `(匿名#${++anonCounter})`;
      const fibers = runtime.fibers ?? [];
      // DisposableList 无下标访问，用迭代器取第一个 fiber
      const first = [...fibers][0] as FiberLike | undefined;
      // 无 fiber（未实例化/懒加载）默认"等待"，不误标"已禁用"
      const stateCode = first?.state ?? 0;
      const inject = first?.inject ? Object.keys(first.inject) : [];
      const isTheme = name.startsWith('ui-');
      // 停靠父：依赖里的第一个插件（否则贴靠核心）
      const pluginDeps = inject.filter((s) => runtimeNames.has(s) && s !== id);
      const dockParent = pluginDeps[0] ?? 'core';
      nodes.push({
        id,
        kind: isTheme ? 'theme' : 'module',
        name,
        state: STATE_LABEL[stateCode] ?? '未知',
        stateCode,
        injectServices: inject,
        dockParent,
      });
      // 过桥管线：依赖越过停靠邻接的插件 → 画线（贴靠邻接不画线）
      for (const dep of pluginDeps) {
        if (dep !== dockParent) {
          edges.push({ from: id, to: dep, status: edgeStatus(stateCode) });
        }
      }
    }

    return { nodes, edges };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    topology: TopologyService;
  }
}
