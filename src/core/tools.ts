/**
 * 工具注册表服务（v0.0.1）
 * 内核抽象层：Tool 六字段契约的注册/查找/执行调度。
 * 工具插件 inject: ['tools'] 后调用 ctx.tools.register(tool)。
 */
import { Service, Context } from '@deepseek-ai/cordis';
import type { Tool, UIMessagePart } from './types';

export class ToolsService extends Service {
  private tools = new Map<string, Tool>();

  constructor(ctx: Context) {
    super(ctx, 'tools');
  }

  /**
   * 注册工具，返回 disposer。
   * 必须传调用方插件自己的 ctx：effect 绑定到调用方 fiber，插件卸载时自动反注册。
   * （不能用 this.ctx——那会绑到 core-services 的 fiber，插件卸载时工具永久残留）
   */
  register(ctx: Context, tool: Tool): () => void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册`);
    }
    this.tools.set(tool.name, tool);
    const dispose = ctx.effect(() => () => {
      this.tools.delete(tool.name);
    });
    return () => void dispose();
  }

  /** 列出全部工具 */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** 按名称查找 */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 模型可见的工具声明（Responses function 工具格式） */
  declarations(): { type: string; name: string; description: string; parameters: unknown }[] {
    return this.list().map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    }));
  }

  /** 执行工具，返回消息部件 */
  async execute(name: string, args: Record<string, unknown>): Promise<UIMessagePart[]> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`工具 "${name}" 未注册`);
    return tool.execute(args);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: ToolsService;
  }
}
