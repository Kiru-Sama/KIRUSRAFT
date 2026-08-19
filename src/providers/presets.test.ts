/**
 * 服务商预设表测试（v0.0.31）
 * 锁住数据质量：id 唯一、密钥购买链接非空、baseURL 是合法 https、分组正确、kind 合法。
 */
import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, getPreset } from './presets';

describe('服务商预设表', () => {
  it('id 全局唯一（provider 注册依赖）', () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个预设都有密钥购买链接（用户要求贴心附上；custom 自定义中转除外）', () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.id === 'custom') continue; // 自定义中转模板：用户自己填，无固定链接
      expect(p.keyUrl, `${p.id} 缺 keyUrl`).toBeTruthy();
      expect(p.keyUrl.startsWith('https://'), `${p.id} 的 keyUrl 非 https`).toBe(true);
    }
  });

  it('baseURL 是合法 https 且不含 /chat/completions 尾巴', () => {
    for (const p of PROVIDER_PRESETS) {
      const url = new URL(p.baseURL); // 非法会抛
      expect(url.protocol, `${p.id} 协议`).toBe('https:');
      expect(p.baseURL.endsWith('/chat/completions'), `${p.id} 应只填 baseURL`).toBe(false);
    }
  });

  it('kind 合法且分组正确', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(['openai', 'anthropic', 'deepseek-responses']).toContain(p.kind);
      expect(['official', 'relay']).toContain(p.group);
    }
    // 官方与中转都有
    expect(PROVIDER_PRESETS.filter((p) => p.group === 'official').length).toBeGreaterThan(5);
    expect(PROVIDER_PRESETS.filter((p) => p.group === 'relay').length).toBeGreaterThan(0);
  });

  it('getPreset 按 id 查到且 deepseek 预设存在', () => {
    const d = getPreset('deepseek');
    expect(d).toBeDefined();
    expect(d!.kind).toBe('deepseek-responses');
    expect(getPreset('not-exist')).toBeUndefined();
  });
});
