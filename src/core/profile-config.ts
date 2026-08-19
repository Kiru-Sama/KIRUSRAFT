/**
 * 服务商配置分节（v0.0.19）
 * GUI 插件共用的 profile 设置表单（每个 GUI 挂载时注册，卸载自动反注册）。
 * 表单控件用 .ks-* 样式类，由各 GUI 的样式表按自己的设计语言提供外观。
 */
import { Context } from '@deepseek-ai/cordis';

const FIELDS: { key: string; label: string; placeholder: string; password?: boolean }[] = [
  { key: 'baseURL', label: 'Base URL（含 /v1）', placeholder: 'https://api.deepseek.com/v1' },
  { key: 'model', label: '模型', placeholder: 'deepseek-chat' },
  { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', password: true },
];

export function registerProfileConfig(ctx: Context): void {
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
      for (const f of FIELDS) {
        const label = document.createElement('label');
        label.className = 'ks-label';
        label.textContent = f.label;
        const input = document.createElement('input');
        input.className = 'ks-input';
        input.type = f.password ? 'password' : 'text';
        input.value = String(get()[f.key] ?? '');
        input.placeholder = f.placeholder;
        input.addEventListener('input', () => {
          set({ ...get(), [f.key]: input.value });
        });
        container.appendChild(label);
        container.appendChild(input);
      }
    },
  });
}
