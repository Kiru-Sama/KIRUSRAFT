/**
 * 会话状态机（v0.0.1）
 * 基于 RikkaHub MessageNodeDto 的消息节点模型，纯逻辑无渲染。
 */
import type { Message, MessageNode, Session, UIMessagePart } from './types';

let idCounter = 0;
export function genId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** 创建消息 */
export function createMessage(role: 'user' | 'ai', parts: UIMessagePart[]): Message {
  return { id: genId('msg'), role, parts, createdAt: Date.now() };
}

/** 创建消息节点 */
export function createNode(conversationId: string, nodeIndex: number, initial?: Message[]): MessageNode {
  const messages = initial ?? [];
  return {
    id: genId('node'),
    conversationId,
    nodeIndex,
    messages,
    selectIndex: messages.length > 0 ? messages.length - 1 : 0,
  };
}

/** 创建会话 */
export function createSession(title?: string): Session {
  const id = genId('conv');
  return {
    id,
    title: title ?? '新对话',
    node: createNode(id, 0),
    createdAt: Date.now(),
  };
}

/** 向当前节点追加消息 */
export function appendMessage(session: Session, role: 'user' | 'ai', parts: UIMessagePart[]): Message {
  const msg = createMessage(role, parts);
  session.node.messages.push(msg);
  session.node.selectIndex = session.node.messages.length - 1;
  return msg;
}

/** 分叉：从指定消息处创建新分支（简化版：单节点替换，多节点链后续扩展） */
export function forkAt(session: Session, messageIndex: number): MessageNode {
  if (messageIndex < 0 || messageIndex >= session.node.messages.length) {
    throw new Error(`分叉位置越界: ${messageIndex}（消息数 ${session.node.messages.length}）`);
  }
  const slice = session.node.messages.slice(0, messageIndex + 1);
  const newNode = createNode(
    session.id,
    session.node.nodeIndex,
    slice.map((m) => ({ ...m, id: genId('msg') })),
  );
  session.node = newNode;
  return newNode;
}

/** 拼接对话历史（给 provider 用）：返回 {role, content} 数组 */
export function toChatMessages(node: MessageNode): { role: string; content: string }[] {
  return node.messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.parts.map((p) => (p.type === 'text' ? p.text : `[图片: ${p.alt ?? p.imageUrl}]`)).join('\n'),
  }));
}
