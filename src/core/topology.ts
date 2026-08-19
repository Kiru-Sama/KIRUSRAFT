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
}

interface RuntimeLike {
  name?: string;
  fibers?: FiberLike[];
}

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
    // 订阅 fiber 状态变化，失效缓存（增量刷新）
    ctx.on('internal/status', () => {
      this.cache = null;
    });
    ctx.on('internal/plugin', () => {
      this.cache = null;
    });
  }

  /** 获取拓扑快照（有缓存则直接用） */
  getTopology(): Topology {
    if (this.cache) return this.cache;
    this.cache = this.build();
    return this.cache;
  }

  private build(): Topology {
    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];

    // 核心舱（聚合节点）
    nodes.push({ id: 'core', kind: 'core', name: '内核', state: '运行中', stateCode: 2, injectServices: [] });

    // 插件舱段
    const runtimes = [...(this.ctx.registry.values() as unknown as RuntimeLike[])];
    for (const runtime of runtimes) {
      const name = runtime.name ?? '(匿名)';
      const fibers = runtime.fibers ?? [];
      const first = fibers[0];
      const stateCode = first?.state ?? 4;
      const inject = first?.inject ? Object.keys(first.inject) : [];
      const isTheme = name.startsWith('ui-');
      nodes.push({
        id: name,
        kind: isTheme ? 'theme' : 'module',
        name,
        state: STATE_LABEL[stateCode] ?? '未知',
        stateCode,
        injectServices: inject,
      });
      // 供给管线：核心舱端口 → 插件舱段（仅 4 个内核服务）
      for (const svc of inject) {
        if (PORTS.some((p) => p.name === svc)) {
          edges.push({ fromPort: svc, toNode: name, status: edgeStatus(stateCode) });
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
