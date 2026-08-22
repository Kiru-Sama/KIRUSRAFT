/**
 * proot 沙箱插件（v0.0.81）
 * 基于 RikkaHub 沙箱机制（参考_RikkaHub_沙箱机制.md）：
 *   - proot 启动（libproot_exec.so + --root-id --link2symlink --kill-on-exit）
 *   - 工作区目录模型（files/linux/tmp）
 *   - 每次命令前修补 rootfs（RootfsPatcher）
 * 工具注册走统一 Tool 六字段契约，通过 Capacitor 桥接调用原生层。
 */
import { Context } from '@deepseek-ai/cordis';
import type { PluginManifest } from '../core/manifest';
import type { UIMessagePart } from '../core/types';
import { logger } from '../core/logger';

export const name = 'sandbox-proot';
export const inject = ['tools', 'storage'];

export const manifest: PluginManifest = {
  name,
  kind: 'tool',
  label: { zh: '沙箱', en: 'Sandbox' },
  group: '工具',
  inject,
  description: 'proot 沙箱：shell 命令执行 / 文件读写 / 工作区管理 / rootfs 安装',
  apply,
};

// ---- 工作区元数据 ----
interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  rootfsInstalled: boolean;
  rootfsUrl?: string;
}

function genId(): string {
  return 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ---- Capacitor 桥接（WebView → 原生 ProotPlugin） ----
interface ProotApi {
  executeCommand(options: { workspaceId: string; command: string; cwd?: string; timeout?: number; stdin?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  createWorkspace(options: { name: string }): Promise<{ id: string }>;
  deleteWorkspace(options: { id: string }): Promise<void>;
  renameWorkspace?(options: { id: string; name: string }): Promise<void>;
  installRootfs(options: { workspaceId: string; url?: string }): Promise<{ progress: number; stage: string }>;
  patchRootfs(options: { workspaceId: string }): Promise<void>;
  readFile(options: { workspaceId: string; path: string }): Promise<{ content: string }>;
  writeFile(options: { workspaceId: string; path: string; content: string }): Promise<void>;
  listFiles(options: { workspaceId: string; path: string }): Promise<{ entries: { name: string; type: 'file' | 'dir'; size: number }[] }>;
  deleteFile?(options: { workspaceId: string; path: string }): Promise<void>;
}
declare const Capacitor: { isNativePlatform: () => boolean; convertFileSrc: (p: string) => string; Plugins?: { ProotPlugin?: ProotApi } } | undefined;

/** 沙箱桥接：封装是否原生平台，非原生环境返回模拟结果 */
function isNative(): boolean {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
}

// v0.0.84：Capacitor 插件从 Capacitor.Plugins 获取（裸全局 ProotPlugin 不存在，之前报 undefined）
function getProot(): ProotApi | undefined {
  try {
    if (typeof Capacitor === 'undefined') return undefined;
    return Capacitor.Plugins?.ProotPlugin;
  } catch {
    return undefined;
  }
}

// ---- 插件入口 ----
export function apply(ctx: Context): void {
  // IndexedDB 键值存储（替代 localStorage/Preferences，成熟方案）
  const loadWorkspaces = async (): Promise<Workspace[]> => {
    try {
      const val = await ctx.storage.getItem<Workspace[]>('sandbox.workspaces');
      return val ?? [];
    } catch { return []; }
  };
  const saveWorkspaces = async (ws: Workspace[]): Promise<void> => {
    await ctx.storage.setItem('sandbox.workspaces', ws);
  };
  // ===== 工作区管理 =====
  ctx.tools.register(ctx, {
    name: 'workspace_create',
    description: '创建一个新的沙箱工作区（生成 UUID，创建 files/linux/tmp 目录）。返回工作区 ID。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工作区名称（字母数字._-）' },
      },
      required: ['name'],
    },
    async execute(args) {
      const name = String(args.name ?? 'default').replace(/[^A-Za-z0-9._-]/g, '_');
      const ws: Workspace = { id: genId(), name, createdAt: Date.now(), rootfsInstalled: false };
      const proot = getProot();
      if (proot) {
        const result = await proot.createWorkspace({ name });
        if (result && result.id) ws.id = result.id;
      }
      const list = await loadWorkspaces();
      list.push(ws);
      await saveWorkspaces(list);
      logger.info('workspace', `创建成功 ${ws.id}(${name}) 列表长度 ${list.length}`);
      return [{ type: 'text', text: `工作区已创建\nID: ${ws.id}\n名称: ${name}` }];
    },
  });

  ctx.tools.register(ctx, {
    name: 'workspace_rename',
    description: '重命名沙箱工作区',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        name: { type: 'string', description: '新名称（字母数字._-）' },
      },
      required: ['workspaceId', 'name'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const name = String(args.name ?? '').replace(/[^A-Za-z0-9._-]/g, '_').trim();
      if (!name) return [{ type: 'text', text: '名称不能为空' }];
      const proot = getProot();
      if (proot?.renameWorkspace) await proot.renameWorkspace({ id, name });
      const list = await loadWorkspaces();
      const ws = list.find((w) => w.id === id);
      if (!ws) return [{ type: 'text', text: `工作区 ${id} 不存在` }];
      ws.name = name;
      await saveWorkspaces(list);
      return [{ type: 'text', text: `工作区已重命名\nID: ${id}\n新名称: ${name}` }];
    },
  });

  ctx.tools.register(ctx, {
    name: 'workspace_list',
    description: '列出所有沙箱工作区（ID/名称/创建时间/rootfs 状态）',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const list = await loadWorkspaces();
      if (list.length === 0) return [{ type: 'text', text: '（无工作区）' }];
      const lines = list.map((w) => `${w.id}  ${w.name}  ${w.rootfsInstalled ? '✓ rootfs' : '✗ 未安装rootfs'}  ${new Date(w.createdAt).toLocaleString('zh-CN')}`);
      return [{ type: 'text', text: lines.join('\n') }];
    },
  });

  ctx.tools.register(ctx, {
    name: 'workspace_delete',
    description: '删除沙箱工作区及其所有数据（不可恢复）',
    needsApproval: true,
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
      },
      required: ['workspaceId'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const proot = getProot();
      if (proot) await proot.deleteWorkspace({ id });
      const list = (await loadWorkspaces()).filter((w) => w.id !== id);
      await saveWorkspaces(list);
      logger.info('workspace', `删除工作区 ${id}`);
      return [{ type: 'text', text: `工作区 ${id} 已删除` }];
    },
  });

  // ===== rootfs 安装 =====
  ctx.tools.register(ctx, {
    name: 'workspace_install_rootfs',
    description: '为工作区安装 Linux rootfs（下载并解压 Alpine/Ubuntu 发行版）。首次使用沙箱前必须执行。',
    needsApproval: true,
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        url: { type: 'string', description: 'rootfs tar.gz 下载地址（可选，默认官方镜像）' },
      },
      required: ['workspaceId'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const url = args.url ? String(args.url) : undefined;
      const proot = getProot();
      if (!proot) {
        return [{ type: 'text', text: isNative() ? '沙箱原生插件未加载（ProotPlugin），请重新构建' : '⚠ 非 Android 环境：rootfs 安装仅支持原生平台。\n已标记工作区 rootfs 为已安装（模拟）。' }];
      }
      await proot.installRootfs({ workspaceId: id, url });
      const list = (await loadWorkspaces()).map((w) => w.id === id ? { ...w, rootfsInstalled: true, rootfsUrl: url } : w);
      await saveWorkspaces(list);
      return [{ type: 'text', text: `rootfs 安装完成（工作区 ${id}）` }];
    },
  });

  // ===== 命令执行 =====
  ctx.tools.register(ctx, {
    name: 'workspace_shell',
    description: '在沙箱工作区内执行 shell 命令。需先安装 rootfs。命令执行前会自动修补 rootfs（DNS/网络/权限）。',
    needsApproval: true,
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        command: { type: 'string', description: '要执行的 shell 命令' },
        cwd: { type: 'string', description: '工作目录（沙箱内路径，默认 /workspace）' },
        timeout: { type: 'number', description: '超时秒数（默认 30，最大 600）' },
      },
      required: ['workspaceId', 'command'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const cmd = String(args.command);
      const cwd = args.cwd ? String(args.cwd) : '/workspace';
      const timeout = Math.min(Number(args.timeout ?? 30), 600);
      const proot = getProot();
      if (!proot) {
        return [{ type: 'text', text: isNative() ? '沙箱原生插件未加载（ProotPlugin），请重新构建' : `[沙箱模拟] 工作区 ${id} 执行命令:\n$ ${cmd}\n（非 Android 环境，命令未实际执行）` }];
      }
      // 执行前修补 rootfs（RikkaHub 每次命令前都调用 RootfsPatcher）
      await proot.patchRootfs({ workspaceId: id }).catch(() => {});
      const result = await proot.executeCommand({ workspaceId: id, command: cmd, cwd, timeout });
      const output = result.stdout.trim() || '(无输出)';
      const err = result.stderr.trim();
      return [{ type: 'text', text: output + (err ? `\n--- stderr ---\n${err}` : '') + `\n\n[退出码: ${result.exitCode}]` }];
    },
  });

  // ===== 文件操作 =====
  ctx.tools.register(ctx, {
    name: 'workspace_read_file',
    description: '读取沙箱工作区内的文件内容。文件大小上限 512KB。',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        path: { type: 'string', description: '文件路径（沙箱内 /workspace 相对路径）' },
      },
      required: ['workspaceId', 'path'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const path = String(args.path);
      const proot = getProot();
      if (!proot) {
        return [{ type: 'text', text: isNative() ? '沙箱原生插件未加载（ProotPlugin），请重新构建' : `[沙箱模拟] 读取 ${id}:${path}\n（非 Android 环境）` }];
      }
      const result = await proot.readFile({ workspaceId: id, path });
      return [{ type: 'text', text: result.content }];
    },
  });

  ctx.tools.register(ctx, {
    name: 'workspace_write_file',
    description: '向沙箱工作区写入文件（覆盖已存在）。目录会自动创建。',
    needsApproval: true,
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        path: { type: 'string', description: '文件路径（沙箱内 /workspace 相对路径）' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['workspaceId', 'path', 'content'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const path = String(args.path);
      const content = String(args.content);
      const proot = getProot();
      if (!proot) {
        return [{ type: 'text', text: isNative() ? '沙箱原生插件未加载（ProotPlugin），请重新构建' : `[沙箱模拟] 写入 ${id}:${path} (${content.length} 字节)\n（非 Android 环境）` }];
      }
      await proot.writeFile({ workspaceId: id, path, content });
      return [{ type: 'text', text: `已写入 ${path} (${content.length} 字节)` }];
    },
  });

  ctx.tools.register(ctx, {
    name: 'workspace_list_files',
    description: '列出沙箱工作区内目录的文件和子目录。',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        path: { type: 'string', description: '目录路径（默认 /workspace）' },
      },
      required: ['workspaceId'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const path = args.path ? String(args.path) : '/workspace';
      const proot = getProot();
      if (!proot) {
        return [{ type: 'text', text: isNative() ? '沙箱原生插件未加载（ProotPlugin），请重新构建' : `[沙箱模拟] 列出 ${id}:${path}\n（非 Android 环境）` }];
      }
      const result = await proot.listFiles({ workspaceId: id, path });
      const lines = result.entries.map((e) => `${e.type === 'dir' ? '[目录]' : '[文件]'} ${e.name}  ${e.type === 'dir' ? '-' : e.size + 'B'}`);
      return [{ type: 'text', text: lines.join('\n') || '(空目录)' }];
    },
  });

  // v0.0.87 文件删除（对齐 RikkaHub 文件三点菜单 Delete）
  ctx.tools.register(ctx, {
    name: 'workspace_delete_file',
    description: '删除沙箱工作区内的文件或空目录（不可恢复）',
    needsApproval: true,
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        path: { type: 'string', description: '文件或空目录路径' },
      },
      required: ['workspaceId', 'path'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const path = String(args.path);
      const proot = getProot();
      if (proot?.deleteFile) await proot.deleteFile({ workspaceId: id, path });
      else if (isNative()) return [{ type: 'text', text: '沙箱原生插件未加载（ProotPlugin），请重新构建' }];
      else return [{ type: 'text', text: `[沙箱模拟] 删除 ${id}:${path}\n（非 Android 环境）` }];
      logger.info('workspace', `删除文件 ${id}:${path}`);
      return [{ type: 'text', text: `已删除 ${path}` }];
    },
  });

  // ===== 技能（预置工具组合） =====
  ctx.tools.register(ctx, {
    name: 'sandbox_skill',
    description: '执行预置的沙箱技能（工作流编排）。可用技能：install_python(安装 Python 环境)、analyze_code(分析代码仓库)、fetch_web(从网页下载文件到工作区)、compress(压缩/解压文件)。',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作区 ID' },
        skill: {
          type: 'string',
          enum: ['install_python', 'analyze_code', 'fetch_web', 'compress'],
          description: '技能名称',
        },
        args: { type: 'string', description: '技能参数（JSON 字符串，不同技能不同）' },
      },
      required: ['workspaceId', 'skill'],
    },
    async execute(args) {
      const id = String(args.workspaceId);
      const skill = String(args.skill);
      const skillArgs: Record<string, unknown> = {};
      try { Object.assign(skillArgs, JSON.parse(String(args.args ?? '{}'))); } catch { /* 忽略 */ }
      // 技能模板：返回指令给 AI 让它按步骤执行
      const skillScripts: Record<string, string> = {
        install_python: `安装 Python 3 及相关工具到工作区 ${id}：
1. workspace_shell(workspaceId="${id}", command="apt-get update -qq && apt-get install -y -qq python3 python3-pip python3-venv git curl wget 2>&1 | tail -5", timeout=120)
2. workspace_shell(workspaceId="${id}", command="python3 --version && pip3 --version")
3. 完成后告知用户可用的 Python 环境`,
        analyze_code: `分析代码仓库 ${id}（需先上传代码到工作区）：
1. workspace_list_files(workspaceId="${id}", path="/workspace")
2. 对每个源文件 workspace_read_file
3. 统计代码行数、结构、依赖
4. 输出分析报告`,
        fetch_web: `下载文件到工作区 ${id}：
1. workspace_shell(workspaceId="${id}", command="cd /workspace && curl -sL '${skillArgs.url ?? ''}' -o '${skillArgs.filename ?? 'download'}'", timeout=60)
2. workspace_list_files(workspaceId="${id}", path="/workspace")`,
        compress: `压缩/解压文件到工作区 ${id}：
${skillArgs.action === 'compress' ? `1. workspace_shell(workspaceId="${id}", command="cd /workspace && tar -czf ${skillArgs.output ?? 'archive.tar.gz'} ${skillArgs.target ?? '.'}", timeout=30)` : `1. workspace_shell(workspaceId="${id}", command="cd /workspace && tar -xzf ${skillArgs.file ?? 'archive.tar.gz'}", timeout=30)`}
2. workspace_list_files(workspaceId="${id}", path="/workspace")`,
      };
      const script = skillScripts[skill] ?? `未知技能：${skill}`;
      return [{ type: 'text', text: `## 技能：${skill}\n\n请按以下步骤执行：\n\n${script}` }];
    },
  });
}