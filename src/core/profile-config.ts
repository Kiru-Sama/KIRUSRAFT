/**
 * 服务商配置分节（v0.0.37 极简版）
 * 参考 RikkaHub/Reasonix/dsh 的交互范式重写：
 *   选服务商卡片（点选即预填 baseURL/模型）→ 只填 API Key → 模型自动检测（/models）+ 预设兜底。
 *   高级项（Base URL/模型手动）折叠进 <details>，默认不打扰。
 * 表单控件用 .ks-* 样式类，由各 GUI 的样式表按自己的设计语言提供外观。
 * 生命周期：core-services 注册（GUI 切换不丢失）。
 */
import { Context } from '@deepseek-ai/cordis';
import { PROVIDER_PRESETS, getPreset, type ProviderPreset } from '../providers/presets';

/** 主面板唯一必填：API Key；其余（模型）自动检测，高级折叠 */
export function registerProfileConfig(ctx: Context): void {
  // 幂等：已注册则跳过（core-services 只注册一次，防御重挂）
  try {
    ctx.config.register(ctx, {
      namespace: 'profile',
      displayName: '服务商',
      defaults: {
        id: 'deepseek',
        baseURL: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: '',
        // 协议：deepseek/双协议预设默认 responses（最新）；单协议预设忽略此字段
        protocol: 'responses',
      },
      render: (container, get, set) => {
        const cur = get();
        const curId = String(cur.id ?? 'deepseek');
        const preset = getPreset(curId);
        const esc = (s: string): string =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // ===== 1. 服务商预设（默认折叠：details 收起，当前选中高亮；点开网格选服务商） =====
        const pickDetails = document.createElement('details');
        pickDetails.style.cssText = 'margin-bottom:8px;';
        const pickSummary = document.createElement('summary');
        pickSummary.style.cssText =
          'font-size:12px;color:var(--ex-accent,#4f6ef7);font-weight:bold;cursor:pointer;padding:6px 0;font-family:inherit;user-select:none;';
        pickSummary.textContent = `选择服务商预设（当前：${preset?.name ?? curId}） ▾`;
        pickDetails.appendChild(pickSummary);

        const pickBody = document.createElement('div');
        pickBody.style.cssText = 'padding:4px 0 8px;';
        const groups: { label: string; presets: ProviderPreset[] }[] = [
          { label: '官方服务商', presets: PROVIDER_PRESETS.filter((p) => p.group === 'official') },
          { label: '聚合 / 中转', presets: PROVIDER_PRESETS.filter((p) => p.group === 'relay') },
        ];
        for (const g of groups) {
          const gTitle = document.createElement('div');
          gTitle.textContent = g.label;
          gTitle.style.cssText = 'font-size:11px;color:var(--ex-text3,#8a90a0);margin:10px 0 6px;font-weight:bold;letter-spacing:1px;';
          pickBody.appendChild(gTitle);
          const grid = document.createElement('div');
          // 用 .ex-preset-grid 类（媒体查询可折叠单列）；内联 style 只补间距，不写 grid-template（避免覆盖媒体查询）
          grid.className = 'ex-preset-grid';
          grid.style.cssText = 'gap:8px;margin-bottom:4px;';
          for (const p of g.presets) {
            const card = document.createElement('button');
            card.type = 'button';
            card.style.cssText =
              'padding:8px 10px;border:2px solid ' +
              (p.id === curId ? 'var(--ex-accent,#4f6ef7)' : 'var(--ex-border2,#c3c8d4)') +
              ';background:' +
              (p.id === curId ? 'color-mix(in srgb, var(--ex-accent,#4f6ef7) 15%, transparent)' : 'var(--ex-surface,#fff)') +
              ';color:var(--ex-text,#111);font-size:12px;font-weight:bold;cursor:pointer;text-align:left;font-family:inherit;' +
              'transition:border-color .2s;line-height:1.3;';
            card.title = p.note ?? p.name;
            card.textContent = p.name;
            card.addEventListener('click', () => {
              set({ ...get(), id: p.id, baseURL: p.baseURL, model: p.model });
            });
            grid.appendChild(card);
          }
          pickBody.appendChild(grid);
        }
        pickDetails.appendChild(pickBody);
        container.appendChild(pickDetails);

        // ===== 2. API Key（唯一必填）+ 购买链接 =====
        // ===== 2. API Key（唯一必填）+ 购买链接 =====
        // 结构与模型行一致：label 单独一行（.ks-label）+ 下面 [输入框][隐藏] 一行 stretch 等高
        const keyLabel = document.createElement('div');
        keyLabel.className = 'ks-label';
        keyLabel.textContent = 'API 密钥（必填）';
        container.appendChild(keyLabel);
        const keyRow = document.createElement('div');
        keyRow.style.cssText = 'display:flex;gap:8px;align-items:stretch;';
        const keyInput = document.createElement('input');
        keyInput.className = 'ks-input';
        // 普通键盘即可（用户明确：无需安全键盘）；密钥本身在本地，不强制掩码
        keyInput.type = 'text';
        keyInput.value = String(cur.apiKey ?? '');
        keyInput.placeholder = 'sk-... 粘贴你的密钥';
        keyInput.style.cssText = 'flex:1;min-width:0;width:auto;margin-bottom:0;';
        keyInput.addEventListener('input', () => {
          set({ ...get(), apiKey: keyInput.value });
        });
        keyRow.appendChild(keyInput);
        const keyToggle = document.createElement('button');
        keyToggle.type = 'button';
        // 默认明文（普通键盘），可切隐藏；内联 style 与底下"检测"按钮完全一致（用户明确要求照抄检测按钮）
        keyToggle.textContent = '隐藏';
        keyToggle.style.cssText =
          'align-self:stretch;padding:0 14px;font-size:13px;border:1px solid var(--ex-border2,#c3c8d4);background:var(--ex-surface2,#f2f4f9);color:var(--ex-text,#333);cursor:pointer;font-family:inherit;flex-shrink:0;box-sizing:border-box;display:inline-flex;align-items:center;';
        keyToggle.addEventListener('click', () => {
          const hidden = keyInput.type === 'password';
          keyInput.type = hidden ? 'text' : 'password';
          keyToggle.textContent = hidden ? '隐藏' : '显示';
        });
        keyRow.appendChild(keyToggle);
        container.appendChild(keyRow);

        // 购买链接（贴心附上）
        if (preset?.keyUrl) {
          const link = document.createElement('a');
          link.href = preset.keyUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `还没有密钥？去获取 ${preset.name} 的 API 密钥 ↗`;
          link.style.cssText =
            'display:inline-block;margin:8px 0 4px;font-size:12px;color:var(--ex-accent,#4f6ef7);font-weight:bold;text-decoration:underline;';
          container.appendChild(link);
        }

        // 协议选择（仅支持双协议的预设显示：如 OpenAI 官方可选 Responses / Chat Completions）
        if (preset?.protocols && preset.protocols.length > 1) {
          const protoLabel = document.createElement('label');
          protoLabel.className = 'ks-label';
          protoLabel.textContent = 'API 协议';
          container.appendChild(protoLabel);
          const protoSelect = document.createElement('select');
          protoSelect.className = 'ks-input';
          const curProto = String(cur.protocol ?? 'responses');
          const protoOpts: Record<string, string> = {
            responses: 'Responses API（最新，推荐）',
            chat: 'Chat Completions（兼容）',
          };
          protoSelect.innerHTML = preset.protocols
            .map((p) => `<option value="${p}" ${p === curProto ? 'selected' : ''}>${protoOpts[p] ?? p}</option>`)
            .join('');
          protoSelect.addEventListener('change', () => {
            set({ ...get(), protocol: protoSelect.value as 'responses' | 'chat' });
          });
          container.appendChild(protoSelect);
          const protoHint = document.createElement('div');
          protoHint.className = 'ks-hint';
          protoHint.textContent = 'Responses API 是 OpenAI 最新协议；若部分工具不兼容可切回 Chat Completions。';
          protoHint.style.cssText = 'font-size:11px;color:var(--ex-text3,#8a90a0);margin:2px 0 8px;';
          container.appendChild(protoHint);
        }

        // ===== 3. 模型：自动检测 + 预设兜底 =====
        const modelLabel = document.createElement('div');
        modelLabel.className = 'ks-label';
        modelLabel.textContent = '模型（自动检测，可改）';
        container.appendChild(modelLabel);
        const modelRow = document.createElement('div');
        modelRow.style.cssText = 'display:flex;gap:8px;align-items:stretch;';
        const modelInput = document.createElement('input');
        modelInput.className = 'ks-input';
        modelInput.value = String(cur.model ?? preset?.model ?? '');
        modelInput.placeholder = '模型 ID（如 deepseek-chat）';
        modelInput.style.cssText = 'flex:1;min-width:0;width:auto;margin-bottom:0;';
        modelInput.addEventListener('input', () => {
          set({ ...get(), model: modelInput.value });
        });
        modelRow.appendChild(modelInput);
        const detectBtn = document.createElement('button');
        detectBtn.type = 'button';
        detectBtn.textContent = '检测';
        // 与密钥行"隐藏"按钮同款：细边框（1px）+ align-self:stretch 随输入框等高（按钮形状大小统一）
        detectBtn.style.cssText =
          'align-self:stretch;padding:0 14px;font-size:13px;border:1px solid var(--ex-border2,#c3c8d4);background:var(--ex-surface2,#f2f4f9);color:var(--ex-text,#333);cursor:pointer;font-family:inherit;flex-shrink:0;box-sizing:border-box;display:inline-flex;align-items:center;';
        modelRow.appendChild(detectBtn);
        container.appendChild(modelRow);
        const modelHint = document.createElement('div');
        modelHint.className = 'ks-hint';
        modelHint.textContent = preset?.note ?? '';
        modelHint.style.cssText = 'font-size:11px;color:var(--ex-text3,#8a90a0);margin:4px 0 8px;';
        container.appendChild(modelHint);

        // 自动检测：有 baseURL + apiKey 时调 provider.listModels，填充下拉
        const fillModelOptions = (models: string[]): void => {
          if (models.length === 0) return;
          // 生成 datalist 供模型输入框联想
          let dl = container.querySelector<HTMLDataListElement>('datalist[data-ks-models]');
          if (!dl) {
            dl = document.createElement('datalist');
            dl.dataset.ksModels = '1';
            modelInput.setAttribute('list', 'ks-models');
            container.appendChild(dl);
          }
          dl.innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join('');
          modelHint.textContent = `检测到 ${models.length} 个模型，可直接选择或输入`;
        };
        const runDetect = (): void => {
          const p = get() as { id?: string; baseURL?: string; apiKey?: string };
          if (!p.id || !p.baseURL || !p.apiKey) {
            modelHint.textContent = preset?.note ?? '填入 API 密钥后可自动检测模型';
            return;
          }
          const provider = ctx.providers.get(p.id);
          if (!provider?.listModels) {
            modelHint.textContent = preset?.note ?? '该服务商不支持自动检测，手动输入模型 ID';
            return;
          }
          detectBtn.disabled = true;
          detectBtn.textContent = '检测中...';
          provider
            .listModels(p.baseURL, p.apiKey)
            .then((models) => {
              fillModelOptions(models);
            })
            .catch(() => {
              modelHint.textContent = '检测失败，手动输入模型 ID';
            })
            .finally(() => {
              detectBtn.disabled = false;
              detectBtn.textContent = '检测';
            });
        };
        detectBtn.addEventListener('click', runDetect);
        // 已有 key 时首次渲染自动检测一次
        if (cur.apiKey) setTimeout(runDetect, 0);

        // ===== 4. 高级折叠：Base URL / 手动模型 =====
        const details = document.createElement('details');
        details.style.cssText = 'margin-top:8px;';
        const summary = document.createElement('summary');
        summary.textContent = '高级设置（Base URL / 自定义中转）';
        summary.style.cssText =
          'font-size:11px;color:var(--ex-text2,#555);cursor:pointer;font-weight:bold;padding:4px 0;font-family:inherit;';
        details.appendChild(summary);
        const advLabel = document.createElement('label');
        advLabel.className = 'ks-label';
        advLabel.textContent = 'Base URL（一般不用改）';
        details.appendChild(advLabel);
        const advInput = document.createElement('input');
        advInput.className = 'ks-input';
        advInput.value = String(cur.baseURL ?? '');
        advInput.placeholder = 'https://api.deepseek.com';
        advInput.addEventListener('input', () => {
          set({ ...get(), baseURL: advInput.value });
        });
        details.appendChild(advInput);
        const advHint = document.createElement('div');
        advHint.style.cssText = 'font-size:11px;color:var(--ex-text3,#8a90a0);margin:4px 0 8px;';
        advHint.textContent = '自定义中转站：选"自定义中转"卡片，改这里为你的中转地址（OpenAI 兼容）';
        details.appendChild(advHint);
        container.appendChild(details);
      },
    });
  } catch (error) {
    if (String(error).includes('已注册')) return; // 已存在，跳过
    throw error;
  }
}
