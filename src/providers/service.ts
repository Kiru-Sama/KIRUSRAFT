/**
 * 服务商 provider 注册表（v0.0.1）
 * 内核抽象层：provider 插件 inject: ['providers'] 后 ctx.providers.register(provider)。
 */
import { Service, Context } from '@deepseek-ai/cordis';
import type { ChatProvider } from './types';

export class ProviderService extends Service {
  private providers = new Map<string, ChatProvider>();

  constructor(ctx: Context) {
    super(ctx, 'providers');
  }

  /**
   * 注册 provider，返回 disposer。
   * 必须传调用方插件自己的 ctx（effect 绑定调用方 fiber，插件卸载时自动反注册）
   */
  register(ctx: Context, provider: ChatProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`provider "${provider.id}" 已注册`);
    }
    this.providers.set(provider.id, provider);
    const dispose = ctx.effect(() => () => {
      this.providers.delete(provider.id);
    });
    return () => void dispose();
  }

  get(id: string): ChatProvider | undefined {
    return this.providers.get(id);
  }

  list(): ChatProvider[] {
    return [...this.providers.values()];
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    providers: ProviderService;
  }
}
