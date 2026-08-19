/**
 * get_time_info 工具插件（v0.0.1）
 * 内核抽象层的第一个验证插件：演示"新能力 = 一个插件文件 + 注册一行"。
 */
import { Context } from '@deepseek-ai/cordis';
import type { PluginManifest } from '../core/manifest';

export const name = 'tool-time';
export const inject = ['tools'];

export const manifest: PluginManifest = {
  name,
  kind: 'tool',
  label: { zh: '时间工具', en: 'Time Tool' },
  group: '工具',
  inject,
  description: 'get_time_info：获取当前日期和时间',
  apply,
};

export function apply(ctx: Context): void {
  ctx.tools.register(ctx, {
    name: 'get_time_info',
    description: '获取当前的日期和时间，用于回答"现在几点""今天几号"之类的问题',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const now = new Date();
      const text = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'long',
        hour12: false,
      });
      return [{ type: 'text', text: `当前时间: ${text}` }];
    },
  });
}
