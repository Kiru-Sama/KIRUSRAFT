/**
 * 插件配置校验 schema（v0.0.27）
 * StandardSchemaV1 极简适配器：插件声明 configSchema 后，Cordis 挂载时自动校验+归一。
 * 注意：Cordis 只支持同步校验（fiber.ts resolveConfig 对 async 抛 TypeError），validate 必须同步。
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

export type Schema<T = unknown> = StandardSchemaV1<T>;

/** 极简 StandardSchemaV1 校验器：validate 抛错即校验失败（同步） */
export function defineSchema<T = unknown>(validate: (value: unknown) => T): Schema<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'kirusraft',
      validate(value: unknown): StandardSchemaV1.Result<T> {
        try {
          return { value: validate(value) };
        } catch (error) {
          return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
        }
      },
    },
  };
}
