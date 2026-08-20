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

// 受保护插件判定单一来源：manifest.protected（isProtected），不再维护硬编码名单

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
    // 用 root 订阅：internal/status 从各 fiber 冒泡到 root，挂 root 才能收到全部插件的状态变化。
    // 包 ctx.effect：TopologyService 被系统级卸下/重挂（core-services）时监听器随 fiber 卸载清理，
    // 避免残留持有旧实例（P2-1 监听器泄漏）。
    ctx.effect(() => {
      const offStatus = ctx.root.on('internal/status', () => {
        this.cache = null;
      });
      const offPlugin = ctx.root.on('internal/plugin', () => {
        this.cache = null;
      });
      return () => {
        offStatus();
        offPlugin();
      };
    });
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

  /** 列出全部登记插件 manifest（UI 主题按钮/插件管理读；与 registerPlugin 同源） */
  listManifests(): PluginManifest[] {
    return [...this.modules.values()];
  }

  /**
   * 抓取当前 registry 中已挂载插件的 config，补全 lastConfigs。
   * 注意：internal/plugin 在 Fiber 构造时同步 emit（cordis index.js:1092），此刻 fiber.config 尚未赋值
   * （_reload 里才 set）→ 这里抓到的一直是 undefined，属死逻辑（P2-2）。
   * lastConfigs 实际由 mountPlugin（:251）填充，本方法仅作防御性兜底保留。
   */
  private captureConfigs(): void {
    for (const runtime of this.ctx.registry.values() as unknown as RuntimeLike[]) {
      const name = runtime.name;
      if (!name) continue;
      if (this.lastConfigs.has(name)) continue;
      const first = [...(runtime.fibers ?? [])][0] as FiberLike | undefined;
      if (first?.config) this.lastConfigs.set(name, first.config);
    }
  }

  /** 获取拓扑快照（有缓存则直接用） */
  getTopology(): Topology {
    if (this.cache) return this.cache;
    this.cache = this.build();
    return this.cache;
  }

  /** 插件是否受保护（禁用会破坏内核/兜底）。单一来源：读 manifest.protected，不再维护硬编码名单。 */
  isProtected(name: string): boolean {
    return this.modules.get(name)?.protected ?? false;
  }

  /** 按名字查找插件 runtime */
  private findRuntime(name: string): RuntimeLike | undefined {
    for (const runtime of this.ctx.registry.values() as unknown as RuntimeLike[]) {
      if (runtime.name === name) return runtime;
    }
    return undefined;
  }

  /**
   * 系统级卸下插件（不受保护限制，GUI 仲裁用）。
   * 返回是否全部 fiber 成功 dispose（部分失败返回 false，调用方可据此决定是否清贴靠关系）。
   * togglePlugin 禁用分支复用本方法（P2-3 消除重复实现）。
   */
  private async disposePlugin(name: string): Promise<boolean> {
    const runtime = this.findRuntime(name);
    if (!runtime) return true;
    let allDisposed = true;
    for (const f of [...(runtime.fibers ?? [])]) {
      try {
        await f.dispose?.();
      } catch {
        allDisposed = false; // 单个 fiber 清理失败不阻断，但标记未完全禁用
      }
    }
    return allDisposed;
  }

  /** 重挂插件：优先用登记的 manifest（保留 runtime 名字），否则用 registry 的 callback 包一层名字 */
  private async mountPlugin(name: string, config: unknown): Promise<void> {
    const manifest = this.modules.get(name);
    // 用 root context 挂载：root fiber 永远 active，杜绝 INACTIVE_EFFECT
    // （this.ctx 经 mixin 解析最终也是 root，但显式化消除 fiber 解析歧义）
    const host = this.ctx.root ?? this.ctx;
    logger.info('topology', `mount ${name}: host.fiber=${host.fiber?.name} uid=${host.fiber?.uid} state=${host.fiber?.state}`);
    if (manifest) {
      // toCordisPlugin：激活 inject 依赖门控 / provide 服务声明 / Config 配置校验
      await host.plugin(toCordisPlugin(manifest) as never, config as never);
    } else {
      const runtime = this.findRuntime(name);
      const cb = runtime?.callback;
      if (typeof cb !== 'function') {
        throw new Error(`插件 ${name} 无可用回调，无法重挂`);
      }
      // 用 { name, apply } 包一层：直接挂裸 apply 会丢 runtime 名字（变成匿名）
      await host.plugin({ name, apply: cb as (c: Context, cfg?: unknown) => unknown } as never, config as never);
    }
    this.lastConfigs.set(name, config);
    logger.info('topology', `插件 ${name} 挂载完成`);
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
   * 触发条件（用户语义）：①没有任何 ACTIVE 的主题 GUI（界面没了）②或关键插件 FAILED（影响使用）
   * —— 才拉应急控制台；否则（主题正常挂着）不动作，避免无关错误误切界面。
   * 已存在则 no-op。失败会抛错（调用方决定是否吞），不再静默。
   */
  async ensureGui(): Promise<{ ok: boolean; message?: string }> {
    try {
      // 先失效缓存再取快照：fiber dispose 期间状态未变时 internal/status 事件可能不发
      // （_updateState 提前 return），getTopology 会返回旧快照 → hasGui 误判 → 白屏（缓存竞态）
      this.cache = null;
      const { hasGui, fallbackActive } = this.guiStatus();
      logger.info('topology', `ensureGui 判定: hasGui=${hasGui} fallbackActive=${fallbackActive} 节点=[${this.getTopology().nodes.map((n) => `${n.id}:${n.stateCode}`).join(' ')}]`);
      if (hasGui || fallbackActive) return { ok: true };
      await this.ensurePlugin('fallback-gui');
      logger.info('topology', 'ensureGui: 已拉起应急控制台');
      return { ok: true };
    } catch (error) {
      logger.error('topology', `ensureGui 异常: ${error instanceof Error ? error.stack : String(error)}`);
      return { ok: false, message: `应急控制台拉起失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** 崩溃恢复入口（crashRecovery 调用）：按用户语义判定是否真的需要应急控制台。
   * ① 应急控制台已在 → 不动；② 有 ACTIVE 主题 GUI → 界面正常，不动；
   * ③ 无 ACTIVE 主题（被禁用/崩溃/未选）或关键插件 FAILED → 拉应急控制台。
   * 返回 { ok, message }；ok=false 仅表示拉起失败。
   */
  async ensureGuiIfNeeded(): Promise<{ ok: boolean; message?: string }> {
    try {
      this.cache = null;
      const { hasGui, fallbackActive } = this.guiStatus();
      if (fallbackActive) return { ok: true, message: '应急控制台已运行' };
      if (hasGui) return { ok: true, message: '界面正常，无需切换' };
      // 无 ACTIVE 主题 GUI：界面缺失（禁用/崩溃/未选）或关键插件 FAILED → 进应急控制台
      await this.ensurePlugin('fallback-gui');
      logger.info('topology', 'crashRecovery: 界面缺失，已进入应急控制台');
      return { ok: true, message: '界面缺失，已进入应急控制台' };
    } catch (error) {
      logger.error('topology', `ensureGuiIfNeeded 异常: ${String(error)}`);
      return { ok: false, message: `应急控制台拉起失败: ${String(error)}` };
    }
  }

  /**
   * 界面状态判定（ensureGui / ensureGuiIfNeeded 共用，P2-16 消除分叉）：
   * - hasGui：有 ACTIVE 的 GUI 主题（kind=theme 且运行）。kernel-gui 是管理面板（overlay），
   *   不是主界面（kind='gui'），不会命中；fallback-gui kind='gui' 同样不会命中，无需排除。
   * - fallbackActive：应急控制台是否在运行。
   */
  private guiStatus(): { hasGui: boolean; fallbackActive: boolean } {
    const topo = this.getTopology();
    return {
      hasGui: topo.nodes.some((n) => n.kind === 'theme' && n.stateCode === 2),
      fallbackActive: topo.nodes.some((n) => n.id === 'fallback-gui' && n.stateCode === 2),
    };
  }

  /**
   * 启用/禁用插件（P1 卡片主开关）。
   * 禁用：dispose 所有 fiber；启用：用登记的模块重挂（registry 的 runtime 在卸载后会
   * 被 Cordis 删除，不能依赖 findRuntime）。DISPOSED fiber 不能 restart，必须重挂。
   * @param opts.ensureGuiAfterDisable 禁用 GUI 主题后是否立即拉应急控制台。
   *   默认 true（单点禁用场景防白屏）；switchTheme 里传 false——它有自己的 GUI 仲裁时序
   *   （先卸 fallback → 禁用旧主题 → 挂新主题 → 按目标决定 fallback 去留），
   *   若这里再拉 fallback 会造成与新主题双挂载白屏（P0-1）。
   */
  async togglePlugin(name: string, opts: { ensureGuiAfterDisable?: boolean } = {}): Promise<{ ok: boolean; message?: string }> {
    const { ensureGuiAfterDisable = true } = opts;
    if (this.isProtected(name)) {
      return { ok: false, message: `${name} 是受保护插件，不能禁用` };
    }
    const runtime = this.findRuntime(name);
    const fibers = runtime ? [...(runtime.fibers ?? [])] : [];
    const hasActive = fibers.some((f) => f.state === 2);
    if (hasActive) {
      // 禁用：dispose 所有 fiber（复用 disposePlugin，消除重复实现 P2-3）
      logger.info('topology', `禁用插件 ${name}（fibers=${fibers.length}）`);
      const allDisposed = await this.disposePlugin(name);
      // 禁用即不贴靠：全部 fiber 确实 dispose 成功才清贴靠关系（L2：失败时保留，避免状态与运行不一致）
      if (allDisposed) {
        this.clearDockParent(name);
      }
      // GUI 仲裁安全网：禁用的是当前提供界面的 GUI 主题 → 立刻恢复应急控制台，避免白屏。
      // ensureGui 失败会返回 { ok:false }，随 togglePlugin 结果上抛，UI 显示原因（不再静默吞）
      if (ensureGuiAfterDisable && isGuiTheme(this.ctx, name)) {
        this.cache = null; // 先失效缓存再判定：ensureGui 内部也会清，这里双保险（缓存竞态防御）
        const r = await this.ensureGui();
        if (!r.ok) {
          return { ok: false, message: `已禁用 ${name}，但${r.message ?? '应急控制台拉起失败'}` };
        }
        logger.info('topology', `已禁用主题 ${name}，界面由应急控制台接管`);
      }
    } else {
      // 启用：重新挂载（registry 的 runtime 可能已被 Cordis 删除，用登记的模块重挂）
      logger.info('topology', `启用插件 ${name}`);
      try {
        await this.mountPlugin(name, this.effectiveConfig(name));
      } catch (error) {
        logger.error('topology', `启用插件 ${name} 失败: ${String(error)}`);
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
    logger.info('topology', `switchTheme: 切换到「${themeName || '默认（兜底界面）'}」`);
    try {
      this.cache = null; // 失效缓存：取最新快照（禁用旧主题后的真实状态，避免竞态）
      const topo = this.getTopology();
      // 当前激活的主题（kind=theme 且 stateCode=2）
      const activeThemes = topo.nodes.filter((n) => n.kind === 'theme' && n.stateCode === 2);
      const targetIsGui = isGuiTheme(this.ctx, themeName);

      // 0. GUI 仲裁先行：目标自带 GUI 且尚未激活 → 先卸下兜底 GUI
      //    （兜底 GUI 与 GUI 主题都注册 profile 分节，同 namespace 不能并存）
      if (targetIsGui && !activeThemes.some((t) => t.id === themeName)) {
        await this.disposePlugin('fallback-gui');
      }

      // 1. 禁用旧主题（除目标外）。传 ensureGuiAfterDisable:false：步骤 0 已卸 fallback，
      //    步骤 2/3 会统一仲裁，这里再拉 fallback 会与新主题双挂载 → 白屏（P0-1）
      for (const t of activeThemes) {
        if (t.id === themeName) continue;
        const r = await this.togglePlugin(t.id, { ensureGuiAfterDisable: false });
        if (!r.ok) {
          // 禁用旧主题失败：旧主题可能已被卸、新主题未挂、fallback 未拉 → 白屏无恢复（P0-2）
          const g = await this.ensureGui();
          if (!g.ok) logger.error('topology', g.message ?? '应急控制台拉起失败');
          logger.warn('topology', `禁用旧主题 ${t.id} 失败，已回退应急控制台: ${r.message ?? ''}`);
          return r;
        }
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
      logger.info('topology', `switchTheme: 完成 → 「${themeName || '默认（兜底界面）'}」`);
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
      const stateCode = runtime ? (first?.state ?? 0) : this.modules.get(name)?.protected ? 0 : 4;
      const inject = first?.inject ? Object.keys(first.inject) : [];
      const manifest = this.modules.get(name);
      // 主题判定单一来源：只认 manifest.kind（不再用名字前缀猜）
      const isTheme = manifest?.kind === 'ui-theme';
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
      // 匿名插件无 manifest，kind 无法判定：一律按 module 展示（不猜前缀，P2-4）。
      // 登记过的主题插件走 manifest.kind 单一来源（:478）。
      const dockParent = this.getDockParent(name);
      nodes.push({
        id: name,
        kind: 'module',
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
