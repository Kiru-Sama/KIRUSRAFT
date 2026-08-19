/**
 * update-checker 插件（v0.0.9）
 * 检测 KIRUSRAFT 新版本（GitHub releases）+ 下载 APK。
 * 纯 Web 能力（fetch GitHub API），不依赖沙箱。
 * 网络失败（如本机代理 MITM 干扰）时降级为友好提示。
 */
import { Context } from '@deepseek-ai/cordis';

export const name = 'update-checker';
export const inject = ['tools'];

const REPO_OWNER = 'Kiru-Sama';
const REPO_NAME = 'KIRUSRAFT';
export const CURRENT_VERSION = '0.0.9';
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

interface ReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  apkUrl: string | null;
  publishedAt: string;
}

/** 拉取最新 release 信息，失败返回 null（由调用方提示） */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
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
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const filename = url.split('/').pop() ?? 'KIRUSRAFT-update.apk';
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
