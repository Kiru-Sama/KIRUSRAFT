/**
 * 兜底 GUI（v0.0.1）
 * 内核自带的极简聊天界面，不依赖任何 UI 插件。
 * UI 插件全部加载失败时，这个界面保证"内核在就有界面"。
 */
import { Context } from '@deepseek-ai/cordis';
import { runAgentLoop } from '../core/agent-loop';
import { appendMessage, createSession, toChatMessages } from '../core/session';
import { logger } from '../core/logger';
import type { Session, UIMessagePart, ProviderProfile } from '../core/types';

export const name = 'fallback-gui';
export const inject = ['providers', 'tools', 'config', 'storage'];

export interface Config {
  /** 挂载根节点，缺省取 #app */
  root?: HTMLElement;
}

export function apply(ctx: Context, config: Config): void {
  const root = config.root ?? document.getElementById('app');
  if (!root) throw new Error('fallback-gui: 找不到挂载节点');

  let session: Session = createSession();
  let loaded = false;

  // 注册 profile 配置分节（走配置中心，带设置表单渲染）
  ctx.config.register(ctx, {
    namespace: 'profile',
    displayName: '服务商',
    defaults: {
      id: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: '',
    },
    render: (container, get, set) => {
      const fields: { key: string; label: string; placeholder: string; password?: boolean }[] = [
        { key: 'baseURL', label: 'Base URL（含 /v1）', placeholder: 'https://api.deepseek.com/v1' },
        { key: 'model', label: '模型', placeholder: 'deepseek-chat' },
        { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', password: true },
      ];
      for (const f of fields) {
        const label = document.createElement('label');
        label.textContent = f.label;
        label.style.cssText = 'display:block;font-size:12px;color:#5a6172;margin:12px 0 4px;';
        const input = document.createElement('input');
        input.type = f.password ? 'password' : 'text';
        input.value = String(get()[f.key] ?? '');
        input.placeholder = f.placeholder;
        input.style.cssText =
          'width:100%;padding:8px 12px;border:1px solid #dfe2ea;border-radius:8px;font-size:13px;box-sizing:border-box;background:#f7f8fa;';
        input.addEventListener('input', () => {
          set({ ...get(), [f.key]: input.value });
        });
        container.appendChild(label);
        container.appendChild(input);
      }
    },
  });

  const container = document.createElement('div');
  container.className = 'fg-root';
  container.innerHTML = `
    <style>
      /* ---- 整体布局：浅色背景 + 强调色（靛蓝），圆角/留白/柔和阴影 ---- */
      .fg-root{display:flex;flex-direction:column;height:100%;position:relative;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;background:#f7f8fa;color:#1f2328;}
      /* ---- 顶栏：白色卡片感，Logo 强调色 + 兜底徽章 ---- */
      [data-fg="header"]{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;background:#ffffff;border-bottom:1px solid #ececf1;flex-shrink:0;}
      [data-fg="header"] strong{font-size:15px;font-weight:600;letter-spacing:.3px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      [data-fg="header"] > div{display:flex;flex-shrink:0;}
      .fg-logo{color:#4f6ef7;}
      .fg-badge{display:inline-block;margin-left:8px;padding:2px 10px;border-radius:999px;background:#eef1ff;color:#4f6ef7;font-size:11px;font-weight:500;letter-spacing:.5px;white-space:nowrap;}
      .fg-ghost-btn{background:transparent;border:1px solid #d9dce3;color:#3c4353;padding:6px 14px;border-radius:999px;font-size:13px;cursor:pointer;transition:all .18s ease;white-space:nowrap;}
      .fg-ghost-btn:hover{background:#f2f4f9;border-color:#c3c8d4;}
      .fg-ghost-btn + .fg-ghost-btn{margin-left:6px;}
      /* ---- 日志面板：保持深色，适合代码/日志查看 ---- */
      [data-fg="logpanel"]{display:none;position:absolute;inset:0;background:#1e1e1e;color:#d4d4d4;font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:12px;flex-direction:column;z-index:10;}
      [data-fg="logpanel"] > div:first-child{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#2a2d35;border-bottom:1px solid #3a3d45;}
      [data-fg="logpanel"] strong{font-size:13px;font-weight:600;color:#e8e8ea;}
      .fg-log-btn{background:#3a3d45;color:#e8e8ea;border:none;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;transition:background .15s ease;}
      .fg-log-btn:hover{background:#4a4e58;}
      .fg-log-btn + .fg-log-btn{margin-left:6px;}
      .fg-log-btn.danger{background:#7a2e2e;}
      .fg-log-btn.danger:hover{background:#943838;}
      [data-fg="logBody"]{flex:1;overflow-y:auto;padding:12px 16px;white-space:pre-wrap;word-break:break-all;line-height:1.6;}
      /* ---- 消息区：气泡列表，圆角卡片 + 柔和阴影 ---- */
      [data-fg="messages"]{flex:1;overflow-y:auto;padding:20px 20px 12px;display:flex;flex-direction:column;gap:12px;}
      [data-fg="messages"]::-webkit-scrollbar{width:8px;}
      [data-fg="messages"]::-webkit-scrollbar-thumb{background:#d4d8e0;border-radius:4px;}
      [data-fg="messages"]::-webkit-scrollbar-thumb:hover{background:#bcc2cd;}
      .fg-bubble{max-width:76%;padding:10px 16px;border-radius:16px;font-size:14px;line-height:1.65;letter-spacing:.2px;white-space:pre-wrap;word-break:break-word;box-sizing:border-box;}
      .fg-user{align-self:flex-end;background:#4f6ef7;color:#fff;border-bottom-right-radius:6px;box-shadow:0 2px 10px rgba(79,110,247,.28);}
      .fg-ai{align-self:flex-start;background:#ffffff;color:#1f2328;border:1px solid #ececf1;border-bottom-left-radius:6px;box-shadow:0 2px 10px rgba(31,35,40,.06);}
      [data-fg="status"]{padding:4px 20px 8px;font-size:12px;color:#8a90a0;min-height:18px;text-align:center;}
      /* ---- 输入区：吸附底部，白底 + 上阴影 ---- */
      .fg-composer{display:flex;align-items:center;gap:10px;padding:12px 20px 16px;background:#ffffff;border-top:1px solid #ececf1;box-shadow:0 -6px 18px rgba(31,35,40,.05);}
      .fg-search{display:flex;align-items:center;gap:6px;font-size:13px;color:#5a6172;cursor:pointer;user-select:none;white-space:nowrap;}
      [data-fg="websearch"]{accent-color:#4f6ef7;width:15px;height:15px;cursor:pointer;}
      [data-fg="input"]{flex:1;min-width:0;padding:11px 16px;border:1px solid #dfe2ea;border-radius:12px;font-size:14px;background:#f7f8fa;outline:none;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease;}
      [data-fg="input"]:focus{border-color:#4f6ef7;background:#fff;box-shadow:0 0 0 3px rgba(79,110,247,.15);}
      [data-fg="input"]::placeholder{color:#9aa1b0;}
      [data-fg="send"]{padding:11px 22px;background:#4f6ef7;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:500;cursor:pointer;box-shadow:0 2px 8px rgba(79,110,247,.3);transition:background .15s ease,transform .05s ease;}
      [data-fg="send"]:hover{background:#3d5af1;}
      [data-fg="send"]:active{transform:scale(.97);}
      [data-fg="stop"]{padding:11px 18px;background:#fff;color:#e5484d;border:1px solid #f3c1c4;border-radius:12px;font-size:14px;font-weight:500;cursor:pointer;transition:background .15s ease;}
      [data-fg="stop"]:hover{background:#fdf1f1;}
      /* ---- 移动端适配 ---- */
      @media (max-width:640px){
        [data-fg="header"]{padding:10px 14px;gap:8px;}
        .fg-badge{display:none;}
        .fg-ghost-btn{padding:5px 10px;font-size:12px;}
        [data-fg="messages"]{padding:14px 12px 8px;}
        .fg-bubble{max-width:85%;}
        .fg-composer{padding:10px 12px 12px;gap:8px;}
        [data-fg="input"]{padding:10px 12px;}
        [data-fg="send"]{padding:10px 14px;}
        .fg-search{font-size:12px;}
      }
    </style>
    <div data-fg="header">
      <strong><span class="fg-logo">KIRUSRAFT</span><span class="fg-badge">兜底模式</span></strong>
      <div>
        <button data-fg="logsBtn" class="fg-ghost-btn">日志</button>
        <button data-fg="settingsBtn" class="fg-ghost-btn">设置</button>
      </div>
    </div>
    <div data-fg="logpanel">
      <div>
        <strong>运行日志</strong>
        <div>
          <button data-fg="logRefresh" class="fg-log-btn">刷新</button>
          <button data-fg="logClear" class="fg-log-btn danger">清空</button>
          <button data-fg="logClose" class="fg-log-btn">关闭</button>
        </div>
      </div>
      <div data-fg="logBody"></div>
    </div>
    <div data-fg="settingspanel" style="display:none;position:absolute;inset:0;background:rgba(31,35,40,.4);z-index:9;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;width:90%;max-width:420px;max-height:80vh;overflow-y:auto;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:16px;">设置</strong>
          <button data-fg="settingsClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8a90a0;line-height:1;">×</button>
        </div>
        <div data-fg="settingsBody"></div>
      </div>
    </div>
    <div data-fg="messages"></div>
    <div data-fg="status"></div>
    <div class="fg-composer">
      <label class="fg-search">
        <input data-fg="websearch" type="checkbox" /> 联网搜索
      </label>
      <input data-fg="input" type="text" placeholder="输入消息，Enter 发送" />
      <button data-fg="send">发送</button>
      <button data-fg="stop" style="display:none;">中止</button>
    </div>
  `;
  root.appendChild(container);

  const msgEl = container.querySelector('[data-fg="messages"]') as HTMLElement;
  const inputEl = container.querySelector('[data-fg="input"]') as HTMLInputElement;
  const sendEl = container.querySelector('[data-fg="send"]') as HTMLButtonElement;
  const stopEl = container.querySelector('[data-fg="stop"]') as HTMLButtonElement;
  const statusEl = container.querySelector('[data-fg="status"]') as HTMLElement;
  const settingsBtn = container.querySelector('[data-fg="settingsBtn"]') as HTMLButtonElement;
  const webSearchEl = container.querySelector('[data-fg="websearch"]') as HTMLInputElement;
  const logsBtn = container.querySelector('[data-fg="logsBtn"]') as HTMLButtonElement;
  const logPanel = container.querySelector('[data-fg="logpanel"]') as HTMLElement;
  const logBody = container.querySelector('[data-fg="logBody"]') as HTMLElement;
  const logRefresh = container.querySelector('[data-fg="logRefresh"]') as HTMLButtonElement;
  const logClear = container.querySelector('[data-fg="logClear"]') as HTMLButtonElement;
  const logClose = container.querySelector('[data-fg="logClose"]') as HTMLButtonElement;
  const settingsPanel = container.querySelector('[data-fg="settingspanel"]') as HTMLElement;
  const settingsBody = container.querySelector('[data-fg="settingsBody"]') as HTMLElement;
  const settingsClose = container.querySelector('[data-fg="settingsClose"]') as HTMLButtonElement;

  let abortCtrl: AbortController | null = null;

  function renderLogs(): void {
    const entries = logger.getLogs();
    logBody.textContent = entries
      .map((e) => {
        const t = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false });
        const lv = e.level.toUpperCase().padEnd(5);
        return `[${t}] ${lv} [${e.source}] ${e.message}`;
      })
      .join('\n');
    logBody.scrollTop = logBody.scrollHeight;
  }

  function openLogs(): void {
    logPanel.style.display = 'flex';
    renderLogs();
  }

  logger.info('gui', '兜底 GUI 已挂载');

  function renderMessage(role: string, parts: UIMessagePart[]): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = role === 'user' ? 'fg-bubble fg-user' : 'fg-bubble fg-ai';
    bubble.textContent = parts.map((p) => (p.type === 'text' ? p.text : `[图片]`)).join('\n');
    return bubble;
  }

  // 切换会话（kernel-gui 会话 tab 触发的事件）
  async function switchSession(id: string): Promise<void> {
    // 中止进行中的流并立即落盘旧会话，避免切换后 AI 回复串写到新会话
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
      saveSessionSafe();
    }
    try {
      const loaded = await ctx.storage.getConversation(id);
      if (!loaded || !loaded.node || !Array.isArray(loaded.node.messages)) {
        logger.error('storage', `切换会话失败（数据损坏）: ${id}`);
        return;
      }
      session = loaded;
      msgEl.innerHTML = '';
      for (const m of session.node.messages) {
        msgEl.appendChild(renderMessage(m.role, m.parts));
      }
      msgEl.scrollTop = msgEl.scrollHeight;
      logger.info('gui', `已切换到会话 ${id}（${session.node.messages.length} 条消息）`);
    } catch (error) {
      logger.error('storage', `切换会话失败: ${String(error)}`);
    }
  }

  ctx.on('session-switch', (id: unknown) => {
    void switchSession(String(id));
  });
  ctx.on('session-deleted', (id: unknown) => {
    if (session.id === String(id)) {
      // 中止进行中的流，避免删除后旧回复串写
      if (abortCtrl) {
        abortCtrl.abort();
        abortCtrl = null;
      }
      session = createSession();
      msgEl.innerHTML = '';
      void ctx.storage.saveConversation(session);
      logger.info('gui', '当前会话已删除，已新建会话');
    }
  });

  // 启动加载最近会话（IndexedDB 持久化，关 App 不丢）
  void (async () => {
    try {
      const list = await ctx.storage.listConversations();
      const loadedSession = list[0];
      if (loadedSession && loadedSession.node && Array.isArray(loadedSession.node.messages)) {
        session = loadedSession;
        for (const m of session.node.messages) {
          msgEl.appendChild(renderMessage(m.role, m.parts));
        }
        msgEl.scrollTop = msgEl.scrollHeight;
        logger.info('gui', `已加载最近会话（${session.node.messages.length} 条消息）`);
      } else if (loadedSession) {
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

  function saveSessionSafe(): void {
    void ctx.storage.saveConversation(session).catch((error) => {
      logger.error('storage', `保存会话失败: ${String(error)}`);
    });
  }

  let streaming = false;

  async function send(text: string): Promise<void> {
    if (!text.trim() || streaming) return;
    if (!loaded) {
      statusEl.textContent = '正在加载会话...';
      return;
    }
    // 每次发送都读最新配置（config.set 会替换对象，闭包引用会失效）
    const currentProfile = ctx.config.get('profile') as unknown as ProviderProfile;
    if (!currentProfile.apiKey) {
      statusEl.textContent = '请先在设置中填写 API Key';
      logger.warn('gui', '发送被拒绝：未配置 API Key');
      openSettings();
      return;
    }
    const provider = ctx.providers.get(currentProfile.id);
    if (!provider) {
      statusEl.textContent = `错误: 服务商 "${currentProfile.id}" 未注册`;
      logger.error('gui', `服务商 "${currentProfile.id}" 未注册`);
      openSettings();
      return;
    }

    streaming = true;
    try {
      logger.info('gui', `发送消息(${webSearchEl.checked ? '联网' : '普通'}): ${text.slice(0, 60)}`);
      appendMessage(session, 'user', [{ type: 'text', text }]);
      msgEl.appendChild(renderMessage('user', [{ type: 'text', text }]));
      saveSessionSafe();
      inputEl.value = '';
      msgEl.scrollTop = msgEl.scrollHeight;

      const aiParts: UIMessagePart[] = [{ type: 'text', text: '' }];
      // 不提前 appendMessage('ai')：避免请求体末尾出现空 content 的 assistant 占位消息（L-1）
      // 且空气泡不会落盘（N-8）。首个文本增量到达时才写入 session。
      let aiAppended = false;
      const aiBubble = renderMessage('ai', aiParts);
      msgEl.appendChild(aiBubble);
      msgEl.scrollTop = msgEl.scrollHeight;

      abortCtrl = new AbortController();
      sendEl.style.display = 'none';
      stopEl.style.display = '';
      statusEl.textContent = '思考中...';

      await runAgentLoop(
        {
          provider,
          request: {
            model: currentProfile.model,
            apiKey: currentProfile.apiKey,
            baseURL: currentProfile.baseURL,
            messages: toChatMessages(session.node),
            maxTokens: 4096,
            tools: webSearchEl.checked ? [{ type: 'web_search', max_uses: 3 }] : undefined,
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
            aiBubble.textContent = (part.type === 'text' ? part.text : '');
            msgEl.scrollTop = msgEl.scrollHeight;
            statusEl.textContent = '生成中...';
          },
          onReasoningDelta: () => {
            statusEl.textContent = '推理中...';
          },
          onToolCall: (call) => {
            statusEl.textContent = `调用工具: ${call.name}...`;
            logger.info('tool', `调用工具 ${call.name}`);
          },
          onDone: () => {
            statusEl.textContent = '';
          },
          onError: (error) => {
            statusEl.textContent = `错误: ${error.message}`;
            logger.error('api', error.message);
          },
        },
      );
    } finally {
      // 无论成功/失败/中止，统一恢复 UI 与落盘（避免 UI 卡死）
      streaming = false;
      sendEl.style.display = '';
      stopEl.style.display = 'none';
      abortCtrl = null;
      saveSessionSafe();
    }
  }

  function openSettings(): void {
    settingsBody.innerHTML = '';
    // 遍历所有注册的配置分节，聚合渲染设置表单
    for (const section of ctx.config.list()) {
      const title = document.createElement('div');
      title.textContent = section.displayName;
      title.style.cssText = 'font-size:14px;font-weight:600;color:#1f2328;margin-top:16px;padding-bottom:4px;border-bottom:1px solid #ececf1;';
      settingsBody.appendChild(title);
      const sectionContainer = document.createElement('div');
      settingsBody.appendChild(sectionContainer);
      if (section.render) {
        section.render(
          sectionContainer,
          () => ctx.config.get(section.namespace),
          (value) => ctx.config.set(section.namespace, value),
        );
      } else {
        const empty = document.createElement('div');
        empty.textContent = '（无设置项）';
        empty.style.cssText = 'font-size:12px;color:#9aa1b0;padding:8px 0;';
        sectionContainer.appendChild(empty);
      }
    }
    settingsPanel.style.display = 'flex';
    logger.info('gui', '打开设置面板');
  }

  // 生命周期：副作用回收（Cordis effect 模式，卸载时自动逆序清理）
  ctx.effect(() => {
    sendEl.addEventListener('click', () => void send(inputEl.value));
    inputEl.addEventListener('keydown', (e) => {
      // 中文输入法组合态（isComposing）回车不应发送
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) void send(inputEl.value);
    });
    stopEl.addEventListener('click', () => {
      abortCtrl?.abort();
      abortCtrl = null;
      statusEl.textContent = '已中止';
      sendEl.style.display = '';
      stopEl.style.display = 'none';
      // 中止也要保存已生成的部分内容
      saveSessionSafe();
    });
    settingsBtn.addEventListener('click', openSettings);
    settingsClose.addEventListener('click', () => {
      settingsPanel.style.display = 'none';
    });
    logsBtn.addEventListener('click', openLogs);
    logClose.addEventListener('click', () => {
      logPanel.style.display = 'none';
    });
    logRefresh.addEventListener('click', renderLogs);
    logClear.addEventListener('click', () => {
      logger.clear();
      renderLogs();
    });
    return () => {
      abortCtrl?.abort();
      container.remove();
    };
  });
}
