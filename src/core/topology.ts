/**
 * 内核拓扑服务（v0.0.11，P0 空间站图数据层）
 * 聚合 Cordis registry + fiber.inject/store，产出"核心舱 + 端口 + 插件舱段 + 供给管线"拓扑快照。
 * UI 只消费快照，订阅状态变化失效缓存（对齐 dsh CordisInventory 的 observable 快照分层）。
 */
import { Service, Context } from '@deepseek-ai/cordis';

export type NodeKind = 'core' | 'module' | 'theme';

export interface TopologyNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** 状态标签（中文） */
  state: string;
  /** 状态码（FiberState 六态） */
  stateCode: number;
  /** 依赖的内核服务名（inject 的服务，用于画供给管线） */
  injectServices: string[];
}

export interface TopologyPort {
  name: string;
  color: string;
}

export interface TopologyEdge {
  fromPort: string;
  toNode: string;
  status: 'active' | 'failed' | 'pending' | 'disabled';
}

export interface Topology {
  nodes: TopologyNode[];
  ports: TopologyPort[];
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
  fibers?: FiberLike[];
  callback?: unknown;
}

/** 受保护插件：禁用会破坏内核/兜底，需二次确认 */
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

const PORTS: TopologyPort[] = [
  { name: 'tools', color: '#4f6ef7' },
  { name: 'providers', color: '#1a9e6b' },
  { name: 'config', color: '#9c6ade' },
  { name: 'storage', color: '#e8912d' },
];

export class TopologyService extends Service {
  private cache: Topology | null = null;

  constructor(ctx: Context) {
    super(ctx, 'topology');
    // 订阅 fiber 状态变化，失效缓存（增量刷新）。
    // 用 root 订阅：internal/status 从各 fiber 冒泡到 root，挂 root 才能收到全部插件的状态变化
    ctx.root.on('internal/status', () => {
      this.cache = null;
    });
    ctx.root.on('internal/plugin', () => {
      this.cache = null;
    });
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

  /**
   * 启用/禁用插件（P1 卡片主开关）。
   * 禁用：dispose 所有 fiber；启用：重新 ctx.plugin(callback, lastConfig)。
   * DISPOSED fiber 不能 restart，必须用 callback + config 重载。
   */
  async togglePlugin(name: string): Promise<{ ok: boolean; message?: string }> {
    if (PROTECTED_PLUGINS.has(name)) {
      return { ok: false, message: `${name} 是受保护插件，不能禁用` };
    }
    const runtime = this.findRuntime(name);
    if (!runtime) {
      return { ok: false, message: `插件 ${name} 未找到` };
    }
    const fibers = [...(runtime.fibers ?? [])];
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
    } else {
      // 启用：重新挂载
      const cb = runtime.callback;
      if (typeof cb !== 'function') {
        return { ok: false, message: `${name} 无可用回调，无法启用` };
      }
      const lastConfig = fibers[0]?.config;
      try {
        // 动态重载：callback 和 config 类型无法静态推导，用 never 断言绕过泛型
        await this.ctx.plugin(cb as never, lastConfig as never);
      } catch (error) {
        return { ok: false, message: `启用失败: ${String(error)}` };
      }
    }
    this.cache = null;
    return { ok: true };
  }

  private build(): Topology {
    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];

    // 核心舱（聚合节点）
    nodes.push({ id: 'core', kind: 'core', name: '内核', state: '运行中', stateCode: 2, injectServices: [] });

    // 插件舱段
    const runtimes = [...(this.ctx.registry.values() as unknown as RuntimeLike[])];
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
      nodes.push({
        id,
        kind: isTheme ? 'theme' : 'module',
        name,
        state: STATE_LABEL[stateCode] ?? '未知',
        stateCode,
        injectServices: inject,
      });
      // 供给管线：核心舱端口 → 插件舱段（仅 4 个内核服务）
      for (const svc of inject) {
        if (PORTS.some((p) => p.name === svc)) {
          edges.push({ fromPort: svc, toNode: id, status: edgeStatus(stateCode) });
        }
      }
    }

    return { nodes, ports: PORTS, edges };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    topology: TopologyService;
  }
}
