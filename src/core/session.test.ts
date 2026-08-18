import { describe, it, expect } from 'vitest';
import { createSession, createNode, appendMessage, forkAt, toChatMessages, genId } from './session';

describe('session 会话状态机', () => {
  it('createSession 创建唯一会话，node 关联会话 id', () => {
    const s1 = createSession();
    const s2 = createSession();
    expect(s1.id).not.toBe(s2.id);
    expect(s1.title).toBe('新对话');
    expect(s1.node.conversationId).toBe(s1.id);
    expect(s1.node.nodeIndex).toBe(0);
    expect(s1.node.messages).toHaveLength(0);
    expect(s1.node.selectIndex).toBe(0);
  });

  it('appendMessage 追加消息并更新 selectIndex', () => {
    const s = createSession();
    const m1 = appendMessage(s, 'user', [{ type: 'text', text: '你好' }]);
    expect(s.node.messages).toHaveLength(1);
    expect(s.node.selectIndex).toBe(0);
    expect(m1.id).toBeTruthy();

    const m2 = appendMessage(s, 'ai', [{ type: 'text', text: '你好呀' }]);
    expect(s.node.messages).toHaveLength(2);
    expect(s.node.selectIndex).toBe(1);
    expect(s.node.messages[1].id).toBe(m2.id);
  });

  it('forkAt 越界抛错', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: 'a' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: 'b' }]);
    expect(() => forkAt(s, -1)).toThrow();
    expect(() => forkAt(s, 2)).toThrow();
    expect(() => forkAt(s, 99)).toThrow();
  });

  it('forkAt 正常分叉截断消息', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: '第一轮' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '回答1' }]);
    appendMessage(s, 'user', [{ type: 'text', text: '第二轮' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '回答2' }]);

    const newNode = forkAt(s, 1); // 从第 1 条（ai 回答1）处分叉
    expect(newNode.messages).toHaveLength(2);
    expect(newNode.conversationId).toBe(s.id);
    expect(s.node.id).toBe(newNode.id);
  });

  it('toChatMessages 转换角色与内容', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: '问题' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '答案' }]);
    const msgs = toChatMessages(s.node);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'user', content: '问题' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: '答案' });
  });

  it('createNode 显式参数', () => {
    const node = createNode('conv-1', 3, [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x' }], createdAt: 0 }]);
    expect(node.conversationId).toBe('conv-1');
    expect(node.nodeIndex).toBe(3);
    expect(node.selectIndex).toBe(0);
  });

  it('genId 生成不重复 id', () => {
    const ids = new Set(Array.from({ length: 100 }, () => genId('t')));
    expect(ids.size).toBe(100);
  });
});
