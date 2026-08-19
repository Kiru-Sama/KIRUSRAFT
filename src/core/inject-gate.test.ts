/**
 * Cordis inject 依赖门控集成测试（v0.0.27）
 * 验证 toCordisPlugin 激活 inject 后：依赖未就绪插件保持 PENDING（apply 不执行、bootstrap 不卡死），
 * 服务注册后自动 ACTIVE。这是"插件依赖门控"承诺的真实运行时验证。
 */
import { Context, Service, type Plugin } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

describe('Cordis inject 依赖门控（真实运行时）', () => {
  it('依赖未就绪保持 PENDING 不卡死，服务出现后自动 ACTIVE', async () => {
    const ctx = new Context();
    let ran = false;
    let ranOrder: string[] = [];

    // 先挂 consumer（依赖 demo-service，此时未注册）——await 不卡死（返回 PENDING fiber）
    const consumer: Plugin.Object = {
      name: 'consumer',
      inject: ['demo-service'],
      apply: () => {
        ran = true;
        ranOrder.push('consumer');
      },
    };
    const p = ctx.plugin(consumer);
    await Promise.resolve();
    expect(ran).toBe(false); // PENDING：apply 未执行

    // 再挂 provider：注册 demo-service
    class DemoService extends Service {
      constructor(c: Context) {
        super(c, 'demo-service');
      }
    }
    const provider: Plugin.Object = {
      name: 'provider',
      apply: (c: Context) => {
        new DemoService(c);
        ranOrder.push('provider');
      },
    };
    await ctx.plugin(provider);
    // provider 先跑，consumer 被 notify 唤醒后跑
    await p;
    expect(ran).toBe(true);
    expect(ranOrder).toEqual(['provider', 'consumer']);

    // 清理：root fiber dispose（Context 无 dispose 方法）
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });
});
