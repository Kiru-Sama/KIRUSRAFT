/**
 * 服务商配置分节（v0.0.31）
 * GUI 插件共用的 profile 设置表单：预设下拉（自动填 baseURL/模型/购买链接）+ 手动编辑字段。
 * 表单控件用 .ks-* 样式类，由各 GUI 的样式表按自己的设计语言提供外观。
 * 生命周期：core-services 注册（GUI 切换不丢失）。
 */
import { Context } from '@deepseek-ai/cordis';
import { PROVIDER_PRESETS, getPreset } from '../providers/presets';

const FIELDS: { key: string; label: string; placeholder: string; password?: boolean }[] = [
  { key: 'baseURL', label: 'Base URL', placeholder: 'https://api.deepseek.com' },
  { key: 'model', label: '模型', placeholder: 'deepseek-chat' },
  { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', password: true },
];

/** 生成预设下拉 option（官方 / 中转分两组） */
function presetOptionsHtml(currentId: string): string {
  const groups: { label: string; presets: typeof PROVIDER_PRESETS }[] = [
    { label: '官方服务商', presets: PROVIDER_PRESETS.filter((p) => p.group === 'official') },
    { label: '聚合 / 中转', presets: PROVIDER_PRESETS.filter((p) => p.group === 'relay') },
  ];
  return groups
    .map(
      (g) =>
        `<optgroup label="${g.label}">` +
        g.presets
          .map((p) => `<option value="${p.id}" ${p.id === currentId ? 'selected' : ''}>${p.name}</option>`)
          .join('') +
        '</optgroup>',
    )
    .join('');
}

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
      },
      render: (container, get, set) => {
        const cur = get();
        const curId = String(cur.id ?? 'deepseek');
        const preset = getPreset(curId);

        // 预设选择器
        const presetLabel = document.createElement('label');
        presetLabel.className = 'ks-label';
        presetLabel.textContent = '服务商预设（选择后自动填 Base URL 与模型）';
        const presetSelect = document.createElement('select');
        presetSelect.className = 'ks-input';
        presetSelect.innerHTML = presetOptionsHtml(curId);
        presetSelect.addEventListener('change', () => {
          const p = getPreset(presetSelect.value);
          if (p) {
            set({
              ...get(),
              id: p.id,
              baseURL: p.baseURL,
              model: p.model,
              ...(p.kind === 'anthropic' ? {} : {}), // 协议类型由 provider 插件按 id 分发，无需存
            });
          }
        });
        container.appendChild(presetLabel);
        container.appendChild(presetSelect);

        // 密钥购买链接（贴心附上）
        if (preset?.keyUrl) {
          const linkRow = document.createElement('div');
          linkRow.style.cssText = 'margin:4px 0 10px;font-size:12px;';
          const a = document.createElement('a');
          a.href = preset.keyUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = `获取 ${preset.name} 的 API 密钥 ↗`;
          a.style.cssText = 'color:var(--ex-accent,#4f6ef7);font-weight:bold;text-decoration:underline;';
          linkRow.appendChild(a);
          container.appendChild(linkRow);
        } else if (curId === 'custom') {
          const hint = document.createElement('div');
          hint.className = 'ks-hint';
          hint.textContent = '自定义中转：填入任意 OpenAI 兼容中转站的 Base URL 与密钥';
          hint.style.cssText = 'font-size:11px;color:var(--ex-text3,#8a90a0);margin:4px 0 10px;';
          container.appendChild(hint);
        }

        // 手动字段
        for (const f of FIELDS) {
          const label = document.createElement('label');
          label.className = 'ks-label';
          label.textContent = f.label;
          const input = document.createElement('input');
          input.className = 'ks-input';
          input.type = f.password ? 'password' : 'text';
          input.value = String(cur[f.key] ?? '');
          input.placeholder = f.placeholder;
          input.addEventListener('input', () => {
            set({ ...get(), [f.key]: input.value });
          });
          container.appendChild(label);
          container.appendChild(input);
        }

        // 当前预设说明
        if (preset?.note) {
          const note = document.createElement('div');
          note.className = 'ks-hint';
          note.textContent = preset.note;
          note.style.cssText = 'font-size:11px;color:var(--ex-text3,#8a90a0);margin-top:4px;';
          container.appendChild(note);
        }
      },
    });
  } catch (error) {
    if (String(error).includes('已注册')) return; // 已存在，跳过
    throw error;
  }
}
