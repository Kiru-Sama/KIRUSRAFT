/**
 * 兜底 GUI（v0.0.1）
 * 内核自带的极简聊天界面，不依赖任何 UI 插件。
 * UI 插件全部加载失败时，这个界面保证"内核在就有界面"。
 */
import { Context } from '@deepseek-ai/cordis';
import { streamChat } from '../providers/deepseek';
import { appendMessage, createSession, toChatMessages } from '../core/session';
import type { Session, UIMessagePart, ProviderProfile } from '../core/types';

export const name = 'fallback-gui';

export interface Config {
  /** 挂载根节点，缺省取 #app */
  root?: HTMLElement;
}

const STORAGE_KEY = 'kirusraft.profile.v1';

function loadProfile(): ProviderProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ProviderProfile;
  } catch {
    /* 忽略损坏配置 */
  }
  return {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: '',
  };
}

function saveProfile(profile: ProviderProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function apply(ctx: Context, config: Config): void {
  const root = config.root ?? document.getElementById('app');
  if (!root) throw new Error('fallback-gui: 找不到挂载节点');

  const session: Session = createSession();
  const profile = loadProfile();

  // 构建界面骨架
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:system-ui,sans-serif;background:#f5f5f5;color:#222;';
  container.innerHTML = `
    <div data-fg="header" style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#222;color:#fff;">
      <strong>KIRUSRAFT <span style="opacity:.6">兜底模式</span></strong>
      <button data-fg="settingsBtn" style="background:none;border:1px solid #555;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;">设置</button>
    </div>
    <div data-fg="messages" style="flex:1;overflow-y:auto;padding:16px;"></div>
    <div data-fg="status" style="padding:2px 16px;font-size:12px;color:#888;min-height:18px;"></div>
    <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid #ddd;background:#fff;">
      <label style="display:flex;align-items:center;gap:4px;font-size:13px;color:#555;">
        <input data-fg="websearch" type="checkbox" /> 联网搜索
      </label>
      <input data-fg="input" type="text" placeholder="输入消息，Enter 发送"
        style="flex:1;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font-size:14px;" />
      <button data-fg="send" style="padding:10px 18px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;">发送</button>
      <button data-fg="stop" style="padding:10px 14px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;display:none;">中止</button>
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

  let abortCtrl: AbortController | null = null;

  function renderMessage(role: string, parts: UIMessagePart[]): HTMLElement {
    const bubble = document.createElement('div');
    bubble.style.cssText = `margin:8px 0;padding:10px 14px;border-radius:10px;max-width:80%;white-space:pre-wrap;word-break:break-word;${
      role === 'user' ? 'margin-left:auto;background:#2563eb;color:#fff;' : 'background:#fff;border:1px solid #ddd;'
    }`;
    bubble.textContent = parts.map((p) => (p.type === 'text' ? p.text : `[图片]`)).join('\n');
    return bubble;
  }

  async function send(text: string): Promise<void> {
    if (!text.trim()) return;
    if (!profile.apiKey) {
      statusEl.textContent = '请先在设置中填写 API Key';
      openSettings();
      return;
    }
    appendMessage(session, 'user', [{ type: 'text', text }]);
    msgEl.appendChild(renderMessage('user', [{ type: 'text', text }]));
    inputEl.value = '';
    msgEl.scrollTop = msgEl.scrollHeight;

    const aiParts: UIMessagePart[] = [{ type: 'text', text: '' }];
    appendMessage(session, 'ai', aiParts);
    const aiBubble = renderMessage('ai', aiParts);
    msgEl.appendChild(aiBubble);
    msgEl.scrollTop = msgEl.scrollHeight;

    abortCtrl = new AbortController();
    sendEl.style.display = 'none';
    stopEl.style.display = '';
    statusEl.textContent = '思考中...';

    await streamChat(
      {
        model: profile.model,
        apiKey: profile.apiKey,
        baseURL: profile.baseURL,
        messages: toChatMessages(session.node),
        maxTokens: 4096,
        tools: webSearchEl.checked ? [{ type: 'web_search', max_uses: 3 }] : undefined,
      },
      {
        onTextDelta: (delta) => {
          const part = aiParts[0];
          if (part.type === 'text') part.text += delta;
          aiBubble.textContent = (part.type === 'text' ? part.text : '');
          msgEl.scrollTop = msgEl.scrollHeight;
          statusEl.textContent = '生成中...';
        },
        onReasoningDelta: () => {
          statusEl.textContent = '推理中...';
        },
        onToolCall: () => {
          statusEl.textContent = '调用工具中...';
        },
        onDone: () => {
          statusEl.textContent = '';
          sendEl.style.display = '';
          stopEl.style.display = 'none';
          abortCtrl = null;
        },
        onError: (error) => {
          statusEl.textContent = `错误: ${error.message}`;
          sendEl.style.display = '';
          stopEl.style.display = 'none';
          abortCtrl = null;
        },
      },
      abortCtrl.signal,
    );
  }

  function openSettings(): void {
    const apiKey = prompt('API Key:', profile.apiKey) ?? profile.apiKey;
    const baseURL = prompt('Base URL（含 /v1）:', profile.baseURL) ?? profile.baseURL;
    const model = prompt('模型:', profile.model) ?? profile.model;
    profile.apiKey = apiKey;
    profile.baseURL = baseURL;
    profile.model = model;
    saveProfile(profile);
    statusEl.textContent = `已配置: ${profile.model} @ ${profile.baseURL}`;
  }

  // 生命周期：副作用回收（Cordis effect 模式，卸载时自动逆序清理）
  ctx.effect(() => {
    const listeners: Array<() => void> = [];
    sendEl.addEventListener('click', () => void send(inputEl.value));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void send(inputEl.value);
    });
    stopEl.addEventListener('click', () => {
      abortCtrl?.abort();
      statusEl.textContent = '已中止';
      sendEl.style.display = '';
      stopEl.style.display = 'none';
    });
    settingsBtn.addEventListener('click', openSettings);
    return () => {
      abortCtrl?.abort();
      listeners.forEach((l) => l());
      container.remove();
    };
  });
}
