/**
 * 配置中心服务（v0.0.4）
 * 内核抽象层：schema 驱动配置，插件注册配置分节，统一持久化 + 变更通知。
 * 参考 dsh 的 installSettingsSection，但简化为 KIRUSRAFT 的体量。
 */
import { Service, Context } from '@deepseek-ai/cordis';

/** 配置分节：一个插件的一块配置 */
export interface ConfigSection {
  /** 唯一命名空间（如 'profile'、'ui'） */
  namespace: string;
  /** 显示名（设置面板里展示） */
  displayName: string;
  /** 默认值 */
  defaults: Record<string, unknown>;
  /** 渲染设置表单：把控件挂到 container，通过 get/set 读写本分节配置 */
  render?: (
    container: HTMLElement,
    get: () => Record<string, unknown>,
    set: (value: Record<string, unknown>) => void,
  ) => void;
}

export class ConfigService extends Service {
  private sections = new Map<string, ConfigSection>();
  private values = new Map<string, Record<string, unknown>>();
  private listeners = new Map<string, Set<(value: Record<string, unknown>) => void>>();

  constructor(ctx: Context) {
    super(ctx, 'config');
  }

  /**
   * 注册配置分节，返回 disposer。
   * 必须传调用方插件自己的 ctx（effect 绑定调用方 fiber，插件卸载时自动反注册）
   */
  register(ctx: Context, section: ConfigSection): () => void {
    if (this.sections.has(section.namespace)) {
      // P2-9：重复注册不抛错（双挂载/重复 bootstrap 场景会直接 throw 导致插件 FAILED），
      // 改为警告 + 返回 no-op disposer，保持降级不崩
      // eslint-disable-next-line no-console
      console.warn(`[config] 配置分节 "${section.namespace}" 已注册，忽略重复注册`);
      return () => undefined;
    }
    this.sections.set(section.namespace, section);
    // 加载持久化值，合并默认
    this.values.set(section.namespace, { ...section.defaults, ...this.load(section.namespace) });
    const dispose = ctx.effect(() => () => {
      this.sections.delete(section.namespace);
      this.values.delete(section.namespace);
    });
    return () => void dispose();
  }

  /** 读配置（返回浅拷贝，防止外部改内部状态绕过持久化） */
  get(namespace: string): Record<string, unknown> {
    return { ...(this.values.get(namespace) ?? {}) };
  }

  /** 写配置：与 defaults 合并（防止部分写入丢字段）+ 持久化 + 通知监听者 */
  set(namespace: string, value: Record<string, unknown>): void {
    // P2-10：未注册 namespace 的写入是幽灵键（插件卸载后残留），warn 提示开发期可发现；
    // 不拒绝——时序上可能存在 set 先于 register（如 docking 懒加载），拒绝会丢数据。
    if (!this.sections.has(namespace)) {
      // eslint-disable-next-line no-console
      console.warn(`[config] 写入未注册配置分节 "${namespace}"，可能残留幽灵键`);
    }
    const merged = { ...(this.sections.get(namespace)?.defaults ?? {}), ...value };
    this.values.set(namespace, merged);
    this.persist(namespace, merged);
    this.listeners.get(namespace)?.forEach((cb) => cb(merged));
  }

  /** 订阅变更，返回 disposer */
  onChange(namespace: string, cb: (value: Record<string, unknown>) => void): () => void {
    if (!this.listeners.has(namespace)) this.listeners.set(namespace, new Set());
    this.listeners.get(namespace)!.add(cb);
    return () => {
      this.listeners.get(namespace)?.delete(cb);
    };
  }

  /** 列出全部分节（设置面板用） */
  list(): ConfigSection[] {
    return [...this.sections.values()];
  }

  private load(namespace: string): Record<string, unknown> {
    try {
      const raw = localStorage.getItem(`kirusraft.config.${namespace}`);
      if (raw) return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* 忽略损坏配置 */
    }
    return {};
  }

  private persist(namespace: string, value: Record<string, unknown>): void {
    try {
      localStorage.setItem(`kirusraft.config.${namespace}`, JSON.stringify(value));
    } catch {
      /* 存储不可用时静默 */
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    config: ConfigService;
  }
}
