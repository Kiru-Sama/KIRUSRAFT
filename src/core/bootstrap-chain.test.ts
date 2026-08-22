/**
 * 挂载链复现测试（v0.0.96 诊断）
 * 复现 APK 环境"workplace_create 未注册"问题：
 * 按 bootstrap 顺序挂载 core-services → sandbox-proot，检查 workspace_create 是否注册。
 */
import { Context, type Plugin } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';

// Node 环境无 DOM：stub 全局再动态 import（logger/storage 用 window/localStorage）
vi.stubGlobal('window', {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
} as unknown as Window & typeof globalThis);
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { toCordisPlugin } = await import('./manifest');
const CoreServices = await import('../plugins/core-services');
const SandboxProot = await import('../plugins/sandbox-proot');
const ProviderDeepseek = await import('../plugins/provider-deepseek');
const ToolTime = await import('../plugins/tool-time');
const UpdateChecker = await import('../plugins/update-checker');

// 模拟最小 DOM/Capacitor 环境（sandbox-proot 用到 document 的地方有限；StorageService 用不到 IndexedDB 则降级内存）
// 不模拟全局，直接跑：ToolsService/StorageService 构造不需要 DOM。

describe('bootstrap 挂载链：sandbox-proot 工具注册', () => {
  it('core-services 挂载后 sandbox-proot 的 workspace_create 已注册且可执行', async () => {
    const ctx = new Context();

    // 第 1 步：core-services（注册 tools/storage/providers 等）
    await ctx.plugin(toCordisPlugin(CoreServices.manifest) as Plugin.Object);
    const coreFiber = (ctx as never as { fiber: { store: Record<string, unknown> } }).fiber;
    // 确认 tools/storage 服务已提供
    expect(coreFiber.store).toBeDefined();

    // 第 6 步：挂载 sandbox-proot
    await ctx.plugin(toCordisPlugin(SandboxProot.manifest) as Plugin.Object);

    // workspace_create 应已注册
    const tools = ctx.tools as { list: () => { name: string }[] };
    const names = tools.list().map((t) => t.name);
    expect(names).toContain('workspace_create');

    // 执行创建（Node 环境无 Capacitor → 非原生 → 模拟或正常走 localStorage/IndexedDB 降级）
    const parts = await ctx.tools.execute('workspace_create', { name: 'test' });
    expect(parts).toBeDefined();
    expect(parts.length).toBeGreaterThan(0);

    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });

  it('按 index.ts 顺序挂载全部插件，workspace_create 仍注册（定位"前面插件卡住"假设）', async () => {
    const ctx = new Context();
    await ctx.plugin(toCordisPlugin(CoreServices.manifest) as Plugin.Object);
    // 依次挂载 provider-deepseek → tool-time → sandbox-proot → update-checker
    // 用 Promise.race + 短超时探测是否卡住（PENDING inject 会挂起 await）
    const mounted: string[] = [];
    const order = [
      ['provider-deepseek', ProviderDeepseek.manifest],
      ['tool-time', ToolTime.manifest],
      ['sandbox-proot', SandboxProot.manifest],
      ['update-checker', UpdateChecker.manifest],
    ] as const;
    for (const [pn, pm] of order) {
      const start = Date.now();
      await Promise.race([
        ctx.plugin(toCordisPlugin(pm) as Plugin.Object).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(() => resolve(), 2000)),
      ]);
      mounted.push(`${pn}:${Date.now() - start}ms`);
    }
    const tools = ctx.tools as { list: () => { name: string }[] };
    const names = tools.list().map((t) => t.name);
    expect(names).toContain('workspace_create');
    expect(mounted.join(', ')).toContain('provider-deepseek');
    expect(mounted.join(', ')).toContain('tool-time');
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });
});