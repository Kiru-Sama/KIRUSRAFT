/**
 * 对话文本长度统计测试（v0.0.41）
 * 锁住：countContextChars 只算 text 部件（不含图片/文件），MAX_CONTEXT_CHARS=100000。
 */
import { describe, expect, it, vi } from 'vitest';

// chat-controller → logger（单例构造访问 window）。node 环境无 window，先 stub 再动态 import
vi.stubGlobal('window', {
  addEventListener: () => undefined,
} as unknown as Window & typeof globalThis);
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { countContextChars, MAX_CONTEXT_CHARS } = await import('./chat-controller');
import type { Session } from './types';

function fakeSession(messages: { role: 'user' | 'ai'; parts: { type: 'text' | 'image'; text?: string; imageUrl?: string }[] }[]): Session {
  return {
    id: 's1',
    title: '测试',
    createdAt: 0,
    nodes: messages.map((m, i) => ({
      id: `n${i}`,
      conversationId: 's1',
      nodeIndex: i,
      messages: [
        {
          id: `m${i}`,
          role: m.role,
          parts: m.parts.map((p) =>
            p.type === 'text'
              ? { type: 'text' as const, text: p.text ?? '' }
              : { type: 'image' as const, imageUrl: p.imageUrl ?? '', alt: '' },
          ),
          createdAt: 0,
        },
      ],
      selectIndex: 0,
    })),
  };
}

describe('对话文本长度统计', () => {
  it('只算 text 部件，image（图片/文件）不计入', () => {
    const session = fakeSession([
      { role: 'user', parts: [{ type: 'text', text: '你好' }, { type: 'image', imageUrl: 'data:...' }] },
      { role: 'ai', parts: [{ type: 'text', text: '世界很大' }] },
    ]);
    expect(countContextChars(session)).toBe(6); // 你好(2) + 世界很大(4) = 6；image 不计
  });

  it('上限为 100000', () => {
    expect(MAX_CONTEXT_CHARS).toBe(100000);
  });

  it('空会话返回 0', () => {
    expect(countContextChars(fakeSession([]))).toBe(0);
  });
});
