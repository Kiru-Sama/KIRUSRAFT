/**
 * 插件统一插槽（manifest）契约（v0.0.27）
 * 全插件设计的地基：每个插件导出 manifest，声明自己的元数据（类型/双语名/分组/依赖/受保护/GUI 能力）。
 * 内核按 manifest 装配：index.ts 遍历注册 + 挂载、插件管理 UI 直接读 manifest 渲染、GUI 仲裁读 providesGui。
 * 新能力 = 一个插件文件（含 manifest）+ index.ts 注册一行，不动其他内核代码。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/** 插件类型（插槽分类） */
export type PluginKind = 'core' | 'ui-theme' | 'tool' | 'provider' | 'gui' | 'utility';

/** 插件功能区（插件管理分组；manifest 自带，UI 直接读，不再硬编码翻译表） */
export type PluginGroup = '基础' | '界面' | '主题' | '服务商' | '工具';

/** 插件统一插槽 */
export interface PluginManifest {
  /** 唯一 id（Cordis runtime name） */
  name: string;
  /** 插件类型 */
  kind: PluginKind;
  /** 双语显示名（插件管理 UI 展示：中文 + 英文） */
  label: { zh: string; en: string };
  /** 功能区（插件管理分组） */
  group: PluginGroup;
  /** 依赖的内核服务（Cordis inject；激活依赖门控：依赖未就绪保持 PENDING，依赖卸载自动卸载） */
  inject?: string[];
  /** 插件声明的服务（Cordis provide；声明式服务图谱，拓扑 edges 未来可由它生成） */
  provide?: string | string[];
  /** 配置校验 schema（StandardSchemaV1；声明后 ctx.plugin 自动校验+归一，非法配置进 FAILED 而非运行时崩） */
  configSchema?: StandardSchemaV1<any, any>;
  /** 是否自带完整 GUI（主题插件的 GUI 仲裁用；true = 进软件直接进该主题） */
  providesGui?: boolean;
  /** 是否受保护（禁用会破坏内核/兜底，需二次确认） */
  protected?: boolean;
  /** 一句话描述（插件管理 UI 可选展示） */
  description?: string;
  /** 插件主体（Cordis 插件模块：apply 挂载逻辑；config 由插件自定义 Config 结构，any 宽泛兼容各插件签名） */
  apply: (ctx: Context, config?: any) => unknown;
}

/** 把 manifest 转成 Cordis 插件对象：激活 inject 依赖门控 / provide 服务声明 / Config 配置校验 */
export function toCordisPlugin(m: PluginManifest) {
  return {
    name: m.name,
    apply: m.apply,
    inject: m.inject,
    provide: m.provide,
    Config: m.configSchema,
  };
}
