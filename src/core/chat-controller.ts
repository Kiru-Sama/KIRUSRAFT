/**
 * 聊天控制器（v0.0.20）
 * 兜底 GUI 与主题 GUI 共用的聊天状态机：会话加载/切换、流式发送/中止、IndexedDB 落盘。
 * GUI 只提供元素引用与消息渲染回调，流式/事件/落盘逻辑全部收敛在这里（效果不变、实现复用）。
 * v0.0.20 增量（向后兼容，不破坏 ChatElements 既有契约）：
 *   - renderMessage 增加可选第三参 message（GUI 可拿 createdAt/id 渲染元信息）
 *   - 流式写入优先落在气泡内的 [data-msg-content] 容器（GUI 可保留 meta 区），无容器时回退整气泡 textContent
 *   - 新增可选 onStreamEnd 回调：每次流结束（成功/错误/中止/兜底）后触发一次，GUI 可做 Markdown 收尾渲染
 *   - ChatController 新增 renameSession（改标题落盘）与 regenerate（截断重发）
 */
import { Context } from '@deepseek-ai/cordis';
import { runAgentLoop, type ToolExecutor } from './agent-loop';
import { appendMessage, createMessage, createSession, currentMessages, findNodeByMessage, forkSessionAtMessage, pushCandidate, setSelectIndex, toChatMessages, truncateAfter } from './session';
import { logger } from './logger';
import type { Session, Message, MessageNode, SessionStats, UIMessagePart, ProviderProfile } from './types';

export interface ChatElements {
  /** 消息列表容器 */
  messages: HTMLElement;
  /** 输入框（input 或 textarea 均可） */
  input: HTMLInputElement | HTMLTextAreaElement;
  /** 发送按钮（发送时隐藏，结束恢复） */
  send: HTMLButtonElement;
  /** 中止按钮（发送时显示） */
  stop: HTMLButtonElement;
  /** 状态栏（思考中/生成中/错误提示） */
  status: HTMLElement;
  /** 联网搜索开关（可选） */
  webSearch?: HTMLInputElement;
  /** 渲染一条消息气泡（GUI 自定义样式），返回的元素会被追加到消息列表；message 为完整消息时传第三参 */
  renderMessage: (role: 'user' | 'ai', parts: UIMessagePart[], message?: Message) => HTMLElement;
  /** 缺 API Key / 服务商未注册时打开设置（可选） */
  onRequireSettings?: () => void;
  /** 会话变化回调（启动加载/切换/删除后触发，GUI 用来刷新侧边栏高亮） */
  onSessionChange?: (id: string) => void;
  /** 流结束回调（成功/错误/中止后触发一次；GUI 可用于 Markdown 全量渲染等收尾） */
  onStreamEnd?: () => void;
  /** 发送真正放行回调（校验通过、开始流式时触发一次；GUI 用于清空待发送附件——校验失败时不清空，附件保留可重发） */
  onSendAccepted?: () => void;
  /** 对话超长拦截（超 100k 时触发）：GUI 弹右上角确认；点确定时调用传入的 confirm 回调放行发送。返回 void */
  onLengthWarn?: (count: number, confirm: () => void) => void;
}

export interface ChatController {
  /** 发送输入框内容（发送/Enter 入口） */
  send(): void;
  /** 发送输入框文本 + 附件部件（图片等；文本可为空串=纯图片）。
   *  附件与文本合并为一条用户消息，随会话落盘（历史回显渲染 img）；校验失败不清空（GUI 侧保留可重发） */
  sendWithAttachments(attachments: UIMessagePart[]): void;
  /** 设置当前对话级系统提示词（覆盖全局；留空=用全局） */
  setConversationSystemPrompt(prompt: string): void;
  /** 读取当前对话级系统提示词（设置页回填用） */
  getConversationSystemPrompt(): string;
  /** 中止当前流 */
  stop(): void;
  /** 切换会话（中止旧流、落盘、渲染目标会话） */
  switchSession(id: string): Promise<void>;
  /** 当前会话 id（侧边栏高亮用） */
  getSessionId(): string;
  /** 修改当前会话标题并落盘 */
  renameSession(title: string): void;
  /** 重新生成：截断到最后一条用户消息，用其内容重新发送 */
  regenerate(): void;
  /** 按消息 id 重新生成（RikkaHub 语义：user 截断重发 / assistant push 新候选共享链） */
  regenerateAt(messageId: string): void;
  /** 编辑用户消息：push 新候选（新文本）+ 截断该节点后续 + 重新生成回复（APITOOL 编辑重发语义） */
  editUserMessage(messageId: string, newText: string): void;
  /** 就地编辑 AI 回复：改选中候选文本 + 标 editedByUser（不重发）；"已修改"标记不进 AI 上下文 */
  editAiMessage(messageId: string, newText: string): void;
  /** 切换分支候选（只改目标节点 selectIndex，后续链不动） */
  selectCandidate(nodeId: string, selectIndex: number): void;
  /** 从消息处 fork 新会话（复制截断节点链，原会话不动，切换过去） */
  forkAt(messageId: string): void;
  /** 节点链分支快照（GUI 渲染 ←→ 计数器 / 轻量总览用） */
  getBranchSnapshot(): { nodeId: string; nodeIndex: number; candidateCount: number; selectIndex: number; messageId: string; role: 'user' | 'ai' }[];
  /** 当前会话用量统计（计费卡渲染用） */
  getStats(): SessionStats;
  /** 卸载：中止流并落盘（GUI effect 清理时调用） */
  dispose(): void;
}

/** 对话文本总长上限：超过时发送前提醒（APITOOL 同款逻辑，只算文本消息，不含图片/文件） */
export const MAX_CONTEXT_CHARS = 100000;

/**
 * Agent 配置分节结构（index.ts 注册，namespace 'agent'）。
 * mode: 'agent'(默认) 代理模式=按工具管理开关发选中工具；'chat' 对话模式=一刀切不带任何工具。
 * enabledTools: 工具名→是否启用，缺省(无该键)=开，显式 false=停用；空 {} = 全开。
 */
export interface AgentConfig {
  mode: 'agent' | 'chat';
  enabledTools: Record<string, boolean>;
}

/**
 * 对话参数配置分节结构（index.ts 注册，namespace 'chat'，v0.0.64）。
 * systemPrompt: 全局系统提示词（被会话级 systemPrompt 覆盖）；temperature: 采样温度（0~2）；
 * maxRounds: 上下文轮数限制（0=不限）；thinkLevel: 思考强度档位（0=不思考 1=自动 2~5=低/中/高/最大）。
 * 参考 RikkaHub Assistant（systemPrompt/temperature/contextMessageLimit/reasoningLevel 同源）。
 */
export interface ChatConfig {
  systemPrompt?: string;
  temperature?: number;
  maxRounds?: number;
  thinkLevel?: number;
  /** 单价（USD/百万 token，计费估算用；不填=不折算金额，只统计 token） */
  priceInput?: number;
  priceOutput?: number;
}

/**
 * 按 Agent 模式 + 工具启用集合过滤 ctx.tools 的工具执行器。
 * 关键点：runAgentLoop 通过 executor.declarations() 把工具声明发给模型，所以过滤必须在
 * 执行器层完成（对话模式返回空声明 = 不带工具）。web_search 是服务端工具，走
 * request.tools 独立控制（联网搜索开关），不经过这里。
 */
function buildAgentToolExecutor(ctx: Context, cfg: AgentConfig): ToolExecutor {
  const enabledTools = cfg?.enabledTools ?? {};
  // 模式判定统一：非 'chat' 即代理（与 UI 高亮一致，避免配置异常时界面显示代理实际无工具）
  const tools =
    cfg?.mode !== 'chat'
      ? ctx.tools.list().filter((t) => enabledTools[t.name] !== false)
      : [];
  return {
    declarations: () =>
      tools.map((t) => ({
        type: 'function' as const,
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: 'object' as const, properties: {} },
      })),
    execute: (name, args) => ctx.tools.execute(name, args),
  };
}

/** 统计会话对话文本总字符数（只算当前选中候选的 text 部件，image 部件不计——文件不塞进对话） */
export function countContextChars(session: Session): number {
  let total = 0;
  for (const m of currentMessages(session)) {
    for (const part of m.parts ?? []) {
      if (part.type === 'text') total += part.text.length;
    }
  }
  return total;
}

/** 按 chat 分节单价（USD/百万 token）估算一次请求费用；无单价返回 0 */
export function estimateCost(inputTokens: number, outputTokens: number, cfg: ChatConfig): number {
  const pi = Number(cfg.priceInput ?? 0);
  const po = Number(cfg.priceOutput ?? 0);
  if (pi <= 0 && po <= 0) return 0;
  return (inputTokens / 1e6) * pi + (outputTokens / 1e6) * po;
}

export function createChatController(ctx: Context, els: ChatElements): ChatController {
  let session: Session = createSession();
  let loaded = false;
  let abortCtrl: AbortController | null = null;
  let streaming = false;
  let disposed = false;
  /** 流令牌：中止/切换后旧流 finally 不得复位共享 UI 状态（M1 竞态修复） */
  let streamToken = 0;
  /** 切换序号：latest-wins，过期切换结果丢弃（M3） */
  let switchSeq = 0;
  /** 已确认超长继续发送（用户点提醒的确定后置真；发送成功后复位） */
  let lengthConfirmed = false;

  /** 切换会话进行中标记：await 读 IDB 期间拒绝发送，避免用户消息写进旧会话（P2-8） */
  let switchingSession = false;

  /** 保存会话（串行队列：上一次保存完成后再保存下一次，避免并发 put 旧数据覆盖新数据 P2-19）。
   *  成功静默（高频调用不刷日志）；失败 error 记录。首次保存打一条 info 确认持久化链路通。 */
  let saveQueue: Promise<void> = Promise.resolve();
  let firstSaveLogged = false;
  function saveSessionSafe(): void {
    saveQueue = saveQueue
      .then(() => {
        if (!firstSaveLogged) {
          firstSaveLogged = true;
          logger.info('storage', `会话持久化链路就绪（${session.id}）`);
        }
        return ctx.storage.saveConversation(session);
      })
      .catch((error) => {
        logger.error('storage', `保存会话失败: ${String(error)}`);
      });
  }

  /** 累计一次请求的 usage 到会话统计（v0.0.65 计费卡数据源） */
  function accumulateUsage(inputTokens: number, outputTokens: number): void {
    const chatCfg = (ctx.config.get('chat') ?? {}) as unknown as ChatConfig;
    const s = session.stats ?? { requestCount: 0, totalTokens: 0, lastInputTokens: 0, lastOutputTokens: 0, totalCost: 0 };
    s.requestCount++;
    s.totalTokens += inputTokens + outputTokens;
    s.lastInputTokens = inputTokens;
    s.lastOutputTokens = outputTokens;
    s.totalCost += estimateCost(inputTokens, outputTokens, chatCfg);
    session.stats = s;
    saveSessionSafe();
  }

  /** 当前会话用量统计（GUI 计费卡渲染用） */
  function getStats(): SessionStats {
    return session.stats ?? { requestCount: 0, totalTokens: 0, lastInputTokens: 0, lastOutputTokens: 0, totalCost: 0 };
  }

  /**
   * 流式写入气泡内容：优先写气泡内的 [data-msg-content] 容器（GUI 气泡可保留 meta 区不被覆盖），
   * 无容器时整体回退 textContent（兼容纯文本气泡渲染器，如兜底 GUI）。
   */
  function setMessageContent(bubble: HTMLElement, text: string): void {
    const target = bubble.querySelector('[data-msg-content]') as HTMLElement | null;
    if (target) {
      target.textContent = text;
    } else {
      bubble.textContent = text;
    }
  }

  function renderCurrent(): void {
    els.messages.innerHTML = '';
    for (const m of currentMessages(session)) {
      els.messages.appendChild(els.renderMessage(m.role, m.parts, m));
    }
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  /** 节点链数据快照（GUI 渲染分支选择器/总览用）：每节点 id、候选数、当前选中、选中消息 id */
  function getBranchSnapshot(): { nodeId: string; nodeIndex: number; candidateCount: number; selectIndex: number; messageId: string; role: 'user' | 'ai' }[] {
    return session.nodes.map((n, i) => {
      const idx = n.selectIndex >= 0 && n.selectIndex < n.messages.length ? n.selectIndex : 0;
      const m = n.messages[idx];
      return {
        nodeId: n.id,
        nodeIndex: i,
        candidateCount: n.messages.length,
        selectIndex: idx,
        messageId: m?.id ?? '',
        role: m?.role ?? 'user',
      };
    });
  }

  async function switchSession(id: string): Promise<void> {
    if (disposed) return;
    const seq = ++switchSeq;
    switchingSession = true; // P2-8：await 窗口内拒绝发送，避免写进旧会话
    // 中止进行中的流并立即落盘旧会话，避免切换后 AI 回复串写到新会话
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
      streaming = false;
      streamToken++;
      els.send.style.display = '';
      els.stop.style.display = 'none';
      els.status.textContent = ''; // P3：切换会话中止旧流后复位状态栏，避免残留"生成中"
      saveSessionSafe();
    }
    try {
      const loadedConv = await ctx.storage.getConversation(id);
      // await 期间可能又发起了新的切换：过期的结果丢弃（latest-wins）
      if (seq !== switchSeq || disposed) return;
      if (!loadedConv || !Array.isArray(loadedConv.nodes)) {
        logger.error('storage', `切换会话失败（数据损坏）: ${id}`);
        return;
      }
      session = loadedConv;
      renderCurrent();
      els.onSessionChange?.(session.id);
      logger.info('gui', `已切换到会话 ${id}（${session.nodes.length} 条消息）`);
    } catch (error) {
      logger.error('storage', `切换会话失败: ${String(error)}`);
    } finally {
      switchingSession = false;
    }
  }

  // 启动：加载最近会话（IndexedDB 持久化，关 App 不丢）
  void (async () => {
    try {
      const list = await ctx.storage.listConversations();
      const latest = list[0];
      if (latest && Array.isArray(latest.nodes)) {
        session = latest;
        renderCurrent();
        els.onSessionChange?.(session.id);
        logger.info('gui', `已加载最近会话（${session.nodes.length} 条消息）`);
      } else if (latest) {
        logger.warn('storage', '会话数据损坏，已重建');
        session = createSession();
        await ctx.storage.saveConversation(session);
      } else {
        await ctx.storage.saveConversation(session);
        logger.info('gui', '新建会话已落盘');
      }
    } catch (error) {
      logger.error('storage', `加载会话失败: ${String(error)}`);
    } finally {
      loaded = true;
    }
  })();

  // 跨插件事件：主题 GUI 侧边栏切换会话（session-switch 事件）
  ctx.on('session-switch', (id: unknown) => {
    void switchSession(String(id));
  });
  ctx.on('session-deleted', (id: unknown) => {
    if (disposed || session.id !== String(id)) return;
    // 中止进行中的流，避免删除后旧回复串写
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
      streaming = false;
      streamToken++;
    }
    session = createSession();
    els.messages.innerHTML = '';
    void ctx.storage.saveConversation(session);
    els.onSessionChange?.(session.id);
    logger.info('gui', '当前会话已删除，已新建会话');
  });

  /** 发送前置校验：返回可发送的部件（空数组=不可发，原因已写入状态栏）。regenerate 截断前必须先过此关（P1-1：避免校验失败时数据已删） */
  function validateParts(parts: UIMessagePart[]): boolean {
    if (!validateStream()) return false;
    // 有文本（非空白）或图片部件即可发送（图片=纯图片消息）
    const hasContent = parts.some((p) => p.type === 'image' || (p.type === 'text' && p.text.trim().length > 0));
    return hasContent;
  }

  /** 流式校验（不含内容检查）：重发/回复流不追加用户输入，只查状态/配置/长度。P1-1 同源 */
  function validateStream(): boolean {
    if (disposed || streaming || switchingSession) {
      // P2-8：切换会话进行中拒绝发送（避免写进旧会话）
      if (switchingSession) els.status.textContent = '正在切换会话...';
      return false;
    }
    if (!loaded) {
      els.status.textContent = '正在加载会话...';
      return false;
    }
    const currentProfile = ctx.config.get('profile') as unknown as ProviderProfile;
    if (!currentProfile.apiKey) {
      els.status.textContent = '请先在设置中填写 API Key';
      logger.warn('gui', '发送被拒绝：未配置 API Key');
      els.onRequireSettings?.();
      return false;
    }
    const provider = ctx.providers.get(currentProfile.id);
    if (!provider) {
      els.status.textContent = `错误: 服务商 "${currentProfile.id}" 未注册`;
      logger.error('gui', `服务商 "${currentProfile.id}" 未注册`);
      els.onRequireSettings?.();
      return false;
    }
    // 对话文本总长检查（不含图片/文件）：超 100k 拦截，弹右上角确认；点确定后重发
    const totalChars = countContextChars(session);
    if (totalChars > MAX_CONTEXT_CHARS && !lengthConfirmed) {
      els.status.textContent = `内容过长：约 ${totalChars.toLocaleString()} 字符（上限 100,000）`;
      logger.warn('gui', `发送被拦截：上下文超长（${totalChars} 字符），等待确认`);
      return false;
    }
    return true;
  }

  /** 发送一段部件（send 读输入框构造 text part，regenerate 复用历史消息 parts）；clearInput 控制是否清空输入框 */
  async function sendText(parts: UIMessagePart[], clearInput = true): Promise<void> {
    if (!validateParts(parts)) {
      // 若因超长被拦截（且未确认过），弹右上角确认；点确定置标记后重发
      const totalChars = countContextChars(session);
      if (totalChars > MAX_CONTEXT_CHARS && !lengthConfirmed) {
        els.onLengthWarn?.(totalChars, () => {
          lengthConfirmed = true;
          void sendText(parts, clearInput);
        });
      } else {
        // 失败原因不是超长（apiKey/服务商/加载态/切换中）：复位确认标记，
        // 避免点确定后重发又失败，导致下次超长永久放行（P2-7）
        lengthConfirmed = false;
      }
      return;
    }
    // 真正开始发送：复位超长确认标记（下次超长需重新确认）
    lengthConfirmed = false;

    streaming = true;
    const token = ++streamToken;
    // 校验已全部通过、开始流式：通知 GUI 清空待发送附件（失败路径不会到这里，附件保留可重发）
    els.onSendAccepted?.();
    // 本次请求 usage 累加（计费统计；claude 的 input/output 分两次回调，合并）
    let reqInput = 0;
    let reqOutput = 0;
    try {
      const textPreview = parts.map((p) => (p.type === 'text' ? p.text : '[图片]')).join(' ').slice(0, 60);
      logger.info('gui', `发送消息(${els.webSearch?.checked ? '联网' : '普通'}): ${textPreview}`);
      appendMessage(session, 'user', parts); // 追加 user 节点（单候选）
      els.messages.appendChild(els.renderMessage('user', parts));
      saveSessionSafe();
      if (clearInput) els.input.value = '';
      els.messages.scrollTop = els.messages.scrollHeight;

      const aiParts: UIMessagePart[] = [{ type: 'text', text: '' }];
      // 不提前 append AI 节点：避免请求体末尾出现空 content 的 assistant 占位消息（L-1）
      // 且空气泡不会落盘（N-8）。首个文本增量到达时才写入 session。
      let aiAppended = false;
      const aiBubble = els.renderMessage('ai', aiParts);
      els.messages.appendChild(aiBubble);
      els.messages.scrollTop = els.messages.scrollHeight;

      abortCtrl = new AbortController();
      els.send.style.display = 'none';
      els.stop.style.display = '';
      els.status.textContent = '思考中...';

      // validateSend 已校验通过，这里重新读取（config 可能已变，闭包里的旧引用会失效）
      const currentProfile = ctx.config.get('profile') as unknown as ProviderProfile;
      const provider = ctx.providers.get(currentProfile.id)!;
      // Agent 模式 + 工具管理：按 config.agent 组装 function 工具集（对话模式=不带工具；
      // 代理模式=过滤掉工具管理里显式停用的；web_search 独立走 request.tools，不受工具管理管）
      const agentCfg = (ctx.config.get('agent') ?? {}) as unknown as AgentConfig;
      // 对话参数（v0.0.64）：温度/全局系统提示词/上下文轮数/思考强度，全部可空则省略（参考 RikkaHub TextGenerationParams 可空设计）
      const chatCfg = (ctx.config.get('chat') ?? {}) as unknown as ChatConfig;
      const effectiveSystemPrompt = (session.systemPrompt ?? '').trim() || (chatCfg.systemPrompt ?? '').trim();

      await runAgentLoop(
        {
          provider,
          request: {
            model: currentProfile.model,
            apiKey: currentProfile.apiKey,
            baseURL: currentProfile.baseURL,
            protocol: (currentProfile as { protocol?: 'responses' | 'chat' }).protocol ?? 'responses',
            messages: toChatMessages(session, chatCfg.maxRounds ?? 0),
            maxTokens: 4096,
            temperature: chatCfg.temperature,
            systemPrompt: effectiveSystemPrompt || undefined,
            thinkLevel: chatCfg.thinkLevel,
            tools: els.webSearch?.checked ? [{ type: 'web_search', max_uses: 3 }] : undefined,
          },
          tools: buildAgentToolExecutor(ctx, agentCfg),
          signal: abortCtrl.signal,
        },
        {
          onTextDelta: (delta) => {
            if (!aiAppended) {
              appendMessage(session, 'ai', aiParts); // 追加 AI 节点（单候选）
              aiAppended = true;
            }
            const part = aiParts[0];
            if (part.type === 'text') part.text += delta;
            setMessageContent(aiBubble, part.type === 'text' ? part.text : '');
            els.messages.scrollTop = els.messages.scrollHeight;
            els.status.textContent = '生成中...';
          },
          onReasoningDelta: (delta) => {
            // 思考过程（v0.0.66）：累积到 AI 消息 reasoning + 气泡推理区展示；不进 AI 上下文
            els.status.textContent = '推理中...';
            const aiMsg = session.nodes[session.nodes.length - 1]?.messages[session.nodes[session.nodes.length - 1]?.selectIndex ?? 0];
            if (aiMsg) {
              aiMsg.reasoning = (aiMsg.reasoning ?? '') + delta;
              const rEl = aiBubble.querySelector('[data-msg-reasoning]') as HTMLElement | null;
              if (rEl) {
                rEl.textContent = aiMsg.reasoning;
                // v0.0.67：有思考内容才显示推理区（流式首增量到达时显示）
                const details = rEl.closest('.ex-msg-reasoning') as HTMLElement | null;
                if (details) details.style.display = '';
              }
            }
          },
          onToolCall: (call) => {
            els.status.textContent = `调用工具: ${call.name}...`;
            logger.info('tool', `调用工具 ${call.name}`);
          },
          onDone: () => {
            els.status.textContent = '';
          },
          onError: (error) => {
            // 首个文本增量前报错：移除空白气泡（未落盘、session 无记录），避免残留（P2-6）
            if (!aiAppended) {
              aiBubble.remove();
            }
            els.status.textContent = `错误: ${error.message}`;
            logger.error('api', error.message);
          },
          onUsage: (u) => {
            // 按分量累加（工具循环多轮、claude 双回调都正确累计，不取最大值）
            if (u.inputTokens > 0) reqInput += u.inputTokens;
            if (u.outputTokens > 0) reqOutput += u.outputTokens;
          },
        },
      );
    } catch (error) {
      // 兜底：provider/工具异常直接冒泡时，走 onError 提示 + 落盘，避免 unhandled rejection 和状态栏卡死（RikkaHub errors 流思路）
      els.status.textContent = `错误: ${error instanceof Error ? error.message : String(error)}`;
      logger.error('api', error instanceof Error ? error.message : String(error));
    } finally {
      // 只有自己还是最新流时才复位共享 UI 状态（旧流中止后新流已启动的场景，M1）
      if (token === streamToken) {
        streaming = false;
        els.send.style.display = '';
        els.stop.style.display = 'none';
        abortCtrl = null;
        // 流真正结束后才做收尾（Markdown 渲染等），避免增量期间被破坏
        els.onStreamEnd?.();
      }
      // usage 统计（无论成功/失败/中止，收到过 usage 就累计）
      if (reqInput > 0 || reqOutput > 0) accumulateUsage(reqInput, reqOutput);
      // 无论成功/失败/中止，已生成的内容都要落盘（避免 UI 卡死/丢内容）
      saveSessionSafe();
    }
  }

  function send(): void {
    const text = els.input.value;
    void sendText([{ type: 'text', text }]);
  }

  function sendWithAttachments(attachments: UIMessagePart[]): void {
    if (attachments.length === 0) {
      send();
      return;
    }
    const text = els.input.value.trim();
    const parts: UIMessagePart[] = [...(text ? [{ type: 'text', text } as UIMessagePart] : []), ...attachments];
    void sendText(parts);
  }

  function setConversationSystemPrompt(prompt: string): void {
    session.systemPrompt = prompt.trim() || undefined;
    saveSessionSafe();
  }

  function getConversationSystemPrompt(): string {
    return session.systemPrompt ?? '';
  }

  function stop(): void {
    if (!abortCtrl) return;
    abortCtrl.abort();
    // 令牌失效：旧流 finally 不再复位 UI（新流可能已启动）
    streamToken++;
    abortCtrl = null;
    streaming = false;
    els.status.textContent = '已中止';
    els.send.style.display = '';
    els.stop.style.display = 'none';
    // P2-5：手动中止也算流结束，触发收尾（Markdown 渲染等），与 finally 分支行为一致
    els.onStreamEnd?.();
    saveSessionSafe();
  }

  function renameSession(title: string): void {
    const t = title.trim();
    if (!t || disposed) return;
    session.title = t;
    saveSessionSafe();
    logger.info('gui', `会话标题已改为 "${t}"`);
  }

  /** 重新生成：截断到最后一条用户消息，用其内容重新发送（兼容旧调用；RikkaHub user 消息 regenerate = 截断重发） */
  function regenerate(): void {
    if (disposed || streaming) {
      // P4：流式/卸载期间点重发给提示，避免静默失败
      els.status.textContent = streaming ? '生成中，暂不能重发' : '';
      return;
    }
    // 找到最后一条用户消息作为重发锚点
    let idx = -1;
    const msgs = currentMessages(session);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    const userMsg = msgs[idx];
    // P1-2：历史消息含非文本 part（如图片）时不重发（避免 [图片] 降级为纯文本导致类型信息永久丢失）
    if (userMsg.parts.some((p) => p.type !== 'text')) {
      els.status.textContent = '该消息含图片等非文本内容，暂不支持重发';
      return;
    }
    const userText = userMsg.parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n');
    if (!userText.trim()) return;
    // P1-1：截断前先过发送校验（apiKey/服务商/加载态），失败则不删数据
    if (!validateParts(userMsg.parts)) return;
    // 截断到最后一条用户消息（含）之前的全部节点，再由 sendText 重新追加同一条用户消息，
    // 避免用户消息在会话里出现两次。首条 user 消息（anchor=0）时清空整链再重发（否则重复）
    const found = findNodeByMessage(session, userMsg.id);
    const anchor = found ? found.nodeIndex : idx;
    if (anchor <= 0) {
      session.nodes = [];
    } else {
      truncateAfter(session, anchor - 1);
    }
    saveSessionSafe();
    renderCurrent();
    void sendText(userMsg.parts, false);
  }

  /**
   * 按消息 id 重新生成（RikkaHub regenerate 语义）：
   *   - user 消息：截断该节点之后的全部节点，重新生成回复（user 消息本身保留）
   *   - assistant 消息：该节点 push 新候选 + selectIndex 指向（旧候选保留），重新生成该条回复（共享链，后续节点不动）
   */
  function regenerateAt(messageId: string): void {
    if (disposed || streaming) {
      els.status.textContent = streaming ? '生成中，暂不能重发' : '';
      return;
    }
    const found = findNodeByMessage(session, messageId);
    if (!found) return;
    const { node, nodeIndex } = found;
    const idx = node.selectIndex >= 0 && node.selectIndex < node.messages.length ? node.selectIndex : 0;
    const msg = node.messages[idx];
    // 非文本内容（如图片）不重发
    if (msg.parts.some((p) => p.type !== 'text')) {
      els.status.textContent = '该消息含图片等非文本内容，暂不支持重发';
      return;
    }
    if (msg.role === 'user') {
      // user：截断该节点之后（含该节点后的所有节点），重新生成回复
      truncateAfter(session, nodeIndex);
      saveSessionSafe();
      renderCurrent();
      void sendReplyToUser(msg.id);
    } else {
      // assistant：push 新候选到该节点（共享链，后续节点不动），流式写回该候选
      const aiParts: UIMessagePart[] = [{ type: 'text', text: '' }];
      const newMsg = createMessage('ai', aiParts);
      pushCandidate(session, nodeIndex, newMsg);
      saveSessionSafe();
      renderCurrent();
      void streamReplyAt(nodeIndex, aiParts);
    }
  }

  /** 编辑用户消息（APITOOL editMsg 原创语义）：push 新候选（新文本）+ 截断该节点后续 + 重新生成回复 */
  function editUserMessage(messageId: string, newText: string): void {
    if (disposed || streaming) {
      // APITOOL：流式期间编辑会被渲染覆盖——拦截
      els.status.textContent = streaming ? '生成中，暂不能编辑' : '';
      return;
    }
    const text = newText.trim();
    if (!text) return;
    const found = findNodeByMessage(session, messageId);
    if (!found) return;
    const { node, nodeIndex } = found;
    // 新候选：同 role（user）、新 id、新文本；保留原 created（时间戳展示不变）
    const newMsg = createMessage('user', [{ type: 'text', text }]);
    newMsg.createdAt = node.messages[0]?.createdAt ?? newMsg.createdAt;
    pushCandidate(session, nodeIndex, newMsg);
    // 截断该节点之后的所有节点（编辑后重生成回复；RikkaHub user 编辑=截断语义）
    truncateAfter(session, nodeIndex);
    saveSessionSafe();
    renderCurrent();
    void streamReply(); // 从链尾 append 新 AI 节点重新生成回复
  }

  /** 就地编辑 AI 回复（APITOOL editAiMsg 原创语义）：剥思考块给正文编辑、改选中候选文本、标 editedByUser（不重发）；
   *  "已编辑"标记只做 UI 展示，不进 AI 上下文（toChatContent 只取 parts） */
  function editAiMessage(messageId: string, newText: string): void {
    if (disposed || streaming) {
      // APITOOL M2：流式期间编辑会被渲染覆盖——拦截
      els.status.textContent = streaming ? '生成中，暂不能编辑' : '';
      return;
    }
    const found = findNodeByMessage(session, messageId);
    if (!found) return;
    const { node } = found;
    const idx = node.selectIndex >= 0 && node.selectIndex < node.messages.length ? node.selectIndex : 0;
    const msg = node.messages[idx];
    if (!msg || msg.role !== 'ai') return;
    const text = newText.trim();
    if (!text) return;
    msg.parts = [{ type: 'text', text }];
    msg.editedByUser = true;
    saveSessionSafe();
    renderCurrent();
  }

  /** 截断后以最后一条 user 消息为锚重新生成回复（append 新 AI 节点） */
  async function sendReplyToUser(userMessageId: string): Promise<void> {
    const found = findNodeByMessage(session, userMessageId);
    if (!found || !validateStream()) {
      // 状态/配置校验失败（已截断数据）：用最后一条 user 消息内容补发（兜底，避免已删数据无处安放）
      const msgs = currentMessages(session);
      const last = [...msgs].reverse().find((m) => m.role === 'user');
      if (!last) return;
      await sendText(last.parts, false);
      return;
    }
    await streamReplyFrom(found.nodeIndex);
  }

  /** 从 nodeIndex 节点（其后的链已被截断）继续生成回复：append 新 AI 节点 */
  async function streamReplyFrom(_anchorNodeIndex: number): Promise<void> {
    await streamReply();
  }

  /** 发送纯回复流（不追加 user 消息）：append 新 AI 节点（对应 RikkaHub 截断后 handleMessageComplete 重生成） */
  async function streamReply(): Promise<void> {
    if (!validateStream()) return; // 回复流不追加用户输入，只校验状态/配置
    streaming = true;
    const token = ++streamToken;
    els.onSendAccepted?.();
    let reqInput = 0;
    let reqOutput = 0;
    const aiParts: UIMessagePart[] = [{ type: 'text', text: '' }];
    let aiAppended = false;
    const aiBubble = els.renderMessage('ai', aiParts);
    els.messages.appendChild(aiBubble);
    els.messages.scrollTop = els.messages.scrollHeight;
    abortCtrl = new AbortController();
    els.send.style.display = 'none';
    els.stop.style.display = '';
    els.status.textContent = '思考中...';
    const currentProfile = ctx.config.get('profile') as unknown as ProviderProfile;
    const provider = ctx.providers.get(currentProfile.id)!;
    const agentCfg = (ctx.config.get('agent') ?? {}) as unknown as AgentConfig;
    const chatCfg = (ctx.config.get('chat') ?? {}) as unknown as ChatConfig;
    const effectiveSystemPrompt = (session.systemPrompt ?? '').trim() || (chatCfg.systemPrompt ?? '').trim();
    try {
      await runAgentLoop(
        {
          provider,
          request: {
            model: currentProfile.model,
            apiKey: currentProfile.apiKey,
            baseURL: currentProfile.baseURL,
            protocol: (currentProfile as { protocol?: 'responses' | 'chat' }).protocol ?? 'responses',
            messages: toChatMessages(session, chatCfg.maxRounds ?? 0),
            maxTokens: 4096,
            temperature: chatCfg.temperature,
            systemPrompt: effectiveSystemPrompt || undefined,
            thinkLevel: chatCfg.thinkLevel,
            tools: els.webSearch?.checked ? [{ type: 'web_search', max_uses: 3 }] : undefined,
          },
          tools: buildAgentToolExecutor(ctx, agentCfg),
          signal: abortCtrl.signal,
        },
        {
          onTextDelta: (delta) => {
            if (!aiAppended) {
              appendMessage(session, 'ai', aiParts);
              aiAppended = true;
            }
            const part = aiParts[0];
            if (part.type === 'text') part.text += delta;
            setMessageContent(aiBubble, part.type === 'text' ? part.text : '');
            els.messages.scrollTop = els.messages.scrollHeight;
            els.status.textContent = '生成中...';
          },
          onReasoningDelta: (delta) => {
            // 思考过程（v0.0.66）：累积到 AI 消息 reasoning + 气泡推理区展示；不进 AI 上下文
            els.status.textContent = '推理中...';
            const aiMsg = session.nodes[session.nodes.length - 1]?.messages[session.nodes[session.nodes.length - 1]?.selectIndex ?? 0];
            if (aiMsg) {
              aiMsg.reasoning = (aiMsg.reasoning ?? '') + delta;
              const rEl = aiBubble.querySelector('[data-msg-reasoning]') as HTMLElement | null;
              if (rEl) {
                rEl.textContent = aiMsg.reasoning;
                // v0.0.67：有思考内容才显示推理区（流式首增量到达时显示）
                const details = rEl.closest('.ex-msg-reasoning') as HTMLElement | null;
                if (details) details.style.display = '';
              }
            }
          },
          onToolCall: (call) => {
            els.status.textContent = `调用工具: ${call.name}...`;
            logger.info('tool', `调用工具 ${call.name}`);
          },
          onDone: () => {
            els.status.textContent = '';
          },
          onError: (error) => {
            if (!aiAppended) {
              aiBubble.remove();
            }
            els.status.textContent = `错误: ${error.message}`;
            logger.error('api', error.message);
          },
          onUsage: (u) => {
            // 按分量累加（工具循环多轮、claude 双回调都正确累计，不取最大值）
            if (u.inputTokens > 0) reqInput += u.inputTokens;
            if (u.outputTokens > 0) reqOutput += u.outputTokens;
          },
        },
      );
    } catch (error) {
      els.status.textContent = `错误: ${error instanceof Error ? error.message : String(error)}`;
      logger.error('api', error instanceof Error ? error.message : String(error));
    } finally {
      if (token === streamToken) {
        streaming = false;
        els.send.style.display = '';
        els.stop.style.display = 'none';
        abortCtrl = null;
        els.onStreamEnd?.();
      }
      if (reqInput > 0 || reqOutput > 0) accumulateUsage(reqInput, reqOutput);
      saveSessionSafe();
    }
  }

  /** assistant 候选重新生成：流式写回已 push 的候选节点（不追加新节点，RikkaHub updateCurrentMessages 按节点下标写回） */
  async function streamReplyAt(nodeIndex: number, aiParts: UIMessagePart[]): Promise<void> {
    if (!validateStream()) return; // 回复流不追加用户输入，只校验状态/配置
    streaming = true;
    const token = ++streamToken;
    els.onSendAccepted?.();
    let reqInput = 0;
    let reqOutput = 0;
    const aiBubble = els.renderMessage('ai', aiParts);
    els.messages.appendChild(aiBubble);
    els.messages.scrollTop = els.messages.scrollHeight;
    abortCtrl = new AbortController();
    els.send.style.display = 'none';
    els.stop.style.display = '';
    els.status.textContent = '思考中...';
    const currentProfile = ctx.config.get('profile') as unknown as ProviderProfile;
    const provider = ctx.providers.get(currentProfile.id)!;
    const agentCfg = (ctx.config.get('agent') ?? {}) as unknown as AgentConfig;
    const chatCfg = (ctx.config.get('chat') ?? {}) as unknown as ChatConfig;
    const effectiveSystemPrompt = (session.systemPrompt ?? '').trim() || (chatCfg.systemPrompt ?? '').trim();
    try {
      await runAgentLoop(
        {
          provider,
          request: {
            model: currentProfile.model,
            apiKey: currentProfile.apiKey,
            baseURL: currentProfile.baseURL,
            protocol: (currentProfile as { protocol?: 'responses' | 'chat' }).protocol ?? 'responses',
            messages: toChatMessages(session, chatCfg.maxRounds ?? 0),
            maxTokens: 4096,
            temperature: chatCfg.temperature,
            systemPrompt: effectiveSystemPrompt || undefined,
            thinkLevel: chatCfg.thinkLevel,
            tools: els.webSearch?.checked ? [{ type: 'web_search', max_uses: 3 }] : undefined,
          },
          tools: buildAgentToolExecutor(ctx, agentCfg),
          signal: abortCtrl.signal,
        },
        {
          onTextDelta: (delta) => {
            const part = aiParts[0];
            if (part.type === 'text') part.text += delta;
            setMessageContent(aiBubble, part.type === 'text' ? part.text : '');
            els.messages.scrollTop = els.messages.scrollHeight;
            els.status.textContent = '生成中...';
          },
          onReasoningDelta: (delta) => {
            // 思考过程（v0.0.66）：累积到 AI 候选消息 reasoning + 气泡推理区展示；不进 AI 上下文
            // streamReplyAt：AI 候选在 nodeIndex 节点（共享链，未必是最后一个节点）
            els.status.textContent = '推理中...';
            const aiMsg = session.nodes[nodeIndex]?.messages[session.nodes[nodeIndex]?.selectIndex ?? 0];
            if (aiMsg) {
              aiMsg.reasoning = (aiMsg.reasoning ?? '') + delta;
              const rEl = aiBubble.querySelector('[data-msg-reasoning]') as HTMLElement | null;
              if (rEl) {
                rEl.textContent = aiMsg.reasoning;
                // v0.0.67：有思考内容才显示推理区（流式首增量到达时显示）
                const details = rEl.closest('.ex-msg-reasoning') as HTMLElement | null;
                if (details) details.style.display = '';
              }
            }
          },
          onToolCall: (call) => {
            els.status.textContent = `调用工具: ${call.name}...`;
            logger.info('tool', `调用工具 ${call.name}`);
          },
          onDone: () => {
            els.status.textContent = '';
          },
          onError: (error) => {
            // 候选气泡流式期间失败：保留候选（用户可切回旧候选），仅提示
            els.status.textContent = `错误: ${error.message}`;
            logger.error('api', error.message);
          },
          onUsage: (u) => {
            // 按分量累加（工具循环多轮、claude 双回调都正确累计，不取最大值）
            if (u.inputTokens > 0) reqInput += u.inputTokens;
            if (u.outputTokens > 0) reqOutput += u.outputTokens;
          },
        },
      );
    } catch (error) {
      els.status.textContent = `错误: ${error instanceof Error ? error.message : String(error)}`;
      logger.error('api', error instanceof Error ? error.message : String(error));
    } finally {
      if (token === streamToken) {
        streaming = false;
        els.send.style.display = '';
        els.stop.style.display = 'none';
        abortCtrl = null;
        els.onStreamEnd?.();
      }
      if (reqInput > 0 || reqOutput > 0) accumulateUsage(reqInput, reqOutput);
      saveSessionSafe();
    }
  }

  /** 切换分支：只改目标节点 selectIndex，后续节点链不动（RikkaHub selectMessageNode 共享链语义） */
  function selectCandidate(nodeId: string, selectIndex: number): void {
    const ni = session.nodes.findIndex((n) => n.id === nodeId);
    if (ni < 0) return;
    setSelectIndex(session, ni, selectIndex);
    saveSessionSafe();
    renderCurrent();
  }

  /** fork：从 messageId 处复制截断节点链成新会话（原会话不动），落盘并切换到新会话 */
  function forkAt(messageId: string): void {
    if (disposed || streaming) return;
    try {
      const forked = forkSessionAtMessage(session, messageId);
      void ctx.storage.saveConversation(forked).then(() => {
        ctx.emit('session-switch', forked.id);
        els.onSessionChange?.(forked.id);
        logger.info('gui', `已从消息 ${messageId} 分叉新会话 ${forked.id}`);
      }).catch((error) => {
        els.status.textContent = `分叉失败: ${error instanceof Error ? error.message : String(error)}`;
      });
    } catch (error) {
      els.status.textContent = `分叉失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
    streamToken++; // P6：卸载时递增令牌，旧流 finally 不再复位/渲染（onStreamEnd 不再触发）
    saveSessionSafe();
  }

  return {
    send: () => void send(),
    sendWithAttachments,
    setConversationSystemPrompt,
    getConversationSystemPrompt,
    stop,
    switchSession,
    getSessionId: () => session.id,
    renameSession,
    regenerate,
    regenerateAt,
    editUserMessage,
    editAiMessage,
    selectCandidate,
    forkAt,
    getBranchSnapshot,
    getStats,
    dispose,
  };
}
