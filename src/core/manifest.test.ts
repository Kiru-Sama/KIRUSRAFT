/**
 * manifest 统一插槽测试（v0.0.27）
 * 锁住两个新机制：toCordisPlugin 字段提取（inject 门控/provide/Config 不丢）、defineSchema 同步校验。
 */
import { describe, expect, it } from 'vitest';
import { toCordisPlugin } from './manifest';
import { defineSchema } from './schema';

describe('manifest 统一插槽', () => {
  const fake = {
    name: 'test-plugin',
    kind: 'tool' as const,
    label: { zh: '测试插件', en: 'Test Plugin' },
    group: '工具' as const,
    inject: ['tools'],
    provide: 'update',
    apply: () => undefined,
  };

  it('toCordisPlugin 提取 Cordis 认识的字段（inject/provide/apply 不丢）', () => {
    const p = toCordisPlugin(fake);
    expect(p.name).toBe('test-plugin');
    expect(p.inject).toEqual(['tools']);
    expect(p.provide).toBe('update');
    expect(p.apply).toBe(fake.apply);
    // 自定义元数据不外泄到 Cordis 插件对象
    expect('kind' in p).toBe(false);
    expect('label' in p).toBe(false);
    expect('group' in p).toBe(false);
  });

  it('defineSchema 同步校验：合法值返回归一结果', async () => {
    const schema = defineSchema<{ enabled: boolean }>((v) => {
      const raw = (v ?? {}) as { enabled?: boolean };
      if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
      return { enabled: raw.enabled ?? true };
    });
    expect(await schema['~standard'].validate({ enabled: true })).toEqual({ value: { enabled: true } });
    // 缺省补默认值
    expect(await schema['~standard'].validate(undefined)).toEqual({ value: { enabled: true } });
  });

  it('defineSchema 同步校验：非法值返回 issues 而非抛异常', async () => {
    const schema = defineSchema<{ enabled: boolean }>((v) => {
      const raw = (v ?? {}) as { enabled?: boolean };
      if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
      return { enabled: raw.enabled ?? true };
    });
    const bad = await schema['~standard'].validate({ enabled: 'yes' });
    expect(bad.issues?.length).toBeGreaterThan(0);
    expect(bad.issues?.[0].message).toContain('enabled');
  });
});
