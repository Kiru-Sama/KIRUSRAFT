/**
 * 插件挂载 config 健壮性测试（v0.0.35 验证）
 * 锁住：Cordis 不传 config / 传 undefined 时，apply 默认参数兜底不崩。
 * 这是"fallback-gui 重载失败: reading 'root'"类错误（旧版 config undefined 直读）的回归防护。
 */
import { Context, type Plugin } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

describe('插件挂载 config 健壮性', () => {
  it('不传 config：apply 默认参数兜底为空对象，不崩', async () => {
    const ctx = new Context();
    let got: unknown = 'unset';
    const plugin: Plugin.Object = {
      name: 'test-no-config',
      // 与 fallback-gui / theme-exdark 相同的签名：config 默认 {}
      apply: (_c: Context, config: Record<string, unknown> = {}) => {
        got = config;
        // 模拟 fallback-gui 的 config.root 读取（旧版此处崩）
        void (config.root as HTMLElement | undefined);
        // 模拟 theme-exdark 的 config.enabled 读取（旧版此处崩）
        void (config.enabled as boolean | undefined);
      },
    };
    await ctx.plugin(plugin); // 不传第二个参数 = undefined
    expect(got).toEqual({});
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });

  it('显式传 undefined：同样兜底，不崩', async () => {
    const ctx = new Context();
    let got: unknown = 'unset';
    const plugin: Plugin.Object = {
      name: 'test-undef-config',
      apply: (_c: Context, config: Record<string, unknown> = {}) => {
        got = config;
        void (config.root as HTMLElement | undefined);
        void (config.enabled as boolean | undefined);
      },
    };
    await ctx.plugin(plugin, undefined);
    expect(got).toEqual({});
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });

  it('configSchema 归一：theme-exdark 挂载时 config 被校验归一（enabled 默认 true）', async () => {
    const ctx = new Context();
    let got: unknown = 'unset';
    const schemaPlugin: Plugin.Object = {
      name: 'test-schema',
      Config: {
        '~standard': {
          version: 1,
          vendor: 'kirusraft-test',
          validate: (value: unknown) => {
            const raw = (typeof value === 'object' && value !== null ? value : {}) as { enabled?: boolean };
            return { value: { enabled: raw.enabled ?? true } };
          },
        },
      },
      apply: (_c: Context, config: Record<string, unknown> = {}) => {
        got = config;
      },
    };
    await ctx.plugin(schemaPlugin, undefined);
    expect(got).toEqual({ enabled: true });
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });
});
