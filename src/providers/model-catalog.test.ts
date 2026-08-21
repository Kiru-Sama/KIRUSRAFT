import { describe, it, expect } from 'vitest';
import { resolveModelCapabilities, supportsImage } from './model-catalog';

describe('model-catalog', () => {
  it('deepseek-v4-flash-vision-exp 支持图片 + 推理', () => {
    expect(supportsImage('deepseek-v4-flash-vision-exp')).toBe(true);
    const cap = resolveModelCapabilities('deepseek-v4-flash-vision-exp');
    expect(cap.input).toContain('image');
    expect(cap.abilities).toContain('reasoning');
  });

  it('deepseek-v4-flash（无 vision 后缀）纯文本', () => {
    expect(supportsImage('deepseek-v4-flash')).toBe(false);
  });

  it('deepseek-chat 纯文本', () => {
    expect(supportsImage('deepseek-chat')).toBe(false);
    expect(resolveModelCapabilities('deepseek-chat').abilities).toContain('tool');
  });

  it('未知名回退纯文本', () => {
    expect(supportsImage('some-unknown-model')).toBe(false);
    expect(resolveModelCapabilities('some-unknown-model').input).toEqual(['text']);
  });

  it('gpt-5 支持图片 + 推理', () => {
    const cap = resolveModelCapabilities('gpt-5');
    expect(cap.input).toContain('image');
    expect(cap.abilities).toContain('reasoning');
  });

  it('名称含 vision 的模型兜底支持图片', () => {
    expect(supportsImage('llava-vision')).toBe(true);
  });
});
