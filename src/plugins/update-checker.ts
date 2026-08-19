/**
 * update-checker 插件（v0.0.9）
 * 检测 KIRUSRAFT 新版本（GitHub releases）+ 下载 APK。
 * 纯 Web 能力（fetch GitHub API），不依赖沙箱。
 * 网络失败（如本机代理 MITM 干扰）时降级为友好提示。
 */
import { Context } from '@deepseek-ai/cordis';
import { VERSION as CURRENT_VERSION } from '../core/version';

export const name = 'update-checker';
export const inject = ['tools'];

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

/** 最近一次 fetch 失败的原因（供调用方显示更具体的提示） */
export let lastFetchError = '';

/** 拉取最新 release 信息，失败返回 null（由调用方读 lastFetchError 提示） */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  lastFetchError = '';
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      if (res.status === 404) lastFetchError = '仓库私有或无 release（私有仓库需配置 GitHub Token）';
      else if (res.status === 403) lastFetchError = 'API 限流（403），请稍后重试';
      else lastFetchError = `GitHub API 错误（HTTP ${res.status}）`;
      return null;
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
      tagName: data.tag_name ?? '',
      name: data.name ?? data.tag_name ?? '',
      body: data.body ?? '',
      apkUrl: apkAsset?.browser_download_url ?? null,
      publishedAt: data.published_at ?? '',
    };
  } catch {
    lastFetchError = '网络不可达';
    return null;
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

export function apply(ctx: Context): void {
  // check_update 工具：模型可调用，也可由内核 GUI 触发
  ctx.tools.register({
    name: 'check_update',
    description: '检查 KIRUSRAFT 是否有新版本（从 GitHub releases 拉取最新版本并对比当前版本）',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const latest = await fetchLatestRelease();
      if (!latest) {
        return [{ type: 'text', text: '检查更新失败：无法访问 GitHub（可能是网络受限），请稍后重试或检查代理设置。' }];
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
