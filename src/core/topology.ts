/**
 * 内核拓扑服务（v0.0.19）
 * 聚合 Cordis registry + fiber.inject/store，产出"平台中心 + 插件舱段 + 过桥管线"拓扑快照。
 * 空间站语义（v0.0.22 改版，导体模型）：
 *  - 贴靠 = 装载（启用）：卡片拖到中心或其他已装载卡片上 = 装载 + 贴靠它；
 *  - 卡片是导体：中心 + 所有已装载卡片都是导体，沿贴靠链可达中心 = 已装载；
 *  - 禁用 = 与中心无导体链接（拖离），禁用时清除其贴靠关系；
 *  - 贴靠关系由用户拖拽产生并持久化（config.docking），不再由 inject 推断。
 * UI 只消费快照，订阅状态变化失效缓存。
 */
import { Service, Context } from '@deepseek-ai/cordis';
import { logger } from './logger';
import { isGuiTheme } from './gui-registry';
import type { ThemePluginModule } from './gui-registry';
import type { PluginManifest } from './manifest';
import { toCordisPlugin } from './manifest';

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
   * 停靠父节点 id：用户拖拽决定的贴靠目标（'core' 或另一插件）。
   * 持久化在 config.docking，贴靠链可达中心 = 已装载（导体模型）。
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
const PROTECTED_PLUGINS = new Set(['core-services', 'fallback-gui', 'kernel-gui', 'update-checker']);

const STATE_LABEL: Record<number, string> = {
  0: '等待',
  1: '加载中',
  2: '运行中',
  3: '失败',
  4: '已禁用',
  5: '卸载中',
};

export class TopologyService extends Service {
  private cache: Topology | null = null;
  /** 切换主题进行中标记（防连点重入，M4） */
  private switching = false;
  /**
   * 可重载插件模块表：name → 插件模块（index.ts 启动时登记）。
   * Cordis 卸载某个插件的最后一个 fiber 时会从 registry 删除 runtime（lib/index.js:1081），
   * 重挂不能依赖 registry 里的 callback，必须用登记过的模块直接 ctx.plugin(module, config)。
   */
  private modules = new Map<string, PluginManifest>();
  /** 各插件最后一次挂载配置（重挂时恢复） */
  private lastConfigs = new Map<string, unknown>();
  /** 贴靠关系缓存：name → dockParent（'core' 或另一插件 id；持久化在 config.docking） */
  private docking = new Map<string, string>();

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
    // 注意：loadDocking 不在此调用——docking 配置分节在 index.ts 中 CoreServices 之后才注册，
    // 此时 get('docking') 只返回 {}（未注册分节不读 localStorage），启动恢复会丢布局。
    // 改为首次读写贴靠关系时懒加载（见 ensureDockingLoaded）。
  }

  /** 贴靠关系是否已从持久化加载 */
  private dockingLoaded = false;

  /** 首次读写贴靠关系前确保已从 config.docking 加载（懒加载，避开分节注册时序问题，S1） */
  private ensureDockingLoaded(): void {
    if (this.dockingLoaded) return;
    this.dockingLoaded = true;
    try {
      const stored = this.ctx.config.get('docking') as Record<string, string> | undefined;
      if (stored && typeof stored === 'object') {
        this.docking = new Map(Object.entries(stored));
      }
    } catch {
      /* 配置损坏则用默认（全部贴中心） */
    }
  }

  /**
   * 设置插件贴靠目标（拖拽后调用）：写入内存 + 持久化 config.docking。
   * parent 为 'core' 或另一已装载插件 id。
   * 返回 false 表示拒绝（形成环），调用方应保持原贴靠不变。
   */
  setDockParent(name: string, parent: string): boolean {
    this.ensureDockingLoaded();
    if (name === parent) return false;
    // 环检测（M1）：沿 parent 的贴靠链向上回溯，遇到 name 则拒绝（避免 A→B、B→A 环）
    let cur = parent;
    const seen = new Set<string>();
    while (cur !== 'core') {
      if (cur === name) return false;
      if (seen.has(cur)) return false;
      seen.add(cur);
      cur = this.docking.get(cur) ?? 'core';
    }
    this.docking.set(name, parent);
    this.persistDocking();
    this.cache = null;
    return true;
  }

  /** 清除插件贴靠关系（禁用时调用，"禁用即不贴靠"） */
  clearDockParent(name: string): void {
    this.ensureDockingLoaded();
    if (this.docking.delete(name)) {
      this.persistDocking();
      this.cache = null;
    }
  }

  /** 持久化贴靠关系到 config.docking */
  private persistDocking(): void {
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of this.docking) obj[k] = v;
      this.ctx.config.set('docking', obj);
    } catch {
      /* 持久化失败不影响本次会话 */
    }
  }

  /** 获取插件贴靠目标（无记录默认 'core'） */
  getDockParent(name: string): string {
    this.ensureDockingLoaded();
    return this.docking.get(name) ?? 'core';
  }

  /** 登记可重载插件模块（index.ts bootstrap 时调用；主题 + 全部内置插件，存完整 manifest） */
  registerPlugin(name: string, manifest: PluginManifest): void {
    this.modules.set(name, manifest);
  }

  /** 获取插件 manifest（元数据：类型/双语名/分组/描述；UI 渲染插件管理用） */
  getManifest(name: string): PluginManifest | undefined {
    return this.modules.get(name);
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

  /** 重挂插件：优先用登记的 manifest（保留 runtime 名字），否则用 registry 的 callback 包一层名字 */
  private async mountPlugin(name: string, config: unknown): Promise<void> {
    const manifest = this.modules.get(name);
    if (manifest) {
      // toCordisPlugin：激活 inject 依赖门控 / provide 服务声明 / Config 配置校验
      await this.ctx.plugin(toCordisPlugin(manifest) as never, config as never);
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

  /**
   * 插件重挂配置：优先上次挂载配置；缺失给空对象 {}。
   * 本会话从未挂载过的插件（如默认主题下从未出现的 fallback-gui、未点过的主题）
   * 没有 runtime 也没有 lastConfig，传 undefined 会让 apply 读 config.xxx 崩溃
   * （各插件 apply 均用 `?? 默认值` 容错，空对象安全）。
   */
  private effectiveConfig(name: string): unknown {
    const stored = this.lastConfigs.get(name);
    if (stored !== undefined) return stored;
    const runtime = this.findRuntime(name);
    const config = runtime ? [...(runtime.fibers ?? [])][0]?.config : undefined;
    return config ?? {};
  }

  /** 系统级确保插件在（未激活则用上次配置重载，GUI 仲裁用） */
  private async ensurePlugin(name: string): Promise<void> {
    const runtime = this.findRuntime(name);
    if (runtime && [...(runtime.fibers ?? [])].some((f) => f.state === 2)) return;
    await this.mountPlugin(name, this.effectiveConfig(name));
  }

  /**
   * 确保界面存在（崩溃/禁用主题后的白屏保险，公共入口）。
   * 当前没有任何 GUI 提供者（主题/兜底）时挂载应急控制台 fallback-gui；
   * 已存在则 no-op。失败会抛错（调用方决定是否吞），不再静默。
   */
  async ensureGui(): Promise<{ ok: boolean; message?: string }> {
    try {
      const topo = this.getTopology();
      // 界面提供者 = ACTIVE 的主题（kind=theme）或 ACTIVE 的 kernel-gui（管理面板）
      const hasGui = topo.nodes.some(
        (n) => (n.kind === 'theme' || n.id === 'kernel-gui') && n.stateCode === 2 && n.id !== 'fallback-gui',
      );
      const fallbackActive = topo.nodes.some((n) => n.id === 'fallback-gui' && n.stateCode === 2);
      if (hasGui || fallbackActive) return { ok: true };
      await this.ensurePlugin('fallback-gui');
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `应急控制台拉起失败: ${String(error)}` };
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
      let allDisposed = true;
      for (const f of fibers) {
        try {
          await f.dispose?.();
        } catch {
          allDisposed = false; // 单个 fiber 清理失败不阻断，但标记未完全禁用
        }
      }
      // 禁用即不贴靠：全部 fiber 确实 dispose 成功才清贴靠关系（L2：失败时保留，避免状态与运行不一致）
      if (allDisposed) {
        this.clearDockParent(name);
      }
      // GUI 仲裁安全网：禁用的是当前提供界面的 GUI 主题 → 立刻恢复应急控制台，避免白屏。
      // ensureGui 失败会返回 { ok:false }，随 togglePlugin 结果上抛，UI 显示原因（不再静默吞）
      if (isGuiTheme(name)) {
        const r = await this.ensureGui();
        if (!r.ok) {
          return { ok: false, message: `已禁用 ${name}，但${r.message ?? '应急控制台拉起失败'}` };
        }
      }
    } else {
      // 启用：重新挂载（registry 的 runtime 可能已被 Cordis 删除，用登记的模块重挂）
      try {
        await this.mountPlugin(name, this.effectiveConfig(name));
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
          // 目标主题加载失败：恢复应急控制台，保证有界面；不持久化（配置保留旧主题名，下次启动重试旧主题）
          const g = await this.ensureGui();
          if (!g.ok) logger.error('topology', g.message ?? '应急控制台拉起失败');
          logger.warn('topology', `主题 ${themeName} 切换失败，已回退应急控制台，配置保留原主题`);
          return r;
        }
      }
      // 3. 兜底 GUI 仲裁：目标不提供完整 GUI → 保证应急控制台在
      if (!targetIsGui) {
        const g = await this.ensureGui();
        if (!g.ok) logger.error('topology', g.message ?? '应急控制台拉起失败');
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

    // 平台中心（聚合节点）
    nodes.push({
      id: 'core',
      kind: 'core',
      name: '平台',
      state: '运行中',
      stateCode: 2,
      injectServices: [],
      dockParent: 'core',
    });

    // 插件舱段：节点来源 = 登记表 modules（全量，含未运行/已禁用）+ registry 状态合并。
    // 只遍历 registry 会导致"禁用插件从列表消失"（Cordis 卸载最后一个 fiber 会删 runtime）——
    // 用户禁用了却找不到入口重新启用。登记过的插件永远出现在拓扑里，未运行标"已禁用/待命"。
    const runtimes = [...(this.ctx.registry.values() as unknown as RuntimeLike[])];
    const runtimeByName = new Map<string, RuntimeLike>();
    for (const r of runtimes) {
      if (r.name) runtimeByName.set(r.name, r);
    }

    // 1. 登记表全量插件（含未运行的）
    for (const name of this.modules.keys()) {
      const runtime = runtimeByName.get(name);
      const fibers = runtime?.fibers ?? [];
      const first = [...fibers][0] as FiberLike | undefined;
      // 未运行：受保护插件 = 内置待命（等待 0，UI 显示"内置"）；可禁用插件 = 已禁用（4）
      const stateCode = runtime ? (first?.state ?? 0) : PROTECTED_PLUGINS.has(name) ? 0 : 4;
      const inject = first?.inject ? Object.keys(first.inject) : [];
      const manifest = this.modules.get(name);
      const isTheme = manifest?.kind === 'ui-theme' || name.startsWith('ui-');
      const dockParent = this.getDockParent(name);
      nodes.push({
        id: name,
        kind: isTheme ? 'theme' : 'module',
        name,
        state: STATE_LABEL[stateCode] ?? '未知',
        stateCode,
        injectServices: inject,
        dockParent,
      });
    }

    // 2. registry 里存在但未登记（匿名/Cordis 内部）的插件，补上（保持可见性）
    let anonCounter = 0;
    for (const runtime of runtimes) {
      const name = runtime.name ?? `(匿名#${++anonCounter})`;
      if (this.modules.has(name)) continue;
      const fibers = runtime.fibers ?? [];
      const first = [...fibers][0] as FiberLike | undefined;
      const stateCode = first?.state ?? 0;
      const inject = first?.inject ? Object.keys(first.inject) : [];
      const isTheme = name.startsWith('ui-');
      const dockParent = this.getDockParent(name);
      nodes.push({
        id: name,
        kind: isTheme ? 'theme' : 'module',
        name,
        state: STATE_LABEL[stateCode] ?? '未知',
        stateCode,
        injectServices: inject,
        dockParent,
      });
    }

    return { nodes, edges };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    topology: TopologyService;
  }
}
