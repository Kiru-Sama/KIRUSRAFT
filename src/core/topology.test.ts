/**
 * topology 插件列表完整性测试（v0.0.29）
 * 锁住"禁用插件不消失"bug：节点来源 = 登记表全量 + registry 状态合并，
 * 禁用（registry 删 runtime）后插件仍出现在 getTopology 里且标"已禁用"。
 */
import { Context, type Plugin } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';

// topology → logger（单例构造访问 window）。vitest 是 node 环境无 window，
// 必须在 import topology 前 stub 最小 window（顶层同步 stub，早于动态 import）
vi.stubGlobal('window', {
  addEventListener: () => undefined,
} as unknown as Window & typeof globalThis);

const { TopologyService } = await import('./topology');
import type { PluginManifest } from './manifest';

function fakeManifest(name: string, opts: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name,
    kind: 'tool',
    label: { zh: name, en: name },
    group: '工具',
    apply: () => undefined,
    ...opts,
  };
}

describe('topology 插件列表完整性', () => {
  it('登记过的插件即使未挂载也出现在拓扑里（禁用不消失）', async () => {
    const ctx = new Context();
    new TopologyService(ctx);
    const svc = ctx.topology;

    // 登记两个插件（模拟 index.ts 启动登记）
    svc.registerPlugin('alpha', fakeManifest('alpha'));
    svc.registerPlugin('beta', fakeManifest('beta'));

    // 未挂载任何 fiber：拓扑里仍应有这两个（标"已禁用"4 / 待命）
    let topo = svc.getTopology();
    const names = topo.nodes.map((n) => n.id);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    const alpha = topo.nodes.find((n) => n.id === 'alpha')!;
    // 未运行 + 非受保护 = 已禁用
    expect(alpha.stateCode).toBe(4);
    expect(alpha.state).toBe('已禁用');

    // 挂载 alpha → 状态变 ACTIVE(2)
    const alphaPlugin: Plugin.Object = { name: 'alpha', apply: () => undefined };
    await ctx.plugin(alphaPlugin);
    topo = svc.getTopology();
    expect(topo.nodes.find((n) => n.id === 'alpha')!.stateCode).toBe(2);

    // 卸载 alpha（模拟禁用：registry 删 runtime）→ 仍在列表且回"已禁用"
    const runtime = [...ctx.registry.values()].find((r: unknown) => (r as { name?: string }).name === 'alpha') as unknown as {
      fibers?: Iterable<{ dispose(): Promise<void> }>;
    };
    if (runtime?.fibers) {
      for (const f of [...runtime.fibers]) await f.dispose();
    }
    topo = svc.getTopology();
    const after = topo.nodes.find((n) => n.id === 'alpha')!;
    expect(after.stateCode).toBe(4);
    expect(after.state).toBe('已禁用');

    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });

  it('受保护插件未挂载时标"等待"而非"已禁用"（内置待命语义）', () => {
    const ctx = new Context();
    new TopologyService(ctx);
    const svc = ctx.topology;
    // core-services 是受保护插件且未挂载（本测试没跑 bootstrap）
    svc.registerPlugin('core-services', fakeManifest('core-services', { kind: 'core', protected: true }));
    const topo = svc.getTopology();
    const node = topo.nodes.find((n) => n.id === 'core-services')!;
    expect(node.stateCode).toBe(0);
    expect(node.state).toBe('等待');
  });
});

describe('ensureGuiIfNeeded 崩溃恢复判定', () => {
  it('无 ACTIVE 主题 GUI 时拉应急控制台（禁用主题后崩溃）', async () => {
    const ctx = new Context();
    new TopologyService(ctx);
    const svc = ctx.topology;
    // 只登记主题（未挂载 = 无 ACTIVE 主题 GUI）
    svc.registerPlugin('ui-exdark', fakeManifest('ui-exdark', { kind: 'ui-theme', providesGui: true }));
    svc.registerPlugin('fallback-gui', fakeManifest('fallback-gui', { kind: 'gui', protected: true }));
    const r = await svc.ensureGuiIfNeeded();
    expect(r.ok).toBe(true);
    // fallback-gui 应被拉起（stateCode=2）
    const topo = svc.getTopology();
    const fb = topo.nodes.find((n) => n.id === 'fallback-gui')!;
    expect(fb.stateCode).toBe(2);
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });

  it('有 ACTIVE 主题 GUI 时不拉应急控制台（主题正常，无关错误不切界面）', async () => {
    const ctx = new Context();
    new TopologyService(ctx);
    const svc = ctx.topology;
    svc.registerPlugin('ui-exdark', fakeManifest('ui-exdark', { kind: 'ui-theme', providesGui: true }));
    svc.registerPlugin('fallback-gui', fakeManifest('fallback-gui', { kind: 'gui', protected: true }));
    // 挂载主题 → ACTIVE
    const themePlugin: Plugin.Object = { name: 'ui-exdark', apply: () => undefined };
    await ctx.plugin(themePlugin);
    const r = await svc.ensureGuiIfNeeded();
    expect(r.ok).toBe(true);
    expect(r.message).toContain('无需切换');
    // fallback-gui 不应被拉起
    const topo = svc.getTopology();
    expect(topo.nodes.find((n) => n.id === 'fallback-gui')!.stateCode).not.toBe(2);
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });

  it('禁用当前主题后应急控制台被拉起（缓存竞态修复：togglePlugin→ensureGui 路径）', async () => {
    const ctx = new Context();
    new TopologyService(ctx);
    const svc = ctx.topology;
    svc.registerPlugin('ui-exdark', fakeManifest('ui-exdark', { kind: 'ui-theme', providesGui: true }));
    svc.registerPlugin('fallback-gui', fakeManifest('fallback-gui', { kind: 'gui', protected: true }));
    // 挂载主题 → ACTIVE，且生成过拓扑缓存（竞态前提：旧快照可能残留）
    await ctx.plugin({ name: 'ui-exdark', apply: () => undefined } as Plugin.Object);
    expect(svc.getTopology().nodes.find((n) => n.id === 'ui-exdark')!.stateCode).toBe(2);
    // 禁用主题：togglePlugin 内必须先失效缓存再 ensureGui，否则读到旧快照 hasGui=true → 白屏
    const r = await svc.togglePlugin('ui-exdark');
    expect(r.ok).toBe(true);
    const topo = svc.getTopology();
    expect(topo.nodes.find((n) => n.id === 'ui-exdark')!.stateCode).toBe(4);
    expect(topo.nodes.find((n) => n.id === 'fallback-gui')!.stateCode).toBe(2);
    await (ctx as never as { fiber: { dispose(): Promise<void> } }).fiber.dispose();
  });
});
