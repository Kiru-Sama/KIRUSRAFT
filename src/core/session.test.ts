import { describe, it, expect } from 'vitest';
import {
  createSession,
  createNode,
  appendMessage,
  currentMessages,
  findNodeByMessage,
  pushCandidate,
  setSelectIndex,
  truncateAfter,
  forkSessionAtMessage,
  migrateLegacySession,
  toChatMessages,
  toChatContent,
  genId,
} from './session';
import type { Session, UIMessagePart } from './types';

function chatSession(): Session {
  const s = createSession();
  appendMessage(s, 'user', [{ type: 'text', text: '你好' }]);
  appendMessage(s, 'ai', [{ type: 'text', text: '你好呀' }]);
  return s;
}

describe('session 节点链会话状态机（v0.0.65 RikkaHub 消息树）', () => {
  it('createSession 创建唯一会话，nodes 为空链', () => {
    const s1 = createSession();
    const s2 = createSession();
    expect(s1.id).not.toBe(s2.id);
    expect(s1.title).toBe('新对话');
    expect(s1.nodes).toHaveLength(0);
  });

  it('appendMessage 追加节点（每条消息一个节点，单候选）', () => {
    const s = chatSession();
    expect(s.nodes).toHaveLength(2);
    expect(s.nodes[0].messages).toHaveLength(1);
    expect(s.nodes[0].selectIndex).toBe(0);
    expect(s.nodes[1].messages[0].role).toBe('ai');
    // currentMessages 派生当前展示序列
    expect(currentMessages(s)).toHaveLength(2);
    expect(currentMessages(s)[0].parts).toEqual([{ type: 'text', text: '你好' }]);
  });

  it('createNode 显式参数', () => {
    const node = createNode('conv-1', 3, [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x' }], createdAt: 0 }]);
    expect(node.conversationId).toBe('conv-1');
    expect(node.nodeIndex).toBe(3);
    expect(node.selectIndex).toBe(0);
  });

  it('pushCandidate 目标节点 push 新候选 + selectIndex 指向（旧候选保留）', () => {
    const s = chatSession();
    pushCandidate(s, 1, { id: 'ai2', role: 'ai', parts: [{ type: 'text', text: '第二版' }], createdAt: 1 });
    expect(s.nodes[1].messages).toHaveLength(2);
    expect(s.nodes[1].selectIndex).toBe(1);
    expect(currentMessages(s)[1].id).toBe('ai2');
  });

  it('setSelectIndex 切换分支只改目标节点（共享链语义：后续节点不动）', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: '问' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '答A' }]);
    appendMessage(s, 'user', [{ type: 'text', text: '追问' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '答B' }]);
    // 给节点 1（答A）加候选 答A2
    pushCandidate(s, 1, { id: 'a2', role: 'ai', parts: [{ type: 'text', text: '答A2' }], createdAt: 2 });
    setSelectIndex(s, 1, 0); // 切回答A
    expect(currentMessages(s).map((m) => m.parts[0])).toEqual([
      { type: 'text', text: '问' },
      { type: 'text', text: '答A' },
      { type: 'text', text: '追问' },
      { type: 'text', text: '答B' }, // 后续节点不动
    ]);
    // 越界 selectIndex 忽略
    setSelectIndex(s, 1, 99);
    expect(s.nodes[1].selectIndex).toBe(0);
  });

  it('truncateAfter 删除 nodeIndex 之后所有节点（目标节点保留）', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: 'u1' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: 'a1' }]);
    appendMessage(s, 'user', [{ type: 'text', text: 'u2' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: 'a2' }]);
    const removed = truncateAfter(s, 1); // 保留 u1/a1，删 u2/a2
    expect(removed).toBe(2);
    expect(s.nodes).toHaveLength(2);
    expect(currentMessages(s).map((m) => m.parts[0])).toEqual([
      { type: 'text', text: 'u1' },
      { type: 'text', text: 'a1' },
    ]);
    // 越界不删
    expect(truncateAfter(s, 99)).toBe(0);
    expect(truncateAfter(s, -1)).toBe(0);
  });

  it('forkSessionAtMessage 复制截断节点链成新会话（原会话不动，id 重生成）', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: 'u1' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: 'a1' }]);
    appendMessage(s, 'user', [{ type: 'text', text: 'u2' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: 'a2' }]);
    const targetMsgId = s.nodes[1].messages[0].id; // a1 处 fork
    const forked = forkSessionAtMessage(s, targetMsgId);
    expect(forked.id).not.toBe(s.id);
    expect(forked.nodes).toHaveLength(2); // 只到 a1
    expect(forked.nodes[0].id).not.toBe(s.nodes[0].id); // id 重生成
    expect(forked.nodes[1].messages[0].id).not.toBe(targetMsgId);
    expect(forked.nodes[1].messages[0].parts).toEqual([{ type: 'text', text: 'a1' }]);
    // 原会话不动
    expect(s.nodes).toHaveLength(4);
    // fork 消息不存在抛错
    expect(() => forkSessionAtMessage(s, 'no-such-id')).toThrow();
  });

  it('migrateLegacySession 把旧单节点平铺会话迁移为节点链（幂等）', () => {
    const legacy = {
      id: 'c1',
      title: '旧会话',
      createdAt: 0,
      node: {
        id: 'n1',
        conversationId: 'c1',
        nodeIndex: 0,
        messages: [
          { id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: '旧问' }], createdAt: 0 },
          { id: 'm2', role: 'ai' as const, parts: [{ type: 'text' as const, text: '旧答' }], createdAt: 1 },
        ],
        selectIndex: 1,
      },
    };
    const migrated = migrateLegacySession(legacy as unknown as Session);
    expect(migrated.nodes).toHaveLength(2);
    expect(migrated.nodes[0].messages[0].id).toBe('m1');
    expect(migrated.nodes[1].messages[0].id).toBe('m2');
    expect(migrated.nodes[0].selectIndex).toBe(0);
    expect((migrated as Session & { node?: unknown }).node).toBeUndefined();
    // 幂等：再迁移一次不破坏
    const again = migrateLegacySession(migrated);
    expect(again.nodes).toHaveLength(2);
  });

  it('findNodeByMessage 定位消息所在节点', () => {
    const s = chatSession();
    const found = findNodeByMessage(s, s.nodes[1].messages[0].id);
    expect(found?.nodeIndex).toBe(1);
    expect(found?.node.messages[0].role).toBe('ai');
    expect(findNodeByMessage(s, 'nope')).toBeNull();
  });

  it('toChatMessages 转换角色与内容（基于选中候选）', () => {
    const s = chatSession();
    const msgs = toChatMessages(s);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'user', content: '你好' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: '你好呀' });
  });

  it('toChatMessages 图片部件映射为部件数组（多模态）', () => {
    const s = createSession();
    appendMessage(s, 'user', [
      { type: 'text', text: '看图' },
      { type: 'image', imageUrl: 'data:image/jpeg;base64,AAA=', alt: '图1' },
    ]);
    const msgs = toChatMessages(s);
    expect(msgs[0].content).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', imageUrl: 'data:image/jpeg;base64,AAA=', alt: '图1' },
    ]);
  });

  it('toChatMessages 工具标注 part 不进 AI 上下文（v0.0.71 工作思维流）', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: '搜热点' }]);
    appendMessage(s, 'ai', [
      { type: 'text', text: '好的我来搜索' },
      { type: 'tool', name: 'search_web', args: '{"q":"热点"}', done: true },
      { type: 'text', text: '这是结果' },
    ]);
    const msgs = toChatMessages(s);
    // AI 消息 content = 纯文本（tool 标注被过滤），且文本顺序保留
    expect(msgs[1].content).toBe('好的我来搜索\n这是结果');
  });

  it('toChatContent 合并 text parts 时保留全部文本（续写不丢内容基础，v0.0.77）', () => {
    // 模拟中止时 AI 消息：首 part 是 tool（工具调用先发生），后有 text —— 续写需合并全部 text
    const parts: UIMessagePart[] = [
      { type: 'tool', name: 'search_web', args: '{}', done: true },
      { type: 'text', text: '搜索到结果一' },
      { type: 'tool', name: 'get_time', done: false },
      { type: 'text', text: '时间信息' },
    ];
    expect(toChatContent(parts)).toBe('搜索到结果一\n时间信息');
  });

  it('toChatMessages maxRounds 按轮截断历史', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: '第一问' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '第一答' }]);
    appendMessage(s, 'user', [{ type: 'text', text: '第二问' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '第二答' }]);
    appendMessage(s, 'user', [{ type: 'text', text: '第三问' }]);
    appendMessage(s, 'ai', [{ type: 'text', text: '第三答' }]);
    expect(toChatMessages(s, 2).map((m) => m.content)).toEqual(['第二问', '第二答', '第三问', '第三答']);
    expect(toChatMessages(s, 0)).toHaveLength(6);
    expect(toChatMessages(s, 99)).toHaveLength(6);
  });

  it('currentMessages 空节点跳过（不返回 undefined）', () => {
    const s = createSession();
    appendMessage(s, 'user', [{ type: 'text', text: 'u1' }]);
    // 手动插一个空节点（模拟损坏/异常数据）
    s.nodes.splice(1, 0, createNode(s.id, 1, []));
    appendMessage(s, 'ai', [{ type: 'text', text: 'a1' }]);
    const msgs = currentMessages(s);
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m && m.parts)).toBe(true);
  });

  it('genId 生成不重复 id', () => {
    const ids = new Set(Array.from({ length: 100 }, () => genId('t')));
    expect(ids.size).toBe(100);
  });
});
