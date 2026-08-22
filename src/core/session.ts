/**
 * 会话状态机（v0.0.65）
 * 基于 RikkaHub 消息树模型（MessageNode 节点链 + 节点内多候选 + selectIndex），纯逻辑无渲染。
 * 分支语义（对齐 RikkaHub ChatService）：
 *   - 发送新消息 = 节点链尾部 append 新节点（单候选）
 *   - regenerate assistant / 编辑 = 目标节点 push 新候选 + selectIndex 指向（旧候选保留可切回）
 *   - 切换分支 = 只改目标节点 selectIndex，后续节点链不动（共享链语义）
 *   - user 消息 regenerate = 截断该节点之后的全部节点，整段重发
 *   - fork = 复制截断后的节点链成新会话（原会话不动，跳转新会话）
 */
import type { ChatMessageContent, ChatMessagePart, Message, MessageNode, Session, UIMessagePart } from './types';

let idCounter = 0;
export function genId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** 创建消息 */
export function createMessage(role: 'user' | 'ai', parts: UIMessagePart[]): Message {
  return { id: genId('msg'), role, parts, createdAt: Date.now() };
}

/** 创建消息节点（会话内一个位置，可含多候选） */
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

/** 创建会话（空节点链） */
export function createSession(title?: string): Session {
  const id = genId('conv');
  return {
    id,
    title: title ?? '新对话',
    nodes: [],
    createdAt: Date.now(),
  };
}

/** 向会话节点链尾部追加一个新节点（单候选），返回该节点内消息。
 *  语义 = RikkaHub sendMessage 的 append 节点，不是往现有节点塞消息。 */
export function appendMessage(session: Session, role: 'user' | 'ai', parts: UIMessagePart[]): Message {
  const msg = createMessage(role, parts);
  const node = createNode(session.id, session.nodes.length, [msg]);
  session.nodes.push(node);
  return msg;
}

/** 当前展示的消息序列 = 每节点取 selectIndex 指向的候选（RikkaHub currentMessages 派生）；空节点（无候选）跳过 */
export function currentMessages(session: Session): Message[] {
  const out: Message[] = [];
  for (const n of session.nodes) {
    if (n.messages.length === 0) continue;
    const idx = n.selectIndex >= 0 && n.selectIndex < n.messages.length ? n.selectIndex : 0;
    out.push(n.messages[idx]);
  }
  return out;
}

/** 找消息所在节点（按消息 id），返回 { node, nodeIndex } 或 null */
export function findNodeByMessage(session: Session, messageId: string): { node: MessageNode; nodeIndex: number } | null {
  for (let i = 0; i < session.nodes.length; i++) {
    if (session.nodes[i].messages.some((m) => m.id === messageId)) {
      return { node: session.nodes[i], nodeIndex: i };
    }
  }
  return null;
}

/** 目标节点 push 新候选 + selectIndex 指向（regenerate assistant / 编辑语义，旧候选保留） */
export function pushCandidate(session: Session, nodeIndex: number, message: Message): void {
  const node = session.nodes[nodeIndex];
  if (!node) return;
  node.messages.push(message);
  node.selectIndex = node.messages.length - 1;
}

/** 切换分支：只改目标节点 selectIndex，后续节点链不动（RikkaHub selectMessageNode） */
export function setSelectIndex(session: Session, nodeIndex: number, selectIndex: number): void {
  const node = session.nodes[nodeIndex];
  if (!node || selectIndex < 0 || selectIndex >= node.messages.length) return;
  node.selectIndex = selectIndex;
}

/** 截断：删除 nodeIndex 之后的所有节点（user regenerate 语义，RikkaHub subList(0, indexAt+1)）。
 *  注意：目标节点本身保留（其候选也保留）。返回被删的节点数。 */
export function truncateAfter(session: Session, nodeIndex: number): number {
  if (nodeIndex < 0 || nodeIndex >= session.nodes.length) return 0;
  const removed = session.nodes.length - nodeIndex - 1;
  session.nodes = session.nodes.slice(0, nodeIndex + 1);
  return removed;
}

/** fork：从 messageId 所在节点截断，复制成新会话（RikkaHub forkConversationAtMessage）。
 *  节点/消息 id 全部重生成，parts 浅拷贝（KIRUSRAFT 图片为 dataURL，无需文件深拷贝）；原会话不动。 */
export function forkSessionAtMessage(session: Session, messageId: string): Session {
  const found = findNodeByMessage(session, messageId);
  if (!found) throw new Error(`分叉位置不存在: ${messageId}`);
  const targetNodeIndex = found.nodeIndex;
  const copiedNodes = session.nodes.slice(0, targetNodeIndex + 1).map((node) => ({
    ...node,
    id: genId('node'),
    conversationId: '', // 新会话 id 生成后回填
    messages: node.messages.map((m) => ({ ...m, id: genId('msg') })),
    selectIndex: node.selectIndex,
  }));
  const newSession = createSession(session.title);
  copiedNodes.forEach((n, i) => {
    n.conversationId = newSession.id;
    n.nodeIndex = i;
  });
  newSession.nodes = copiedNodes;
  newSession.systemPrompt = session.systemPrompt;
  return newSession;
}

/** 拼接对话历史（给 provider 用）：基于当前选中的候选序列。
 *  图片部件映射为 {type:'image', imageUrl}（dataURL），provider 再转各自格式。
 *  v0.0.78：AI 消息的 reasoning 回传（DeepSeek thinking 模式必须带 reasoning_text，否则报错或重复输出）。
 *  maxRounds>0 时按"轮"截断历史：保留最后 maxRounds 条用户消息及其后的全部回复（1 轮=1 条用户消息）。 */
export function toChatMessages(session: Session, maxRounds = 0): { role: string; content: ChatMessageContent }[] {
  let messages = currentMessages(session).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: toChatContent(m.parts, m.role === 'ai' ? m.reasoning : undefined),
  }));
  if (maxRounds > 0) messages = limitRounds(messages, maxRounds);
  return messages;
}

/** UIMessagePart[] → ChatMessageContent（纯文本保持字符串；含图片时用部件数组）。
 *  tool 标注（v0.0.71）不进 AI 上下文——过滤掉（工作思维流仅 UI 展示）。
 *  reasoning（v0.0.78）：DeepSeek thinking 续写必须回传，作为 reasoning part 放在 content 数组首位 */
export function toChatContent(parts: UIMessagePart[], reasoning?: string): ChatMessageContent {
  const nonEmpty = parts.filter((p): p is Exclude<UIMessagePart, { type: 'tool' }> =>
    p.type !== 'tool' && (p.type === 'text' ? p.text.length > 0 : true),
  );
  const base = nonEmpty.map((p): ChatMessagePart =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', imageUrl: p.imageUrl, alt: p.alt },
  );
  if (reasoning && reasoning.length > 0) {
    base.unshift({ type: 'reasoning', text: reasoning });
    return base;
  }
  if (base.every((p) => p.type === 'text')) {
    return base.map((p) => p.text).join('\n');
  }
  return base;
}

/** 按轮数截断（maxRounds<=0 或消息不足时不截断）：锚定最后一条用户消息，往前保留 maxRounds 条用户消息 */
function limitRounds(messages: { role: string; content: ChatMessageContent }[], maxRounds: number): { role: string; content: ChatMessageContent }[] {
  const userIdx: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') userIdx.push(i);
  });
  if (userIdx.length <= maxRounds) return messages;
  return messages.slice(userIdx[userIdx.length - maxRounds]);
}

/** 旧数据迁移：v0.0.64 及之前的 Session.node（单节点平铺整段历史）→ v0.0.65 节点链。
 *  把 node.messages 每条消息拆成独立节点（单候选 selectIndex=0），与 RikkaHub 退化形态天然兼容。幂等。 */
export function migrateLegacySession(session: Session & { node?: MessageNode } | undefined): Session | undefined {
  if (!session) return undefined;
  if (session.nodes) return session as Session;
  if (!session.node || !Array.isArray(session.node.messages)) {
    // 无 node 也无 nodes：重建空链
    (session as Session).nodes = [];
    return session as Session;
  }
  const nodes: MessageNode[] = session.node.messages.map((m, i) => ({
    id: genId('node'),
    conversationId: session.id,
    nodeIndex: i,
    messages: [m],
    selectIndex: 0,
  }));
  const migrated: Session = { ...session, nodes };
  delete (migrated as Session & { node?: MessageNode }).node;
  return migrated;
}
