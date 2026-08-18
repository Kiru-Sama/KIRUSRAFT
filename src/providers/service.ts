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

  register(provider: ChatProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`provider "${provider.id}" 已注册`);
    }
    this.providers.set(provider.id, provider);
    const dispose = this.ctx.effect(() => () => {
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
