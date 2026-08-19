/**
 * 兜底 GUI（v0.0.19）
 * 内核自带的极简聊天界面，不依赖任何 UI 插件。
 * 主题 GUI 全部加载失败 / 用户选择"默认"时，这个界面保证"内核在就有界面"。
 * 聊天状态机已抽取到 chat-controller，本插件只负责布局、样式与入口。
 */
import { Context } from '@deepseek-ai/cordis';
import { createChatController } from '../core/chat-controller';
import { registerProfileConfig } from '../core/profile-config';
import { logger } from '../core/logger';
import type { UIMessagePart } from '../core/types';

export const name = 'fallback-gui';
export const inject = ['providers', 'tools', 'config', 'storage', 'topology'];

export interface Config {
  /** 挂载根节点，缺省取 #app */
  root?: HTMLElement;
}

export function apply(ctx: Context, config: Config): void {
  // 防御：重挂时可能收到空配置（TopologyService 已给 {}，这里再兜一层）
  const root = config?.root ?? document.getElementById('app');
  if (!root) throw new Error('fallback-gui: 找不到挂载节点');

  // 服务商配置分节（共享实现，样式类 .ks-* 由本插件样式表提供）
  registerProfileConfig(ctx);

  const container = document.createElement('div');
  container.className = 'fg-root';
  container.innerHTML = `
    <style>
      /* ---- 整体布局：浅色背景 + 强调色（靛蓝），圆角/留白/柔和阴影 ---- */
      .fg-root{display:flex;flex-direction:column;height:100%;position:relative;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;background:#f7f8fa;color:#1f2328;}
      /* ---- 顶栏：白色卡片感，Logo 强调色 + 兜底徽章；顶部安全区（状态栏/刘海）适配 ---- */
      [data-fg="header"]{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:calc(12px + env(safe-area-inset-top,0px)) 20px 12px;background:#ffffff;border-bottom:1px solid #ececf1;flex-shrink:0;}
      [data-fg="header"] strong{font-size:15px;font-weight:600;letter-spacing:.3px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      [data-fg="header"] > div{display:flex;flex-shrink:0;}
      .fg-logo{color:#4f6ef7;}
      .fg-badge{display:inline-block;margin-left:8px;padding:2px 10px;border-radius:999px;background:#eef1ff;color:#4f6ef7;font-size:11px;font-weight:500;letter-spacing:.5px;white-space:nowrap;}
      .fg-ghost-btn{position:relative;background:transparent;border:1px solid #d9dce3;color:#3c4353;padding:6px 14px;border-radius:999px;font-size:13px;cursor:pointer;transition:all .18s ease;white-space:nowrap;}
      .fg-ghost-btn:hover{background:#f2f4f9;border-color:#c3c8d4;}
      .fg-ghost-btn + .fg-ghost-btn{margin-left:6px;}
      /* 异常红点：有 FAILED 插件时内核按钮显示（原 FAB 红点迁移到唯一入口上） */
      .fg-reddot{position:absolute;top:-4px;right:-4px;width:12px;height:12px;border-radius:50%;background:#e5484d;border:2px solid #fff;display:none;}
      /* ---- 日志面板：保持深色，适合代码/日志查看 ---- */
      [data-fg="logpanel"]{display:none;position:absolute;inset:0;background:#1e1e1e;color:#d4d4d4;font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:12px;flex-direction:column;z-index:10;}
      [data-fg="logpanel"] > div:first-child{display:flex;justify-content:space-between;align-items:center;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;background:#2a2d35;border-bottom:1px solid #3a3d45;}
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
      /* ---- 共享设置表单（.ks-*，profile 配置分节用） ---- */
      .ks-label{display:block;font-size:12px;color:#5a6172;margin:12px 0 4px;}
      .ks-input{width:100%;padding:8px 12px;border:1px solid #dfe2ea;border-radius:8px;font-size:13px;box-sizing:border-box;background:#f7f8fa;color:#1f2328;outline:none;transition:border-color .15s ease,background .15s ease;}
      .ks-input:focus{border-color:#4f6ef7;background:#fff;}
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
        <button data-fg="kernelBtn" class="fg-ghost-btn">内核<span class="fg-reddot"></span></button>
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
  const kernelBtn = container.querySelector('[data-fg="kernelBtn"]') as HTMLButtonElement;
  const redDot = kernelBtn.querySelector('.fg-reddot') as HTMLElement;
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

  // 聊天状态机（共享控制器：会话/流式/落盘/事件）
  const controller = createChatController(ctx, {
    messages: msgEl,
    input: inputEl,
    send: sendEl,
    stop: stopEl,
    status: statusEl,
    webSearch: webSearchEl,
    renderMessage: (role: 'user' | 'ai', parts: UIMessagePart[]): HTMLElement => {
      const bubble = document.createElement('div');
      bubble.className = role === 'user' ? 'fg-bubble fg-user' : 'fg-bubble fg-ai';
      bubble.textContent = parts.map((p) => (p.type === 'text' ? p.text : '[图片]')).join('\n');
      return bubble;
    },
    onRequireSettings: openSettings,
  });

  logger.info('gui', '兜底 GUI 已挂载');

  // 生命周期：副作用回收（Cordis effect 模式，卸载时自动逆序清理）
  ctx.effect(() => {
    sendEl.addEventListener('click', controller.send);
    inputEl.addEventListener('keydown', (e) => {
      // 中文输入法组合态（isComposing）回车不应发送
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) controller.send();
    });
    stopEl.addEventListener('click', controller.stop);
    settingsBtn.addEventListener('click', openSettings);
    // 顶栏"内核"按钮：唤起 kernel-gui 管理面板（v0.0.19 起兜底 GUI 的唯一内核入口）
    kernelBtn.addEventListener('click', () => {
      ctx.emit('kernel-gui:open');
    });
    // 异常红点：有 FAILED 插件时内核按钮显示红点
    const updateDot = () => {
      try {
        const topo = ctx.topology.getTopology();
        redDot.style.display = topo.nodes.some((n) => n.stateCode === 3) ? 'block' : 'none';
      } catch {
        redDot.style.display = 'none';
      }
    };
    ctx.on('internal/status', updateDot);
    ctx.on('internal/plugin', updateDot);
    updateDot();
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
      controller.dispose();
      container.remove();
    };
  });
}
