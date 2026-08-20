/**
 * update-checker 插件（v0.0.9）
 * 检测 KIRUSRAFT 新版本（GitHub releases）+ 下载 APK。
 * 纯 Web 能力（fetch GitHub API），不依赖沙箱。
 * 网络失败（如本机代理 MITM 干扰）时降级为友好提示。
 */
import { Context, Service } from '@deepseek-ai/cordis';
import { VERSION as CURRENT_VERSION } from '../core/version';
import type { PluginManifest } from '../core/manifest';

export const name = 'update-checker';
export const inject = ['tools'];

export const manifest: PluginManifest = {
  name,
  kind: 'utility',
  label: { zh: '更新检测', en: 'Update Checker' },
  group: '工具',
  inject,
  provide: 'update',
  protected: true,
  description: '检测新版本（GitHub releases）+ 下载 APK',
  apply,
};
const REPO_OWNER = 'Kiru-Sama';
const REPO_NAME = 'KIRUSRAFT';
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

interface ReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  apkUrl: string | null;
  publishedAt: string;
}

/** 拉取结果：info 为成功时的版本信息，error 为失败原因（返回体携带，避免模块级可变状态并发覆盖，RikkaHub StateFlow 思路） */
export interface FetchResult {
  info: ReleaseInfo | null;
  error: string;
}

/** 拉取最新 release 信息，失败返回 info=null + error（由调用方直接读 error 提示） */
export async function fetchLatestRelease(): Promise<FetchResult> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      if (res.status === 404) return { info: null, error: '仓库私有或无 release（私有仓库需配置 GitHub Token）' };
      if (res.status === 403) return { info: null, error: 'API 限流（403），请稍后重试' };
      return { info: null, error: `GitHub API 错误（HTTP ${res.status}）` };
    }
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    const apkAsset = (data.assets ?? []).find((a) => a.name?.endsWith('.apk'));
    return {
      info: {
        tagName: data.tag_name ?? '',
        name: data.name ?? data.tag_name ?? '',
        body: data.body ?? '',
        apkUrl: apkAsset?.browser_download_url ?? null,
        publishedAt: data.published_at ?? '',
      },
      error: '',
    };
  } catch {
    return { info: null, error: '网络不可达' };
  }
}

/** 对比版本：只比较三段式数字，返回是否更新 */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const clean = v.replace(/^v/, '').split('-')[0];
    return clean.split('.').map((n) => parseInt(n, 10) || 0);
  };
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** 下载 APK 到 Blob，返回 Blob 与文件名 */
export async function downloadApk(url: string): Promise<{ blob: Blob; filename: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    const seg = url.split('/').pop() ?? '';
    const filename = seg.split(/[?#]/)[0] || 'KIRUSRAFT-update.apk';
    return { blob, filename };
  } catch {
    return null;
  }
}

/** 更新检测服务：解耦 kernel-gui 对 update-checker 模块函数的直接 import（插件 A 不再静态 import 插件 B） */
export class UpdateService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'update');
  }

  /** 拉取最新 release（返回 FetchResult：info + error） */
  checkLatest(): Promise<FetchResult> {
    return fetchLatestRelease();
  }

  /** 下载 APK 到 Blob */
  download(url: string): Promise<{ blob: Blob; filename: string } | null> {
    return downloadApk(url);
  }

  /** 版本对比（委托模块级 isNewer 纯函数） */
  compareVersion(latest: string, current: string): boolean {
    return isNewer(latest, current);
  }
}

export function apply(ctx: Context): void {
  // 注册更新检测服务（kernel-gui 等通过 inject ['update'] 使用，不再直接 import 模块函数）
  new UpdateService(ctx);

  // check_update 工具：模型可调用
  ctx.tools.register(ctx, {
    name: 'check_update',
    description: '检查 KIRUSRAFT 是否有新版本（从 GitHub releases 拉取最新版本并对比当前版本）',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const { info: latest, error } = await fetchLatestRelease();
      if (!latest) {
        return [{ type: 'text', text: `检查更新失败：${error || '无法访问 GitHub（可能是网络受限）'}，请稍后重试或检查代理设置。` }];
      }
      if (!latest.tagName) {
        return [{ type: 'text', text: '未找到版本信息。' }];
      }
      if (isNewer(latest.tagName, CURRENT_VERSION)) {
        const line = `发现新版本 ${latest.tagName}（当前 ${CURRENT_VERSION}）`;
        const body = latest.body ? `\n更新说明：\n${latest.body.slice(0, 500)}` : '';
        return [{ type: 'text', text: `${line}${body}` }];
      }
      return [{ type: 'text', text: `已是最新版本 ${CURRENT_VERSION}（远端 ${latest.tagName}）` }];
    },
  });
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    update: UpdateService;
  }
}
