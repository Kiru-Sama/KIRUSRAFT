/**
 * 聊天控制器（v0.0.19）
 * 兜底 GUI 与主题 GUI 共用的聊天状态机：会话加载/切换、流式发送/中止、IndexedDB 落盘。
 * GUI 只提供元素引用与消息渲染回调，流式/事件/落盘逻辑全部收敛在这里（效果不变、实现复用）。
 */
import { Context } from '@deepseek-ai/cordis';
import { runAgentLoop } from './agent-loop';
import { appendMessage, createSession, toChatMessages } from './session';
import { logger } from './logger';
import type { Session, UIMessagePart, ProviderProfile } from './types';

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
  /** 渲染一条消息气泡（GUI 自定义样式），返回的元素会被追加到消息列表 */
  renderMessage: (role: 'user' | 'ai', parts: UIMessagePart[]) => HTMLElement;
  /** 缺 API Key / 服务商未注册时打开设置（可选） */
  onRequireSettings?: () => void;
  /** 会话变化回调（启动加载/切换/删除后触发，GUI 用来刷新侧边栏高亮） */
  onSessionChange?: (id: string) => void;
}

export interface ChatController {
  /** 发送输入框内容（发送/Enter 入口） */
  send(): void;
  /** 中止当前流 */
  stop(): void;
  /** 切换会话（中止旧流、落盘、渲染目标会话） */
  switchSession(id: string): Promise<void>;
  /** 当前会话 id（侧边栏高亮用） */
  getSessionId(): string;
  /** 卸载：中止流并落盘（GUI effect 清理时调用） */
  dispose(): void;
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

  function saveSessionSafe(): void {
    void ctx.storage.saveConversation(session).catch((error) => {
      logger.error('storage', `保存会话失败: ${String(error)}`);
    });
  }

  function renderCurrent(): void {
    els.messages.innerHTML = '';
    for (const m of session.node.messages) {
      els.messages.appendChild(els.renderMessage(m.role, m.parts));
    }
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  async function switchSession(id: string): Promise<void> {
    if (disposed) return;
    const seq = ++switchSeq;
    // 中止进行中的流并立即落盘旧会话，避免切换后 AI 回复串写到新会话
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
      streaming = false;
      streamToken++;
      els.send.style.display = '';
      els.stop.style.display = 'none';
      saveSessionSafe();
    }
    try {
      const loadedConv = await ctx.storage.getConversation(id);
      // await 期间可能又发起了新的切换：过期的结果丢弃（latest-wins）
      if (seq !== switchSeq || disposed) return;
      if (!loadedConv || !loadedConv.node || !Array.isArray(loadedConv.node.messages)) {
        logger.error('storage', `切换会话失败（数据损坏）: ${id}`);
        return;
      }
      session = loadedConv;
      renderCurrent();
      els.onSessionChange?.(session.id);
      logger.info('gui', `已切换到会话 ${id}（${session.node.messages.length} 条消息）`);
    } catch (error) {
      logger.error('storage', `切换会话失败: ${String(error)}`);
    }
  }

  // 启动：加载最近会话（IndexedDB 持久化，关 App 不丢）
  void (async () => {
    try {
      const list = await ctx.storage.listConversations();
      const latest = list[0];
      if (latest && latest.node && Array.isArray(latest.node.messages)) {
        session = latest;
        renderCurrent();
        els.onSessionChange?.(session.id);
        logger.info('gui', `已加载最近会话（${session.node.messages.length} 条消息）`);
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

  // 跨插件事件：kernel-gui 会话 tab / 主题 GUI 侧边栏切换会话
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

  async function send(): Promise<void> {
    if (disposed || streaming) return;
    if (!loaded) {
      els.status.textContent = '正在加载会话...';
      return;
    }
    const text = els.input.value;
    if (!text.trim()) return;
    // 每次发送都读最新配置（config.set 会替换对象，闭包引用会失效）
    const currentProfile = ctx.config.get('profile') as unknown as ProviderProfile;
    if (!currentProfile.apiKey) {
      els.status.textContent = '请先在设置中填写 API Key';
      logger.warn('gui', '发送被拒绝：未配置 API Key');
      els.onRequireSettings?.();
      return;
    }
    const provider = ctx.providers.get(currentProfile.id);
    if (!provider) {
      els.status.textContent = `错误: 服务商 "${currentProfile.id}" 未注册`;
      logger.error('gui', `服务商 "${currentProfile.id}" 未注册`);
      els.onRequireSettings?.();
      return;
    }

    streaming = true;
    const token = ++streamToken;
    try {
      logger.info('gui', `发送消息(${els.webSearch?.checked ? '联网' : '普通'}): ${text.slice(0, 60)}`);
      appendMessage(session, 'user', [{ type: 'text', text }]);
      els.messages.appendChild(els.renderMessage('user', [{ type: 'text', text }]));
      saveSessionSafe();
      els.input.value = '';
      els.messages.scrollTop = els.messages.scrollHeight;

      const aiParts: UIMessagePart[] = [{ type: 'text', text: '' }];
      // 不提前 appendMessage('ai')：避免请求体末尾出现空 content 的 assistant 占位消息（L-1）
      // 且空气泡不会落盘（N-8）。首个文本增量到达时才写入 session。
      let aiAppended = false;
      const aiBubble = els.renderMessage('ai', aiParts);
      els.messages.appendChild(aiBubble);
      els.messages.scrollTop = els.messages.scrollHeight;

      abortCtrl = new AbortController();
      els.send.style.display = 'none';
      els.stop.style.display = '';
      els.status.textContent = '思考中...';

      await runAgentLoop(
        {
          provider,
          request: {
            model: currentProfile.model,
            apiKey: currentProfile.apiKey,
            baseURL: currentProfile.baseURL,
            messages: toChatMessages(session.node),
            maxTokens: 4096,
            tools: els.webSearch?.checked ? [{ type: 'web_search', max_uses: 3 }] : undefined,
          },
          tools: ctx.tools,
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
            aiBubble.textContent = part.type === 'text' ? part.text : '';
            els.messages.scrollTop = els.messages.scrollHeight;
            els.status.textContent = '生成中...';
          },
          onReasoningDelta: () => {
            els.status.textContent = '推理中...';
          },
          onToolCall: (call) => {
            els.status.textContent = `调用工具: ${call.name}...`;
            logger.info('tool', `调用工具 ${call.name}`);
          },
          onDone: () => {
            els.status.textContent = '';
          },
          onError: (error) => {
            els.status.textContent = `错误: ${error.message}`;
            logger.error('api', error.message);
          },
        },
      );
    } finally {
      // 只有自己还是最新流时才复位共享 UI 状态（旧流中止后新流已启动的场景，M1）
      if (token === streamToken) {
        streaming = false;
        els.send.style.display = '';
        els.stop.style.display = 'none';
        abortCtrl = null;
      }
      // 无论成功/失败/中止，已生成的内容都要落盘（避免 UI 卡死/丢内容）
      saveSessionSafe();
    }
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
    saveSessionSafe();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
    saveSessionSafe();
  }

  return { send: () => void send(), stop, switchSession, getSessionId: () => session.id, dispose };
}
