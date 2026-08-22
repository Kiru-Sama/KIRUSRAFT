/**
 * ui-exdark 主题 GUI 插件（v0.0.20）
 * APITOOL Exdark 设计语言的完整迁移版：暗色底 + 青绿强调 + 橙色硬阴影 + 玻璃侧边栏 + 视差背景。
 * 自带完整聊天 GUI（侧边栏会话 + 顶栏 + 消息区 + 输入区），进软件直接进入本界面。
 * 主题系统约定：kind='ui-theme'，gui-registry 登记 providesGui=true → 挂载时兜底 GUI 不挂载。
 * v0.0.20 UI/UX 增强（保持 Exdark 设计语言，向后兼容 chat-controller 契约）：
 *   A 顶栏：会话标题可点击改名、模型 chip 点击进配置、清空会话入口、防挤压
 *   B 侧边栏：会话搜索、置顶（UI 本地存储，不动数据层）、时间分组、增强空态引导、选中态高亮、底部按钮分组
 *   C 消息区：轻量安全 Markdown（白名单标签 + 全量转义）、时间戳/角色标识/复制/重发、空会话引导
 *   D 输入区：textarea 1-4 行自动增高、发送禁用态、字符计数
 *   E 移动端：抽屉遮罩层（点外关闭）
 *   F 主题令牌一致性：去除硬编码色值，全部走 --ex-*
 */
import { Context } from '@deepseek-ai/cordis';
import { createChatController } from '../core/chat-controller';
import { createSession } from '../core/session';
import { logger, filterByRange, renderEntry, type LogRange } from '../core/logger';
import { defineSchema } from '../core/schema';
import { VERSION } from '../core/version';
import type { UIMessagePart, Message } from '../core/types';
import { resolveModelCapabilities } from '../providers/model-catalog';
import type { PluginManifest } from '../core/manifest';

/** 用量脚注（v0.0.84 主线 B）：AI 消息底部 tokens / tok/s / 耗时，对齐 RikkaHub TokenUsage */
function renderUsageFooter(message: Message): HTMLElement {
  const u = message.usage!;
  const dur = message.durationSec ?? 0;
  const rate = dur > 0 ? (u.outputTokens / dur).toFixed(1) : '-';
  const fmt = (n: number): string => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  };
  const foot = document.createElement('div');
  foot.className = 'ex-msg-usage';
  foot.textContent = `${fmt(u.totalTokens)} tokens (${fmt(u.cacheInputTokens ?? 0)} cached) · ${fmt(u.outputTokens)} tokens · ${rate} tok/s · ${dur.toFixed(1)}s`;
  return foot;
}

export const name = 'ui-exdark';
/** UI 主题插件元数据：可运行时切换的主题 */
export const kind = 'ui-theme';
/** 依赖的内核服务（不声明 inject 会解析不到服务，主题永远挂载失败） */
export const inject = ['providers', 'tools', 'config', 'storage', 'topology', 'rate'];

export const manifest: PluginManifest = {
  name,
  kind: 'ui-theme',
  label: { zh: '暗黑主题', en: 'Exdark Theme' },
  group: '主题',
  inject,
  providesGui: true,
  configSection: 'ui',
  // 配置 schema 样板：挂载时 Cordis 自动校验（enabled 非布尔即 FAILED）并归一（缺省补默认值）
  configSchema: defineSchema<Config>((value) => {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<Config>;
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
      throw new Error('enabled 必须是布尔值');
    }
    return { enabled: raw.enabled ?? true, root: raw.root };
  }),
  description: 'Exdark 设计语言主题：暗色 + 青绿 + 橙影 + 直角 + 视差（APITOOL 布局全量复刻）',
  apply,
};

export interface Config {
  /** 默认启用 */
  enabled?: boolean;
  /** 挂载根节点，缺省取 #app */
  root?: HTMLElement;
}

/** Exdark 设计令牌（APITOOL .theme-exdark 原样迁移） */
const STYLE = `
.kr-exdark {
  --ex-bg:#1A1A1A; --ex-bg2:#2A2A2A; --ex-bg3:#3D3D3D;
  --ex-accent:#00FFD1; --ex-accent2:#FF8800; --ex-accent3:#FFB04D;
  /* A1：红 = 唯一清除数据（三权分立：青绿主操作 / 橙警告 / 红清除数据） */
  --ex-danger:#E5484D;
  --ex-surface:#2A2A2A; --ex-surface2:#3D3D3D;
  --ex-text:#F0EDE8; --ex-text2:#A0A0A0; --ex-text3:#666666;
  --ex-border:#3D3D3D; --ex-border2:#00FFD1;
  /* A1：硬影全删（Rikka 分层思想）——浮层用柔和投影（0 8px 32px rgba），焦点用青绿光晕 */
  --ex-shadow:0 8px 32px rgba(0,0,0,.5);
  --ex-sidebar-glass: rgba(42,42,42,0.5);
  --ex-sidebar-transition: 0.3s cubic-bezier(0.25,0.8,0.25,1);
  --ex-font: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  height:100%; position:relative; font-family:var(--ex-font);
  color:var(--ex-text); background:var(--ex-bg);
}
.kr-exdark * { margin:0; padding:0; box-sizing:border-box; border-radius:0; }
.kr-exdark ::selection { background:var(--ex-accent); color:var(--ex-bg); }
/* ---- 应用框架：粗边框 + 橙色硬阴影（Exdark 签名特征） ---- */
.ex-app { width:100%; height:100%; background:var(--ex-bg); display:flex; border:1px solid var(--ex-border); box-shadow:var(--ex-shadow); overflow:hidden; position:relative; z-index:1; }
.ex-app .ex-parallax { position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:0; overflow:visible; }
/* ---- 侧边栏：玻璃拟态 + 右侧粗边框，绝对定位抽屉 ---- */
.ex-sidebar { width:260px; background:var(--ex-sidebar-glass); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); color:var(--ex-text); display:flex; flex-direction:column; border-right:1px solid var(--ex-border); position:absolute; top:0; left:0; bottom:0; z-index:50; transform:translateX(0); transition:transform var(--ex-sidebar-transition); will-change:transform; }
.ex-sidebar.hidden { transform:translateX(-100%); }
.ex-sidebar-header { padding:calc(16px + env(safe-area-inset-top,0px)) 16px 12px; border-bottom:1px solid var(--ex-border); background:var(--ex-surface); }
.ex-sidebar-header h2 { font-size:18px; text-transform:uppercase; letter-spacing:3px; color:var(--ex-accent); font-weight:900; }
.ex-sidebar-sub { font-size:11px; color:var(--ex-text2); margin-top:2px; font-weight:bold; letter-spacing:1px; }
.ex-sidebar-stats { font-size:10px; color:var(--ex-text3); margin-top:5px; font-weight:bold; letter-spacing:1px; }
.ex-sidebar-actions { padding:10px 12px; display:flex; flex-direction:column; gap:8px; border-bottom:1px solid var(--ex-border); background:var(--ex-surface); }
.ex-sidebar-row { display:flex; gap:8px; }
.ex-sidebar-row .ex-btn-new { flex:1; }
.ex-sidebar-row .ex-btn-manage { flex-shrink:0; width:auto; padding:10px 12px; }
/* ---- 侧边栏对话管理模式（v0.0.65：批量管理工具条 + 卡片 checkbox/×） ---- */
.ex-manage-bar { display:flex; gap:6px; align-items:center; padding:8px 12px; border-bottom:1px solid var(--ex-border); background:var(--ex-surface); flex-wrap:wrap; }
.ex-manage-btn { background:var(--ex-surface2); border:1px solid var(--ex-border2); color:var(--ex-text2); font-size:10px; padding:4px 8px; cursor:pointer; font-family:var(--ex-font); font-weight:bold; touch-action:manipulation; }
.ex-manage-btn:hover { background:var(--ex-accent); color:var(--ex-bg); }
.ex-manage-btn.ex-manage-exit { border-color:var(--ex-danger); color:var(--ex-danger); }
.ex-manage-btn.ex-manage-exit:hover { background:var(--ex-danger); color:#fff; }
.ex-manage-count { font-size:10px; color:var(--ex-text3); margin-left:auto; }
.ex-conv-check { display:flex; align-items:center; flex-shrink:0; }
.ex-conv-check input { width:15px; height:15px; accent-color:var(--ex-accent); cursor:pointer; }
.ex-conv-del { background:none; border:none; color:var(--ex-danger); font-size:16px; line-height:1; padding:2px 6px; cursor:pointer; flex-shrink:0; font-family:var(--ex-font); }
.ex-conv-del:hover { color:#fff; background:var(--ex-danger); }
.ex-conv-item.manage-selected { border-color:var(--ex-border2); background:var(--ex-surface2); }
/* 会话长按二级菜单（浮层：置顶/分享/管理/删除/重新生成标题） */
.ex-conv-menu { display:none; position:fixed; z-index:4000; min-width:150px; background:var(--ex-surface2); border:1px solid var(--ex-border); box-shadow:0 8px 32px rgba(0,0,0,.5); padding:4px 0; }
.ex-conv-menu.show { display:block; }
.ex-conv-menu-item { display:block; width:100%; padding:10px 14px; background:none; border:none; color:var(--ex-text); font-size:12px; text-align:left; cursor:pointer; font-family:var(--ex-font); }
.ex-conv-menu-item:hover { background:var(--ex-bg3); color:var(--ex-accent); }
.ex-conv-menu-item.danger { color:var(--ex-danger); }
.ex-conv-menu-item.danger:hover { background:var(--ex-danger); color:#fff; }
/* Think 思考强度弹层（浮层：滑块选强度） */
.ex-think-pop { display:none; position:fixed; left:50%; bottom:90px; transform:translateX(-50%); z-index:4000; width:min(340px, 92vw); background:var(--ex-surface2); border:1px solid var(--ex-border); box-shadow:0 8px 32px rgba(0,0,0,.5); padding:20px 22px; }
.ex-think-pop.show { display:block; }
.ex-think-pop::before { content:''; position:absolute; left:50%; bottom:-8px; transform:translateX(-50%); border:8px solid transparent; border-top-color:var(--ex-surface2); border-bottom:none; }
.ex-think-head { font-size:13px; font-weight:900; color:var(--ex-accent); letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
.ex-think-pop .ex-style-slider { width:100%; margin:8px 0 14px; }
.ex-think-value { font-size:16px; color:var(--ex-text); text-align:center; font-weight:900; margin-bottom:4px; }
/* 档位刻度：不思考/自动/低...最大 横排 */
.ex-think-scale { display:flex; justify-content:space-between; font-size:9px; color:var(--ex-text3); padding:0 2px; }
.ex-think-scale span:first-child { color:var(--ex-text3); }
.ex-think-scale span:last-child { color:var(--ex-accent2); }
/* 会话搜索框（RikkaHub 会话搜索借鉴，Exdark 硬边框风格） */
.ex-sidebar-search { padding:8px 10px; border-bottom:1px solid var(--ex-border); background:var(--ex-surface); }
.ex-sidebar-search input { width:100%; padding:7px 10px; background:var(--ex-bg); border:1px solid var(--ex-border2); color:var(--ex-text); font-size:12px; outline:none; font-family:var(--ex-font); box-sizing:border-box; transition:border-color .2s; }
.ex-sidebar-search input:focus { border-color:var(--ex-accent); box-shadow:0 0 0 3px rgba(0,255,209,.18); }
.ex-sidebar-search input::placeholder { color:var(--ex-text3); }
/* 主按钮（APITOOL .btn-new）：青绿底 + 粗边框 + 硬阴影 ---- */
.ex-btn-new { width:100%; padding:10px; background:var(--ex-accent); color:var(--ex-bg); border:1px solid var(--ex-border); font-weight:900; text-transform:uppercase; letter-spacing:2px; box-shadow:0 2px 8px rgba(0,0,0,.3); cursor:pointer; transition:all .2s; font-family:var(--ex-font); font-size:13px; }
.ex-btn-new:hover { background:var(--ex-accent2); transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.35); }
.ex-btn-new:active { transform:translateY(0); box-shadow:0 1px 6px rgba(0,0,0,.25); }
/* ---- 次按钮（APITOOL .btn-manage）：暗底 + 青绿描边 ---- */
.ex-btn-manage { position:relative; width:100%; padding:10px 12px; background:var(--ex-surface2); color:var(--ex-text2); border:1px solid var(--ex-border2); font-weight:900; text-transform:uppercase; letter-spacing:1px; box-shadow:0 1px 6px rgba(0,0,0,.25); cursor:pointer; transition:all .2s; font-family:var(--ex-font); font-size:11px; text-align:left; }
.ex-btn-manage:hover { background:var(--ex-border2); border-color:var(--ex-accent); color:var(--ex-bg); transform:translateY(-2px); box-shadow:0 3px 10px rgba(0,0,0,.3); }
.ex-btn-manage:active { transform:translateY(0); box-shadow:none; }
/* 异常红点：有 FAILED 插件时更多按钮显示（Exdark 语义：accent2 橙 = 错误/警告色；直角方块，无圆角） */
.ex-reddot { position:absolute; top:-4px; right:-4px; width:10px; height:10px; border-radius:0; background:var(--ex-accent2); border:2px solid var(--ex-bg); display:none; }
/* ---- 会话列表：叠卡效果（APITOOL .conv-item 原样）+ 分组组头 + 选中态高亮 ---- */
.ex-conv-list { flex:1; overflow-y:auto; padding:12px 8px 20px; }
.ex-conv-group { font-size:10px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:var(--ex-text3); padding:12px 12px 2px; }
/* 会话项平铺（去叠卡）：普通列表项，无 hover 按钮，长按弹二级菜单 */
.ex-conv-item { position:relative; background:var(--ex-surface); padding:10px 12px; margin-bottom:6px; cursor:pointer; transition:background .2s; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
.ex-conv-item:hover { background:var(--ex-surface2); }
.ex-conv-item.active { background:var(--ex-accent); color:var(--ex-bg); }
.ex-conv-item.pinned { border-left:3px solid var(--ex-accent2); }
.ex-conv-title { font-size:12px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ex-conv-info { font-size:9px; color:var(--ex-text2); display:flex; justify-content:space-between; margin-top:2px; }
.ex-conv-item.active .ex-conv-info { color:var(--ex-bg); }
/* ---- 主区 ---- */
.ex-main { flex:1; display:flex; flex-direction:column; position:relative; overflow:hidden; padding-left:260px; transition:padding-left var(--ex-sidebar-transition); will-change:padding-left; }
.ex-main.full { padding-left:0; }
/* 侧边栏抽屉开关（移动端顶栏内按钮，不遮挡标题；APITOOL .float-toggle-btn 优化） */
.ex-toggle { display:none; background:var(--ex-surface2); color:var(--ex-text); border:1px solid var(--ex-border2); padding:3px 10px; font-size:16px; font-weight:bold; cursor:pointer; box-shadow:0 1px 6px rgba(0,0,0,.25); font-family:var(--ex-font); line-height:1.3; flex-shrink:0; transition:all .2s; }
.ex-toggle:hover { background:var(--ex-border2); color:var(--ex-bg); }
/* 移动端抽屉遮罩：点外关闭（RikkaHub 右栏遮罩借鉴） */
.ex-sidebar-mask { display:none; position:absolute; inset:0; background:rgba(0,0,0,0.55); z-index:45; }
/* ---- 右侧边栏（APITOOL .right-sidebar 复刻：玻璃 + 统计） ---- */
.ex-right-sidebar { position:absolute; top:0; right:0; bottom:0; width:260px; background:var(--ex-sidebar-glass); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); color:var(--ex-text); display:flex; flex-direction:column; border-left:1px solid var(--ex-border); z-index:55; transform:translateX(0); transition:transform var(--ex-sidebar-transition); will-change:transform; }
.ex-right-sidebar.hidden { transform:translateX(100%); }
.ex-right-sidebar-header { padding:calc(16px + env(safe-area-inset-top,0px)) 16px 12px; border-bottom:1px solid var(--ex-border); background:var(--ex-surface); }
.ex-right-sidebar-header h2 { font-size:18px; text-transform:uppercase; letter-spacing:3px; color:var(--ex-accent); font-weight:900; }
.ex-right-sidebar-content { flex:1; overflow-y:auto; padding:16px; }
/* 分支总览（v0.0.65）：列表 + 候选切换 */
.ex-right-stats { background:var(--ex-surface); border:2px solid var(--ex-border); padding:12px; box-shadow:0 1px 6px rgba(0,0,0,.25); }
.ex-right-stats-row { display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:12px; }
.ex-right-stats-label { color:var(--ex-text2); font-weight:bold; }
.ex-right-stats-value { color:var(--ex-accent); font-weight:bold; font-variant-numeric:tabular-nums; }
.ex-right-branch { font-size:12px; color:var(--ex-text3); border:1px dashed var(--ex-border2); padding:14px; margin-bottom:10px; text-align:center; }
.ex-right-link { display:block; width:100%; text-align:center; font-size:11px; color:var(--ex-accent); text-decoration:underline; cursor:pointer; margin:0 0 14px; background:none; border:none; font-family:var(--ex-font); }
.ex-right-stats-divider { height:1px; background:var(--ex-border2); margin:6px 0; opacity:0.3; }
.ex-right-mask { display:none; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.3); z-index:54; }
.ex-right-mask.show { display:block; }
/* ---- 更多按钮 + 更多菜单（APITOOL .more-btn） ---- */
.ex-btn-more { padding:6px 12px; background:var(--ex-surface2); color:var(--ex-text); border:1px solid var(--ex-border2); cursor:pointer; font-size:11px; font-weight:bold; text-transform:uppercase; box-shadow:0 1px 6px rgba(0,0,0,.25); transition:all .2s; font-family:var(--ex-font); position:relative; }
.ex-btn-more:hover { background:var(--ex-border2); color:var(--ex-bg); }
.ex-more-menu { display:none; position:fixed; top:calc(52px + env(safe-area-inset-top,0px)); right:16px; background:var(--ex-surface); border:1px solid var(--ex-border); box-shadow:var(--ex-shadow); z-index:3000; min-width:140px; }
.ex-more-menu.show { display:block; }
.ex-more-item { display:block; width:100%; text-align:left; padding:10px 14px; border:none; background:transparent; color:var(--ex-text); font-size:13px; font-weight:bold; cursor:pointer; font-family:var(--ex-font); }
.ex-more-item:hover { background:var(--ex-border2); color:var(--ex-bg); }
/* ---- 模型下拉（右上角模型名点击展开；Exdark 硬边框 + 直角） ---- */
.ex-model-pop { display:none; position:fixed; top:calc(52px + env(safe-area-inset-top,0px)); right:96px; background:var(--ex-surface); border:1px solid var(--ex-border); box-shadow:var(--ex-shadow); z-index:3000; width:220px; max-height:340px; flex-direction:column; }
.ex-model-pop.show { display:flex; }
.ex-model-pop-head { padding:10px 12px; font-size:12px; font-weight:900; color:var(--ex-accent); border-bottom:2px solid var(--ex-border); letter-spacing:2px; text-transform:uppercase; }
.ex-model-pop-search { padding:8px; border-bottom:2px solid var(--ex-border); }
.ex-model-pop-search input { width:100%; padding:6px 8px; background:var(--ex-bg); border:1px solid var(--ex-border2); color:var(--ex-text); font-size:12px; outline:none; font-family:var(--ex-font); box-sizing:border-box; }
.ex-model-pop-search input:focus { border-color:var(--ex-accent); }
.ex-model-pop-list { flex:1; overflow-y:auto; padding:6px; }
.ex-model-item { display:block; width:100%; text-align:left; padding:8px 10px; border:none; background:transparent; color:var(--ex-text); font-size:12px; cursor:pointer; font-family:var(--ex-font); border-left:3px solid transparent; }
.ex-model-item:hover { background:var(--ex-surface2); border-left-color:var(--ex-accent2); }
.ex-model-item.active { color:var(--ex-accent); border-left-color:var(--ex-accent); font-weight:bold; }
.ex-model-item .ex-model-inner { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; }
.ex-model-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.ex-model-tags { display:flex; gap:3px; flex-shrink:0; }
.ex-model-tag { font-style:normal; font-size:9px; padding:0 4px; border:1px solid var(--ex-border2); color:var(--ex-accent); line-height:1.5; }
.ex-model-empty { padding:14px; font-size:11px; color:var(--ex-text3); text-align:center; }
/* ---- 顶栏：粗底边框 + 青绿标题；顶部安全区（状态栏/刘海）适配 ---- */
.ex-topbar { padding:calc(12px + env(safe-area-inset-top,0px)) 20px 12px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--ex-border); z-index:5; background:var(--ex-surface); flex-wrap:nowrap; gap:8px; }
.ex-topbar-left { display:flex; align-items:center; gap:10px; min-width:0; flex:1 1 auto; }
/* 标题区（Rikka 左对齐两行：大标题 + 模型副标题小字单行省略） */
.ex-title-wrap { min-width:0; flex:1 1 auto; display:flex; flex-direction:column; gap:1px; }
.ex-title-wrap h1 { font-size:20px; letter-spacing:4px; color:var(--ex-accent); font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; cursor:pointer; }
.ex-title-wrap h1:hover { text-decoration:underline; }
/* 模型副标题：小字灰色单行省略，点击开模型选择（去掉状态灯） */
.ex-model-sub { display:block; max-width:100%; background:none; border:none; padding:0; text-align:left; font-size:11px; font-weight:bold; letter-spacing:0.5px; color:var(--ex-text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; font-family:var(--ex-font); transition:color .2s; }
.ex-model-sub:hover { color:var(--ex-accent); }
.ex-topbar-right { display:flex; gap:8px; align-items:center; flex-shrink:0; }
/* 清空会话入口 */
.ex-btn-clear { font-size:10px; padding:4px 10px; border:2px solid var(--ex-border); background:var(--ex-surface2); color:var(--ex-text2); font-weight:bold; cursor:pointer; flex-shrink:0; font-family:var(--ex-font); text-transform:uppercase; letter-spacing:1px; box-shadow:0 1px 6px rgba(0,0,0,.25); transition:all .2s; }
.ex-btn-clear:hover { background:var(--ex-accent2); border-color:var(--ex-accent); color:var(--ex-bg); transform:translateY(-1px); box-shadow:0 3px 10px rgba(0,0,0,.3); }
.ex-btn-clear:active { transform:translateY(0); box-shadow:none; }
/* ---- 消息区（气泡 = 内容 + 底部操作条；v0.0.65 改版：时间在气泡外上方，去角色标签，对齐由 wrap 控制） ---- */
.ex-msgwrap { flex:1; position:relative; display:flex; flex-direction:column; min-height:0; }
/* v0.0.70：messages 必须 min-height:0——flex 列子项默认 min-height:auto，内容多时会撑破 msgwrap
   把 input-area 挤出屏幕/气泡溢出到输入区（"输入框上方挡气泡"根因） */
.ex-messages { flex:1; overflow-y:auto; min-height:0; padding:20px 8px 16px; display:flex; flex-direction:column; position:relative; z-index:1; }
/* 气泡 wrapper：控制宽度与对齐（user 右 / ai 左）；v0.0.67 拉宽到 94%（手机屏窄多利用，留两侧呼吸） */
.ex-msg-wrap { max-width:94%; margin:0 auto 20px; display:flex; flex-direction:column; width:100%; }
.ex-msg-wrap.ex-user { align-items:flex-end; }
.ex-msg-wrap.ex-ai { align-items:flex-start; }
/* 时间戳：气泡上方（AI 靠左 / user 靠右，v0.0.85 居中布局下显式对齐） */
.ex-msg-wrap.ex-ai .ex-msg-time { align-self:flex-start; }
.ex-msg-wrap.ex-user .ex-msg-time { align-self:flex-end; }
/* 时间戳：气泡外上方（小字，弱化） */
.ex-msg-time { font-size:10px; color:var(--ex-text3); margin-bottom:4px; padding:0 4px; }
.ex-message { background:var(--ex-surface2); color:var(--ex-text); line-height:1.6; font-size:13px; position:relative; padding:12px 16px 10px; min-width:120px; width:100%; word-wrap:break-word; word-break:break-word; white-space:pre-wrap; }
/* v0.0.66：用户气泡与 AI 同色（深色），强调边 AI 在左、用户移到右 */
.ex-message.ex-user { border-right:3px solid var(--ex-accent); }
.ex-message.ex-ai { border-left:3px solid var(--ex-accent); }
/* 底部操作条：左下角分支选择（<> n/m）+ 右下角工具（复制/编辑），APITOOL 底部按钮布局。
   v0.0.70：按钮不换行不压缩（气泡适应按钮，而非按钮适应气泡） */
.ex-msg-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; flex-wrap:nowrap; white-space:nowrap; }
/* v0.0.85：操作按钮定位——AI 气泡：操作（复制/编辑）左下、分支 <> 右下；user 气泡：操作右下、分支左下（分支实际由候选>1 的节点触发） */
.ex-msg-wrap.ex-ai .ex-msg-actions { justify-content:flex-start; }
.ex-msg-wrap.ex-ai .ex-msg-tools { margin-left:0; }
.ex-msg-branch { display:flex; align-items:center; gap:2px; font-size:10px; color:var(--ex-text2); flex-shrink:0; }
.ex-msg-arrow { background:none; border:1px solid var(--ex-border2); color:var(--ex-text2); font-size:10px; line-height:1; padding:2px 6px; cursor:pointer; font-family:var(--ex-font); flex-shrink:0; }
.ex-msg-arrow:hover:not(:disabled) { background:var(--ex-accent); color:var(--ex-bg); border-color:var(--ex-accent); }
.ex-msg-arrow:disabled { opacity:.35; cursor:default; }
.ex-msg-count { padding:0 2px; min-width:26px; text-align:center; flex-shrink:0; }
.ex-msg-tools { display:flex; gap:6px; margin-left:auto; flex-shrink:0; }
.ex-msg-btn { background:none; border:1px solid var(--ex-border2); color:var(--ex-text2); font-size:10px; padding:1px 7px; cursor:pointer; transition:all .2s; font-weight:bold; font-family:var(--ex-font); flex-shrink:0; }
.ex-msg-btn:hover { background:var(--ex-accent); color:var(--ex-bg); border-color:var(--ex-accent); }
.ex-msg-btn.copied { background:var(--ex-accent2) !important; color:var(--ex-bg); border-color:var(--ex-accent2) !important; }
/* AI 思考过程（v0.0.84，主线 B）：折叠卡（summary 可展开，对齐 RikkaHub 思考折叠卡） */
.ex-msg-reasoning { margin-bottom:8px; border-left:3px solid var(--ex-accent2); background:var(--ex-bg2); font-size:11px; color:var(--ex-text3); }
.ex-msg-reasoning summary { padding:6px 8px; cursor:pointer; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--ex-text3); font-weight:bold; user-select:none; }
.ex-msg-reasoning summary:hover { color:var(--ex-accent); }
.ex-msg-reasoning summary::before { content:'▸ '; color:var(--ex-accent2); }
.ex-msg-reasoning[open] summary::before { content:'▾ '; }
.ex-msg-reasoning [data-msg-reasoning] { padding:0 8px 6px; white-space:pre-wrap; word-break:break-word; line-height:1.5; font-style:italic; }
.ex-user .ex-msg-reasoning { display:none; } /* 推理只属于 AI */
/* 工作思维流（v0.0.70）：AI 气泡内工具调用状态行（参考成熟 agent 方案，展示 AI 正在做什么） */
.ex-msg-flow { margin-bottom:8px; display:flex; flex-direction:column; gap:2px; }
.ex-msg-flow-line { font-size:10px; color:var(--ex-text3); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:0.5px; }
.ex-msg-flow-line::before { content:'▸ '; color:var(--ex-accent2); }
/* 工具卡（v0.0.84，主线 B）：shell 终端卡 + 通用卡（对齐 RikkaHub 工具卡） */
.ex-tool-card { margin:6px 0; border:1px solid var(--ex-border2); background:var(--ex-surface2); font-size:11px; color:var(--ex-text2); }
.ex-tool-title { padding:5px 8px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:11px; font-weight:bold; color:var(--ex-accent); border-bottom:1px solid var(--ex-border); }
.ex-tool-cmd { margin:0; padding:5px 8px; font-size:10px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; color:var(--ex-text); white-space:pre-wrap; word-break:break-word; }
.ex-tool-args { margin:0; padding:5px 8px; font-size:10px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; color:var(--ex-text3); white-space:pre-wrap; word-break:break-word; }
.ex-tool-out { margin:0; padding:5px 8px; font-size:10px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; color:var(--ex-text2); white-space:pre-wrap; word-break:break-word; border-top:1px solid var(--ex-border); }
.ex-tool-exit { padding:3px 8px; font-size:10px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-weight:bold; }
.ex-tool-exit.ok { color:var(--ex-accent); }
.ex-tool-exit.err { color:var(--ex-accent2); }
.ex-tool-loading { padding:5px 8px; font-size:10px; color:var(--ex-text3); }
/* 思考块 + 工具步骤（v0.0.85 对齐 RikkaHub ChainOfThought/ThinkingBlock）：连续工具聚合折叠，步骤=状态+名称+参数+结果
   white-space:normal 阻断 .ex-message 的 pre-wrap 继承——否则历史模板的换行缩进会被渲染成空白行（间距崩） */
.ex-think-block { margin:6px 0; border:1px solid var(--ex-border); border-left:3px solid var(--ex-accent); background:var(--ex-surface2); white-space:normal; }
.ex-think-block > summary.ex-think-label { padding:6px 10px; font-size:10px; color:var(--ex-text3); cursor:pointer; user-select:none; letter-spacing:0.5px; }
.ex-think-block > summary.ex-think-label::after { content:' ▾'; color:var(--ex-accent2); }
.ex-think-block > summary.ex-think-label:hover { color:var(--ex-accent); }
.ex-tool-step { padding:5px 10px; border-top:1px solid var(--ex-border); white-space:normal; }
.ex-tool-step:first-of-type { border-top:none; }
.ex-tool-step-head { display:flex; align-items:center; gap:7px; }
.ex-tool-step-icon { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; flex-shrink:0; font-size:10px; color:var(--ex-text3); }
.ex-tool-step-icon.run { animation:ex-spin 1s linear infinite; }
.ex-tool-step-icon.ok { color:var(--ex-accent); }
.ex-tool-step-name { font-size:11px; font-weight:700; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; color:var(--ex-text); word-break:break-all; }
.ex-tool-step .ex-tool-args { margin:4px 0 0; padding:4px 6px; background:var(--ex-bg); border-radius:0; border:none; border-top:none; }
.ex-tool-step .ex-tool-out { margin:4px 0 0; padding:4px 6px; background:var(--ex-bg); border-radius:0; border:none; border-top:none; }
.ex-tool-step .ex-tool-loading { padding:4px 6px 0; }
@keyframes ex-spin { to { transform:rotate(360deg); } }
.ex-msg-usage { margin:6px 0 0; font-size:9px; color:var(--ex-text3); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:0.3px; }
/* ---- 消息 Markdown 渲染（仅白名单标签，文本已 esc 全量转义） ---- */
.ex-msg-content > :first-child { margin-top:0; }
.ex-msg-content > :last-child { margin-bottom:0; }
.ex-msg-content p { margin:6px 0; }
.ex-msg-content h1, .ex-msg-content h2, .ex-msg-content h3 { font-weight:900; color:var(--ex-accent); margin:10px 0 6px; letter-spacing:1px; line-height:1.3; }
.ex-msg-content h1, .ex-msg-content h2 { border-bottom:3px solid var(--ex-border); padding-bottom:4px; }
.ex-msg-content h1 { font-size:17px; }
.ex-msg-content h2 { font-size:15px; }
.ex-msg-content h3 { font-size:14px; }
.ex-msg-content code { background:var(--ex-bg2); color:var(--ex-accent2); padding:1px 6px; border:1px solid var(--ex-border2); font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace; font-size:0.88em; word-break:break-word; }
.ex-msg-content pre { background:var(--ex-bg); border:2px solid var(--ex-border); border-left:5px solid var(--ex-accent2); padding:10px 12px; margin:8px 0; overflow-x:auto; box-shadow:0 1px 6px rgba(0,0,0,.25); }
.ex-msg-content pre::before { content:attr(data-lang); display:block; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:var(--ex-text3); margin-bottom:6px; font-family:var(--ex-font); }
.ex-msg-content pre code { background:transparent; border:none; color:var(--ex-text); padding:0; font-size:12px; line-height:1.6; display:block; white-space:pre; }
.ex-msg-content blockquote { border-left:4px solid var(--ex-accent); background:var(--ex-bg2); padding:6px 10px; margin:8px 0; color:var(--ex-text2); }
.ex-msg-content ul, .ex-msg-content ol { padding-left:20px; margin:6px 0; }
.ex-msg-content li { margin:2px 0; }
.ex-msg-content a { color:var(--ex-accent); text-decoration:underline; word-break:break-all; }
.ex-msg-content hr { border:none; border-top:2px dashed var(--ex-border2); margin:10px 0; }
/* 空会话引导（欢迎卡：装饰旋转方块 + 硬投影标题） */
.ex-empty-guide { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; pointer-events:none; text-align:center; padding:24px; z-index:2; }
.ex-empty-guide.hidden { display:none; }
.ex-empty-badge { width:28px; height:28px; background:var(--ex-accent); border:1px solid var(--ex-border); box-shadow:var(--ex-shadow); transform:rotate(15deg); }
.ex-empty-title { font-size:26px; font-weight:900; letter-spacing:6px; color:var(--ex-accent); text-transform:uppercase; text-shadow:4px 4px 0 var(--ex-border); }
.ex-empty-sub { font-size:12px; color:var(--ex-text2); line-height:1.7; }
.ex-empty-hint { font-size:10px; color:var(--ex-text3); letter-spacing:1px; }
.ex-empty-start { pointer-events:auto; max-width:220px; }
/* 状态行（v0.0.71：移入输入区顶部，灰色小字，不占消息区与输入区间隙） */
.ex-status { padding:0 2px 4px; font-size:10px; color:var(--ex-text3); min-height:0; text-align:left; }
/* ---- 输入区（Rikka ChatInput 复刻：圆角0 + 1px 半透明描边 + 半透明 surface + blur；内部工具行 + 输入框） ---- */
.ex-input-area { margin:8px 12px; padding:8px 10px; padding-bottom:calc(8px + env(safe-area-inset-bottom,0px)); background:var(--ex-surface); border:1px solid var(--ex-border); box-shadow:var(--ex-shadow); z-index:5; display:flex; flex-direction:column; gap:8px; }
/* 工具行：左滚动区（模型/深思/搜索/上传）+ 右固定发送 */
.ex-tools-row { display:flex; align-items:center; gap:8px; }
.ex-tools-scroll { display:flex; align-items:center; gap:6px; overflow-x:auto; flex:1; min-width:0; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
.ex-tools-scroll::-webkit-scrollbar { height:0; display:none; }
/* 工具行模型按钮（点击开模型选择） */
.ex-feature-btn { flex-shrink:0; padding:5px 12px; background:var(--ex-surface2); color:var(--ex-text2); border:1px solid var(--ex-border2); font-weight:bold; cursor:pointer; font-size:11px; font-family:var(--ex-font); transition:all .2s; box-shadow:0 1px 6px rgba(0,0,0,.25); white-space:nowrap; }
.ex-feature-btn:hover { background:var(--ex-border2); color:var(--ex-bg); }
.ex-feature-btn.on { background:var(--ex-accent); color:var(--ex-bg); border-color:var(--ex-accent); }
.ex-file-indicator { font-size:10px; color:var(--ex-accent2); white-space:nowrap; flex-shrink:0; }
/* 输入框：透明无边框，最大 5 行自动增高（JS autoResize 同步控制） */
.ex-input-box { position:relative; min-width:0; display:flex; align-items:center; }
.ex-input-area textarea { flex:1; width:100%; padding:4px 40px 4px 0; background:transparent; border:none; resize:none; height:44px; max-height:118px; min-height:40px; font-size:13px; line-height:1.5; outline:none; font-family:var(--ex-font); color:var(--ex-text); min-width:0; }
.ex-input-area textarea::placeholder { color:var(--ex-text3); }
.ex-char-count { position:absolute; right:8px; bottom:4px; font-size:9px; color:var(--ex-text3); pointer-events:none; background:transparent; padding:0 4px; display:none; }
/* 发送按钮：方形直角；有内容青绿实心 / 空禁用灰 / 生成中停止（橙） */
.ex-send-btn { flex-shrink:0; padding:10px 18px; background:var(--ex-accent); color:var(--ex-bg); border:1px solid var(--ex-accent); font-weight:900; text-transform:uppercase; cursor:pointer; transition:all .2s; min-width:64px; font-family:var(--ex-font); font-size:12px; }
.ex-send-btn:hover { background:var(--ex-accent2); border-color:var(--ex-accent2); }
.ex-send-btn:disabled { background:var(--ex-surface2); color:var(--ex-text3); border-color:var(--ex-border); cursor:not-allowed; }
.ex-stop-btn { background:var(--ex-accent2); border-color:var(--ex-accent2); }
/* 继续生成按钮（v0.0.70）：中止后显示，accent 色区分 */
.ex-continue-btn { background:var(--ex-accent); border-color:var(--ex-accent); }
/* ---- 滚动条（APITOOL 风格：细轨 + 青绿滑块） ---- */
.ex-conv-list::-webkit-scrollbar, .ex-messages::-webkit-scrollbar { width:6px; }
.ex-conv-list::-webkit-scrollbar-track, .ex-messages::-webkit-scrollbar-track { background:var(--ex-bg2); border-radius:0; }
.ex-conv-list::-webkit-scrollbar-thumb, .ex-messages::-webkit-scrollbar-thumb { background:var(--ex-border2); border-radius:0; }
.ex-conv-list::-webkit-scrollbar-thumb:hover, .ex-messages::-webkit-scrollbar-thumb:hover { background:var(--ex-accent); }
/* ---- 共享设置表单（.ks-*，profile 配置分节；可能渲染在管理中心浅色面板外，用显式 Exdark 色值） ---- */
.ks-label { display:block; font-size:12px; color:var(--ex-text2); margin:12px 0 4px; }
/* 行内标签（与输入框/按钮同行等高，rikka 行式布局） */
.ks-label-inline { font-size:12px; color:var(--ex-text2); white-space:nowrap; flex-shrink:0; display:inline-flex; align-items:center; }
/* 表单行：行内标签 + 输入框 + 按钮 同行等高（align-items:stretch） */
.ks-row { display:flex; gap:8px; align-items:stretch; margin-bottom:14px; }
.ks-row > .ks-input { flex:1; min-width:0; margin-bottom:0; }
/* 统一表单按钮（密钥隐藏/模型检测等）：与输入框等高，细边框，形状大小一致 */
.ks-btn { align-self:stretch; padding:0 14px; font-size:13px; border:1px solid var(--ex-border2); background:var(--ex-surface2); color:var(--ex-text); cursor:pointer; font-family:var(--ex-font); flex-shrink:0; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; transition:all .15s; }
.ks-btn:hover { background:var(--ex-border2); color:var(--ex-bg); }
.ks-input { width:100%; padding:10px; border:1px solid var(--ex-border2); background:var(--ex-bg); color:var(--ex-text); font-family:var(--ex-font); font-size:13px; box-sizing:border-box; outline:none; transition:border-color .2s; }
.ks-input:focus { border-color:var(--ex-accent); box-shadow:0 0 0 3px rgba(0,255,209,.18); }
.ks-hint { display:block; font-size:11px; color:var(--ex-text3); margin:4px 0 10px; line-height:1.5; }
/* ---- 移动端适配（APITOOL @media max-width:768px 对齐）+ 抽屉遮罩 ---- */
@media (max-width:768px){
  .kr-exdark .ex-app { border-width:2px; box-shadow:0 2px 8px rgba(0,0,0,.3); }
  .ex-main { padding-left:0; }
  .ex-sidebar { transform:translateX(-100%); }
  .ex-sidebar.open { transform:translateX(0); }
  .ex-sidebar-mask { display:none; }
  .ex-sidebar.open + .ex-sidebar-mask { display:block; }
  .ex-toggle { display:block; }
  /* v0.0.85：宽窄屏统一居中气泡（窄屏同走 .ex-msg-wrap 默认 max-width:94% + margin:0 auto） */
  .ex-message { max-width:100%; font-size:12px; padding:10px 12px; margin-bottom:22px; }
  .ex-topbar { padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px; gap:6px; }
  .ex-title-wrap h1 { font-size:16px; letter-spacing:2px; }
  .ex-model-sub { font-size:9px; }
  .ex-btn-clear { font-size:9px; padding:3px 7px; }
  .ex-input-area { margin:6px 8px; padding:6px 8px; padding-bottom:calc(6px + env(safe-area-inset-bottom,0px)); }
  .ex-input-area textarea { font-size:12px; height:40px; min-height:36px; max-height:110px; }
  .ex-send-btn { font-size:11px; padding:8px 14px; min-width:56px; }
  .ex-conv-item { padding:8px 10px; }
  .ex-conv-title { font-size:11px; }
  .ex-conv-info { font-size:8px; }
  .ex-msg-meta { font-size:9px; }
  .ex-char-count { display:none !important; }
  .ex-empty-title { font-size:22px; letter-spacing:4px; }
}
@media (min-width:769px){
  .ex-toggle { display:none; }
  .ex-sidebar-mask { display:none !important; }
  /* 桌面宽屏：气泡不撑满（96% 太宽），回 88% */
  .ex-msg-wrap { max-width:88%; }
}
@media (hover:none){
  /* 触屏无 hover：会话项操作已改为长按菜单，无需此规则 */
}
/* ==================== 设置页（RikkaHub 竖向设置页复刻：全屏 + 横滑标签条 + 竖向卡片组） ==================== */
.ex-modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:var(--ex-bg); z-index:2000; }
.ex-modal.show { display:block; }
/* 更新日志弹层（v0.0.67）：复用设置页头样式，内容区滚动展示 CHANGELOG */
.ex-changelog { position:fixed; inset:0; width:100%; height:100%; z-index:2000; background:var(--ex-bg); display:flex; flex-direction:column; overflow:hidden; color:var(--ex-text); }
.ex-changelog-body { flex:1; overflow-y:auto; padding:16px 20px; }
.ex-changelog-content { margin:0; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; line-height:1.7; color:var(--ex-text2); white-space:pre-wrap; word-break:break-word; }
/* 编辑消息弹窗（v0.0.69，APITOOL editModal 同款）：textarea 大输入区 + 保存/取消 */
.ex-edit-modal { position:fixed; inset:0; width:100%; height:100%; z-index:2000; background:var(--ex-bg); display:flex; flex-direction:column; overflow:hidden; color:var(--ex-text); }
.ex-edit-body { flex:1; overflow-y:auto; padding:16px 20px; }
.ex-edit-textarea { width:100%; height:100%; min-height:300px; padding:12px; background:var(--ex-bg); border:2px solid var(--ex-border2); color:var(--ex-text); font-family:var(--ex-font); font-size:13px; line-height:1.6; resize:vertical; outline:none; box-sizing:border-box; }
.ex-edit-textarea:focus { border-color:var(--ex-accent); }
/* 全屏设置页：占满视口（不再是居中弹窗），页面自身即整屏，遮罩背景无意义已去掉 */
.ex-settings { position:fixed; inset:0; width:100%; height:100%; z-index:2000; background:var(--ex-bg); display:flex; flex-direction:column; overflow:hidden; color:var(--ex-text); }
/* 固定头部：永远在页面顶部，不随内容滚动（返回按钮左侧 + 保存按钮右侧常驻） */
.ex-settings-head { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; flex-shrink:0; padding:calc(14px + env(safe-area-inset-top,0px)) 20px 14px; background:var(--ex-surface); border-bottom:1px solid var(--ex-border); }
.ex-settings-head-left { display:flex; align-items:center; gap:10px; min-width:0; }
.ex-settings-head-left h2 { margin:0; font-size:18px; color:var(--ex-accent); letter-spacing:2px; font-weight:900; white-space:nowrap; }
.ex-settings-back { width:36px; height:36px; flex-shrink:0; background:var(--ex-surface2); color:var(--ex-text); border:1px solid var(--ex-border2); font-size:18px; line-height:1; cursor:pointer; font-family:var(--ex-font); transition:all .15s; }
.ex-settings-back:hover { background:var(--ex-border2); border-color:var(--ex-accent); color:var(--ex-bg); }
.ex-settings-head-actions { display:flex; gap:8px; flex-shrink:0; }
/* 保存按钮（返回按钮即原"取消"，共用 data-ex="settingsCancel" 的关闭逻辑） */
.ex-settings-head-actions button { padding:9px 22px; height:36px; border:1px solid var(--ex-border2); font-weight:700; cursor:pointer; font-size:13px; font-family:var(--ex-font); display:inline-flex; align-items:center; box-shadow:none; transition:all .15s; }
.ex-settings-head-actions .ex-save-btn { background:var(--ex-accent); color:var(--ex-bg); border-color:var(--ex-accent); }
.ex-settings-head-actions .ex-save-btn:hover { background:var(--ex-accent2); }
/* 中段：竖向布局（顶部横滑标签条 + 竖向滚动内容） */
.ex-settings-main { display:flex; flex-direction:column; flex:1; min-height:0; }
/* 横滑快速定位标签条（RikkaHub 顶部 tabs 复刻）：一行横向滚动 chip，overflow-x 横向滑 */
.ex-settings-nav { display:flex; flex-direction:row; overflow-x:auto; -webkit-overflow-scrolling:touch; flex-shrink:0; width:100%; background:var(--ex-surface2); border-bottom:1px solid var(--ex-border); padding:8px 12px; gap:4px; }
.ex-settings-nav .ex-nav-item { flex-shrink:0; white-space:nowrap; padding:7px 14px; border:1px solid transparent; background:transparent; color:var(--ex-text2); font-size:12px; font-weight:bold; cursor:pointer; transition:all .2s; font-family:var(--ex-font); text-align:center; }
.ex-settings-nav .ex-nav-item:hover { border-color:var(--ex-border2); background:var(--ex-surface); color:var(--ex-text); }
.ex-settings-nav .ex-nav-item.active { border-color:var(--ex-accent); background:var(--ex-accent); color:var(--ex-bg); box-shadow:0 2px 8px rgba(0,0,0,.3); }
/* 内容区：竖向滚动分区列表 */
.ex-settings-body { flex:1; overflow-y:auto; overflow-x:hidden; padding:20px 24px 40px; min-height:0; }
/* Rikka 分区：分区标题（primary 青绿小字，独立在卡片上方）+ 无边框卡片簇（亮一档底色，行间 1px 细线分隔，不画外框） */
.ex-section { scroll-margin-top:8px; max-width:100%; overflow-wrap:break-word; word-break:break-word; margin-bottom:28px; }
.ex-section-title { font-size:12px; color:var(--ex-accent); font-weight:900; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px; }
/* 分区标题行：标题左 + 操作按钮右（如日志"展开"） */
.ex-section-title-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.ex-section-title-row .ex-section-title { margin-bottom:0; }
.ex-section-title-row .ex-top-btn { padding:3px 12px; font-size:11px; }
.ex-section-title.danger { color:var(--ex-danger); }
.ex-card-group { background:var(--ex-surface); padding:0 16px; }
/* 设置项行：标签/标题在左，控件在右，行间 1px 细线分隔 */
.ex-setting-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 0; }
.ex-setting-row + .ex-setting-row { border-top:1px solid var(--ex-border); }
.ex-settings-body label { font-size:12px; color:var(--ex-text2); display:block; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px; font-weight:bold; }
.ex-setting-row > label, .ex-setting-row > .ex-label-strong { flex-shrink:0; width:180px; text-transform:none; letter-spacing:0; margin-bottom:0; }
.ex-settings-body input[type="text"], .ex-settings-body input[type="password"], .ex-settings-body input[type="number"], .ex-settings-body select, .ex-settings-body textarea { width:100%; min-width:0; padding:10px; margin-bottom:14px; border:1px solid var(--ex-border2); background:var(--ex-bg); color:var(--ex-text); font-family:var(--ex-font); font-size:13px; box-sizing:border-box; border-radius:0; }
.ex-settings-body textarea { min-height:88px; line-height:1.6; resize:vertical; }
.ex-settings-body input:focus, .ex-settings-body select:focus, .ex-settings-body textarea:focus { outline:none; border-color:var(--ex-accent); box-shadow:0 0 0 3px rgba(0,255,209,.18); }
.ex-settings-body input::placeholder, .ex-settings-body textarea::placeholder { color:var(--ex-text3); }
/* 行内控件：占满行剩余宽度，去除基础规则的下边距（Rikka 行式布局右列） */
.ex-setting-row > input, .ex-setting-row > select, .ex-setting-row > textarea, .ex-setting-row > .ex-form-row, .ex-setting-row > .ex-slider-row, .ex-setting-row > .ex-theme-options, .ex-setting-row > .ex-import-export, .ex-setting-row > .ex-log-actions { flex:1; min-width:0; margin-bottom:0; }
/* 卡片组内辅助块：提示/说明文字、按钮组，行间细线分隔 */
.ex-card-group > .ex-hint { margin:0; padding:10px 0; border-top:1px solid var(--ex-border); }
.ex-card-group > .ex-conv-note { margin:0; padding:12px 0; border-bottom:1px solid var(--ex-border); }
.ex-card-group .ex-plugin-list { padding-bottom:14px; }
.ex-card-group .ex-log-view { margin:0 0 14px; }
.ex-log-actions { display:flex; gap:8px; flex-wrap:wrap; }
.ex-form-row { display:flex; gap:10px; align-items:stretch; }
.ex-settings-body .ex-form-row input, .ex-settings-body .ex-form-row select { flex:1; min-width:0; width:auto; margin-bottom:0; }
.ex-form-row .ex-top-btn { flex-shrink:0; }
.ex-form-buttons { display:flex; gap:8px; margin-top:6px; }
/* 工具栏按钮（APITOOL .top-btn） */
.ex-top-btn { padding:6px 12px; background:var(--ex-surface2); color:var(--ex-text); border:1px solid var(--ex-border2); cursor:pointer; font-size:11px; font-weight:bold; text-transform:uppercase; box-shadow:0 1px 6px rgba(0,0,0,.25); transition:all .2s; white-space:nowrap; font-family:var(--ex-font); letter-spacing:0.5px; }
/* 紧凑按钮：与输入框同行等高（对齐检测/隐藏按钮尺寸，用户要求按钮形状大小统一） */
.ex-btn-sm { align-self:stretch; padding:0 14px; font-size:13px; text-transform:none; letter-spacing:normal; display:inline-flex; align-items:center; justify-content:center; min-height:0; }
.ex-form-row > .ex-btn-sm { margin-bottom:0; }
.ex-top-btn:hover { background:var(--ex-border2); border-color:var(--ex-accent); color:var(--ex-bg); transform:translateY(-1px); box-shadow:0 3px 10px rgba(0,0,0,.3); }
.ex-top-btn:active { transform:translateY(0); box-shadow:none; }
.ex-top-btn.active { background:var(--ex-accent); border-color:var(--ex-accent); color:var(--ex-bg); box-shadow:0 1px 6px rgba(0,0,0,.25); }
/* API 服务商（APITOOL .api-provider-*） */
.ex-provider-main { display:flex; flex-direction:column; gap:10px; margin:12px 0; }
.ex-card-group > .ex-provider-main { margin:0; padding:14px 0; }
.ex-provider-main-head { display:flex; align-items:center; justify-content:space-between; }
.ex-provider-main-label { font-size:13px; font-weight:bold; color:var(--ex-text2); letter-spacing:0.5px; }
.ex-provider-tabs { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:4px 0 8px; width:100%; }
.ex-provider-tab { position:relative; border:1px solid var(--ex-border2); background:var(--ex-surface); padding:12px 10px; cursor:pointer; box-shadow:0 1px 6px rgba(0,0,0,.25); transition:all .2s; font-size:12px; font-weight:bold; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ex-text); font-family:var(--ex-font); }
.ex-provider-tab:hover { border-color:var(--ex-accent); transform:translateY(-1px); box-shadow:0 3px 10px rgba(0,0,0,.3); }
.ex-provider-tab.active { border-color:var(--ex-accent); background:var(--ex-accent); color:var(--ex-bg); box-shadow:0 1px 6px rgba(0,0,0,.25); }
.ex-provider-add { border:1px dashed var(--ex-border2); background:var(--ex-surface2); padding:12px 10px; cursor:pointer; color:var(--ex-text2); font-size:12px; font-weight:bold; transition:all .2s; text-align:center; font-family:var(--ex-font); }
.ex-provider-add:hover { border-color:var(--ex-accent); color:var(--ex-accent); }
.ex-preset-details, .ex-model-mgmt { border:1px solid var(--ex-border2); background:var(--ex-surface2); margin-bottom:14px; }
.ex-preset-details summary, .ex-model-mgmt summary { cursor:pointer; font-weight:bold; color:var(--ex-accent2); user-select:none; padding:10px 14px; font-size:12px; font-family:var(--ex-font); }
.ex-preset-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:0 14px 12px; }
.ex-preset-item { display:flex; align-items:center; justify-content:space-between; border:1px solid var(--ex-border2); background:var(--ex-surface); padding:10px 12px; cursor:pointer; font-size:12px; transition:all .2s; }
.ex-preset-item:hover { border-color:var(--ex-accent); }
.ex-preset-item .preset-name { font-weight:bold; color:var(--ex-text); }
.ex-preset-item .preset-model { font-size:11px; color:var(--ex-text3); max-width:55%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ex-provider-form { border:1px solid var(--ex-border2); background:var(--ex-surface); padding:16px; box-shadow:0 1px 6px rgba(0,0,0,.25); margin-bottom:14px; }
.ex-model-mgmt-list { padding:0 12px 10px; max-height:200px; overflow-y:auto; display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.ex-model-mgmt-item { padding:8px 10px; font-size:12px; border:1px solid var(--ex-border2); background:var(--ex-surface); box-shadow:0 1px 6px rgba(0,0,0,.25); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ex-text); }
.ex-model-mgmt-count { font-size:11px; color:var(--ex-text3); font-weight:normal; }
.ex-usage-note { font-size:11px; color:var(--ex-text2); margin:14px 0 16px; line-height:1.6; padding:10px 12px; border:1px dashed var(--ex-border2); background:var(--ex-surface2); }
.ex-usage-note a { color:var(--ex-accent); text-decoration:underline; word-break:break-all; }
/* 对话设置覆盖 */
.ex-conv-override { border:2px solid var(--ex-accent3); padding:12px; margin-bottom:12px; background:var(--ex-surface2); }
.ex-conv-note { font-size:11px; color:var(--ex-text2); margin-bottom:8px; }
.ex-conv-note strong { color:var(--ex-accent); }
/* 通道设置 */
.ex-label-strong { font-size:12px; font-weight:bold; color:var(--ex-text2); margin-bottom:6px; }
.ex-channel-row { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
.ex-hint { font-size:10px; color:var(--ex-text3); margin:6px 0 10px; line-height:1.5; }
.ex-channel-bottom { border-top:2px solid var(--ex-border2); padding-top:10px; display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap; }
/* 对话设置高级参数（<details> 默认折叠） */
.ex-conv-details { margin:0; }
.ex-conv-details > summary { cursor:pointer; padding:14px 0; font-size:12px; font-weight:bold; color:var(--ex-accent2); font-family:var(--ex-font); user-select:none; }
.ex-conv-details > summary:hover { color:var(--ex-accent); }
.ex-conv-details > .ex-setting-row { padding-left:0; }
/* 插件管理折叠（默认收起，点击展开插件列表） */
.ex-plugin-details { margin:0; }
.ex-plugin-details > summary { cursor:pointer; padding:12px 0; font-size:12px; font-weight:bold; color:var(--ex-accent2); font-family:var(--ex-font); user-select:none; }
.ex-plugin-details > summary:hover { color:var(--ex-accent); }
.ex-plugin-details > .ex-card-group { margin-top:4px; }
.ex-slider-row { display:flex; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap; }
.ex-slider-value { font-size:13px; font-weight:bold; min-width:44px; text-align:center; color:var(--ex-text); }
input[type="range"].ex-style-slider { -webkit-appearance:none; appearance:none; height:8px; background:var(--ex-bg2); border:1px solid var(--ex-border2); border-radius:0; outline:none; box-shadow:0 1px 6px rgba(0,0,0,.25); margin:4px 0; cursor:pointer; flex:1; min-width:120px; }
input[type="range"].ex-style-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:18px; height:18px; background:var(--ex-surface); border:1px solid var(--ex-border2); border-radius:0; box-shadow:0 1px 6px rgba(0,0,0,.25); cursor:pointer; transition:all .15s; }
input[type="range"].ex-style-slider::-webkit-slider-thumb:hover { background:var(--ex-accent3); border-color:var(--ex-accent); box-shadow:0 2px 8px rgba(0,0,0,.3); }
/* 主题点（APITOOL .theme-dot，Exdark 三分割渐变） */
.ex-theme-options { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
.ex-theme-dot { width:36px; height:36px; border:1px solid var(--ex-border2); cursor:pointer; box-shadow:0 1px 6px rgba(0,0,0,.25); transition:all .2s; }
.ex-theme-dot:hover { border-color:var(--ex-accent); transform:scale(1.1); box-shadow:0 3px 10px rgba(0,0,0,.3); }
.ex-theme-dot.selected { border-color:var(--ex-accent); box-shadow:0 0 0 3px var(--ex-accent); }
.ex-theme-dot.exdark { background:linear-gradient(135deg,#00FFD1 33%,#1A1A1A 33%,#1A1A1A 66%,#FF8800 66%); }
.ex-theme-dot.soviet { background:linear-gradient(135deg,#CC1319 33%,#F3EFE6 33%,#F3EFE6 66%,#1D1D1D 66%); }
.ex-theme-dot.cyber { background:linear-gradient(135deg,#00F0FF 33%,#0D0D11 33%,#0D0D11 66%,#FF003C 66%); }
/* 关于 / 重置 */
.ex-about-card { background:var(--ex-surface); border:1px solid var(--ex-border); padding:16px; margin-bottom:14px; }
.ex-about-title { font-size:20px; font-weight:900; letter-spacing:4px; color:var(--ex-accent); text-transform:uppercase; }
.ex-about-sub { font-size:11px; color:var(--ex-text2); margin-top:4px; }
.ex-about-ver { font-size:10px; color:var(--ex-text3); margin-top:6px; }
.ex-import-export { display:flex; gap:8px; margin:12px 0; flex-wrap:wrap; }
.ex-danger-zone { margin-top:14px; border-top:1px solid var(--ex-border); padding-top:10px; }
.ex-danger-title { font-size:12px; font-weight:bold; color:var(--ex-danger); margin-bottom:6px; }
/* A1：危险按钮 = 红（唯一清除数据，不再用橙色）。又小又扁：窄宽度 + 小 padding + 小字号 */
.ex-danger-btn { display:inline-block; box-sizing:border-box; padding:4px 14px; background:transparent; color:var(--ex-danger); border:1px solid var(--ex-danger); font-weight:700; cursor:pointer; text-transform:uppercase; transition:all .15s; font-family:var(--ex-font); font-size:10px; letter-spacing:.5px; }
.ex-card-group > .ex-danger-btn { margin:10px 0 2px; }
.ex-danger-btn:hover { background:var(--ex-danger); color:#fff; }
/* 模态底部按钮（APITOOL .modal-buttons / .save-btn / .cancel-btn） */
.ex-modal-buttons { display:flex; gap:10px; justify-content:flex-end; margin-top:16px; flex-wrap:wrap; border-top:2px solid var(--ex-border); padding-top:14px; }
.ex-modal-buttons button { padding:8px 20px; border:1px solid var(--ex-border); font-weight:900; cursor:pointer; text-transform:uppercase; box-shadow:0 1px 6px rgba(0,0,0,.25); transition:all .2s; font-family:var(--ex-font); font-size:12px; }
.ex-save-btn { background:var(--ex-accent); color:var(--ex-bg); padding:8px 24px; border:1px solid var(--ex-accent); font-weight:900; cursor:pointer; text-transform:uppercase; font-family:var(--ex-font); font-size:12px; transition:all .2s; }
.ex-save-btn:hover { background:var(--ex-accent2); transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.35); }
.ex-cancel-btn { background:var(--ex-surface2); color:var(--ex-text2); }
.ex-cancel-btn:hover { background:var(--ex-border); color:var(--ex-bg); }
.ex-footer-ver { text-align:center; font-size:10px; color:var(--ex-text3); margin:24px 0 16px; line-height:1.5; }
.ex-settings-body::-webkit-scrollbar, .ex-settings-nav::-webkit-scrollbar { width:6px; height:6px; }
.ex-settings-body::-webkit-scrollbar-track, .ex-settings-nav::-webkit-scrollbar-track { background:var(--ex-bg2); border-radius:0; }
.ex-settings-body::-webkit-scrollbar-thumb, .ex-settings-nav::-webkit-scrollbar-thumb { background:var(--ex-border2); border-radius:0; }
.ex-settings-body::-webkit-scrollbar-thumb:hover, .ex-settings-nav::-webkit-scrollbar-thumb:hover { background:var(--ex-accent); }
/* ==================== 能力设置独立页面（模式切换 + 工具管理 + 检查更新） ==================== */
.ex-capability { display:none; position:fixed; inset:0; width:100%; height:100%; z-index:4000; background:var(--ex-bg); flex-direction:column; overflow:hidden; color:var(--ex-text); }
.ex-capability.show { display:flex; }
.ex-capability-head { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-shrink:0; padding:calc(14px + env(safe-area-inset-top,0px)) 20px 14px; background:var(--ex-surface); border-bottom:1px solid var(--ex-border); }
.ex-capability-head-left { display:flex; align-items:center; gap:10px; min-width:0; }
.ex-capability-head-left h2 { margin:0; font-size:18px; color:var(--ex-accent); letter-spacing:2px; font-weight:900; white-space:nowrap; }
.ex-capability-body { flex:1; overflow-y:auto; overflow-x:hidden; padding:20px 24px 40px; min-height:0; }
.ex-capability-body::-webkit-scrollbar { width:6px; }
.ex-capability-body::-webkit-scrollbar-track { background:var(--ex-bg2); border-radius:0; }
.ex-capability-body::-webkit-scrollbar-thumb { background:var(--ex-border2); border-radius:0; }
.ex-capability-body::-webkit-scrollbar-thumb:hover { background:var(--ex-accent); }
/* 模式切换：两选项按钮横排（当前模式高亮；Exdark 直角硬边框风格） */
.ex-capability-mode { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:14px 0; }
.ex-capability-mode-3 { grid-template-columns:2fr 1fr; }
.ex-capability-mode-3 .ex-mode-btn:nth-child(1) { grid-column:1; grid-row:1; }
.ex-capability-mode-3 .ex-mode-btn:nth-child(2) { grid-column:2; grid-row:1; }
.ex-capability-mode-3 .ex-mode-btn:nth-child(3) { grid-column:1 / -1; grid-row:2; }
.ex-mode-btn { padding:12px 10px; border:1px solid var(--ex-border2); background:var(--ex-surface); color:var(--ex-text2); cursor:pointer; font-size:13px; font-weight:900; text-align:center; font-family:var(--ex-font); box-shadow:0 1px 6px rgba(0,0,0,.25); transition:all .2s; }
.ex-mode-btn:hover { border-color:var(--ex-accent); color:var(--ex-text); }
.ex-mode-btn.active { background:var(--ex-accent); border-color:var(--ex-accent); color:var(--ex-bg); box-shadow:0 1px 6px rgba(0,0,0,.25); }
/* 工具管理列表：复用 .ex-tool-row / .ex-tool-switch（Agent 工具管理同款） */
.ex-capability-tools { display:flex; flex-direction:column; gap:8px; padding:14px 0; }
/* 检查更新：按钮行 + 结果区（有新版显示版本号 + 下载按钮；失败显示错误） */
.ex-update-row { display:flex; align-items:center; gap:12px; padding:14px 0 10px; }
.ex-update-result { font-size:12px; color:var(--ex-text2); padding:0 0 14px; min-height:18px; line-height:1.6; word-break:break-all; }
.ex-update-result .ex-ver { color:var(--ex-accent); font-weight:900; }
.ex-update-result .ex-err { color:var(--ex-accent2); }
.ex-update-dl { margin-top:8px; padding:8px 18px; background:var(--ex-accent); color:var(--ex-bg); border:1px solid var(--ex-accent); font-weight:900; cursor:pointer; font-family:var(--ex-font); font-size:12px; transition:all .2s; }
.ex-update-dl:hover { background:var(--ex-accent2); border-color:var(--ex-accent2); }
@media (max-width:768px){
  .ex-capability-body { padding:16px 14px 40px; }
  .ex-capability-mode { grid-template-columns:1fr; }
}
/* ---- 插件管理卡片：左侧状态方块灯 + 两行（名字/状态 + 描述），默认折叠点开操作 ---- */
.ex-plugin-list { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
.ex-plugin-group-title { font-size:12px; font-weight:900; color:var(--ex-accent); border-left:4px solid var(--ex-accent); padding-left:8px; margin:14px 0 8px; letter-spacing:1px; }
.ex-plugin-card { background:var(--ex-surface2); display:flex; flex-direction:column; position:relative; padding-left:6px; }
.ex-plugin-card:hover { background:var(--ex-bg3); }
.ex-plugin-card.open { background:var(--ex-surface2); }
/* 状态方块灯：卡片左侧竖条（像"旧"字左边那一竖） */
.ex-plugin-lamp { position:absolute; left:0; top:0; bottom:0; width:6px; }
.ex-plugin-lamp.on { background:var(--ex-accent); }
.ex-plugin-lamp.off { background:var(--ex-text3); }
.ex-plugin-lamp.err { background:var(--ex-accent2); }
.ex-plugin-lamp.core { background:var(--ex-accent); }
.ex-plugin-card-inner { padding:12px 14px 6px; cursor:pointer; }
.ex-plugin-card-main { min-width:0; }
/* 第一行：左插件名 + 右状态文字 */
.ex-plugin-card-row { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.ex-plugin-card-name { font-size:15px; font-weight:700; color:var(--ex-text); line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
.ex-plugin-card-name .ex-en { font-size:10px; color:var(--ex-text3); font-weight:normal; margin-left:8px; letter-spacing:.5px; }
.ex-plugin-state { font-size:11px; font-weight:700; white-space:nowrap; flex-shrink:0; }
.ex-plugin-state.on { color:var(--ex-accent); }
.ex-plugin-state.off { color:var(--ex-text3); }
.ex-plugin-state.err { color:var(--ex-accent2); }
.ex-plugin-state.core { color:var(--ex-accent); }
/* 第二行：小字简短说明 */
.ex-plugin-card-desc { font-size:11px; color:var(--ex-text3); margin-top:3px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
/* 操作行：默认隐藏（卡片折叠），点开才显示 */
.ex-plugin-actions { display:none; padding:0 14px 10px; }
.ex-plugin-card.open .ex-plugin-actions { display:flex; gap:8px; align-items:center; }
.ex-plugin-btn { padding:5px 12px; font-size:11px; font-weight:900; border:1px solid var(--ex-border2); background:transparent; color:var(--ex-text); cursor:pointer; font-family:var(--ex-font); letter-spacing:1px; transition:all .2s; }
.ex-plugin-btn:hover { background:var(--ex-border2); color:var(--ex-bg); }
.ex-plugin-btn.off { border-color:var(--ex-accent2); color:var(--ex-accent2); }
.ex-plugin-btn.off:hover { background:var(--ex-accent2); color:var(--ex-bg); }
.ex-plugin-btn:disabled { opacity:.5; cursor:not-allowed; }
/* Agent 工具管理：工具行 + 方形开关（Exdark 直角风格，零圆角；能力设置页复用） */
.ex-agent-note { font-size:11px; color:var(--ex-text3); padding:0 0 12px; line-height:1.6; }
.ex-tool-row { display:flex; align-items:center; justify-content:space-between; gap:12px; background:var(--ex-surface2); padding:10px 12px; border:1px solid var(--ex-border); }
.ex-tool-info { flex:1; min-width:0; }
.ex-tool-name { font-size:12px; font-weight:900; color:var(--ex-text); letter-spacing:.5px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
.ex-tool-desc { font-size:11px; color:var(--ex-text2); margin-top:2px; word-break:break-all; line-height:1.5; }
.ex-tool-switch { position:relative; flex-shrink:0; width:44px; height:22px; cursor:pointer; }
.ex-tool-switch input { position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer; }
.ex-tool-switch-track { position:absolute; inset:0; background:var(--ex-bg3); border:1px solid var(--ex-border); transition:all .2s; }
.ex-tool-switch-track::after { content:''; position:absolute; top:2px; left:2px; width:16px; height:16px; background:var(--ex-text); transition:all .2s; }
/* 工具审批徽标（v0.0.82）：需审批工具显示橙色 badge */
.ex-tool-badge { display:inline-block; font-size:9px; padding:0 5px; background:var(--ex-accent2); color:var(--ex-bg); font-weight:bold; margin-left:4px; vertical-align:middle; border-radius:0; }
.ex-tool-switch input:checked + .ex-tool-switch-track { background:var(--ex-accent); border-color:var(--ex-accent); }
.ex-tool-switch input:checked + .ex-tool-switch-track::after { left:24px; background:var(--ex-bg); }
/* 能力设置·工具管理：功能分组 + 卡片（grid：行1 工具名+开关；行2 详情+小字；开关/小字同列对齐） */
.ex-tool-group { margin-bottom:14px; }
.ex-tool-group-title { font-size:11px; font-weight:900; color:var(--ex-accent); border-left:3px solid var(--ex-accent); padding-left:8px; margin:10px 0 8px; letter-spacing:1px; }
.ex-tool-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.ex-tool-mgmt-card { display:grid; grid-template-columns:1fr auto; gap:6px 12px; background:var(--ex-surface2); border:1px solid var(--ex-border); padding:12px; }
.ex-tool-name { grid-column:1; grid-row:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:900; color:var(--ex-text); }
.ex-tool-switch-row { grid-column:2; grid-row:1; display:grid; grid-template-columns:44px; justify-content:end; }
.ex-tool-more { grid-column:1; grid-row:2; display:flex; flex-direction:column; min-width:0; }
.ex-tool-more summary { cursor:pointer; font-size:10px; color:var(--ex-text3); user-select:none; white-space:nowrap; }
.ex-tool-more summary:hover { color:var(--ex-accent); }
.ex-tool-more summary::after { content:' ▾'; color:var(--ex-accent2); }
.ex-tool-desc { font-size:11px; color:var(--ex-text2); margin-top:6px; line-height:1.5; word-break:break-all; }
.ex-tool-params { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }
.ex-tool-chip { font-size:9px; padding:1px 6px; border:1px solid var(--ex-border2); color:var(--ex-accent); }
/* 沙箱管理三页（v0.0.87 对齐 RikkaHub WorkspacePage/DetailPage/TerminalPage：列表 + 详情[Basic/Files] + 终端） */
.ex-sandbox-manage { display:none; position:fixed; inset:0; z-index:5000; background:var(--ex-bg); flex-direction:column; overflow:hidden; color:var(--ex-text); }
.ex-sandbox-manage.show { display:flex; }
.ex-sb-page { display:flex; flex-direction:column; flex:1; min-height:0; position:relative; }
.ex-sb-page[hidden] { display:none; }
.ex-sb-topbar { display:flex; align-items:center; gap:10px; flex-shrink:0; padding:calc(14px + env(safe-area-inset-top,0px)) 20px 14px; background:var(--ex-surface); border-bottom:1px solid var(--ex-border); }
.ex-sb-topbar h2 { margin:0; font-size:17px; color:var(--ex-text); font-weight:800; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ex-sb-topbar-spacer { width:36px; flex-shrink:0; }
.ex-sb-topbar-actions { display:flex; gap:6px; flex-shrink:0; }
.ex-sb-topbar-btn { background:none; border:1px solid var(--ex-border2); color:var(--ex-text2); font-size:11px; padding:2px 9px; cursor:pointer; font-family:var(--ex-font); border-radius:6px; }
.ex-sb-topbar-btn:hover { border-color:var(--ex-accent); color:var(--ex-accent); }
.ex-sb-body { flex:1; overflow-y:auto; padding:16px 20px 30px; min-height:0; }
.ex-sb-tabbar { display:flex; border-top:1px solid var(--ex-border); background:var(--ex-surface); flex-shrink:0; }
.ex-sb-tabbar button { flex:1; padding:10px 0; background:none; border:none; color:var(--ex-text3); font-size:12px; font-family:var(--ex-font); cursor:pointer; font-weight:700; }
.ex-sb-tabbar button.active { color:var(--ex-accent); box-shadow:inset 0 -2px 0 var(--ex-accent); }
.ex-sb-card { background:var(--ex-surface); border:1px solid var(--ex-border); border-radius:10px; padding:12px 14px; margin-bottom:12px; }
.ex-sb-card-title { font-size:12px; font-weight:800; color:var(--ex-accent); margin-bottom:8px; }
.ex-sb-row { display:flex; justify-content:space-between; gap:10px; padding:4px 0; font-size:12px; }
.ex-sb-row-label { color:var(--ex-text3); }
.ex-sb-row-value { color:var(--ex-text); word-break:break-all; text-align:right; }
.ex-sb-rootfs { display:flex; align-items:center; gap:10px; }
.ex-sb-rootfs-state { font-size:11px; padding:1px 8px; border-radius:8px; border:1px solid var(--ex-border2); color:var(--ex-text3); }
.ex-sb-rootfs-state.installed { color:var(--ex-accent); border-color:var(--ex-accent); }
.ex-sb-rootfs-progress { margin-top:8px; font-size:11px; color:var(--ex-accent2); }
.ex-sb-toggle-row { display:flex; align-items:center; justify-content:space-between; padding:6px 0; font-size:12px; }
.ex-sb-toggle-row input { accent-color:var(--ex-accent); }
.ex-sb-segment { display:flex; background:var(--ex-surface2); border-radius:8px; padding:3px; margin-bottom:10px; }
.ex-sb-segment button { flex:1; padding:5px 0; background:none; border:none; color:var(--ex-text3); font-size:12px; font-family:var(--ex-font); border-radius:6px; cursor:pointer; font-weight:700; }
.ex-sb-segment button.active { background:var(--ex-surface); color:var(--ex-text); box-shadow:0 1px 3px rgba(0,0,0,.3); }
.ex-sb-pathbar { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.ex-sb-path-up { background:none; border:1px solid var(--ex-border2); color:var(--ex-text2); width:24px; height:24px; cursor:pointer; border-radius:6px; font-size:11px; }
.ex-sb-path-up:hover { border-color:var(--ex-accent); color:var(--ex-accent); }
.ex-sb-path { font-size:11px; color:var(--ex-text2); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* FAB（对齐 RikkaHub FloatingActionButton） */
.ex-sb-fab { position:fixed; right:20px; bottom:calc(20px + env(safe-area-inset-bottom,0px)); width:48px; height:48px; border-radius:50%; background:var(--ex-accent); color:var(--ex-bg); border:none; font-size:22px; font-weight:900; cursor:pointer; touch-action:manipulation; box-shadow:0 3px 10px rgba(0,0,0,.35); z-index:5100; }
.ex-sb-fab:hover { filter:brightness(1.1); }
/* 工作区列表卡片（对齐 RikkaHub WorkspaceCard：图标+名称+状态+三点菜单） */
.ex-sandbox-wslist { display:flex; flex-direction:column; gap:10px; }
.ex-sandbox-ws-item { display:flex; align-items:center; gap:12px; width:100%; padding:12px 10px 12px 14px; background:var(--ex-surface); border:1px solid var(--ex-border); border-radius:10px; color:var(--ex-text); cursor:pointer; font-family:var(--ex-font); font-size:12px; text-align:left; transition:background .15s; }
.ex-sandbox-ws-item:hover { background:var(--ex-surface2); }
.ex-sandbox-ws-icon { flex-shrink:0; width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; color:var(--ex-accent); }
.ex-sandbox-ws-icon svg { width:20px; height:20px; }
.ex-sandbox-ws-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.ex-sandbox-ws-name { font-size:14px; font-weight:700; color:var(--ex-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ex-sandbox-ws-id { font-size:10px; color:var(--ex-text3); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ex-sandbox-ws-menu { flex-shrink:0; background:none; border:none; color:var(--ex-text3); font-size:15px; padding:2px 8px; cursor:pointer; font-weight:900; }
.ex-sandbox-ws-menu:hover { color:var(--ex-accent); }
/* 工作区卡片菜单弹层（重命名/删除，对齐 RikkaHub DropdownMenu） */
.ex-sb-ws-menu-pop { position:fixed; z-index:5100; background:var(--ex-surface); border:1px solid var(--ex-border2); border-radius:8px; padding:4px; box-shadow:0 4px 14px rgba(0,0,0,.4); min-width:130px; }
.ex-sb-ws-menu-pop button { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; background:none; border:none; color:var(--ex-text); font-size:12px; font-family:var(--ex-font); cursor:pointer; border-radius:5px; text-align:left; }
.ex-sb-ws-menu-pop button:hover { background:var(--ex-surface2); }
.ex-sb-ws-menu-pop button.danger { color:#e5484d; }
/* 文件树（保留） */
.ex-sandbox-tree { margin-top:4px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; color:var(--ex-text); }
.ex-sandbox-tree-item { padding:4px 0; cursor:default; display:flex; align-items:center; gap:6px; }
.ex-sandbox-tree-item.dir { cursor:pointer; color:var(--ex-accent); }
.ex-sandbox-tree-item.dir:hover { background:var(--ex-surface2); }
/* v0.0.87 选中态：文件行点击查看时高亮（RikkaHub 列表选中风格：圆角背景 + accent 左竖条） */
.ex-sandbox-tree-item.selected { background:var(--ex-surface2); border-radius:6px; box-shadow:inset 2px 0 0 var(--ex-accent); }
/* 文件行三点菜单按钮 */
.ex-sandbox-tree-menu { flex-shrink:0; background:none; border:none; color:var(--ex-text3); font-size:14px; padding:0 5px; cursor:pointer; font-weight:900; line-height:1; margin-left:auto; }
.ex-sandbox-tree-menu:hover { color:var(--ex-accent); }
.ex-sandbox-tree-icon { flex-shrink:0; width:14px; color:var(--ex-accent2); }
.ex-sandbox-tree-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ex-sandbox-tree-size { margin-left:auto; font-size:10px; color:var(--ex-text3); }
.ex-sandbox-tree-children { border-left:1px solid var(--ex-border2); margin-left:6px; padding-left:4px; }
/* 文件内容查看/编辑 */
.ex-sandbox-fileview { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
.ex-sandbox-fileview-path { font-size:10px; color:var(--ex-text3); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; word-break:break-all; }
.ex-sandbox-fileview textarea { width:100%; min-height:160px; background:var(--ex-bg); border:1px solid var(--ex-border2); color:var(--ex-text); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; padding:8px; resize:vertical; }
.ex-sandbox-fileview textarea:focus { outline:none; border-color:var(--ex-accent); }
.ex-sandbox-fileview-actions { display:flex; align-items:center; gap:10px; }
.ex-sandbox-fileview-actions span { font-size:10px; color:var(--ex-text3); }
/* 终端（对齐 RikkaHub WorkspaceTerminalPage：深色底 + 输入行 + 按键栏） */
.ex-sb-terminal { background:#0d1117; }
.ex-sb-terminal .ex-sb-topbar { background:#161b22; border-bottom-color:#21262d; }
.ex-sb-terminal .ex-sb-topbar h2 { color:#e6edf3; }
.ex-sb-term-out { flex:1; overflow-y:auto; padding:12px 14px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; color:#c9d1d9; white-space:pre-wrap; word-break:break-word; min-height:0; }
.ex-sb-term-hint { color:#484f58; }
.ex-sb-term-input-row { display:flex; gap:8px; padding:8px 14px; border-top:1px solid #21262d; flex-shrink:0; }
.ex-sb-term-input-row input { flex:1; min-width:0; background:#0d1117; border:1px solid #30363d; color:#e6edf3; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; padding:8px 10px; }
.ex-sb-term-input-row input:focus { outline:none; border-color:var(--ex-accent); }
.ex-sb-term-keys { display:flex; gap:6px; padding:0 14px 14px; flex-shrink:0; flex-wrap:wrap; }
.ex-sb-term-keys button { background:#161b22; border:1px solid #30363d; color:#8b949e; font-size:10px; padding:4px 9px; cursor:pointer; border-radius:5px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
.ex-sb-term-keys button:hover { border-color:var(--ex-accent); color:#e6edf3; }
/* 对话框（创建/重命名/删除确认） */
.ex-sb-dialog { position:fixed; inset:0; z-index:5200; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; }
.ex-sb-dialog[hidden] { display:none; }
.ex-sb-dialog-box { background:var(--ex-surface); border:1px solid var(--ex-border2); border-radius:12px; padding:18px 20px; width:min(320px,86vw); }
.ex-sb-dialog-box h3 { margin:0 0 12px; font-size:15px; color:var(--ex-text); }
.ex-sb-dialog-box input { width:100%; padding:8px 10px; background:var(--ex-bg); border:1px solid var(--ex-border2); color:var(--ex-text); font-size:13px; font-family:var(--ex-font); box-sizing:border-box; }
.ex-sb-dialog-box input:focus { outline:none; border-color:var(--ex-accent); }
.ex-sb-dialog-err { margin-top:6px; font-size:11px; color:#e5484d; }
.ex-sb-dialog-tip { margin:0 0 12px; font-size:12px; color:var(--ex-text2); }
.ex-sb-dialog-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
.ex-manage-btn.primary { background:var(--ex-accent); color:var(--ex-bg); border-color:var(--ex-accent); font-weight:900; }
.ex-manage-btn.danger { background:transparent; color:#e5484d; border-color:#e5484d; }
@media (max-width:768px){ .ex-sb-body { padding:14px 14px 24px; } }
@media (max-width:768px){ .ex-tool-grid { grid-template-columns:1fr; } }
.ex-plugin-detail { display:none; padding:0 14px 12px; border-top:2px solid var(--ex-border); }
.ex-plugin-card.open .ex-plugin-detail { display:block; }
.ex-plugin-detail-row { font-size:11px; color:var(--ex-text2); margin:6px 0; line-height:1.6; }
.ex-plugin-detail-row b { color:var(--ex-text); }
.ex-plugin-tag { display:inline-block; padding:1px 8px; font-size:10px; border:1px solid var(--ex-border2); color:var(--ex-accent); margin-right:6px; }
/* Toast（APITOOL .toast 右上角滑入） */
.ex-toast-container { position:fixed; top:16px; right:16px; z-index:9999; pointer-events:none; }
/* 超长确认 toast：右上角、橙色描边、带确定按钮 */
.ex-toast-confirm { border-color:var(--ex-accent2) !important; }
.ex-toast-confirm .ex-toast-btn { margin-left:10px; padding:3px 12px; background:var(--ex-accent2); color:var(--ex-bg); border:none; font-weight:900; cursor:pointer; font-family:var(--ex-font); font-size:11px; }
.ex-toast { background:var(--ex-surface); border:1px solid var(--ex-accent); padding:10px 16px; box-shadow:var(--ex-shadow); font-weight:bold; margin-bottom:8px; animation:exToastIn .3s ease; pointer-events:auto; font-size:12px; color:var(--ex-text); font-family:var(--ex-font); }
@keyframes exToastIn { from{transform:translateX(100px);opacity:0;} to{transform:translateX(0);opacity:1;} }
/* 移动端：全屏设置页收窄边距 + 设置项行改纵向堆叠 + 插件两列改单列（防窄屏塌陷） */
@media (max-width:768px){
  .ex-settings-body { padding:16px 14px 40px; }
  .ex-setting-row { flex-direction:column; align-items:stretch; gap:8px; }
  .ex-setting-row > label, .ex-setting-row > .ex-label-strong { width:100%; }
  .ex-plugin-list { grid-template-columns:1fr; }
  .ex-preset-grid, .ex-model-mgmt-list { grid-template-columns:1fr; }
  .ex-provider-tabs { grid-template-columns:1fr; }
  .ex-form-row { flex-direction:column; }
  .ex-form-row .ex-top-btn { width:100%; }
}
`;

export function apply(ctx: Context, config: Record<string, unknown> = {}): void {
  // 防御：重挂时可能收到空配置（TopologyService 已给 {}，这里再兜一层；双保险兜 undefined/null）
  config = config ?? {};
  const enabled = (config.enabled as boolean | undefined) ?? true;
  if (!enabled) return;
  const root = (config.root as HTMLElement | undefined) ?? document.getElementById('app');
  if (!root) throw new Error('ui-exdark: 找不到挂载节点');

  // 服务商配置分节已由 core-services 统一注册（生命周期跟内核，GUI 切换不丢失）
  const container = document.createElement('div');
  container.className = 'kr-exdark';
  container.innerHTML = `
    <style>${STYLE}</style>
    <div class="ex-app">
      <svg class="ex-parallax" data-ex="parallax" aria-hidden="true"></svg>
      <aside class="ex-sidebar" data-ex="sidebar">
        <div class="ex-sidebar-header">
          <h2>KIRUSRAFT</h2>
          <div class="ex-sidebar-sub">EXDARK 主题</div>
          <div class="ex-sidebar-stats" data-ex="convcount">已保存 0 个会话</div>
        </div>
        <div class="ex-sidebar-actions">
          <button class="ex-btn-new" data-ex="newchat">+ 新对话</button>
        </div>
        <!-- 对话管理模式工具条（v0.0.65 修正：长按"管理"进入边栏就地批量管理，不弹内核设置） -->
        <div class="ex-manage-bar" data-ex="manage-bar" style="display:none;">
          <button type="button" class="ex-manage-btn" data-ex="manage-select-all">全选</button>
          <button type="button" class="ex-manage-btn" data-ex="manage-delete">删除选中</button>
          <button type="button" class="ex-manage-btn ex-manage-exit" data-ex="manage-exit">退出</button>
          <span class="ex-manage-count" data-ex="manage-count"></span>
        </div>
        <div class="ex-sidebar-search">
          <input data-ex="convsearch" type="text" placeholder="搜索会话…" />
        </div>
        <div class="ex-conv-list" data-ex="convlist"></div>
      </aside>
      <div class="ex-sidebar-mask" data-ex="mask"></div>
      <main class="ex-main" data-ex="main">
        <div class="ex-topbar">
          <div class="ex-topbar-left">
            <button class="ex-toggle" data-ex="toggle" title="会话列表">≡</button>
            <div class="ex-title-wrap">
              <h1 data-ex="title" title="点击修改会话标题">KIRUSRAFT</h1>
              <!-- 模型副标题：小字灰色单行省略，点击开模型选择（去掉状态灯） -->
              <button type="button" class="ex-model-sub" data-ex="model" title="当前模型（点击切换）"><span data-ex="model-name">deepseek-chat</span></button>
            </div>
          </div>
          <div class="ex-topbar-right">
            <button class="ex-btn-more" data-ex="more" title="更多">更多<span class="ex-reddot" data-ex="more-dot"></span></button>
          </div>
        </div>
        <div class="ex-msgwrap">
          <div class="ex-messages" data-ex="messages"></div>
          <div class="ex-empty-guide" data-ex="empty">
            <div class="ex-empty-badge"></div>
            <div class="ex-empty-title">开始对话</div>
            <div class="ex-empty-sub">输入消息开始聊天，或先创建一个新会话。</div>
            <button class="ex-btn-new ex-empty-start" data-ex="empty-start">＋ 新对话</button>
            <div class="ex-empty-hint">KIRUSRAFT × EXDARK</div>
          </div>
        </div>
        <!-- 输入区（Rikka ChatInput：容器 + 状态行 + 输入框 + 工具行；v0.0.71 状态行移入输入区顶部，不再夹消息区与输入区间隙） -->
        <div class="ex-input-area">
          <div class="ex-status" data-ex="status"></div>
          <div class="ex-input-box">
            <textarea data-ex="input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
            <span class="ex-char-count" data-ex="charcount"></span>
          </div>
          <div class="ex-tools-row">
            <div class="ex-tools-scroll">
              <button class="ex-feature-btn" data-ex="deepthink" title="思考强度（点击调节）">Think</button>
              <button class="ex-feature-btn" data-ex="websearch-btn" title="搜索（开启后由模型自动判定）">联网搜索</button>
              <input type="checkbox" data-ex="websearch" style="display:none;" />
              <label class="ex-feature-btn" title="上传文件（支持多文件拖拽）">上传<input type="file" data-ex="file" multiple hidden></label>
              <span class="ex-file-indicator" data-ex="file-indicator"></span>
            </div>
            <!-- v0.0.73：发送/中止/继续 = 同一按钮三态（成熟 chat 设计）——
                 流式中=中止；中止后输入框空=继续、有文本=发送 -->
            <button class="ex-send-btn" data-ex="send" disabled>发送</button>
          </div>
        </div>
      </main>
      <!-- 右侧边栏（APITOOL right-sidebar 复刻：统计/信息，打开放更多菜单） -->
      <aside class="ex-right-sidebar hidden" data-ex="right-sidebar">
        <div class="ex-right-sidebar-header"><h2>会话详情</h2></div>
        <div class="ex-right-sidebar-content">
          <!-- 信息卡（保留） -->
          <div class="ex-right-stats" data-ex="right-stats">
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">插件</span><span class="ex-right-stats-value" data-ex="stat-plugins">-</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">工具</span><span class="ex-right-stats-value" data-ex="stat-tools">-</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">服务商</span><span class="ex-right-stats-value" data-ex="stat-providers">-</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">配置分节</span><span class="ex-right-stats-value" data-ex="stat-configs">-</span></div>
          </div>
          <!-- 底部统计卡（v0.0.67：真实 usage + 余额 API + 缓存命中 + 存储用量，参考 APITOOL updateRightSidebarStats） -->
          <div class="ex-right-stats" style="margin-top:12px;">
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">本场计费</span><span class="ex-right-stats-value" data-ex="stat-cost">–</span></div>
            <div class="ex-right-stats-divider"></div>
            <div class="ex-right-stats-row" style="cursor:pointer;" data-ex="stat-balance-row" title="点击刷新余额">
              <span class="ex-right-stats-label">账户余额 <span style="font-size:9px;">↻</span></span>
              <span class="ex-right-stats-value" data-ex="stat-balance">–</span>
            </div>
            <div class="ex-right-stats-row" style="font-size:10px;padding-left:10px;"><span class="ex-right-stats-label" style="color:var(--ex-text3);">充值</span><span class="ex-right-stats-value" data-ex="stat-balance-topped" style="color:var(--ex-text3);">–</span></div>
            <div class="ex-right-stats-row" style="font-size:10px;padding-left:10px;"><span class="ex-right-stats-label" style="color:var(--ex-text3);">赠金</span><span class="ex-right-stats-value" data-ex="stat-balance-granted" style="color:var(--ex-text3);">–</span></div>
            <div class="ex-right-stats-divider"></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">请求数</span><span class="ex-right-stats-value" data-ex="stat-requests">0</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">对话 token</span><span class="ex-right-stats-value" data-ex="stat-total-tokens">0</span></div>
            <div class="ex-right-stats-divider"></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">本次输入</span><span class="ex-right-stats-value" data-ex="stat-input">–</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">本次输出</span><span class="ex-right-stats-value" data-ex="stat-output">–</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">缓存命中</span><span class="ex-right-stats-value" data-ex="stat-cache">–</span></div>
            <div class="ex-right-stats-divider"></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">localStorage</span><span class="ex-right-stats-value" data-ex="stat-storage">–</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">IndexedDB</span><span class="ex-right-stats-value" data-ex="stat-db">–</span></div>
          </div>
        </div>
      </aside>
      <div class="ex-right-mask" data-ex="right-mask"></div>
    </div>
    <!-- 更多菜单（侧栏开关；能力设置独立页；设置入口已在侧边栏右下角，不再重复） -->
    <div class="ex-more-menu" data-ex="more-menu">
      <!-- 设置入口移到更多菜单最上面（v0.0.66）；侧边栏右下角设置按钮已移除 -->
      <button type="button" class="ex-more-item" data-ex="more-settings">设置</button>
      <button type="button" class="ex-more-item" data-ex="more-sidebar">侧栏</button>
      <button type="button" class="ex-more-item" data-ex="more-capability">能力设置</button>
      <button type="button" class="ex-more-item" data-ex="more-changelog">更新日志</button>
    </div>
    <!-- 更新日志弹层（v0.0.67：更多菜单 → 更新日志；内置 CHANGELOG 展示） -->
    <div class="ex-modal" data-ex="changelog-modal">
      <div class="ex-changelog">
        <div class="ex-settings-head">
          <div class="ex-settings-head-left">
            <button type="button" class="ex-settings-back" data-ex="changelogClose" title="返回">←</button>
            <h2>更新日志</h2>
          </div>
        </div>
        <div class="ex-changelog-body">
          <pre class="ex-changelog-content" data-ex="changelog-content"></pre>
        </div>
      </div>
    </div>
    <!-- 编辑消息弹窗（v0.0.69，APITOOL editModal 同款：textarea 预填旧文本 + 取消/保存） -->
    <div class="ex-modal" data-ex="edit-modal">
      <div class="ex-edit-modal">
        <div class="ex-settings-head">
          <div class="ex-settings-head-left">
            <button type="button" class="ex-settings-back" data-ex="editClose" title="返回">←</button>
            <h2 data-ex="edit-title">编辑消息</h2>
          </div>
          <button type="button" class="ex-save-btn" data-ex="editSave">保存</button>
        </div>
        <div class="ex-edit-body">
          <textarea class="ex-edit-textarea" data-ex="edit-textarea" spellcheck="true"></textarea>
        </div>
      </div>
    </div>
    <!-- 模型下拉（右上角模型名点击展开：自动检测模型列表 + 自定义输入） -->
    <div class="ex-model-pop" data-ex="model-pop">
      <div class="ex-model-pop-head">选择模型</div>
      <div class="ex-model-pop-search"><input type="text" data-ex="model-search" placeholder="搜索或输入模型 ID..." /></div>
      <div class="ex-model-pop-list" data-ex="model-list"></div>
    </div>
    <!-- 设置页（RikkaHub 竖向设置页复刻：全屏页面 + 横滑标签条 + 竖向滚动卡片组分区） -->
    <div class="ex-modal" data-ex="settings-modal">
      <div class="ex-settings">
        <!-- 固定头部：返回按钮（←）左侧 + 保存按钮右侧常驻 -->
        <div class="ex-settings-head">
          <div class="ex-settings-head-left">
            <button type="button" class="ex-settings-back" data-ex="settingsCancel" title="返回">←</button>
            <h2>设置</h2>
          </div>
          <div class="ex-settings-head-actions">
            <button type="button" class="ex-save-btn" data-ex="settingsSave">保存</button>
          </div>
        </div>
        <div class="ex-settings-main">
        <nav class="ex-settings-nav" data-ex="settings-nav">
          <button type="button" class="ex-nav-item active" data-ex-nav="sec-api">API 设置</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-conv">对话设置</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-prompt">系统提示词</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-theme">主题</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-pricing">计费显示</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-perf">性能调节</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-plugins">插件管理</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-storage">存档管理</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-logs">运行记录</button>
          <button type="button" class="ex-nav-item" data-ex-nav="sec-update">检查更新</button>
        </nav>
        <div class="ex-settings-body" data-ex="settings-body">
          <div class="ex-section" id="sec-api">
            <div class="ex-section-title">API 设置</div>
            <div class="ex-card-group">
              <div class="ex-provider-main">
                <div class="ex-provider-main-head"><span class="ex-provider-main-label">服务商配置</span></div>
                <!-- 极简服务商配置：由 profile-config 分节渲染（选预设卡/填 Key/自动检测模型/高级折叠） -->
                <div data-ex="profile-render"></div>
              </div>
            </div>
          </div>
          <div class="ex-section" id="sec-conv">
            <div class="ex-section-title">对话设置（覆盖全局）</div>
            <div class="ex-card-group">
              <div class="ex-conv-note"><strong>当前对话</strong> — 留空 = 使用全局设置</div>
              <div class="ex-setting-row">
                <label for="exConvPrompt">当前对话系统提示词</label>
                <textarea id="exConvPrompt" rows="2" placeholder="留空则使用全局系统提示词"></textarea>
              </div>
              <!-- 高级参数：Temperature / 上下文轮数默认折叠 -->
              <details class="ex-conv-details">
                <summary>高级参数（Temperature / 上下文轮数）</summary>
                <div class="ex-setting-row">
                  <label for="exConvTemp">Temperature</label>
                  <div class="ex-slider-row">
                    <input type="range" id="exConvTemp" class="ex-style-slider" min="0" max="2" step="0.1" value="1" data-ex="convTemp" aria-label="Temperature">
                    <span class="ex-slider-value"><span data-ex="convTempValue">1.0</span></span>
                  </div>
                </div>
                <div class="ex-setting-row">
                  <label for="exConvRounds">上下文轮数限制（可选）</label>
                  <input type="number" id="exConvRounds" placeholder="留空 = 不限" min="1" max="100">
                </div>
              </details>
            </div>
          </div>
          <div class="ex-section" id="sec-prompt">
            <div class="ex-section-title">系统提示词</div>
            <div class="ex-card-group">
              <div class="ex-setting-row">
                <label for="exSystemPrompt">全局系统提示词</label>
                <textarea id="exSystemPrompt" rows="4" placeholder="全局系统提示词..."></textarea>
              </div>
            </div>
          </div>
          <div class="ex-section" id="sec-theme">
            <div class="ex-section-title">主题</div>
            <div class="ex-card-group">
              <div class="ex-setting-row">
                <span class="ex-label-strong">主题样式</span>
                <div class="ex-theme-options">
                  <div class="ex-theme-dot exdark selected" data-ex-theme="exdark" title="Exdark"></div>
                </div>
              </div>
              <div class="ex-hint">当前内置主题：Exdark。</div>
            </div>
          </div>
          <div class="ex-section" id="sec-pricing">
            <div class="ex-section-title">计费显示</div>
            <div class="ex-card-group">
              <div class="ex-setting-row">
                <label for="exCurrency">币种</label>
                <select id="exCurrency"><option>人民币（默认）</option><option>美元</option></select>
              </div>
              <div class="ex-setting-row">
                <label for="exRate">人民币汇率（1 USD = ? CNY）</label>
                <div class="ex-form-row">
                  <input type="text" id="exRate" placeholder="如 7.2000">
                  <button type="button" class="ex-top-btn ex-btn-sm" data-ex="syncRate">同步汇率</button>
                </div>
              </div>
            </div>
          </div>
          <div class="ex-section" id="sec-perf">
            <div class="ex-section-title">性能调节</div>
            <div class="ex-card-group">
              <div class="ex-setting-row">
                <span class="ex-label-strong">帧率调整</span>
                <div class="ex-slider-row">
                  <input type="range" class="ex-style-slider" min="0" max="3" value="2" step="1" data-ex="fpsSlider" aria-label="帧率档位">
                  <span class="ex-slider-value"><span data-ex="fpsValue">60</span> FPS</span>
                </div>
              </div>
              <div class="ex-setting-row">
                <span class="ex-label-strong">视差层数</span>
                <div class="ex-slider-row">
                  <input type="range" class="ex-style-slider" min="1" max="15" value="4" step="1" data-ex="parallaxSlider" aria-label="视差层数">
                  <span class="ex-slider-value"><span data-ex="parallaxValue">4</span> 层</span>
                </div>
              </div>
            </div>
          </div>
          <div class="ex-section" id="sec-plugins">
            <div class="ex-section-title">插件管理</div>
            <details class="ex-plugin-details">
              <summary>展开插件列表</summary>
              <div class="ex-card-group">
                <div class="ex-plugin-note" style="font-size:11px;color:var(--ex-text3);padding:12px 0 4px;">按功能区启停插件，受保护插件不可禁用。</div>
                <div class="ex-plugin-list" data-ex="plugin-list">
                  <div style="font-size:12px;color:var(--ex-text3);padding:16px;text-align:center;">插件列表加载中...</div>
                </div>
              </div>
            </details>
          </div>
          <div class="ex-section" id="sec-storage">
            <div class="ex-section-title">存档管理</div>
            <div class="ex-card-group">
              <div class="ex-setting-row">
                <span class="ex-label-strong">对话存档</span>
                <div class="ex-import-export">
                  <button type="button" class="ex-top-btn" data-ex="exportData">导出存档</button>
                  <button type="button" class="ex-top-btn" data-ex="importData">导入存档</button>
                </div>
              </div>
            </div>
          </div>
          <div class="ex-section" id="sec-logs">
            <div class="ex-section-title-row">
              <div class="ex-section-title">运行记录（日志）</div>
              <button type="button" class="ex-top-btn" data-ex="logExpand">展开</button>
            </div>
            <div class="ex-card-group">
              <div class="ex-setting-row">
                <span class="ex-label-strong">日志操作</span>
                <div class="ex-log-actions">
                  <span class="ex-logrange">
                    <button type="button" class="ex-top-btn" data-ex-log-range="today">今天</button>
                    <button type="button" class="ex-top-btn" data-ex-log-range="3d">3天</button>
                    <button type="button" class="ex-top-btn active" data-ex-log-range="7d">7天</button>
                    <button type="button" class="ex-top-btn" data-ex-log-range="all">全部</button>
                  </span>
                  <button type="button" class="ex-top-btn" data-ex="logCopy">复制</button>
                  <button type="button" class="ex-top-btn" data-ex="logExport">导出</button>
                  <button type="button" class="ex-top-btn" data-ex="logRefresh">刷新</button>
                  <button type="button" class="ex-top-btn" data-ex="logClear">清空</button>
                </div>
              </div>
              <div class="ex-hint">保留最近 7 天日志（自动轮转），点击「展开」查看。</div>
              <div class="ex-log-view" data-ex="logView" style="display:none;background:var(--ex-bg);padding:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.6;color:var(--ex-text2);white-space:pre-wrap;word-break:break-all;min-height:88px;max-height:50vh;overflow-y:auto;"></div>
            </div>
          </div>
          <!-- 检查更新：手动检查最新版本（放设置里） -->
          <div class="ex-section" id="sec-update">
            <div class="ex-section-title">检查更新</div>
            <div class="ex-card-group">
              <div class="ex-update-row">
                <button type="button" class="ex-top-btn" data-ex="checkUpdate">检查更新</button>
              </div>
              <div class="ex-update-result" data-ex="update-result"></div>
            </div>
          </div>
          <!-- 危险区：独立分区放最底部（存档管理之外），红色标题 + 红色描边按钮 -->
          <div class="ex-section" id="sec-danger">
            <div class="ex-section-title danger">⚠ 危险操作</div>
            <div class="ex-card-group">
              <button type="button" class="ex-danger-btn" data-ex="resetApp">重置所有数据（清空全部对话、设置与历史存档）</button>
              <div class="ex-hint">等同恢复出厂设置：清空浏览器中本应用的全部数据，清空后回到首次打开状态。</div>
            </div>
          </div>
          <div class="ex-footer-ver">KIRUSRAFT v${VERSION} 云上千夜</div>
        </div>
        </div><!-- .ex-settings-main -->
      </div>
    </div>
    <!-- 能力设置独立页面（模式切换 + 工具管理 + 检查更新）：全屏浮层，仿设置页结构 -->
    <div class="ex-capability" data-ex="capability">
      <div class="ex-capability-head">
        <div class="ex-capability-head-left">
          <button type="button" class="ex-settings-back" data-ex="capabilityBack" title="返回">←</button>
          <h2>能力设置</h2>
        </div>
      </div>
      <div class="ex-capability-body">
        <!-- 运行模式：代理/对话 双选项（当前模式高亮），点击切换 + 持久化 -->
        <div class="ex-section">
          <div class="ex-section-title">运行模式</div>
          <div class="ex-card-group">
            <div class="ex-capability-mode ex-capability-mode-3">
              <button type="button" class="ex-mode-btn" data-ex-mode="agent">[ 代理模式 ]</button>
              <button type="button" class="ex-mode-btn" data-ex="sandboxManage">沙箱管理</button>
              <button type="button" class="ex-mode-btn" data-ex-mode="chat">[ 对话模式 ]</button>
            </div>
            <div class="ex-agent-note">代理模式按下方工具开关向 AI 发送工具；对话模式不带任何工具。web_search 由输入区联网搜索开关独立控制。</div>
          </div>
        </div>
        <!-- 工具管理：列出全部已注册工具（开关写 config.agent.enabledTools，默认全开） -->
        <div class="ex-section">
          <div class="ex-section-title">工具管理</div>
          <div class="ex-card-group">
            <div class="ex-capability-tools" data-ex="capability-tools">工具列表加载中...</div>
          </div>
        </div>
      </div>
    </div>
    <!-- 沙箱管理三页（v0.0.87 对齐 RikkaHub WorkspacePage/DetailPage/TerminalPage：列表页 + 详情页[Basic/Files] + 终端页） -->
    <div class="ex-sandbox-manage" data-ex="sandbox-manage">
      <!-- 页1：工作区列表 -->
      <section class="ex-sb-page" data-ex="sb-page-list">
        <div class="ex-sb-topbar">
          <button type="button" class="ex-settings-back" data-ex="sandboxBack" title="返回">←</button>
          <h2>工作区</h2>
          <span class="ex-sb-topbar-spacer"></span>
        </div>
        <div class="ex-sb-body">
          <div class="ex-sandbox-wslist" data-ex="sandbox-wslist">加载中...</div>
        </div>
        </section>
      <!-- 页2：工作区详情 -->
      <section class="ex-sb-page" data-ex="sb-page-detail" hidden>
        <div class="ex-sb-topbar">
          <button type="button" class="ex-settings-back" data-ex="sb-detail-back" title="返回">←</button>
          <h2 data-ex="sb-detail-title">工作区</h2>
          <div class="ex-sb-topbar-actions">
            <button type="button" class="ex-sb-topbar-btn" data-ex="sb-import" title="导入文件到当前目录">导入</button>
            <button type="button" class="ex-sb-topbar-btn" data-ex="sb-terminal" title="终端">终端</button>
            <button type="button" class="ex-sb-topbar-btn" data-ex="sb-refresh" title="刷新">刷新</button>
          </div>
          <input type="file" data-ex="sb-import-file" multiple hidden />
        </div>
        <div class="ex-sb-body">
          <!-- Basic tab：信息 + rootfs + 工具审批 -->
          <div data-ex="sb-tab-basic">
            <div class="ex-sb-card">
              <div class="ex-sb-card-title">信息</div>
              <div class="ex-sb-row"><span class="ex-sb-row-label">名称</span><span class="ex-sb-row-value" data-ex="sb-info-name">-</span></div>
              <div class="ex-sb-row"><span class="ex-sb-row-label">ID</span><span class="ex-sb-row-value" data-ex="sb-info-id">-</span></div>
              <div class="ex-sb-row"><span class="ex-sb-row-label">Shell 状态</span><span class="ex-sb-row-value" data-ex="sb-info-shell">-</span></div>
            </div>
            <div class="ex-sb-card">
              <div class="ex-sb-card-title">Rootfs</div>
              <div class="ex-sb-rootfs">
                <span class="ex-sb-rootfs-state" data-ex="sb-rootfs-state">未安装</span>
                <button type="button" class="ex-manage-btn" data-ex="sb-rootfs-install">安装 rootfs</button>
              </div>
              <div class="ex-sb-rootfs-progress" data-ex="sb-rootfs-progress" hidden>安装中...</div>
            </div>
            <div class="ex-sb-card">
              <div class="ex-sb-card-title">工具审批</div>
              <div class="ex-sb-toggle-row"><span>读取文件</span><input type="checkbox" data-ex="sb-appr-read" /></div>
              <div class="ex-sb-toggle-row"><span>写入文件</span><input type="checkbox" data-ex="sb-appr-write" /></div>
              <div class="ex-sb-toggle-row"><span>编辑文件</span><input type="checkbox" data-ex="sb-appr-edit" /></div>
              <div class="ex-sb-toggle-row"><span>Shell</span><input type="checkbox" data-ex="sb-appr-shell" /></div>
            </div>
          </div>
          <!-- Files tab：Files/Rootfs 分段 + 路径栏 + 文件树 -->
          <div data-ex="sb-tab-files" hidden>
            <div class="ex-sb-segment">
              <button type="button" class="active" data-ex="sb-seg-files">Files</button>
              <button type="button" data-ex="sb-seg-rootfs">Rootfs</button>
            </div>
            <div class="ex-sb-pathbar">
              <button type="button" class="ex-sb-path-up" data-ex="sb-path-up" title="上一级">←</button>
              <span class="ex-sb-path" data-ex="sb-path">/workspace</span>
            </div>
            <div class="ex-sandbox-tree" data-ex="sandbox-tree">选择工作区查看文件树</div>
            <div class="ex-sandbox-fileview" data-ex="sandbox-fileview">点击文件查看/编辑内容</div>
          </div>
        </div>
        <div class="ex-sb-tabbar">
          <button type="button" class="active" data-ex="sb-tab-basic-btn">基础</button>
          <button type="button" data-ex="sb-tab-files-btn">文件</button>
        </div>
      </section>
      <!-- 页3：终端 -->
      <section class="ex-sb-page ex-sb-terminal" data-ex="sb-page-term" hidden>
        <div class="ex-sb-topbar">
          <button type="button" class="ex-settings-back" data-ex="sb-term-back" title="返回">←</button>
          <h2 data-ex="sb-term-title">终端</h2>
          <span class="ex-sb-topbar-spacer"></span>
        </div>
        <div class="ex-sb-term-out" data-ex="sb-term-out"><span class="ex-sb-term-hint">输入命令开始（如 ls /workspace）</span></div>
        <div class="ex-sb-term-input-row">
          <input type="text" data-ex="sb-term-input" spellcheck="false" placeholder="输入命令" />
          <button type="button" class="ex-manage-btn" data-ex="sb-term-run">执行</button>
        </div>
        <div class="ex-sb-term-keys">
          <button type="button" data-ex="sb-key-esc">ESC</button>
          <button type="button" data-ex="sb-key-tab">TAB</button>
          <button type="button" data-ex="sb-key-ctrl">CTRL</button>
          <button type="button" data-ex="sb-key-alt">ALT</button>
          <button type="button" data-ex="sb-key-up">↑</button>
          <button type="button" data-ex="sb-key-down">↓</button>
          <button type="button" data-ex="sb-key-left">←</button>
          <button type="button" data-ex="sb-key-right">→</button>
        </div>
      </section>
      <!-- 创建/重命名对话框 -->
      <div class="ex-sb-dialog" data-ex="sb-name-dialog" hidden>
        <div class="ex-sb-dialog-box">
          <h3 data-ex="sb-name-dialog-title">创建</h3>
          <input type="text" data-ex="sb-name-input" spellcheck="false" placeholder="工作区名称" />
          <div class="ex-sb-dialog-err" data-ex="sb-name-err" hidden>名称已存在</div>
          <div class="ex-sb-dialog-actions">
            <button type="button" class="ex-manage-btn" data-ex="sb-name-cancel">取消</button>
            <button type="button" class="ex-manage-btn primary" data-ex="sb-name-ok">保存</button>
          </div>
        </div>
      </div>
      <!-- 删除确认对话框 -->
      <div class="ex-sb-dialog" data-ex="sb-del-dialog" hidden>
        <div class="ex-sb-dialog-box">
          <h3>删除工作区</h3>
          <p class="ex-sb-dialog-tip">删除后不可恢复，确认删除该工作区？</p>
          <div class="ex-sb-dialog-actions">
            <button type="button" class="ex-manage-btn" data-ex="sb-del-cancel">取消</button>
            <button type="button" class="ex-manage-btn danger" data-ex="sb-del-ok">删除</button>
          </div>
        </div>
      </div>
      <!-- FAB（工作区列表页右下角创建按钮，fixed 脱离页 stacking context，手机点击修复） -->
      <button type="button" class="ex-sb-fab" data-ex="sb-add" title="创建工作区">+</button>
    </div>
    <div class="ex-toast-container" data-ex="toast"></div>
    <!-- 会话长按二级菜单（置顶/分享/管理/删除/重新生成标题）：放在 .ex-app 外，避免 overflow:hidden 裁剪 -->
    <div class="ex-conv-menu" data-ex="conv-menu">
      <button type="button" class="ex-conv-menu-item" data-ex-menu-action="pin">置顶</button>
      <button type="button" class="ex-conv-menu-item" data-ex-menu-action="share">分享</button>
      <button type="button" class="ex-conv-menu-item" data-ex-menu-action="manage">管理</button>
      <button type="button" class="ex-conv-menu-item danger" data-ex-menu-action="delete">删除</button>
      <button type="button" class="ex-conv-menu-item" data-ex-menu-action="rename">重新生成标题</button>
    </div>
    <!-- Think 思考强度弹层：底部面板（rikka 式），滑块选择（不思考/自动/低/中/高/最大） -->
    <div class="ex-think-pop" data-ex="think-pop">
      <div class="ex-think-head">思考强度</div>
      <div class="ex-think-value" data-ex="think-value">自动</div>
      <input type="range" class="ex-style-slider" min="0" max="5" step="1" value="1" data-ex="think-slider" aria-label="思考强度" />
      <div class="ex-think-scale"><span>不思考</span><span>自动</span><span>低</span><span>中</span><span>高</span><span>最大</span></div>
    </div>
  `;
  root.appendChild(container);

  const sidebar = container.querySelector('[data-ex="sidebar"]') as HTMLElement;
  const maskEl = container.querySelector('[data-ex="mask"]') as HTMLElement;
  const toggleBtn = container.querySelector('[data-ex="toggle"]') as HTMLButtonElement;
  const messagesEl = container.querySelector('[data-ex="messages"]') as HTMLElement;
  const inputEl = container.querySelector('[data-ex="input"]') as HTMLTextAreaElement;
  const sendEl = container.querySelector('[data-ex="send"]') as HTMLButtonElement;
  const statusEl = container.querySelector('[data-ex="status"]') as HTMLElement;
  const webSearchEl = container.querySelector('[data-ex="websearch"]') as HTMLInputElement;
  const webSearchBtn = container.querySelector('[data-ex="websearch-btn"]') as HTMLButtonElement;
  const newChatBtn = container.querySelector('[data-ex="newchat"]') as HTMLButtonElement;
  const moreDot = container.querySelector('[data-ex="more-dot"]') as HTMLElement;
  const convCountEl = container.querySelector('[data-ex="convcount"]') as HTMLElement;
  const convList = container.querySelector('[data-ex="convlist"]') as HTMLElement;
  const modelStatus = container.querySelector('[data-ex="model"]') as HTMLElement;
  const modelPop = container.querySelector('[data-ex="model-pop"]') as HTMLElement;
  const modelPopList = container.querySelector('[data-ex="model-list"]') as HTMLElement;
  const modelSearchInput = container.querySelector('[data-ex="model-search"]') as HTMLInputElement;
  const titleEl = container.querySelector('[data-ex="title"]') as HTMLElement;
  const searchInput = container.querySelector('[data-ex="convsearch"]') as HTMLInputElement;
  const moreBtn = container.querySelector('[data-ex="more"]') as HTMLButtonElement;
  const moreMenu = container.querySelector('[data-ex="more-menu"]') as HTMLElement;
  const moreSidebarBtn = container.querySelector('[data-ex="more-sidebar"]') as HTMLButtonElement;
  const rightSidebar = container.querySelector('[data-ex="right-sidebar"]') as HTMLElement;
  const rightMask = container.querySelector('[data-ex="right-mask"]') as HTMLElement;
  const charCountEl = container.querySelector('[data-ex="charcount"]') as HTMLElement;
  const emptyGuide = container.querySelector('[data-ex="empty"]') as HTMLElement;
  const emptyStartBtn = container.querySelector('[data-ex="empty-start"]') as HTMLButtonElement;
  const parallaxSvg = container.querySelector('[data-ex="parallax"]') as SVGSVGElement;

  // ---- 设置面板元素（APITOOL 复刻：左导航 + 右内容） ----
  const settingsModal = container.querySelector('[data-ex="settings-modal"]') as HTMLElement;
  const settingsNav = container.querySelector('[data-ex="settings-nav"]') as HTMLElement;
  const settingsBody = container.querySelector('[data-ex="settings-body"]') as HTMLElement;
  const toastContainer = container.querySelector('[data-ex="toast"]') as HTMLElement;
  const profileRender = container.querySelector('[data-ex="profile-render"]') as HTMLElement;
  const syncRateBtn = container.querySelector('[data-ex="syncRate"]') as HTMLButtonElement;
  const exportDataBtn = container.querySelector('[data-ex="exportData"]') as HTMLButtonElement;
  const importDataBtn = container.querySelector('[data-ex="importData"]') as HTMLButtonElement;
  const resetAppBtn = container.querySelector('[data-ex="resetApp"]') as HTMLButtonElement;
  const settingsCancelBtn = container.querySelector('[data-ex="settingsCancel"]') as HTMLButtonElement;
  const settingsSaveBtn = container.querySelector('[data-ex="settingsSave"]') as HTMLButtonElement;
  const capabilityModal = container.querySelector('[data-ex="capability"]') as HTMLElement;
  const capabilityBackBtn = container.querySelector('[data-ex="capabilityBack"]') as HTMLButtonElement;
  const logRefreshBtn = container.querySelector('[data-ex="logRefresh"]') as HTMLButtonElement;
  const logClearBtn = container.querySelector('[data-ex="logClear"]') as HTMLButtonElement;
  const logCopyBtn = container.querySelector('[data-ex="logCopy"]') as HTMLButtonElement;
  const logExportBtn = container.querySelector('[data-ex="logExport"]') as HTMLButtonElement;
  const logExpandBtn = container.querySelector('[data-ex="logExpand"]') as HTMLButtonElement;
  const logView = container.querySelector('[data-ex="logView"]') as HTMLElement;
  /** 运行记录日志范围：今天 / 3天 / 7天 / 全部 可切换（v0.0.96 起真切换，默认 7 天=轮转上限） */
  let logRange: LogRange = '7d';
  const parallaxSlider = container.querySelector('[data-ex="parallaxSlider"]') as HTMLInputElement;
  const parallaxValueEl = container.querySelector('[data-ex="parallaxValue"]') as HTMLElement;

  /** 右上角 toast（APITOOL 同款） */
  function showToast(msg: string): void {
    if (!toastContainer) return;
    const t = document.createElement('div');
    t.className = 'ex-toast';
    t.textContent = msg;
    toastContainer.appendChild(t);
    window.setTimeout(() => t.remove(), 2200);
  }
  /** 超长确认 toast：右上角带确定按钮；点确定触发 confirm 回调（controller 置标记后重发） */
  function confirmOversize(count: number, confirm: () => void): void {
    if (!toastContainer) return;
    const t = document.createElement('div');
    t.className = 'ex-toast ex-toast-confirm';
    const span = document.createElement('span');
    span.textContent = `对话内容过长（约 ${count.toLocaleString()} 字符，上限 100,000）。`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ex-toast-btn';
    btn.textContent = '确定发送';
    btn.addEventListener('click', () => {
      t.remove();
      confirm();
    });
    t.appendChild(span);
    t.appendChild(btn);
    toastContainer.appendChild(t);
    window.setTimeout(() => t.remove(), 8000);
  }
  function renderLogView(): void {
    void (async () => {
      if (!logView) return;
      // 展开/刷新时读取（默认折叠隐藏，不时刻刷新）
      const entries = filterByRange(await logger.getLogsAsync(), logRange);
      logView.textContent = entries.map((e) => renderEntry(e)).join('\n') || '（暂无日志）';
      logView.scrollTop = logView.scrollHeight;
    })();
  }
  /** 展开/收起日志视图（展开时自动刷新） */
  function toggleLogView(): void {
    if (!logView) return;
    const hidden = logView.style.display === 'none' || !logView.style.display;
    logView.style.display = hidden ? 'block' : 'none';
    if (logExpandBtn) logExpandBtn.textContent = hidden ? '收起' : '展开';
    if (hidden) renderLogView();
  }

  // ---- 更新日志（v0.0.67：更多菜单 → 更新日志；内置 CHANGELOG 从 v0.0.63 起） ----
  const CHANGELOG = [
    'v0.0.67：二级菜单统一交互（点外收回/互关）、思考流式直显、删分支图谱与AI重发按钮、气泡94%、右侧统计卡做实（余额/充值/赠金/缓存命中/存储用量）、更新日志入口',
    'v0.0.66：消息编辑（用户重发/AI就地编辑+已编辑标记）、AI思考过程显示、流式完才显操作按钮、管理模式自动退出、设置入口移更多菜单、气泡改深色统一+拉宽',
    'v0.0.65：分支节点链模型（RikkaHub 消息树：候选/切换/fork）、UI 占位全面做实（导出导入/计费统计/会话管理/性能调节）',
    'v0.0.64：设置页保存生效（温度/提示词/轮数）、Think 思考强度透传、多模态图片上传（压缩+三协议映射）',
    'v0.0.63：Agent 模式 + 能力设置页 + 检查更新入口',
  ].join('\n\n');
  function openChangelog(): void {
    const modal = container.querySelector('[data-ex="changelog-modal"]') as HTMLElement | null;
    const content = container.querySelector('[data-ex="changelog-content"]') as HTMLElement | null;
    if (!modal) return;
    if (content) content.textContent = CHANGELOG;
    modal.classList.add('show');
  }
  function closeChangelog(): void {
    container.querySelector('[data-ex="changelog-modal"]')?.classList.remove('show');
  }

  // ---- 编辑消息弹窗（v0.0.69，APITOOL editModal 同款：预填旧文本 + Promise 回调，M12 防泄漏） ----
  let editModalCallback: ((text: string | null) => void) | null = null;
  function showEditModal(content: string, title = '编辑消息'): Promise<string | null> {
    const modal = container.querySelector('[data-ex="edit-modal"]') as HTMLElement | null;
    const ta = container.querySelector('[data-ex="edit-textarea"]') as HTMLTextAreaElement | null;
    const titleEl = container.querySelector('[data-ex="edit-title"]') as HTMLElement | null;
    if (!modal || !ta) return Promise.resolve(null);
    // M12：打开新弹窗前放弃旧的挂起编辑（防 Promise 泄漏/前次编辑静默丢弃）
    if (editModalCallback) {
      const old = editModalCallback;
      editModalCallback = null;
      old(null);
    }
    if (titleEl) titleEl.textContent = title;
    ta.value = content; // 保留上一轮用户输入，便于修改
    modal.classList.add('show');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length); // 光标移到末尾
    return new Promise((resolve) => {
      editModalCallback = resolve;
    });
  }
  function closeEditModal(): void {
    const modal = container.querySelector('[data-ex="edit-modal"]') as HTMLElement | null;
    modal?.classList.remove('show');
    const cb = editModalCallback;
    editModalCallback = null;
    if (cb) cb(null); // 取消/关闭 → null（调用方放弃）
  }
  function saveEditModal(): void {
    const modal = container.querySelector('[data-ex="edit-modal"]') as HTMLElement | null;
    const ta = container.querySelector('[data-ex="edit-textarea"]') as HTMLTextAreaElement | null;
    modal?.classList.remove('show');
    const cb = editModalCallback;
    editModalCallback = null;
    if (cb) cb(ta?.value ?? null);
  }
  // 编辑弹窗按钮：取消（返回）/ 保存 / 点遮罩关闭
  const editCloseBtn = container.querySelector('[data-ex="editClose"]') as HTMLElement | null;
  editCloseBtn?.addEventListener('click', closeEditModal);
  const editSaveBtn = container.querySelector('[data-ex="editSave"]') as HTMLElement | null;
  editSaveBtn?.addEventListener('click', saveEditModal);
  const editModalEl = container.querySelector('[data-ex="edit-modal"]') as HTMLElement | null;
  editModalEl?.addEventListener('click', (e) => {
    if (e.target === editModalEl) closeEditModal();
  });

  function openSettings(tab?: string): void {
    // 渲染服务商极简配置（profile-config 分节：选卡/填 Key/自动检测模型/高级折叠）
    if (profileRender) {
      const section = ctx.config.list().find((s) => s.namespace === 'profile');
      if (section?.render) {
        profileRender.innerHTML = '';
        section.render(profileRender, () => ctx.config.get('profile'), (v) => ctx.config.set('profile', v));
      } else {
        profileRender.innerHTML = '<div class="ks-hint">服务商配置分节未就绪</div>';
      }
    }
    renderPluginList();
    // 回填对话参数（v0.0.64）：当前对话提示词（会话级）/ 温度 / 轮数 / 全局提示词
    const chatCfg = (ctx.config.get('chat') ?? {}) as Record<string, unknown>;
    const convPromptEl = container.querySelector('#exConvPrompt') as HTMLTextAreaElement | null;
    const convTempEl = container.querySelector('#exConvTemp') as HTMLInputElement | null;
    const convTempValueEl = container.querySelector('[data-ex="convTempValue"]') as HTMLElement | null;
    const convRoundsEl = container.querySelector('#exConvRounds') as HTMLInputElement | null;
    const sysPromptEl = container.querySelector('#exSystemPrompt') as HTMLTextAreaElement | null;
    if (convPromptEl) convPromptEl.value = controller.getConversationSystemPrompt();
    const temp = Number(chatCfg.temperature);
    const tempVal = Number.isFinite(temp) ? temp : 1.0;
    if (convTempEl) convTempEl.value = String(tempVal);
    if (convTempValueEl) convTempValueEl.textContent = String(tempVal);
    if (convRoundsEl) convRoundsEl.value = Number(chatCfg.maxRounds) > 0 ? String(chatCfg.maxRounds) : '';
    if (sysPromptEl) sysPromptEl.value = String(chatCfg.systemPrompt ?? '');
    // 计费区回填（v0.0.65）：币种 select + 汇率输入（优先 config.chat.rate，否则缓存汇率）
    const currencySel = container.querySelector('#exCurrency') as HTMLSelectElement | null;
    if (currencySel) currencySel.value = chatCfg.currency === 'USD' ? '美元' : '人民币（默认）';
    const rateInputEl = container.querySelector('#exRate') as HTMLInputElement | null;
    if (rateInputEl) {
      const cfgRate = Number(chatCfg.rate);
      const cached = (() => {
        try {
          return ctx.rate.getCached();
        } catch {
          return null;
        }
      })();
      rateInputEl.value = (Number.isFinite(cfgRate) && cfgRate > 0 ? cfgRate : cached ?? 7.2).toFixed(4);
    }
    settingsModal.classList.add('show');
    // 指定分区：激活导航项 + 滚动到分区（供"运行记录"等入口直达；B1：滚动 body 容器而非 scrollIntoView，避免被固定 head 遮挡）
    if (tab) {
      const navBtn = settingsNav.querySelector(`[data-ex-nav="${esc(tab)}"]`) as HTMLElement | null;
      if (navBtn) {
        settingsNav.querySelectorAll('.ex-nav-item').forEach((n) => n.classList.toggle('active', n === navBtn));
        const sec = settingsBody.querySelector('#' + tab) as HTMLElement | null;
        if (sec) {
          const top = sec.offsetTop - settingsBody.offsetTop;
          settingsBody.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
        }
      }
      // 导航到运行记录时自动刷新日志
      if (tab === 'sec-logs') renderLogView();
    }
  }
  function closeSettings(): void {
    settingsModal.classList.remove('show');
  }

  /** 能力设置独立页：打开时渲染模式高亮 + 工具列表（先关设置页，防残留叠层） */
  function openCapability(): void {
    closeSettings();
    renderCapabilityTools();
    syncModeButtons();
    capabilityModal.classList.add('show');
  }
  function closeCapability(): void {
    capabilityModal.classList.remove('show');
  }
  /** 模式切换按钮高亮（config.agent.mode：agent=代理 / chat=对话） */
  function syncModeButtons(): void {
    const agentBtn = capabilityModal.querySelector('[data-ex-mode="agent"]') as HTMLElement | null;
    const chatBtn = capabilityModal.querySelector('[data-ex-mode="chat"]') as HTMLElement | null;
    const agent = (ctx.config.get('agent') ?? {}) as Record<string, unknown>;
    agentBtn?.classList.toggle('active', agent.mode !== 'chat');
    chatBtn?.classList.toggle('active', agent.mode === 'chat');
  }

  /** 渲染右侧边栏统计（插件/工具/服务商/配置分节数 + v0.0.65 计费卡：token/费用/余额） */
  async function renderRightStats(): Promise<void> {
    const set = (sel: string, val: string): void => {
      const el = container.querySelector(sel) as HTMLElement | null;
      if (el) el.textContent = val;
    };
    try {
      set('[data-ex="stat-plugins"]', String([...(ctx.registry.values() as unknown as { length?: number }[])].length));
      set('[data-ex="stat-tools"]', String(ctx.tools.list().length));
      set('[data-ex="stat-providers"]', String(ctx.providers.list().length));
      set('[data-ex="stat-configs"]', String(ctx.config.list().length));
    } catch {
      /* 统计失败保持占位 */
    }
    // 计费卡：会话级用量统计（真实 usage 累加，v0.0.65）
    const stats = controller.getStats();
    const chatCfgForStats = (ctx.config.get('chat') ?? {}) as Record<string, unknown>;
    const cfgRate = Number(chatCfgForStats.rate);
    const rate = Number.isFinite(cfgRate) && cfgRate > 0
      ? cfgRate
      : (() => {
          try {
            return ctx.rate.getCached();
          } catch {
            return null;
          }
        })();
    // 费用折算：USD → CNY（config.chat.rate 优先，其次缓存汇率，默认 7.2）或 USD
    const inCny = chatCfgForStats.currency !== 'USD';
    const cny = rate ?? 7.2;
    const fmtMoney = (usd: number): string => {
      if (usd <= 0) return '—';
      const v = inCny ? usd * cny : usd;
      const symbol = inCny ? '¥' : '$';
      return `${symbol}${v.toFixed(4)}`;
    };
    set('[data-ex="stat-cost"]', fmtMoney(stats.totalCost));
    // 账户余额（v0.0.67，参考 APITOOL fetchBalance）：profile.balanceUrl 或 DeepSeek 官方；60s 缓存；点击刷新
    void fetchBalance();
    set('[data-ex="stat-requests"]', String(stats.requestCount));
    set('[data-ex="stat-total-tokens"]', stats.totalTokens.toLocaleString());
    set('[data-ex="stat-input"]', stats.lastInputTokens > 0 ? stats.lastInputTokens.toLocaleString() + ' tok' : '—');
    set('[data-ex="stat-output"]', stats.lastOutputTokens > 0 ? stats.lastOutputTokens.toLocaleString() + ' tok' : '—');
    // 缓存命中（v0.0.67）：最近一次请求的缓存 token / 输入 token 占比；无明细显示 —（如中转站不返回）
    set(
      '[data-ex="stat-cache"]',
      stats.lastInputTokens > 0 && stats.lastCacheInputTokens > 0
        ? `${Math.round((stats.lastCacheInputTokens / stats.lastInputTokens) * 100)}% (${stats.lastCacheInputTokens.toLocaleString()} tok)`
        : '—',
    );
    // 存储用量：localStorage 键长度合计 + IndexedDB 大小（估算）
    try {
      let ls = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) ls += (localStorage.getItem(k) ?? '').length + k.length;
      }
      set('[data-ex="stat-storage"]', `${(ls / 1024).toFixed(1)} KB`);
    } catch {
      set('[data-ex="stat-storage"]', '—');
    }
    void estimateDbSize().then((kb) => set('[data-ex="stat-db"]', kb > 0 ? `${kb} KB` : '—'));
  }

  // ---- 账户余额（v0.0.67，参考 APITOOL fetchBalance：balanceUrl/DeepSeek 官方 + 60s 缓存 + 点击刷新） ----
  let balanceCache: { data: Record<string, unknown> | null; time: number } | null = null;
  async function fetchBalance(): Promise<void> {
    const set = (sel: string, val: string): void => {
      const el = container.querySelector(sel) as HTMLElement | null;
      if (el) el.textContent = val;
    };
    const profile = ctx.config.get('profile') as Record<string, unknown>;
    const key = String(profile.apiKey ?? '');
    if (!key) {
      setBalanceUI(null);
      return;
    }
    const id = String(profile.id ?? '');
    const balanceUrl = String(profile.balanceUrl ?? '').trim();
    const url = balanceUrl || (id === 'deepseek' ? 'https://api.deepseek.com/user/balance' : '');
    if (!url) {
      setBalanceUI(null); // 非 DeepSeek 且未配余额接口 → 中性 —
      return;
    }
    if (balanceCache && Date.now() - balanceCache.time < 60000) {
      setBalanceUI(balanceCache.data);
      return;
    }
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      balanceCache = { data, time: Date.now() };
      setBalanceUI(data);
    } catch {
      balanceCache = { data: null, time: Date.now() };
      setBalanceUI(null);
    }
  }
  function setBalanceUI(data: Record<string, unknown> | null): void {
    const set = (sel: string, val: string): void => {
      const el = container.querySelector(sel) as HTMLElement | null;
      if (el) el.textContent = val;
    };
    const infos = data?.balance_infos as { total_balance?: number; topped_up_balance?: number; granted_balance?: number }[] | undefined;
    const b = infos?.[0];
    if (!b) {
      set('[data-ex="stat-balance"]', '—');
      set('[data-ex="stat-balance-topped"]', '—');
      set('[data-ex="stat-balance-granted"]', '—');
      return;
    }
    set('[data-ex="stat-balance"]', `¥${b.total_balance ?? '—'}`);
    set('[data-ex="stat-balance-topped"]', `¥${b.topped_up_balance ?? '—'}`);
    set('[data-ex="stat-balance-granted"]', `¥${b.granted_balance ?? '—'}`);
  }
  // 余额行点击刷新
  const balanceRow = container.querySelector('[data-ex="stat-balance-row"]') as HTMLElement | null;
  balanceRow?.addEventListener('click', () => {
    balanceCache = null; // 强制刷新
    void fetchBalance();
  });

  /** 估算 IndexedDB 大小（APITOOL sizeBytes 思路：会话 JSON 的 UTF-16 字节 ≈ 字符数 × 2） */
  async function estimateDbSize(): Promise<number> {
    try {
      const sessions = await ctx.storage.listConversations();
      const bytes = JSON.stringify(sessions).length * 2;
      return Math.round(bytes / 1024);
    } catch {
      return 0;
    }
  }

  /** 渲染右侧栏分支总览（v0.0.65）：列出全部节点，候选>1 高亮 + ←→ 直接切换；替代"分支图谱"占位 */
  /** 插件功能区标题（manifest 的 group 字段 → 显示名） */
  const GROUP_LABELS: Record<string, string> = {
    基础: '基础 / Core',
    界面: '界面 / Interface',
    主题: '主题 / Themes',
    服务商: '服务商 / Providers',
    工具: '工具 / Tools',
  };
  const GROUP_ORDER = ['基础', '界面', '主题', '服务商', '工具'];

  /** 渲染设置弹窗的插件管理列表（真实读取 topology 状态 + manifest 元数据，启停真实生效；受保护标锁；双语 + 功能区两列） */
  /** 插件管理：就地展开状态（点卡片展开详情） */
  const expandedPlugins = new Set<string>();

  function renderPluginList(): void {
    const listEl = container.querySelector('[data-ex="plugin-list"]') as HTMLElement | null;
    if (!listEl) return;
    let topo;
    try {
      topo = ctx.topology.getTopology();
    } catch {
      listEl.innerHTML = `<div style="font-size:12px;color:var(--ex-text3);padding:16px;text-align:center;">拓扑服务不可用</div>`;
      return;
    }
    const nodes = topo.nodes.filter((n) => n.kind !== 'core');
    if (nodes.length === 0) {
      listEl.innerHTML = `<div style="font-size:12px;color:var(--ex-text3);padding:16px;text-align:center;">（无插件）</div>`;
      return;
    }
    // 按功能区分组：manifest.group 决定（未知插件归"工具"）
    const groups = new Map<string, typeof nodes>();
    for (const n of nodes) {
      const meta = ctx.topology.getManifest(n.id);
      const g = meta?.group ?? '工具';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(n);
    }
    const groupHtml = GROUP_ORDER.filter((g) => groups.has(g))
      .map((g) => {
        const items = groups.get(g)!;
        return `<div>
          <div class="ex-plugin-group-title">${GROUP_LABELS[g] ?? g}</div>
          <div class="ex-plugin-list">${items.map(pluginCardHtml).join('')}</div>
        </div>`;
      })
      .join('');
    listEl.innerHTML =
      `<div style="font-size:11px;color:var(--ex-text3);margin-bottom:10px;">点卡片就地展开详情 · 内置插件不可停用 · 各插件均为功能开关</div>` + groupHtml;
    bindPluginList(listEl);
  }

  /** 单张插件卡片（状态徽标 + 权限行 + 就地展开；与内核插件启停逻辑统一） */
  function pluginCardHtml(n: { id: string; name: string; stateCode: number; state: string; injectServices: string[] }): string {
    const meta = ctx.topology.getManifest(n.id);
    const zh = meta?.label?.zh ?? n.name;
    const en = meta?.label?.en ?? n.id;
    const desc = meta?.description;
    const protectedP = ctx.topology.isProtected(n.id);
    const active = n.stateCode === 2;
    const failed = n.stateCode === 3;
    const open = expandedPlugins.has(n.id);
    // 状态方块灯（卡片左侧竖条）：青绿=已开启 橙=出问题 灰=已关闭 青绿实心=内置
    const lampCls = protectedP ? 'core' : active ? 'on' : failed ? 'err' : 'off';
    // 第一行右侧状态文字（简短）：开启/关闭/出问题/内置
    const stateText = protectedP ? '内置' : active ? '已开启' : failed ? '出问题' : '已关闭';
    // 权限行：从 manifest/kind 派生（网络/存储/读写文件/系统）
    const perms = derivePermissions(n);
    const toggleBtn = protectedP
      ? ''
      : active
        ? `<button type="button" class="ex-plugin-btn off" data-ex-toggle-plugin="${esc(n.id)}">停用</button>`
        : `<button type="button" class="ex-plugin-btn" data-ex-toggle-plugin="${esc(n.id)}">启用</button>`;
    return `<div class="ex-plugin-card${open ? ' open' : ''}" data-ex-plugin-card="${esc(n.id)}">
      <div class="ex-plugin-lamp ${lampCls}"></div>
      <div class="ex-plugin-card-inner">
        <div class="ex-plugin-card-main">
          <div class="ex-plugin-card-row">
            <div class="ex-plugin-card-name">${esc(zh)}<span class="ex-en">${esc(en)}</span></div>
            <span class="ex-plugin-state ${lampCls}">${stateText}</span>
          </div>
          ${desc ? `<div class="ex-plugin-card-desc" title="${esc(desc)}">${esc(desc)}</div>` : ''}
        </div>
      </div>
      <div class="ex-plugin-actions">
        ${toggleBtn}
      </div>
      <div class="ex-plugin-detail">
        <div class="ex-plugin-detail-row"><b>状态</b>：${esc(n.state)}</div>
        ${desc ? `<div class="ex-plugin-detail-row"><b>描述</b>：${esc(desc)}</div>` : ''}
        <div class="ex-plugin-detail-row"><b>需要权限</b>：${esc(perms)}</div>
        ${n.injectServices.length > 0 ? `<div class="ex-plugin-detail-row"><b>依赖</b>：${n.injectServices.map((s) => `<span class="ex-plugin-tag">${esc(s)}</span>`).join('')}</div>` : ''}
        ${protectedP ? '<div class="ex-plugin-detail-row" style="color:var(--ex-accent2);">内置插件：禁用会破坏内核/界面，不可停用。</div>' : ''}
      </div>
    </div>`;
  }

  /** 权限行派生（从 kind/inject 简单映射；后续 manifest 可扩展 permissions 字段） */
  function derivePermissions(n: { id: string; kind?: string; injectServices: string[] }): string {
    const inj = new Set(n.injectServices ?? []);
    const parts: string[] = [];
    if (inj.has('storage')) parts.push('存储');
    if (inj.has('tools') || inj.has('providers')) parts.push('网络');
    if (n.id === 'core-services') parts.push('系统');
    if (n.id === 'fallback-gui') parts.push('系统');
    if (parts.length === 0) parts.push('网络');
    return parts.join(' / ');
  }

  /** 绑定插件列表：卡片点击就地展开 + 启停按钮 */
  function bindPluginList(listEl: HTMLElement): void {
    // 卡片点击（非按钮）→ 就地展开/收起
    listEl.querySelectorAll<HTMLElement>('[data-ex-plugin-card]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const id = card.dataset.exPluginCard;
        if (!id) return;
        if (expandedPlugins.has(id)) expandedPlugins.delete(id);
        else expandedPlugins.add(id);
        card.classList.toggle('open');
      });
    });
    // 启停按钮
    listEl.querySelectorAll<HTMLButtonElement>('[data-ex-toggle-plugin]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.exTogglePlugin;
        if (!name || ctx.topology.isProtected(name)) return;
        btn.disabled = true;
        const r = await ctx.topology.togglePlugin(name);
        if (!r.ok) {
          showToast(`切换失败：${r.message ?? name}`);
        } else {
          showToast(r.message ?? '已切换');
        }
        renderPluginList();
      });
    });
  }

  function esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 沙箱管理页：模块级状态（loadSandboxDir/loadSandboxFile 是模块级函数，需共享选中工作区与面板引用） */
  let sandboxWsId = '';
  let sandboxFileviewEl: HTMLElement | null = null;
  let sandboxShellInput: HTMLInputElement | null = null;
  let sandboxShellRun: HTMLButtonElement | null = null;
  let sandboxShellOut: HTMLElement | null = null;
  let sbDirty = false; // v0.0.87 编辑器 dirty 追踪（返回确认）

  /** 沙箱管理三页（v0.0.87 对齐 RikkaHub WorkspacePage/DetailPage/TerminalPage）：列表 → 详情[Basic/Files] / 终端 */
  function initSandboxManage(): void {
    const manage = container.querySelector('[data-ex="sandbox-manage"]') as HTMLElement | null;
    if (!manage) return;
    const pageList = manage.querySelector('[data-ex="sb-page-list"]') as HTMLElement | null;
    const pageDetail = manage.querySelector('[data-ex="sb-page-detail"]') as HTMLElement | null;
    const pageTerm = manage.querySelector('[data-ex="sb-page-term"]') as HTMLElement | null;
    const wsListEl = manage.querySelector('[data-ex="sandbox-wslist"]') as HTMLElement | null;
    const treeEl = manage.querySelector('[data-ex="sandbox-tree"]') as HTMLElement | null;
    const openBtn = container.querySelector('[data-ex="sandboxManage"]') as HTMLButtonElement | null;
    const backBtn = manage.querySelector('[data-ex="sandboxBack"]') as HTMLButtonElement | null;
    sandboxFileviewEl = manage.querySelector('[data-ex="sandbox-fileview"]');
    sandboxShellInput = manage.querySelector('[data-ex="sb-term-input"]');
    sandboxShellRun = manage.querySelector('[data-ex="sb-term-run"]');
    sandboxShellOut = manage.querySelector('[data-ex="sb-term-out"]');
    sandboxWsId = '';
    const showPage = (p: HTMLElement | null): void => {
      [pageList, pageDetail, pageTerm].forEach((pg) => { if (pg) pg.hidden = pg !== p; });
      // FAB 只在列表页显示
      const fab = manage.querySelector('[data-ex="sb-add"]') as HTMLElement | null;
      if (fab) fab.hidden = p !== pageList;
    };
    openBtn?.addEventListener('click', () => {
      manage.classList.add('show');
      showPage(pageList);
      void loadWorkspaceList();
    });
    backBtn?.addEventListener('click', () => manage.classList.remove('show'));
    // 面板引用（详情页）
    const detailTitle = manage.querySelector('[data-ex="sb-detail-title"]') as HTMLElement | null;
    const infoName = manage.querySelector('[data-ex="sb-info-name"]') as HTMLElement | null;
    const infoId = manage.querySelector('[data-ex="sb-info-id"]') as HTMLElement | null;
    const infoShell = manage.querySelector('[data-ex="sb-info-shell"]') as HTMLElement | null;
    const rootfsState = manage.querySelector('[data-ex="sb-rootfs-state"]') as HTMLElement | null;
    const rootfsInstall = manage.querySelector('[data-ex="sb-rootfs-install"]') as HTMLButtonElement | null;
    const rootfsProgress = manage.querySelector('[data-ex="sb-rootfs-progress"]') as HTMLElement | null;
    const tabBasic = manage.querySelector('[data-ex="sb-tab-basic"]') as HTMLElement | null;
    const tabFiles = manage.querySelector('[data-ex="sb-tab-files"]') as HTMLElement | null;
    const segFiles = manage.querySelector('[data-ex="sb-seg-files"]') as HTMLButtonElement | null;
    const segRootfs = manage.querySelector('[data-ex="sb-seg-rootfs"]') as HTMLButtonElement | null;
    const pathEl = manage.querySelector('[data-ex="sb-path"]') as HTMLElement | null;
    const pathUp = manage.querySelector('[data-ex="sb-path-up"]') as HTMLButtonElement | null;
    const termTitle = manage.querySelector('[data-ex="sb-term-title"]') as HTMLElement | null;
    const nameDialog = manage.querySelector('[data-ex="sb-name-dialog"]') as HTMLElement | null;
    const nameDialogTitle = manage.querySelector('[data-ex="sb-name-dialog-title"]') as HTMLElement | null;
    const nameInput = manage.querySelector('[data-ex="sb-name-input"]') as HTMLInputElement | null;
    const nameErr = manage.querySelector('[data-ex="sb-name-err"]') as HTMLElement | null;
    const nameOk = manage.querySelector('[data-ex="sb-name-ok"]') as HTMLButtonElement | null;
    const nameCancel = manage.querySelector('[data-ex="sb-name-cancel"]') as HTMLButtonElement | null;
    const delDialog = manage.querySelector('[data-ex="sb-del-dialog"]') as HTMLElement | null;
    const delOk = manage.querySelector('[data-ex="sb-del-ok"]') as HTMLButtonElement | null;
    const delCancel = manage.querySelector('[data-ex="sb-del-cancel"]') as HTMLButtonElement | null;
    // 名称/删除对话框：状态变量 + 单次绑定（v0.0.87 修复：此前每次打开都 addEventListener 新闭包，removeEventListener 用新引用永远移不掉旧监听器，
    // 残留的"创建"监听器在重命名保存时同时执行 → 复制副本 bug）
    let sbNameMode: 'create' | 'rename' = 'create';
    let sbNameTargetId = '';
    let sbWsRows: string[] = [];
    let sbDelTargetId = '';
    const openNameDialog = (mode: 'create' | 'rename', targetId: string, preset: string, rowsNow: string[]): void => {
      sbNameMode = mode;
      sbNameTargetId = targetId;
      sbWsRows = rowsNow;
      if (!nameDialog || !nameInput || !nameErr || !nameDialogTitle) return;
      nameDialogTitle.textContent = mode === 'create' ? '创建工作区' : '重命名工作区';
      nameInput.value = preset;
      nameErr.hidden = true;
      nameDialog.hidden = false;
      window.setTimeout(() => nameInput.focus(), 30);
    };
    nameOk?.addEventListener('click', async () => {
      logger.info('sandbox', `nameOk 点击 mode=${sbNameMode} name=${nameInput?.value?.trim()}`);
      if (!nameDialog || !nameInput || !nameErr) return;
      const v = nameInput.value.trim();
      if (!v) return;
      if (sbNameMode === 'rename') {
        const exists = sbWsRows.some((r2) => { const c = r2.split(/\s+/); return c.length >= 2 && c[1] === v && c[0] !== sbNameTargetId; });
        if (exists) { nameErr.hidden = false; return; }
      }
      nameDialog.hidden = true;
      try {
        if (sbNameMode === 'rename') {
          await ctx.tools.execute('workspace_rename', { workspaceId: sbNameTargetId, name: v });
          showToast('已重命名');
          void loadWorkspaceList();
        } else {
          const parts = await ctx.tools.execute('workspace_create', { name: v });
          logger.info('sandbox', `workspace_create 调用 name=${v}`);
          showToast('已创建');
          // 手动追加卡片到列表（不依赖 localStorage 刷新，避免环境差异导致不显示）
          // 注意：不调用 loadWorkspaceList，因为它的 wsListEl.innerHTML='加载中...' 会清空刚追加的卡片
          const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
          const idMatch = text.match(/ID:\s*(\S+)/);
          const newId = idMatch ? idMatch[1] : '';
          logger.info('sandbox', `workspace_create 返回 text=${text.slice(0, 80)} newId=${newId}`);
          showToast(`调试: text=${text.slice(0, 60)}`);
          if (wsListEl && newId) {
            const empty = wsListEl.querySelector('[style*="text-align:center"]');
            if (empty) empty.remove();
            const card = createWsCard(newId, v, '', []);
            if (card) wsListEl.appendChild(card);
            else showToast('调试: createWsCard 返回 null');
          } else {
            showToast(`调试: 跳过卡片追加 wsListEl=${!!wsListEl} newId=${newId}`);
          }
        }
      } catch { showToast(sbNameMode === 'rename' ? '重命名失败' : '创建失败'); }
    });
    nameCancel?.addEventListener('click', () => { if (nameDialog) nameDialog.hidden = true; });
    delOk?.addEventListener('click', async () => {
      if (!delDialog) return;
      delDialog.hidden = true;
      try {
        await ctx.tools.execute('workspace_delete', { workspaceId: sbDelTargetId });
        showToast('已删除');
        void loadWorkspaceList();
      } catch { showToast('删除失败'); }
    });
    delCancel?.addEventListener('click', () => { if (delDialog) delDialog.hidden = true; });
    // 详情页状态
    let currentWsName = '';
    let currentFs: 'files' | 'rootfs' = 'files';
    let currentFsPath = '/workspace';
    // 文件三点菜单（Export/Share/Delete，对齐 RikkaHub）
    const showFileMenu = (menuBtn: HTMLElement, wsId: string, path: string): void => {
      const pop = document.createElement('div');
      pop.className = 'ex-sb-ws-menu-pop';
      pop.innerHTML = '<button type="button" data-ex="file-export">导出</button><button type="button" data-ex="file-share">分享</button><button type="button" class="danger" data-ex="file-delete">删除</button>';
      const rect = menuBtn.getBoundingClientRect();
      pop.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 100)}px`;
      pop.style.left = `${Math.max(8, Math.min(rect.left - 100, window.innerWidth - 140))}px`;
      document.body.appendChild(pop);
      const close = (): void => pop.remove();
      window.setTimeout(() => { document.addEventListener('click', close, { once: true }); }, 0);
      pop.querySelector('[data-ex="file-export"]')?.addEventListener('click', () => { close(); void loadSandboxFile(wsId, path, true, 'download'); });
      pop.querySelector('[data-ex="file-share"]')?.addEventListener('click', () => { close(); void loadSandboxFile(wsId, path, true, 'share'); });
      pop.querySelector('[data-ex="file-delete"]')?.addEventListener('click', () => {
        close();
        if (!confirm('确认删除？')) return;
        ctx.tools.execute('workspace_delete_file', { workspaceId: wsId, path }).then(() => {
          showToast('已删除');
          if (sandboxWsId) void loadDetailFiles(sandboxWsId, currentFs, currentFsPath);
        }).catch(() => showToast('删除失败'));
      });
    };
    // 工作区卡片创建（复用 loadWorkspaceList 和创建后追加，保证事件绑定一致）
    const createWsCard = (id: string, name: string, state: string, rowsNow: string[]): HTMLDivElement | null => {
      if (!wsListEl) { showToast('调试: wsListEl 为空'); return null; }
      const iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7l9-5z"/><path d="M12 12v10"/><path d="M3 7l9 5 9-5"/></svg>';
      const item = document.createElement('div');
      item.className = 'ex-sandbox-ws-item';
      const stateLabel = state || '需安装';
      const stateCls = state ? 'installed' : 'missing';
      item.innerHTML = `<span class="ex-sandbox-ws-icon">${iconSvg}</span><span class="ex-sandbox-ws-main"><span class="ex-sandbox-ws-name">${esc(name)}</span><span class="ex-sandbox-ws-id">${esc(id)}</span></span><span class="ex-sandbox-ws-state ${stateCls}">${esc(stateLabel)}</span><button type="button" class="ex-sandbox-ws-menu" data-ex="ws-menu" title="更多">···</button>`;
      item.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-ex="ws-menu"]')) return;
        sandboxWsId = id; currentWsName = name; showPage(pageDetail);
        if (detailTitle) detailTitle.textContent = name;
        if (infoName) infoName.textContent = name;
        if (infoId) infoId.textContent = id;
        if (infoShell) infoShell.textContent = state || '未知';
        if (rootfsState) { rootfsState.textContent = state || '未安装'; rootfsState.classList.toggle('installed', !!state); rootfsState.classList.toggle('missing', !state); if (rootfsInstall) rootfsInstall.textContent = state ? '重新安装' : '安装 rootfs'; }
        if (tabBasic) tabBasic.hidden = false; if (tabFiles) tabFiles.hidden = true;
        manage.querySelector('[data-ex="sb-tab-basic-btn"]')?.classList.add('active');
        manage.querySelector('[data-ex="sb-tab-files-btn"]')?.classList.remove('active');
        if (segFiles) segFiles.classList.add('active'); if (segRootfs) segRootfs.classList.remove('active');
        currentFs = 'files'; currentFsPath = '/workspace';
        void loadDetailFiles(id, 'files', '/workspace');
        if (sandboxFileviewEl) sandboxFileviewEl.innerHTML = '<div style="font-size:11px;color:var(--ex-text3);padding:8px">点击文件查看/编辑内容</div>';
      });
      const menuBtn = item.querySelector('[data-ex="ws-menu"]') as HTMLButtonElement | null;
      menuBtn?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const pop = document.createElement('div'); pop.className = 'ex-sb-ws-menu-pop';
        pop.innerHTML = '<button type="button" data-ex="ws-rename">✎ 重命名</button><button type="button" class="danger" data-ex="ws-delete">✕ 删除</button>';
        const rect = menuBtn.getBoundingClientRect();
        pop.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 90)}px`;
        pop.style.left = `${Math.max(8, Math.min(rect.left - 100, window.innerWidth - 140))}px`;
        document.body.appendChild(pop);
        const close = (): void => pop.remove();
        window.setTimeout(() => { document.addEventListener('click', close, { once: true }); }, 0);
        pop.querySelector('[data-ex="ws-rename"]')?.addEventListener('click', () => { close(); openNameDialog('rename', id, name, rowsNow); });
        pop.querySelector('[data-ex="ws-delete"]')?.addEventListener('click', () => { close(); sbDelTargetId = id; if (delDialog) delDialog.hidden = false; });
      });
      return item;
    };
    // Files/Rootfs 当前目录平铺加载（对齐 RikkaHub WorkspaceDetailPage Files tab：路径栏 + 平铺列表）
    const loadDetailFiles = async (wsId: string, fs: 'files' | 'rootfs', p: string): Promise<void> => {
      currentFs = fs;
      currentFsPath = p;
      if (pathEl) pathEl.textContent = p;
      if (!treeEl) return;
      treeEl.innerHTML = '<div style="font-size:12px;color:var(--ex-text3);padding:12px;text-align:center;">加载中...</div>';
      try {
        const parts = await ctx.tools.execute('workspace_list_files', { workspaceId: wsId, path: p });
        const text = (parts ?? []).map((x) => (x.type === 'text' ? x.text : '')).join('\n');
        const items = parseSandboxList(text);
        if (items.length === 0) {
          treeEl.innerHTML = '<div class="ex-sandbox-tree-item" style="color:var(--ex-text3)">（空目录）</div>';
          return;
        }
        treeEl.innerHTML = '';
        for (const it of items) {
          const row = document.createElement('div');
          row.className = 'ex-sandbox-tree-item' + (it.type === 'dir' ? ' dir' : ' file');
          row.style.cursor = 'pointer';
          const icon = it.type === 'dir' ? '▸' : '·';
          const ext = it.name.split('.').pop()?.toLowerCase() || '';
          const TEXT_EXTS = 'txt,md,json,xml,yaml,yml,toml,ini,csv,log,html,css,js,ts,tsx,jsx,kt,py,go,rs,c,sh,sql,lua,php,diff,srt,dockerfile,dart,swift,m,h,cpp,hpp,scss,less,vue,svelte,astro,conf,cfg,env,gitignore,editorconfig,npmrc,yarnrc,lock,gradle,mjs,cjs,mts,cts'.split(',');
          const IMG_EXTS = 'png,jpg,jpeg,gif,webp,bmp,svg,ico,avif'.split(',');
          row.innerHTML = `<span class="ex-sandbox-tree-icon">${icon}</span><span class="ex-sandbox-tree-name">${esc(it.name)}</span>${it.type === 'file' ? `<span class="ex-sandbox-tree-size">${esc(it.size)}</span>` : ''}`;
          // 文件行点击：dirty 保护 + 类型路由（TEXT→编辑器 IMAGE→提示 OTHER→下载）
          row.addEventListener('click', (ev) => {
            if ((ev.target as HTMLElement).closest('[data-ex="tree-menu"]')) return;
            const childPath = `${p === '/' ? '' : p}/${it.name}`;
            if (it.type === 'dir') {
              if (sbDirty && !confirm('放弃更改？')) return;
              sbDirty = false;
              void loadDetailFiles(wsId, fs, childPath);
            } else {
              if (sbDirty && !confirm('放弃更改？')) return;
              sbDirty = false;
              treeEl.querySelectorAll('.ex-sandbox-tree-item.selected').forEach((n) => n.classList.remove('selected'));
              row.classList.add('selected');
              if (IMG_EXTS.includes(ext)) {
                if (sandboxFileviewEl) sandboxFileviewEl.innerHTML = `<div class="ex-sandbox-fileview-path">${esc(childPath)}</div><div style="padding:12px;text-align:center;color:var(--ex-text3);font-size:12px">图片预览（仅原生 APK 支持）</div>`;
              } else if (TEXT_EXTS.includes(ext)) {
                void loadSandboxFile(wsId, childPath, fs === 'rootfs');
              } else {
                void loadSandboxFile(wsId, childPath, true, 'download');
              }
            }
          });
          // 三点菜单（Export/Share/Delete，对齐 RikkaHub）
          if (it.type === 'file') {
            const menuBtn = document.createElement('button');
            menuBtn.type = 'button';
            menuBtn.className = 'ex-sandbox-tree-menu';
            menuBtn.textContent = '···';
            menuBtn.title = '更多';
            row.appendChild(menuBtn);
            menuBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const childPath = `${p === '/' ? '' : p}/${it.name}`;
              showFileMenu(menuBtn, wsId, childPath);
            });
          }
          treeEl.appendChild(row);
        }
      } catch {
        treeEl.innerHTML = '<div style="font-size:12px;color:var(--ex-text3);padding:12px;text-align:center;">读取失败</div>';
      }
    };
    // 列表页：卡片（图标+名称+状态+三点菜单）+ FAB 创建 + 重命名/删除（对齐 RikkaHub WorkspacePage）
    async function loadWorkspaceList(): Promise<void> {
      if (!wsListEl) { logger.info('workspace', 'loadWorkspaceList: wsListEl null'); return; }
      wsListEl.innerHTML = '<div style="font-size:12px;color:var(--ex-text3);padding:12px;text-align:center;">加载中...</div>';
      try {
        const parts = await ctx.tools.execute('workspace_list', {});
        const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
        const rows = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (rows.length === 0) {
          wsListEl.innerHTML = '<div style="font-size:12px;color:var(--ex-text3);padding:28px 12px;text-align:center;">暂无工作区<br/><span style="font-size:11px">点击右下角 + 创建</span></div>';
          return;
        }
        wsListEl.innerHTML = '';
        const iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7l9-5z"/><path d="M12 12v10"/><path d="M3 7l9 5 9-5"/></svg>';
        for (const line of rows) {
          const cols = line.split(/\s+/);
          if (cols.length < 2) continue;
          const id = cols[0];
          const name = cols[1];
          const state = cols[2] === '✓' ? '已装 rootfs' : cols[2] === '✗' ? '未装 rootfs' : '';
          const item = document.createElement('div');
          item.className = 'ex-sandbox-ws-item';
          item.innerHTML = `<span class="ex-sandbox-ws-icon">${iconSvg}</span><span class="ex-sandbox-ws-main"><span class="ex-sandbox-ws-name">${esc(name)}</span><span class="ex-sandbox-ws-id">${esc(id)}${state ? ` · ${esc(state)}` : ''}</span></span><button type="button" class="ex-sandbox-ws-menu" data-ex="ws-menu" title="更多">···</button>`;
          item.addEventListener('click', (ev) => {
            const t = ev.target as HTMLElement;
            if (t.closest('[data-ex="ws-menu"]')) return;
            // 进详情页
            sandboxWsId = id;
            currentWsName = name;
            showPage(pageDetail);
            if (detailTitle) detailTitle.textContent = name;
            if (infoName) infoName.textContent = name;
            if (infoId) infoId.textContent = id;
            if (infoShell) infoShell.textContent = state || '未知';
            if (rootfsState) {
              rootfsState.textContent = state || '未安装';
              rootfsState.classList.toggle('installed', state === '已装 rootfs');
            }
            if (tabBasic) tabBasic.hidden = false;
            if (tabFiles) tabFiles.hidden = true;
            const tb = container.querySelector('[data-ex="sb-tab-basic-btn"]');
            const tf = container.querySelector('[data-ex="sb-tab-files-btn"]');
            tb?.classList.add('active');
            tf?.classList.remove('active');
            if (segFiles) segFiles.classList.add('active');
            if (segRootfs) segRootfs.classList.remove('active');
            currentFs = 'files';
            currentFsPath = '/workspace';
            void loadDetailFiles(id, 'files', '/workspace');
            if (sandboxFileviewEl) sandboxFileviewEl.innerHTML = '<div style="font-size:11px;color:var(--ex-text3);padding:8px">点击文件查看/编辑内容</div>';
          });
          const menuBtn = item.querySelector('[data-ex="ws-menu"]') as HTMLButtonElement | null;
          menuBtn?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const pop = document.createElement('div');
            pop.className = 'ex-sb-ws-menu-pop';
            pop.innerHTML = '<button type="button" data-ex="ws-rename">✎ 重命名</button><button type="button" class="danger" data-ex="ws-delete">✕ 删除</button>';
            const rect = menuBtn.getBoundingClientRect();
            pop.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 90)}px`;
            pop.style.left = `${Math.max(8, Math.min(rect.left - 100, window.innerWidth - 140))}px`;
            document.body.appendChild(pop);
            const close = (): void => pop.remove();
            window.setTimeout(() => { document.addEventListener('click', close, { once: true }); }, 0);
            pop.querySelector('[data-ex="ws-rename"]')?.addEventListener('click', () => {
              close();
              openNameDialog('rename', id, name, rows);
            });
            pop.querySelector('[data-ex="ws-delete"]')?.addEventListener('click', () => {
              close();
              sbDelTargetId = id;
              if (delDialog) delDialog.hidden = false;
            });
          });
          wsListEl.appendChild(item);
        }
      } catch {
        wsListEl.innerHTML = '<div style="font-size:12px;color:var(--ex-text3);padding:12px;text-align:center;">工作区列表读取失败</div>';
      }
    }
    // FAB 创建工作区（单次绑定，经 openNameDialog 设状态）
    const fabAdd = manage.querySelector('[data-ex="sb-add"]') as HTMLButtonElement | null;
    fabAdd?.addEventListener('click', () => {
      openNameDialog('create', '', '', []);
    });
    // —— 详情页导航 ——
    manage.querySelector('[data-ex="sb-detail-back"]')?.addEventListener('click', () => { showPage(pageList); void loadWorkspaceList(); });
    manage.querySelector('[data-ex="sb-refresh"]')?.addEventListener('click', () => { if (sandboxWsId) void loadDetailFiles(sandboxWsId, currentFs, currentFsPath); });
    // v0.0.87 导入（对齐 RikkaHub Import：文件选择器 → 写入当前工作区当前目录，支持多选文本文件）
    const importBtn = manage.querySelector('[data-ex="sb-import"]') as HTMLButtonElement | null;
    const importFile = manage.querySelector('[data-ex="sb-import-file"]') as HTMLInputElement | null;
    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', async () => {
      const files = importFile.files ? Array.from(importFile.files) : [];
      if (!sandboxWsId || files.length === 0) return;
      let ok = 0;
      let fail = 0;
      for (const f of files) {
        try {
          const content = await f.text();
          const path = `${currentFsPath === '/' ? '' : currentFsPath}/${f.name}`;
          const parts = await ctx.tools.execute('workspace_write_file', { workspaceId: sandboxWsId, path, content });
          const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
          if (text.includes('未加载') || text.includes('模拟')) { fail++; continue; }
          ok++;
        } catch { fail++; }
      }
      importFile.value = '';
      showToast(ok > 0 ? `已导入 ${ok} 个文件${fail > 0 ? `，${fail} 个失败` : ''}` : '导入失败');
      if (ok > 0 && sandboxWsId) void loadDetailFiles(sandboxWsId, currentFs, currentFsPath);
    });
    manage.querySelector('[data-ex="sb-terminal"]')?.addEventListener('click', () => {
      showPage(pageTerm);
      if (termTitle) termTitle.textContent = `${currentWsName || '工作区'} · 终端`;
      if (sandboxShellOut && sandboxShellOut.textContent.includes('输入命令开始')) sandboxShellOut.textContent = '';
    });
    manage.querySelector('[data-ex="sb-tab-basic-btn"]')?.addEventListener('click', () => {
      if (tabBasic) tabBasic.hidden = false;
      if (tabFiles) tabFiles.hidden = true;
      manage.querySelector('[data-ex="sb-tab-basic-btn"]')?.classList.add('active');
      manage.querySelector('[data-ex="sb-tab-files-btn"]')?.classList.remove('active');
    });
    manage.querySelector('[data-ex="sb-tab-files-btn"]')?.addEventListener('click', () => {
      if (tabFiles) tabFiles.hidden = false;
      if (tabBasic) tabBasic.hidden = true;
      manage.querySelector('[data-ex="sb-tab-files-btn"]')?.classList.add('active');
      manage.querySelector('[data-ex="sb-tab-basic-btn"]')?.classList.remove('active');
      if (sandboxWsId) void loadDetailFiles(sandboxWsId, currentFs, currentFsPath);
    });
    segFiles?.addEventListener('click', () => { if (sandboxWsId) void loadDetailFiles(sandboxWsId, 'files', '/workspace'); });
    segRootfs?.addEventListener('click', () => { if (sandboxWsId) void loadDetailFiles(sandboxWsId, 'rootfs', '/'); });
    pathUp?.addEventListener('click', () => {
      if (!sandboxWsId) return;
      const p = currentFsPath;
      const parentPath = p === '/' || p === '/workspace' ? p : (p.replace(/\/[^/]*$/, '') || '/');
      void loadDetailFiles(sandboxWsId, currentFs, parentPath);
    });
    // rootfs 安装（对齐 RikkaHub rootfs 安装三态）
    rootfsInstall?.addEventListener('click', async () => {
      if (!sandboxWsId || !rootfsProgress || !rootfsState) return;
      rootfsProgress.hidden = false;
      rootfsProgress.textContent = '安装中...';
      rootfsInstall.disabled = true;
      try {
        const parts = await ctx.tools.execute('workspace_install_rootfs', { workspaceId: sandboxWsId });
        const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
        if (text.includes('未加载') || text.includes('模拟')) {
          rootfsProgress.textContent = '安装失败：原生插件不可用';
          rootfsInstall.disabled = false;
          return;
        }
        rootfsProgress.textContent = '安装完成';
        rootfsState.textContent = '已装 rootfs';
        rootfsState.classList.add('installed');
        rootfsState.classList.remove('missing');
        if (rootfsInstall) rootfsInstall.textContent = '重新安装';
      } catch {
        rootfsProgress.textContent = '安装失败';
      } finally {
        rootfsInstall.disabled = false;
      }
    });
    // 工具审批开关（对齐 RikkaHub Tool Approval：读/写/shell）
    const apprRead = manage.querySelector('[data-ex="sb-appr-read"]') as HTMLInputElement | null;
    const apprWrite = manage.querySelector('[data-ex="sb-appr-write"]') as HTMLInputElement | null;
    const apprShell = manage.querySelector('[data-ex="sb-appr-shell"]') as HTMLInputElement | null;
    const apprEdit = manage.querySelector('[data-ex="sb-appr-edit"]') as HTMLInputElement | null;
    // v0.0.87 修正：审批开关接 config.agent.needsApproval（执行链 chat-controller buildAgentToolExecutor 真实消费，
    // AI 调用对应工具前弹 confirm 审批；此前写 approvals 死键无人读，是占位）
    const agentCfg = (ctx.config.get('agent') ?? {}) as { needsApproval?: Record<string, boolean> };
    const sbNeeds = agentCfg.needsApproval ?? {};
    const sbDefNeed: Record<string, boolean> = { workspace_write_file: true, workspace_shell: true };
    if (apprRead) apprRead.checked = sbNeeds.workspace_read_file ?? false;
    if (apprWrite) apprWrite.checked = sbNeeds.workspace_write_file ?? sbDefNeed.workspace_write_file;
    if (apprShell) apprShell.checked = sbNeeds.workspace_shell ?? sbDefNeed.workspace_shell;
    if (apprEdit) apprEdit.checked = sbNeeds.workspace_edit_file ?? false;
    const apprVal = (key: string, v: boolean): void => {
      const agent = (ctx.config.get('agent') ?? {}) as Record<string, unknown>;
      const needsApproval = { ...((agent.needsApproval as Record<string, boolean> | undefined) ?? {}) };
      if (v) needsApproval[key] = true;
      else delete needsApproval[key];
      ctx.config.set('agent', { ...agent, needsApproval });
    };
    apprRead?.addEventListener('change', () => apprVal('workspace_read_file', apprRead.checked));
    apprWrite?.addEventListener('change', () => apprVal('workspace_write_file', apprWrite.checked));
    apprShell?.addEventListener('change', () => apprVal('workspace_shell', apprShell.checked));
    apprEdit?.addEventListener('change', () => apprVal('workspace_edit_file', apprEdit.checked));
    // —— 终端页 ——
    manage.querySelector('[data-ex="sb-term-back"]')?.addEventListener('click', () => { showPage(pageDetail); });
    sandboxShellRun?.addEventListener('click', async () => {
      const cmd = sandboxShellInput?.value.trim();
      if (!cmd || !sandboxShellOut) return;
      if (!sandboxWsId) { sandboxShellOut.textContent += '\n请先选择工作区'; return; }
      if (sandboxShellOut.textContent.includes('输入命令开始')) sandboxShellOut.textContent = '';
      sandboxShellOut.textContent += `\n$ ${cmd}`;
      try {
        const parts = await ctx.tools.execute('workspace_shell', { workspaceId: sandboxWsId, command: cmd });
        const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
        sandboxShellOut.textContent += `\n${text}`;
        if (sandboxShellInput) sandboxShellInput.value = '';
        sandboxShellOut.scrollTop = sandboxShellOut.scrollHeight;
      } catch (e) {
        sandboxShellOut.textContent += `\n执行失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
    sandboxShellInput?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') sandboxShellRun?.click();
    });
    // 按键栏（ESC/TAB/CTRL/ALT/方向键）
    const keyMap: Record<string, string> = { esc: '\u001b', tab: '\t', ctrl: '\u0003', alt: '\u001b' };
    manage.querySelectorAll('[data-ex^="sb-key-"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = (btn as HTMLElement).getAttribute('data-ex')!.replace('sb-key-', '');
        const inp = sandboxShellInput;
        if (!inp) return;
        if (key === 'left' || key === 'right') {
          const pos = (inp.selectionStart ?? 0) + (key === 'left' ? -1 : 1);
          inp.focus();
          inp.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
          return;
        }
        if (key === 'up' || key === 'down') { inp.focus(); return; }
        const kv = keyMap[key];
        if (kv !== undefined) {
          const pos = inp.selectionStart ?? inp.value.length;
          inp.value = inp.value.slice(0, pos) + kv + inp.value.slice(pos);
          inp.setSelectionRange(pos + kv.length, pos + kv.length);
          inp.focus();
        }
      });
    });
  }

  /** 递归加载沙箱目录（解析 workspace_list_files 返回，目录可展开） */
  async function loadSandboxDir(wsId: string, path: string, parent: HTMLElement, depth: number): Promise<void> {
    parent.innerHTML = '<div>加载中...</div>';
    try {
      const parts = await ctx.tools.execute('workspace_list_files', { workspaceId: wsId, path });
      const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
      const items = parseSandboxList(text);
      if (items.length === 0) { parent.innerHTML = '<div>（空目录）</div>'; return; }
      parent.innerHTML = '';
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'ex-sandbox-tree-item';
        row.style.paddingLeft = `${depth * 16 + 8}px`;
        const icon = it.type === 'dir' ? '▸' : '·';
        row.innerHTML = `<span class="ex-sandbox-tree-icon">${icon}</span> <span class="ex-sandbox-tree-name">${esc(it.name)}</span>${it.type === 'file' ? ` <span class="ex-sandbox-tree-size">${esc(it.size)}</span>` : ''}`;
        if (it.type === 'dir') {
          row.classList.add('dir');
          row.addEventListener('click', async () => {
            const opened = row.classList.toggle('open');
            const iconEl = row.querySelector('.ex-sandbox-tree-icon') as HTMLElement;
            if (opened) {
              iconEl.textContent = '▾';
              const child = document.createElement('div');
              child.className = 'ex-sandbox-tree-children';
              row.appendChild(child);
              await loadSandboxDir(wsId, `${path === '/' ? '' : path}/${it.name}`, child, depth + 1);
            } else {
              iconEl.textContent = '▸';
              row.querySelector('.ex-sandbox-tree-children')?.remove();
            }
          });
        } else {
          // v0.0.86：文件行点击 → 查看/编辑内容（对齐 RikkaHub workspace_read_file / write_file）
          row.classList.add('file');
          row.style.cursor = 'pointer';
          row.addEventListener('click', () => {
            const p = `${path === '/' ? '' : path}/${it.name}`;
            void loadSandboxFile(sandboxWsId || wsId, p);
          });
        }
        parent.appendChild(row);
      }
    } catch {
      parent.innerHTML = '<div>读取失败</div>';
    }
  }

  /** 加载文件内容到查看/编辑面板（v0.0.86 对齐 RikkaHub workspace_read_file，保存走 write_file */
  async function loadSandboxFile(wsId: string, path: string, readOnly = false, mode: 'text' | 'download' | 'share' = 'text'): Promise<void> {
    if (!sandboxFileviewEl) return;
    // 下载/分享模式：直接读内容后操作，不打开编辑器
    if (mode === 'download' || mode === 'share') {
      sandboxFileviewEl.innerHTML = `<div class="ex-sandbox-fileview-path">${esc(path)} 加载中...</div>`;
      try {
        const parts = await ctx.tools.execute('workspace_read_file', { workspaceId: wsId, path });
        const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
        const name = path.split('/').pop() || 'file';
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        if (mode === 'download') {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = name; a.click();
          URL.revokeObjectURL(url);
        } else {
          if (navigator.share) await navigator.share({ title: name, text: text.slice(0, 5000) }).catch(() => {});
          else await navigator.clipboard.writeText(text).catch(() => {});
        }
      } catch { /* 静默 */ }
      sandboxFileviewEl.innerHTML = `<div class="ex-sandbox-fileview-path">${esc(path)}</div>`;
      return;
    }
    // 文本编辑器模式
    sandboxFileviewEl.innerHTML = `<div class="ex-sandbox-fileview-path">${esc(path)} 加载中...</div>`;
    try {
      const parts = await ctx.tools.execute('workspace_read_file', { workspaceId: wsId, path });
      const text = (parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n');
      sandboxFileviewEl.innerHTML = `
        <div class="ex-sandbox-fileview-path">${esc(path)}</div>
        <textarea data-ex="sandbox-fileview-text" spellcheck="false"${readOnly ? ' readonly' : ''}>${esc(text)}</textarea>
        <div class="ex-sandbox-fileview-actions">
          ${readOnly ? '' : '<button type="button" class="ex-manage-btn" data-ex="sandbox-fileview-save">保存</button>'}
          <button type="button" class="ex-manage-btn" data-ex="sandbox-fileview-export">导出</button>
          <span data-ex="sandbox-fileview-status"></span>
        </div>`;
      const saveBtn = sandboxFileviewEl.querySelector('[data-ex="sandbox-fileview-save"]') as HTMLButtonElement | null;
      const exportBtn = sandboxFileviewEl.querySelector('[data-ex="sandbox-fileview-export"]') as HTMLButtonElement | null;
      const status = sandboxFileviewEl.querySelector('[data-ex="sandbox-fileview-status"]') as HTMLElement | null;
      const ta = sandboxFileviewEl.querySelector('[data-ex="sandbox-fileview-text"]') as HTMLTextAreaElement | null;
      // dirty 追踪（返回确认）
      sbDirty = false;
      ta?.addEventListener('input', () => { sbDirty = true; });
      exportBtn?.addEventListener('click', () => {
        const name = path.split('/').pop() || 'file';
        const blob = new Blob([ta?.value ?? text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
      });
      saveBtn?.addEventListener('click', async () => {
        if (!ta || !status) return;
        status.textContent = '保存中...';
        try {
          await ctx.tools.execute('workspace_write_file', { workspaceId: wsId, path, content: ta.value });
          status.textContent = '已保存';
          sbDirty = false;
        } catch {
          status.textContent = '保存失败';
        }
      });
    } catch {
      sandboxFileviewEl.innerHTML = `<div class="ex-sandbox-fileview-path">${esc(path)} 读取失败</div>`;
    }
  }

  /** 解析沙箱文件列表文本 → [{name,type,size}]（[目录]/[文件] 前缀） */
  function parseSandboxList(text: string): { name: string; type: 'dir' | 'file'; size: string }[] {    const out: { name: string; type: 'dir' | 'file'; size: string }[] = [];
    for (const raw of text.split('\n')) {
      const l = raw.trim();
      if (!l) continue;
      if (l.startsWith('[目录]')) out.push({ name: l.slice(3).trim().split(/\s+/)[0], type: 'dir', size: '' });
      else if (l.startsWith('[文件]')) {
        const rest = l.slice(3).trim();
        const sp = rest.lastIndexOf(' ');
        const size = sp >= 0 ? rest.slice(sp + 1) : '';
        const name = sp >= 0 ? rest.slice(0, sp) : rest;
        out.push({ name, type: 'file', size });
      }
    }
    return out;
  }

  /** 渲染能力设置页的工具管理列表（列出 ctx.tools 全部工具；开关写入 config.agent.enabledTools，无记录=默认开） */
  function renderCapabilityTools(): void {
    const listEl = container.querySelector('[data-ex="capability-tools"]') as HTMLElement | null;
    if (!listEl) return;
    const tools = ctx.tools.list();
    if (tools.length === 0) {
      listEl.innerHTML = `<div style="font-size:12px;color:var(--ex-text3);padding:16px;text-align:center;">（暂无已注册工具）</div>`;
      return;
    }
    const agent = (ctx.config.get('agent') ?? {}) as Record<string, unknown>;
    const enabledTools = (agent.enabledTools as Record<string, boolean> | undefined) ?? {};
    // v0.0.85：RikkaHub 布局——功能分组 + 卡片（工具名 + 并排「需审批」「启用」开关 + 展开详情/参数芯片）
    const groups: { title: string; items: typeof tools }[] = [
      { title: '沙箱', items: [] },
      { title: '技能', items: [] },
      { title: '系统', items: [] },
    ];
    for (const t of tools) {
      if (t.name.startsWith('workspace_')) groups[0].items.push(t);
      else if (t.name === 'sandbox_skill') groups[1].items.push(t);
      else groups[2].items.push(t);
    }
    const paramChips = (t: (typeof tools)[number]): string => {
      const props = t.parameters?.properties ?? {};
      const keys = Object.keys(props);
      if (keys.length === 0) return '';
      return `<div class="ex-tool-params">${keys.map((k) => `<span class="ex-tool-chip">${esc(k)}</span>`).join('')}</div>`;
    };
    listEl.innerHTML = groups
      .filter((g) => g.items.length > 0)
      .map(
        (g) => `<div class="ex-tool-group">
        <div class="ex-tool-group-title">${esc(g.title)}</div>
        <div class="ex-tool-grid">${g.items
          .map((t) => {
            const on = enabledTools[t.name] !== false;
            return `<div class="ex-tool-mgmt-card">
            <span class="ex-tool-name">${esc(t.name)}</span>
            <div class="ex-tool-switch-row">
              <label class="ex-tool-switch" title="${on ? '停用' : '启用'}"><input type="checkbox" data-ex-tool-toggle="${esc(t.name)}" ${on ? 'checked' : ''} /><span class="ex-tool-switch-track"></span></label>
            </div>
            <details class="ex-tool-more">
              <summary>详情</summary>
              <div class="ex-tool-desc">${esc(t.description ?? '')}</div>
              ${paramChips(t)}
            </details>
          </div>`;
          })
          .join('')}</div>
      </div>`,
      )
      .join('');
    // 启用开关（v0.0.87：工具管理列表不再显示审批按钮，审批只保留沙箱管理页的读/写/Shell 三项）
    listEl.querySelectorAll<HTMLInputElement>('[data-ex-tool-toggle]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const name = chk.dataset.exToolToggle;
        if (!name) return;
        const agent = (ctx.config.get('agent') ?? {}) as Record<string, unknown>;
        const enabledTools = { ...((agent.enabledTools as Record<string, boolean> | undefined) ?? {}) };
        if (chk.checked) delete enabledTools[name];
        else enabledTools[name] = false;
        ctx.config.set('agent', { ...agent, enabledTools });
        showToast(chk.checked ? `已启用工具 ${name}` : `已停用工具 ${name}`);
      });
    });
  }

  // ---- 轻量 Markdown（安全：全部先 esc 再套白名单标签，无外部依赖） ----
  function renderInline(s: string): string {
    let out = esc(s);
    // 顺序关键：code 先提取为占位符，避免 `<code>` 内部被后续粗体/斜体规则二次解析（P5）；
    // 链接仅允许 http(s)://
    const codeBlocks: string[] = [];
    out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => {
      codeBlocks.push(`<code>${code}</code>`);
      return `\u0000${codeBlocks.length - 1}\u0000`;
    });
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // 还原 code 占位符
    out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codeBlocks[Number(i)] ?? '');
    return out;
  }

  function renderMarkdown(text: string): string {
    const lines = text.split('\n');
    let html = '';
    let inCode = false;
    let inList = false;
    let para: string[] = [];
    const flushPara = () => {
      if (para.length) {
        html += '<p>' + para.map(renderInline).join('<br>') + '</p>';
        para = [];
      }
    };
    const flushList = () => {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
    };
    const flushCode = () => {
      if (inCode) {
        html += '</code></pre>';
        inCode = false;
      }
    };
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line.trim() === '') {
        flushPara();
        flushList();
        continue;
      }
      const fence = line.match(/^```(\w*)/);
      if (fence) {
        if (inCode) {
          flushCode();
        } else {
          flushPara();
          flushList();
          inCode = true;
          html += `<pre${fence[1] ? ` data-lang="${esc(fence[1])}"` : ''}><code>`;
        }
        continue;
      }
      if (inCode) {
        html += esc(line) + '\n';
        continue;
      }
      const head = line.match(/^(#{1,6})\s+(.*)$/);
      if (head) {
        flushPara();
        flushList();
        const lv = head[1].length;
        html += `<h${lv}>${renderInline(head[2])}</h${lv}>`;
        continue;
      }
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${renderInline(ul[1])}</li>`;
        continue;
      }
      const bq = line.match(/^\s*>\s?(.*)$/);
      if (bq) {
        flushPara();
        flushList();
        html += `<blockquote>${renderInline(bq[1])}</blockquote>`;
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara();
    flushList();
    flushCode();
    return html;
  }

  // ---- 复制到剪贴板（带降级） ----
  function copyToClipboard(text: string): void {
    const done = () => {
      logger.info('gui', '已复制消息内容');
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* 复制失败静默 */
    }
    ta.remove();
  }

  // ---- 视差背景（APITOOL initSVGParallax 简化版：Exdark 色相 160-190 的漂浮几何） ----
  function initParallax(svg: SVGSVGElement, options: { layerLevel?: number; fpsLimit?: number } = {}): () => void {
    // v0.0.65：视差层数/帧率参数化（性能调节滑块驱动；默认 4 层/60fps 与旧行为一致）
    const layerLevel = options.layerLevel ?? 4;
    const fpsLimit = options.fpsLimit ?? 60;
    const NS = 'http://www.w3.org/2000/svg';
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const colors = [
      'hsla(170, 60%, 42%, 0.30)',
      'hsla(178, 55%, 36%, 0.24)',
      'hsla(162, 48%, 30%, 0.20)',
      'hsla(186, 52%, 46%, 0.22)',
      'hsla(165, 42%, 26%, 0.16)',
    ];
    const pick = () => colors[Math.floor(Math.random() * colors.length)];
    interface Blob {
      el: SVGElement;
      x: number;
      y: number;
      depth: number;
      speed: number;
      rot: number;
      rotSpeed: number;
    }
    const blobs: Blob[] = [];
    // 层数 → 元素数量：4 层=26（与旧默认一致），线性缩放
    const count = Math.max(4, Math.round((26 * layerLevel) / 4));
    for (let i = 0; i < count; i++) {
      let el: SVGElement;
      const type = i % 3;
      if (type === 0) {
        el = document.createElementNS(NS, 'rect');
        el.setAttribute('width', String(rand(10, 90)));
        el.setAttribute('height', String(rand(10, 160)));
        el.setAttribute('fill', pick());
      } else if (type === 1) {
        el = document.createElementNS(NS, 'rect');
        el.setAttribute('width', String(rand(12, 80)));
        el.setAttribute('height', String(rand(12, 120)));
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', pick());
        el.setAttribute('stroke-width', String(rand(0.6, 2.4)));
      } else {
        el = document.createElementNS(NS, 'line');
        const len = rand(20, 140);
        el.setAttribute('x1', String(-len / 2));
        el.setAttribute('y1', '0');
        el.setAttribute('x2', String(len / 2));
        el.setAttribute('y2', '0');
        el.setAttribute('stroke', pick());
        el.setAttribute('stroke-width', String(rand(0.6, 2.2)));
        el.setAttribute('stroke-linecap', 'round');
      }
      svg.appendChild(el);
      blobs.push({
        el,
        x: rand(0, window.innerWidth),
        y: rand(0, window.innerHeight),
        depth: rand(0.25, 1),
        speed: rand(0.2, 1),
        rot: rand(0, 360),
        rotSpeed: rand(-0.35, 0.35),
      });
    }
    let raf = 0;
    let t0 = performance.now();
    let lastDraw = 0;
    // 帧率节流：rAF 每帧跑，但按 minInterval 更新位置（APITOOL setFpsLimit 思路）
    const minInterval = 1000 / fpsLimit;
    const tick = (t: number): void => {
      const dt = Math.min((t - t0) / 1000, 0.05);
      t0 = t;
      if (t - lastDraw < minInterval) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastDraw = t;
      const W = window.innerWidth;
      const H = window.innerHeight;
      for (const b of blobs) {
        b.x += b.speed * 10 * dt * b.depth;
        b.y -= b.speed * 6 * dt * b.depth;
        if (b.x > W + 220) b.x = -220;
        if (b.y < -220) b.y = H + 220;
        b.rot += b.rotSpeed * dt * 30;
        b.el.setAttribute(
          'transform',
          `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.rot.toFixed(1)}) scale(${(0.5 + b.depth).toFixed(2)})`,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }

  // ---- 置顶状态（UI 本地偏好，不动会话数据层） ----
  const PIN_KEY = 'kirusraft.exdark.pinned';
  function loadPinned(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }
  function savePinned(pinned: Set<string>): void {
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify([...pinned]));
    } catch {
      /* 存储不可用静默 */
    }
  }

  // ---- 会话时间分组 ----
  function groupLabel(ts: number): string {
    const now = new Date();
    const d = new Date(ts);
    const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.floor((dayStart(now) - dayStart(d)) / 86400000);
    if (diff <= 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 7) return '7 天内';
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  // ---- 会话列表（搜索过滤 + 置顶排序 + 时间分组 + 空态引导） ----
  let searchQuery = '';
  // 对话管理模式（v0.0.65 修正：长按"管理"进入边栏就地批量管理）
  let manageMode = false;
  let manageSelected = new Set<string>();
  async function renderSessionList(activeId: string): Promise<void> {
    let sessions;
    try {
      sessions = await ctx.storage.listConversations();
    } catch (error) {
      logger.error('storage', `会话列表加载失败: ${String(error)}`);
      return;
    }
    // await 后 DOM 可能已重建（主题切换），失效则放弃
    if (!convList.isConnected) return;
    if (convCountEl) convCountEl.textContent = `已保存 ${sessions.length} 个会话`;
    convList.innerHTML = '';
    const pinned = loadPinned();
    const query = searchQuery.trim().toLowerCase();

    let filtered = sessions;
    if (query) filtered = sessions.filter((s) => (s.title || '').toLowerCase().includes(query));

    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '（暂无会话）';
      empty.style.cssText = 'padding:16px 10px;font-size:11px;color:var(--ex-text3);text-align:center;';
      convList.appendChild(empty);
      return;
    }
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '没有匹配的会话';
      empty.style.cssText = 'padding:16px 10px;font-size:11px;color:var(--ex-text3);text-align:center;';
      convList.appendChild(empty);
      return;
    }
    // 排序：置顶优先，其次按时间倒序
    const sorted = [...filtered].sort((a, b) => {
      const ap = pinned.has(a.id) ? 0 : 1;
      const bp = pinned.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return b.createdAt - a.createdAt;
    });

    let lastGroup = '';
    for (const s of sorted) {
      const isPinned = pinned.has(s.id);
      const group = query ? '' : isPinned ? '置顶' : groupLabel(s.createdAt);
      if (!query && group !== lastGroup) {
        const g = document.createElement('div');
        g.className = 'ex-conv-group';
        g.textContent = group;
        convList.appendChild(g);
        lastGroup = group;
      }
      const item = document.createElement('div');
      item.className = 'ex-conv-item' + (s.id === activeId ? ' active' : '') + (isPinned ? ' pinned' : '');
      item.dataset.exSwitch = s.id;
      const count = Array.isArray(s.nodes) ? s.nodes.length : 0;
      const time = new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric' });
      if (manageMode) {
        // 管理模式：左侧 checkbox + 标题/信息 + 右侧 × 单删；整卡不切换会话
        const checked = manageSelected.has(s.id);
        if (checked) item.classList.add('manage-selected');
        const body = document.createElement('div');
        body.style.cssText = 'min-width:0;flex:1;';
        body.innerHTML = `
          <div class="ex-conv-title">${esc(s.title || '新对话')}</div>
          <div class="ex-conv-info"><span>${count} 条</span><span>${esc(time)}</span></div>
        `;
        const check = document.createElement('label');
        check.className = 'ex-conv-check';
        check.title = '选择';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.dataset.exManageCheck = s.id;
        check.appendChild(cb);
        const del = document.createElement('button');
        del.className = 'ex-conv-del';
        del.textContent = '×';
        del.title = '删除该会话';
        del.dataset.exManageDel = s.id;
        item.append(check, body, del);
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
      } else {
        // 平铺：无 hover 按钮（▲/× 已删），长按弹二级菜单（置顶/分享/管理/删除/重新生成标题）
        item.innerHTML = `
          <div class="ex-conv-title">${esc(s.title || '新对话')}</div>
          <div class="ex-conv-info"><span>${count} 条</span><span>${esc(time)}</span></div>
        `;
      }
      convList.appendChild(item);
    }
  }

  /** 管理模式退出（幂等）：其他操作（发送/切会话等）触发，管理是临时态 */
  function exitManageIfActive(): void {
    if (!manageMode) return;
    manageMode = false;
    manageSelected.clear();
    updateManageBar();
    void renderSessionList(controller.getSessionId());
  }

  /** 更新管理模式工具条（选中计数 + 全选按钮状态） */
  function updateManageBar(): void {
    const bar = container.querySelector('[data-ex="manage-bar"]') as HTMLElement | null;
    const countEl = container.querySelector('[data-ex="manage-count"]') as HTMLElement | null;
    const selectAllBtn = container.querySelector('[data-ex="manage-select-all"]') as HTMLElement | null;
    if (!bar) return;
    bar.style.display = manageMode ? 'flex' : 'none';
    if (!manageMode) return;
    if (countEl) countEl.textContent = manageSelected.size > 0 ? `已选 ${manageSelected.size}` : '';
    if (selectAllBtn) {
      // 全选态判断：列表里可见会话是否全被选中（简化：按钮文本随状态切换）
      const total = convList.querySelectorAll('[data-ex-switch]').length;
      const allChecked = total > 0 && manageSelected.size >= total;
      selectAllBtn.textContent = allChecked ? '取消全选' : '全选';
    }
  }

  function updateModelStatus(): void {
    const profile = ctx.config.get('profile') as { model?: string };
    const name = String(profile.model ?? 'deepseek-chat');
    container.querySelectorAll<HTMLElement>('[data-ex="model-name"]').forEach((el) => (el.textContent = name));
  }

  // 顶栏标题跟随当前会话
  async function updateTopbarTitle(id: string): Promise<void> {
    const s = await ctx.storage.getConversation(id);
    if (!titleEl.isConnected) return;
    titleEl.textContent = (s?.title || '新对话').trim();
  }

  // 输入区：自动增高（1-4 行）、发送禁用态、字符计数
  function autoResize(): void {
    inputEl.style.height = 'auto';
    const lineH = parseFloat(window.getComputedStyle(inputEl).lineHeight) || 20;
    const maxH = Math.round(lineH * 5 + 20);
    inputEl.style.height = Math.min(inputEl.scrollHeight, maxH) + 'px';
  }
  // v0.0.73：发送按钮三态（idle=发送 / streaming=中止 / stopped=继续或发送）
  function syncSendState(): void {
    const state = sendEl.dataset.state ?? 'idle';
    if (state === 'streaming') {
      sendEl.textContent = '中止';
      sendEl.disabled = false;
      return;
    }
    const hasInput = !!inputEl.value.trim() || pendingImages.length > 0;
    if (state === 'stopped' && !hasInput) {
      sendEl.textContent = '继续';
      sendEl.classList.add('ex-stop-btn');
      sendEl.disabled = false;
      return;
    }
    sendEl.textContent = '发送';
    sendEl.classList.remove('ex-stop-btn');
    sendEl.disabled = !hasInput;
  }
  function updateSendState(): void {
    syncSendState();
  }
  function updateCharCount(): void {
    const n = inputEl.value.length;
    charCountEl.style.display = n ? 'block' : 'none';
    charCountEl.textContent = String(n);
  }
  const resetInputUI = () => {
    if (inputEl.value) autoResize();
    else inputEl.style.height = '';
    updateSendState();
    updateCharCount();
  };

  // ---- 聊天状态机（共享控制器） ----
  let lastAiBubble: HTMLElement | null = null;
  /** 用户主动上滚标志（v0.0.76）：流式自动滚动尊重用户——上滚看历史就停止跟随，滚回底部恢复 */
  let userScrolledUp = false;
  // 待发送图片（多模态 v0.0.64）：选择后暂存，随下一条消息发送；发送真正放行（onSendAccepted）后清空
  let pendingImages: UIMessagePart[] = [];
  /** 图片压缩处理中计数：>0 时拒绝发送（防止压缩未完成时漏发到下一轮） */
  let processingImages = 0;
  // 文件指示器（上传段复用；提前声明供 onSendAccepted 清空）
  const fileIndicator = container.querySelector('[data-ex="file-indicator"]') as HTMLElement;
  const controller = createChatController(ctx, {
    messages: messagesEl,
    input: inputEl,
    send: sendEl,
    // v0.0.75：继续生成原位续写——返回最后 AI 气泡 DOM（不新建）
    getLastAiBubble: () => lastAiBubble,
    onStreamState: (state) => {
      // v0.0.73：发送/中止/继续同一按钮三态
      sendEl.dataset.state = state;
      if (state === 'streaming') {
        sendEl.textContent = '中止';
        sendEl.classList.add('ex-stop-btn');
        sendEl.disabled = false;
      } else if (state === 'stopped') {
        // 中止后：输入框空=继续，有文本=发送（形态由 updateSendState 决定）
        syncSendState();
      } else {
        sendEl.textContent = '发送';
        sendEl.classList.remove('ex-stop-btn');
        syncSendState();
      }
    },
    status: statusEl,
    webSearch: webSearchEl,
    // 对话超 100k 字符：右上角确认 toast（带"确定发送"按钮），点确定后放行
    onLengthWarn: (count, confirm) => {
      confirmOversize(count, confirm);
    },
    renderMessage: (role: 'user' | 'ai', parts: UIMessagePart[], message?: Message): HTMLElement => {
      // wrapper：时间在气泡外上方，气泡含内容 + 底部操作条（左下分支 ←→ n/m，右下工具）
      const wrap = document.createElement('div');
      wrap.className = `ex-msg-wrap ex-${role}`;
      // 时间戳（气泡外上方，弱化；去掉了"AI/你"角色标签；AI 已修改的标"已修改"）
      const timeLabel = document.createElement('div');
      timeLabel.className = 'ex-msg-time';
      const timeText = new Date(message?.createdAt ?? Date.now()).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      const editedMark = role === 'ai' && message?.editedByUser ? ' · 已修改' : '';
      // v0.0.85：称呼在气泡上方时间旁——AI 称呼在时间左边、user（你）称呼在时间右边（居中布局下区分角色）
      timeLabel.textContent = role === 'ai'
        ? `AI · ${timeText}${editedMark}`
        : `${timeText} · 你${editedMark}`;
      wrap.appendChild(timeLabel);

      const bubble = document.createElement('div');
      bubble.className = `ex-message ex-${role}`;
      // AI 思考过程（v0.0.84，主线 B）：折叠卡（summary + 内容），对齐 RikkaHub 思考折叠卡。
      // 流式空气泡默认展开（实时看思考）；已结束默认收起，点击展开。
      if (role === 'ai') {
        const hasReasoning = (message?.reasoning ?? '').length > 0;
        if (hasReasoning || !message) {
          const reasonEl = document.createElement('details');
          reasonEl.className = 'ex-msg-reasoning';
          if (!hasReasoning) {
            reasonEl.style.display = 'none'; // 流式空气泡：等首个思考增量再显示
            reasonEl.setAttribute('open', ''); // 展开，首增量后实时显示思考
          }
          const summary = document.createElement('summary');
          summary.className = 'ex-msg-reasoning-label';
          summary.textContent = '思考过程';
          reasonEl.appendChild(summary);
          const bodyEl = document.createElement('div');
          bodyEl.setAttribute('data-msg-reasoning', '');
          bodyEl.textContent = message?.reasoning ?? '';
          reasonEl.appendChild(bodyEl);
          bubble.appendChild(reasonEl);
        }
      }
      // 多模态渲染（v0.0.85 对齐 RikkaHub groupMessageParts）：连续 tool 聚成思考块（details 折叠），
      // 其余每个 part 独立内容块，按数组顺序渲染（文本→Markdown，图片→img，工具→步骤行）
      const toolStepHtml = (p: Extract<UIMessagePart, { type: 'tool' }>, index: number): string => {
        const done = p.done;
        const args = p.args ?? '';
        const result = p.result ?? '';
        return `<div class="ex-tool-step" data-tool-part="${index}">
          <div class="ex-tool-step-head">
            <span class="ex-tool-step-icon ${done ? 'ok' : 'run'}">${done ? '✓' : '◦'}</span>
            <span class="ex-tool-step-name">${esc(p.name)}</span>
          </div>
          ${args && args !== '{}' ? `<pre class="ex-tool-args">${esc(args)}</pre>` : ''}
          ${done ? `<pre class="ex-tool-out">${esc(result || '(无输出)')}</pre>` : '<div class="ex-tool-loading">执行中...</div>'}
        </div>`;
      };
      const blocks: string[] = [];
      let currentTools: { part: Extract<UIMessagePart, { type: 'tool' }>; index: number }[] = [];
      const flushTools = (): void => {
        if (currentTools.length === 0) return;
        blocks.push(`<details class="ex-think-block" open>
          <summary class="ex-think-label">工具调用 ×${currentTools.length}</summary>
          ${currentTools.map(({ part, index }) => toolStepHtml(part, index)).join('')}
        </details>`);
        currentTools = [];
      };
      parts.forEach((p, index) => {
        if (p.type === 'tool') {
          currentTools.push({ part: p, index });
          return;
        }
        flushTools();
        if (p.type === 'text') blocks.push(p.text ? renderMarkdown(p.text) : '');
        else if (p.type === 'image') blocks.push(`<img class="ex-msg-img" src="${esc(p.imageUrl)}" alt="${esc(p.alt ?? '图片')}" />`);
      });
      flushTools();
      const html = blocks.join('');

      // 内容区（v0.0.72）：流式文本写 [data-msg-text] 容器；工具标注插在文本段之间（成熟 agent 交错布局）
      // v0.0.73 修复：只有「AI 且无 message」才是流式空气泡（空文本容器）；用户消息/历史消息直接渲染 html
      const content = document.createElement('div');
      content.className = 'ex-msg-content';
      content.setAttribute('data-msg-content', '');
      const textContainer = document.createElement('div');
      textContainer.setAttribute('data-msg-text', '');
      if (role === 'ai' && !message) {
        textContainer.textContent = '';
        content.appendChild(textContainer);
      } else {
        content.innerHTML = html;
      }
      bubble.appendChild(content);

      // 用量脚注（v0.0.84 主线 B）：AI 历史消息有 usage 时渲染（当前流式在 onStreamEnd 补渲染）
      if (role === 'ai' && message && message.usage) {
        bubble.appendChild(renderUsageFooter(message));
      }

      // 底部操作条：左下角分支选择器（候选>1 时显示 ←→ n/m，RikkaHub ChatMessageBranch 式）+ 右下角工具（复制/编辑/重发）
      const actions = document.createElement('div');
      actions.className = 'ex-msg-actions';
      actions.setAttribute('data-msg-actions', '');
      // AI 流式空气泡（message 未 append，v0.0.66 判定）：AI 所有信息发完（onStreamEnd）前隐藏操作按钮，
      // 避免流式中点编辑/重发/切分支破坏渲染（APITOOL 打字动画结束才补按钮）
      if (role === 'ai' && !message) {
        actions.style.display = 'none';
      }

      // 分支选择器：查节点链快照，该消息候选数>1 才显示；v0.0.85 只在 user 气泡显示（AI 候选由 user 的 <> 联动切换，避免双入口冲突）
      const snap = message ? controller.getBranchSnapshot().find((n) => n.messageId === message.id) : undefined;
      if (snap && snap.candidateCount > 1 && role === 'user') {
        const branch = document.createElement('div');
        branch.className = 'ex-msg-branch';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'ex-msg-arrow';
        prevBtn.textContent = '<';
        prevBtn.title = '上一个候选';
        prevBtn.disabled = snap.selectIndex <= 0;
        prevBtn.addEventListener('click', () => {
          controller.selectCandidate(snap.nodeId, snap.selectIndex - 1);
        });
        const count = document.createElement('span');
        count.className = 'ex-msg-count';
        count.textContent = `${snap.selectIndex + 1}/${snap.candidateCount}`;
        const nextBtn = document.createElement('button');
        nextBtn.className = 'ex-msg-arrow';
        nextBtn.textContent = '>';
        nextBtn.title = '下一个候选';
        nextBtn.disabled = snap.selectIndex >= snap.candidateCount - 1;
        nextBtn.addEventListener('click', () => {
          controller.selectCandidate(snap.nodeId, snap.selectIndex + 1);
        });
        branch.append(prevBtn, count, nextBtn);
        actions.appendChild(branch);
      }

      // 右下角工具：复制 / 编辑（user=编辑重发，ai=就地编辑，APITOOL 原创语义）/ AI 重发
      const tools = document.createElement('div');
      tools.className = 'ex-msg-tools';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ex-msg-btn';
      copyBtn.textContent = '复制';
      copyBtn.title = '复制内容';
      copyBtn.addEventListener('click', () => {
        copyToClipboard(content.textContent || '');
        copyBtn.textContent = '已复制';
        copyBtn.classList.add('copied');
        window.setTimeout(() => {
          copyBtn.textContent = '复制';
          copyBtn.classList.remove('copied');
        }, 1200);
      });
      tools.appendChild(copyBtn);
      // 编辑按钮（APITOOL editMsg/editAiMsg 语义）：弹窗编辑后写回。
      // v0.0.75：AI 流式空气泡（无 message）也创建——点击时用最后 AI 消息 id（onStreamEnd 后按钮与复制一起显示）
      const editMsgId = message ? message.id : undefined;
      if (editMsgId || role === 'ai') {
        const editBtn = document.createElement('button');
        editBtn.className = 'ex-msg-btn';
        editBtn.textContent = '编辑';
        editBtn.title = role === 'user' ? '编辑此消息并重新生成回复' : '就地编辑此回复（不重发）';
        editBtn.addEventListener('click', () => {
          // 流式空气泡（无 message）：从分支快照找最后一条 AI 消息
          let targetId = editMsgId;
          if (!targetId) {
            const snap = controller.getBranchSnapshot();
            for (let i = snap.length - 1; i >= 0; i--) {
              if (snap[i].role === 'ai') {
                targetId = snap[i].messageId;
                break;
              }
            }
          }
          if (!targetId) return;
          const oldText = parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
          // v0.0.69：专用编辑弹窗（保留上一轮输入便于修改），不再用 window.prompt
          void showEditModal(oldText, role === 'user' ? '编辑消息' : '编辑回复').then((next) => {
            if (next === null || !next.trim()) return;
            if (role === 'user') controller.editUserMessage(targetId!, next);
            else controller.editAiMessage(targetId!, next);
          });
        });
        tools.appendChild(editBtn);
      }
      // v0.0.67：AI"重发"按钮移除——用户消息气泡的"编辑"就是重发（编辑后重新生成回复），不需要独立重发
      actions.appendChild(tools);

      bubble.appendChild(actions);
      wrap.appendChild(bubble);
      lastAiBubble = wrap;
      return wrap;
    },
    onRequireSettings: () => openSettings(),
    onSessionChange: (id) => {
      void renderSessionList(id);
      void updateTopbarTitle(id);
    },
    onStreamEnd: () => {
      if (lastAiBubble && lastAiBubble.isConnected) {
        // v0.0.72：逐段 Markdown 收尾——文本段各自 Markdown 化，tool 标注 details 原位保留（保持交错顺序）
        const c = lastAiBubble.querySelector('[data-msg-content]') as HTMLElement | null;
        if (c) {
          for (const child of Array.from(c.childNodes)) {
            // 工具标注/工具卡/思考块保留原样（v0.0.85：思考块内步骤已含参数/结果，不 Markdown 化）
            if (child instanceof HTMLElement && (child.classList.contains('ex-msg-tool') || child.classList.contains('ex-tool-card') || child.classList.contains('ex-think-block'))) continue;
            const text = child.textContent ?? '';
            if (!text.trim()) continue;
            if (child instanceof HTMLElement) {
              child.innerHTML = renderMarkdown(text);
            } else {
              const seg = document.createElement('div');
              seg.innerHTML = renderMarkdown(text);
              child.replaceWith(seg);
            }
          }
        }
        // v0.0.67：流式结束仍无思考内容 → 移除空推理区（不思考就不显示）
        const rEl = lastAiBubble.querySelector('[data-msg-reasoning]') as HTMLElement | null;
        if (rEl && !rEl.textContent?.trim()) {
          rEl.closest('.ex-msg-reasoning')?.remove();
        }
        // AI 所有信息发完：显示操作按钮（流式中隐藏，v0.0.66 判定）
        const actions = lastAiBubble.querySelector('[data-msg-actions]') as HTMLElement | null;
        if (actions) actions.style.display = '';
        // v0.0.84（主线 B）：流式结束，最后 AI 消息有 usage → 渲染用量脚注（防重复）
        const lastMsg = controller.getLastAiMessage();
        const bubbleEl = lastAiBubble.querySelector('.ex-message') as HTMLElement | null;
        if (lastMsg?.usage && bubbleEl && !bubbleEl.querySelector('.ex-msg-usage')) {
          bubbleEl.appendChild(renderUsageFooter(lastMsg));
        }
      }
    },
    // 流式自动滚动（v0.0.76 成熟 chat 做法）：用户主动上滚 = 停止自动跟随（记录标志）；
    // 用户滚回底部 = 恢复跟随。不再只按"距底距离"判断（那会拽用户）
    autoScroll: () => {
      if (userScrolledUp) return; // 用户正在看历史，不打扰
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
    // 发送校验通过、开始流式：清空待发送图片（校验失败时不清，附件保留可重发）
    onSendAccepted: () => {
      pendingImages = [];
      fileIndicator.textContent = '';
    },
    // 联网搜索状态（v0.0.69，APITOOL 同款右上角提示）
    onWebSearch: (state) => {
      showToast(state === 'searching' ? '联网搜索中...' : '搜索完成');
    },
    // 工作思维流（v0.0.70）：工具调用开始 → 最后 AI 气泡内插状态行"调用工具 X"
    onToolStart: (name, partIndex) => {
      // v0.0.85 对齐 RikkaHub：固化当前文本段，工具步骤加入思考块（details.ex-think-block，连续工具复用块），开新文本容器
      if (lastAiBubble && lastAiBubble.isConnected) {
        const content = lastAiBubble.querySelector('[data-msg-content]') as HTMLElement | null;
        if (content) {
          // 固化：把当前最后一个文本容器的内容转成普通文本节点（保留样式），移除容器
          const containers = content.querySelectorAll('[data-msg-text]');
          const lastText = containers.length > 0 ? (containers[containers.length - 1] as HTMLElement) : null;
          if (lastText && lastText.textContent) {
            const seg = document.createElement('div');
            seg.textContent = lastText.textContent;
            lastText.replaceWith(seg);
          } else if (lastText) {
            lastText.remove();
          }
          // 思考块：content 末尾是思考块（工具连续）则复用，否则新建
          const lastChild = content.lastElementChild;
          let block: HTMLElement | null = lastChild && lastChild.classList.contains('ex-think-block') ? (lastChild as HTMLElement) : null;
          if (!block) {
            block = document.createElement('details');
            block.className = 'ex-think-block';
            block.setAttribute('open', '');
            const summary = document.createElement('summary');
            summary.className = 'ex-think-label';
            summary.textContent = '工具调用';
            block.appendChild(summary);
            content.appendChild(block);
          }
          // 步骤行（loading 态；onToolCallDone 回填参数 + ✓，onToolDone 追加结果）
          const step = document.createElement('div');
          step.className = 'ex-tool-step';
          step.dataset.toolPart = String(partIndex);
          const head = document.createElement('div');
          head.className = 'ex-tool-step-head';
          const icon = document.createElement('span');
          icon.className = 'ex-tool-step-icon run';
          icon.textContent = '◦';
          head.appendChild(icon);
          const nm = document.createElement('span');
          nm.className = 'ex-tool-step-name';
          nm.textContent = name;
          head.appendChild(nm);
          step.appendChild(head);
          const loading = document.createElement('div');
          loading.className = 'ex-tool-loading';
          loading.textContent = '执行中...';
          step.appendChild(loading);
          block.appendChild(step);
          // 开新文本容器（后续流式增量进这里 → 思考块后）
          const next = document.createElement('div');
          next.setAttribute('data-msg-text', '');
          content.appendChild(next);
        }
      }
      if (statusEl) statusEl.textContent = `调用工具: ${name}...`;
    },
    // v0.0.85：工具调用完成——按 partIndex 精确更新步骤（✓ + 参数），不再按顺序匹配（对齐 RikkaHub toolCallId 定位）
    onToolCallDone: (call, partIndex) => {
      if (lastAiBubble && lastAiBubble.isConnected && partIndex != null) {
        const step = lastAiBubble.querySelector(`.ex-tool-step[data-tool-part="${partIndex}"]`) as HTMLElement | null;
        if (step) {
          const nm = step.querySelector('.ex-tool-step-name');
          if (nm) nm.textContent = call.name;
          const icon = step.querySelector('.ex-tool-step-icon');
          if (icon) { icon.className = 'ex-tool-step-icon ok'; icon.textContent = '✓'; }
          const loading = step.querySelector('.ex-tool-loading');
          if (loading) {
            const argsText = call.rawArguments ?? JSON.stringify(call.args ?? {});
            if (argsText && argsText !== '{}') {
              const args = document.createElement('pre');
              args.className = 'ex-tool-args';
              args.textContent = argsText;
              loading.replaceWith(args);
            } else {
              loading.remove(); // 空参数不显示参数行
            }
          }
        }
      }
    },
    // v0.0.85：工具执行完成——按 partIndex 把结果写进步骤（流式即终态，刷新前后一致，对齐 RikkaHub）
    onToolDone: ({ name, output }, partIndex) => {
      if (lastAiBubble && lastAiBubble.isConnected && partIndex != null) {
        const step = lastAiBubble.querySelector(`.ex-tool-step[data-tool-part="${partIndex}"]`) as HTMLElement | null;
        if (step) {
          let out = step.querySelector('pre.ex-tool-out') as HTMLElement | null;
          if (!out) {
            out = document.createElement('pre');
            out.className = 'ex-tool-out';
            step.appendChild(out);
          }
          out.textContent = output;
        }
      }
    },
  });

  logger.info('gui', 'Exdark 主题 GUI 已挂载');

  // ---- 生命周期 ----
  // 视差句柄（性能调节滑块重建用，v0.0.65）
  let currentStopParallax: (() => void) | null = null;
  ctx.effect(() => {
    const uiCfg = (ctx.config.get('ui') ?? {}) as Record<string, unknown>;
    const stopParallax = initParallax(parallaxSvg, {
      layerLevel: Number(uiCfg.parallaxLayers) > 0 ? Number(uiCfg.parallaxLayers) : 4,
      fpsLimit: Number(uiCfg.fps) > 0 ? Number(uiCfg.fps) : 60,
    });
    currentStopParallax = stopParallax;
    updateModelStatus();
    resetInputUI();

    // 发送 / 中止 / 继续 三态按钮（v0.0.73）：流式中点击=中止；中止后输入空=继续、有文=发送
    sendEl.addEventListener('click', () => {
      exitManageIfActive(); // 发送即退出管理模式（管理是临时态）
      const state = sendEl.dataset.state ?? 'idle';
      if (state === 'streaming') {
        controller.stop();
        return;
      }
      if (state === 'stopped' && !inputEl.value.trim() && !pendingImages.length) {
        controller.continueGeneration();
        return;
      }
      if (processingImages > 0) {
        showToast('图片处理中，请稍候...');
        return;
      }
      if (pendingImages.length > 0) {
        controller.sendWithAttachments(pendingImages);
      } else {
        controller.send();
      }
      window.setTimeout(resetInputUI, 0);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        controller.send();
        window.setTimeout(resetInputUI, 0);
      }
    });
    inputEl.addEventListener('input', resetInputUI);

    // 功能工具栏：联网搜索按钮切换（隐藏 checkbox 保持 chat-controller 契约）
    const syncWebSearchBtn = () => {
      webSearchBtn.classList.toggle('on', webSearchEl.checked);
      webSearchBtn.textContent = webSearchEl.checked ? '联网搜索: 开' : '联网搜索';
    };
    webSearchBtn.addEventListener('click', () => {
      webSearchEl.checked = !webSearchEl.checked;
      syncWebSearchBtn();
    });
    syncWebSearchBtn();

    // 功能工具栏：Think 思考强度（点击弹滑块：最小=不思考 / 上一档=自动 / 最大=最大思考）
    // v0.0.64：档位持久化到 config.chat.thinkLevel（初始化回填、变更写回），发送时由 chat-controller 传入 request
    const deepThinkBtn = container.querySelector('[data-ex="deepthink"]') as HTMLButtonElement;
    const thinkPop = container.querySelector('[data-ex="think-pop"]') as HTMLElement | null;
    const thinkSlider = container.querySelector('[data-ex="think-slider"]') as HTMLInputElement | null;
    const thinkValueEl = container.querySelector('[data-ex="think-value"]') as HTMLElement | null;
    // 强度档位：0=不思考 1=自动 2=低 3=中 4=高 5=最大（6 档对应刻度 6 个字）
    const readThinkLevel = (): number => {
      const v = (ctx.config.get('chat') as Record<string, unknown> | undefined)?.thinkLevel;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n) : 1;
    };
    const writeThinkLevel = (level: number): void => {
      const chat = (ctx.config.get('chat') ?? {}) as Record<string, unknown>;
      ctx.config.set('chat', { ...chat, thinkLevel: level });
    };
    let thinkLevel = readThinkLevel(); // 默认自动
    const THINK_LABELS = ['不思考', '自动', '低', '中', '高', '最大'];
    const updateThinkLabel = (): void => {
      deepThinkBtn.textContent = thinkLevel === 0 ? 'Think' : `Think: ${THINK_LABELS[thinkLevel]}`;
      deepThinkBtn.classList.toggle('on', thinkLevel > 0);
    };
    updateThinkLabel();
    // v0.0.67：Think 按钮切换逻辑在下方统一处理（打开/收回 + 全局点外关闭），此处不再单独绑定
    thinkSlider?.addEventListener('input', () => {
      thinkLevel = Number(thinkSlider.value);
      if (thinkValueEl) thinkValueEl.textContent = THINK_LABELS[thinkLevel];
    });
    thinkSlider?.addEventListener('change', () => {
      thinkLevel = Number(thinkSlider.value);
      writeThinkLevel(thinkLevel); // 持久化：发送时生效
      updateThinkLabel();
      thinkPop?.classList.remove('show');
      showToast(thinkLevel === 0 ? '思考已关闭' : thinkLevel === 1 ? '思考：自动' : `思考强度：${THINK_LABELS[thinkLevel]}`);
    });
    // 点击别处关闭思考弹层（v0.0.67：任何点击（含其他按钮/其他菜单）都收回——统一交互逻辑）
    // 全局 document 级监听：点 thinkPop 内部不关，其余（含 deepThinkBtn 自身）都关
    const closeThinkPop = () => thinkPop?.classList.remove('show');
    document.addEventListener('click', (e) => {
      if (thinkPop?.classList.contains('show') && !thinkPop.contains(e.target as Node)) {
        closeThinkPop();
      }
    });
    // Think 按钮点击 = 切换（当前关闭则打开，当前打开则收回）
    deepThinkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!thinkPop || !thinkSlider) return;
      if (thinkPop.classList.contains('show')) {
        closeThinkPop();
        return;
      }
      thinkSlider.value = String(thinkLevel);
      if (thinkValueEl) thinkValueEl.textContent = THINK_LABELS[thinkLevel];
      closeAllMenus(); // v0.0.67：打开思考弹层前先关其他菜单
      thinkPop.classList.add('show');
    });

    // 功能工具栏：上传文件（v0.0.64：图片读入→canvas 压缩→dataURL，随发送一起发给模型）
    // 参考 RikkaHub FileEncoder：强制 JPEG + 缩放到 maxDimension 内 + 选择时只暂存、编码统一在请求侧
    const fileInput = container.querySelector('[data-ex="file"]') as HTMLInputElement;
    // fileIndicator 已在控制器旁提前声明（onSendAccepted 清空用），此处不再重复声明
    // 单文件原始大小上限 10MB（dataURL 膨胀约 33%，超出会被 provider 拒）
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const MAX_IMG_DIM = 2000;
    const IMG_QUALITY = 0.85;
    const readFileAsDataUrl = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
    /** 压缩图片：超出 MAX_IMG_DIM 的降采样并转 JPEG（GIF 动图/小图原样返回） */
    const compressImage = (dataUrl: string, mime: string): Promise<string> =>
      new Promise((resolve) => {
        if (mime === 'image/gif') return resolve(dataUrl);
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, MAX_IMG_DIM / Math.max(img.width, img.height));
            if (scale >= 1) return resolve(dataUrl); // 小图不压缩
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx2d = canvas.getContext('2d');
            if (!ctx2d) return resolve(dataUrl);
            ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', IMG_QUALITY));
          } catch {
            resolve(dataUrl); // 压缩失败降级用原图
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
    fileInput.addEventListener('change', () => {
      const files = fileInput.files ? [...fileInput.files] : [];
      fileInput.value = ''; // 允许重复选同一文件
      if (files.length === 0) return;
      const images = files.filter((f) => f.type.startsWith('image/'));
      const skipped = files.length - images.length;
      if (skipped > 0) showToast(`已忽略 ${skipped} 个非图片文件（当前仅支持图片）`);
      const valid = images.filter((f) => f.size <= MAX_FILE_BYTES);
      const oversize = images.length - valid.length;
      if (oversize > 0) showToast(`已忽略 ${oversize} 个超过 10MB 的图片`);
      void (async () => {
        processingImages += valid.length;
        try {
          for (const f of valid) {
            try {
              const raw = await readFileAsDataUrl(f);
              const compressed = await compressImage(raw, f.type);
              pendingImages.push({ type: 'image', imageUrl: compressed, alt: f.name });
            } catch (error) {
              showToast(`读取 ${f.name} 失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } finally {
          processingImages = Math.max(0, processingImages - valid.length);
        }
        fileIndicator.textContent = pendingImages.length > 0 ? `已选 ${pendingImages.length} 张图片` : '';
        if (pendingImages.length > 0) showToast(`已添加 ${pendingImages.length} 张图片，随下一条消息发送`);
      })();
    });

    // 侧边栏抽屉（移动端）：开关按钮 + 遮罩点外关闭
    const closeSidebar = () => {
      if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
      }
    };
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
    maskEl.addEventListener('click', closeSidebar);

    // 新对话（侧边栏按钮 + 空态引导按钮共用）
    const startNewChat = () => {
      const s = createSession();
      void ctx.storage.saveConversation(s).then(() => {
        ctx.emit('session-switch', s.id);
        void renderSessionList(controller.getSessionId());
        void updateTopbarTitle(controller.getSessionId());
        closeSidebar();
      });
    };
    newChatBtn.addEventListener('click', startNewChat);
    emptyStartBtn.addEventListener('click', startNewChat);
    emptyGuide.addEventListener('click', () => inputEl.focus());

    // 顶栏：标题改名 / 模型 chip 进配置 / 清空会话
    titleEl.addEventListener('click', () => {
      const current = titleEl.textContent || '新对话';
      const next = window.prompt('修改会话标题：', current);
      if (next !== null && next.trim()) {
        controller.renameSession(next);
        titleEl.textContent = next.trim();
        void renderSessionList(controller.getSessionId());
      }
    });
    // 会话搜索
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      void renderSessionList(controller.getSessionId());
    });

    // 更多菜单：打开/关闭（点外关闭）
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // v0.0.67：打开更多菜单前先关其他菜单（防重叠）
      closeAllMenus();
      moreMenu.classList.toggle('show');
    });
    const closeMoreMenu = () => moreMenu.classList.remove('show');
    document.addEventListener('click', closeMoreMenu);
    moreMenu.addEventListener('click', (e) => e.stopPropagation());

    // ===== 模型下拉（右上角模型名点击展开；自动检测模型列表 + 搜索/自定义） =====
    // 缓存拉到的模型列表（当前会话内）
    let detectedModels: string[] | null = null;
    const getProfile = () => ctx.config.get('profile') as { id?: string; baseURL?: string; apiKey?: string; model?: string };
    const currentModel = () => getProfile().model ?? 'deepseek-chat';

    /** 自动检测模型：优先 provider.listModels，失败/无实现则用预设模型名兜底 */
    async function fetchModels(): Promise<string[]> {
      const p = getProfile();
      if (!p.id || !p.baseURL || !p.apiKey) return [];
      if (detectedModels !== null) return detectedModels;
      try {
        const provider = ctx.providers.get(p.id);
        const list = provider?.listModels ? await provider.listModels(p.baseURL, p.apiKey) : [];
        detectedModels = list.length > 0 ? list : null; // 空结果不缓存，下次重试
        return detectedModels ?? [];
      } catch {
        return [];
      }
    }

    function renderModelList(filter: string): void {
      const cur = currentModel();
      const q = filter.trim().toLowerCase();
      const items = (detectedModels ?? []).filter((m) => !q || m.toLowerCase().includes(q));
      modelPopList.innerHTML =
        items.length > 0
          ? items
              .map((m) => {
                const cap = resolveModelCapabilities(m);
                const tags: string[] = [];
                if (cap.input.includes('image')) tags.push('视觉');
                if (cap.abilities.includes('tool')) tags.push('工具');
                if (cap.abilities.includes('reasoning')) tags.push('推理');
                const tagHtml = tags.length > 0
                  ? `<span class="ex-model-tags">${tags.map((t) => `<i class="ex-model-tag">${t}</i>`).join('')}</span>`
                  : '';
                return `<button type="button" class="ex-model-item${m === cur ? ' active' : ''}" data-ex-model="${esc(m)}"><span class="ex-model-inner"><span class="ex-model-name">${esc(m)}</span>${tagHtml}</span></button>`;
              })
              .join('')
          : `<div class="ex-model-empty">${detectedModels === null ? '加载中...（无 Key 则显示预设）' : '没有匹配的模型'}</div>`;
      // 选中当前模型
      modelPopList.querySelectorAll<HTMLButtonElement>('[data-ex-model]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const m = btn.dataset.exModel;
          if (!m) return;
          ctx.config.set('profile', { ...getProfile(), model: m });
          updateModelStatus();
          showToast(`已切换到模型 ${m}`);
          modelPop.classList.remove('show');
        });
      });
    }

    async function openModelPop(anchor?: HTMLElement): Promise<void> {
      const showing = modelPop.classList.contains('show');
      if (showing) {
        modelPop.classList.remove('show');
        return;
      }
      // 定位：从触发锚点（顶栏副标题 / 底部工具行模型按钮）下方弹出，底部空间不足则向上
      const ref = (anchor ?? modelStatus) as HTMLElement | null;
      if (ref) {
        const r = ref.getBoundingClientRect();
        const w = modelPop.offsetWidth || 220;
        const h = modelPop.offsetHeight || 340;
        modelPop.style.right = 'auto';
        modelPop.style.top = '';
        modelPop.style.bottom = '';
        if (window.innerHeight - r.bottom >= h) {
          modelPop.style.top = `${Math.round(r.bottom + 4)}px`;
        } else {
          modelPop.style.bottom = `${Math.round(window.innerHeight - r.top + 4)}px`;
        }
        modelPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
      }
      // 有 Key 才尝试检测；检测失败/无 Key → 空列表，显示"加载中/预设"提示
      detectedModels = null;
      closeAllMenus(); // v0.0.67：打开模型下拉前先关其他菜单
      modelPop.classList.add('show');
      renderModelList('');
      const p = getProfile();
      if (p.id && p.baseURL && p.apiKey) {
        await fetchModels();
        renderModelList(modelSearchInput.value);
      } else {
        modelPopList.innerHTML = `<div class="ex-model-empty">先在设置中配置服务商与 API Key</div>`;
      }
    }

    // 模型名点击（顶栏副标题 / 底部工具行）→ 打开模型下拉
    modelStatus.addEventListener('click', (e) => {
      e.stopPropagation();
      void openModelPop(modelStatus);
    });
    // 搜索过滤（输入即过滤已拉到的列表；也允许直接回车用自定义模型）
    modelSearchInput.addEventListener('input', () => renderModelList(modelSearchInput.value));
    modelSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && modelSearchInput.value.trim()) {
        const m = modelSearchInput.value.trim();
        ctx.config.set('profile', { ...getProfile(), model: m });
        updateModelStatus();
        showToast(`已切换到模型 ${m}`);
        modelPop.classList.remove('show');
      }
    });
    // 点外关闭
    const closeModelPop = () => modelPop.classList.remove('show');
    document.addEventListener('click', (e) => {
      if (!modelPop.contains(e.target as Node)) closeModelPop();
    });
    // 模型下拉监听器随插件卸载清理（closeMoreMenu 已由主 cleanup 移除，这里只清 closeModelPop）
    ctx.effect(() => () => {
      document.removeEventListener('click', closeModelPop);
    });
    // 更多菜单：设置（移到最上面，v0.0.66）——打开设置弹窗
    const moreSettingsBtn = container.querySelector('[data-ex="more-settings"]') as HTMLButtonElement | null;
    moreSettingsBtn?.addEventListener('click', () => {
      moreMenu.classList.remove('show');
      openSettings();
    });
    // 更多菜单：更新日志（v0.0.67）——打开更新日志弹层
    const moreChangelogBtn = container.querySelector('[data-ex="more-changelog"]') as HTMLButtonElement | null;
    moreChangelogBtn?.addEventListener('click', () => {
      moreMenu.classList.remove('show');
      openChangelog();
    });
    // 更新日志弹层关闭
    const changelogCloseBtn = container.querySelector('[data-ex="changelogClose"]') as HTMLButtonElement | null;
    changelogCloseBtn?.addEventListener('click', closeChangelog);
    const changelogModal = container.querySelector('[data-ex="changelog-modal"]') as HTMLElement | null;
    changelogModal?.addEventListener('click', (e) => {
      if (e.target === changelogModal) closeChangelog();
    });
    // 更多菜单：右侧边栏开关（APITOOL：右侧栏打开放更多里）
    moreSidebarBtn.addEventListener('click', () => {
      moreMenu.classList.remove('show');
      rightSidebar.classList.toggle('hidden');
      rightMask.classList.toggle('show', !rightSidebar.classList.contains('hidden'));
      void renderRightStats();
    });
    // 更多菜单：能力设置（打开独立全屏页，模式切换/工具管理/检查更新 全部集中在该页）
    const moreCapabilityBtn = container.querySelector('[data-ex="more-capability"]') as HTMLButtonElement | null;
    moreCapabilityBtn?.addEventListener('click', () => {
      moreMenu.classList.remove('show');
      openCapability();
    });
    // 右侧边栏遮罩点外关闭
    rightMask.addEventListener('click', () => {
      rightSidebar.classList.add('hidden');
      rightMask.classList.remove('show');
    });

    // 会话列表：点击切换 + 长按二级菜单（置顶/分享/管理/删除/重新生成标题）
    // 管理态：checkbox 选择 / × 单删优先；非管理态：点击切换会话
    convList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // 管理态 × 单删
      const delBtn = target.closest('[data-ex-manage-del]') as HTMLElement | null;
      if (delBtn?.dataset.exManageDel) {
        e.stopPropagation();
        const id = delBtn.dataset.exManageDel;
        if (window.confirm('确定删除该会话？')) {
          void ctx.storage.deleteConversation(id).then(() => {
            manageSelected.delete(id);
            ctx.emit('session-deleted', id);
            void renderSessionList(controller.getSessionId());
            void updateTopbarTitle(controller.getSessionId());
            updateManageBar();
          });
        }
        return;
      }
      // 管理态 checkbox 选择
      const cb = target.closest('[data-ex-manage-check]') as HTMLInputElement | null;
      if (cb?.dataset.exManageCheck) {
        e.stopPropagation();
        const id = cb.dataset.exManageCheck;
        if (cb.checked) manageSelected.add(id);
        else manageSelected.delete(id);
        const card = cb.closest('[data-ex-switch]');
        card?.classList.toggle('manage-selected', cb.checked);
        updateManageBar();
        return;
      }
      if (manageMode) {
        // 管理态：点击整张卡片 = 切换选中（checkbox 视觉同步）；× 已在上面处理
        if (cb || delBtn) return;
        const item = target.closest('[data-ex-switch]') as HTMLElement | null;
        if (!item?.dataset.exSwitch) return;
        const id = item.dataset.exSwitch;
        if (manageSelected.has(id)) manageSelected.delete(id);
        else manageSelected.add(id);
        item.classList.toggle('manage-selected', manageSelected.has(id));
        const box = item.querySelector<HTMLInputElement>('[data-ex-manage-check]');
        if (box) box.checked = manageSelected.has(id);
        updateManageBar();
        return;
      }
      const item = (target).closest('[data-ex-switch]') as HTMLElement | null;
      if (item && item.dataset.exSwitch) {
        ctx.emit('session-switch', item.dataset.exSwitch);
        void renderSessionList(controller.getSessionId());
        closeSidebar();
      }
    });

    // 长按会话项（600ms）→ 弹二级菜单
    const convMenu = container.querySelector('[data-ex="conv-menu"]') as HTMLElement | null;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressTarget: HTMLElement | null = null;
    let menuShown = false; // 菜单已弹出：松手/移开不再关闭（否则 pointerup 立即关掉菜单，用户看不到）
    const closeConvMenu = (): void => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      pressTarget = null;
      menuShown = false;
      convMenu?.classList.remove('show');
    };
    // v0.0.67：统一关闭所有二级菜单（打开任一菜单前先关其他，防重叠）
    const closeAllMenus = (): void => {
      moreMenu.classList.remove('show');
      closeModelPop();
      closeConvMenu();
      thinkPop?.classList.remove('show');
    };
    convList.addEventListener('pointerdown', (e) => {
      const item = (e.target as HTMLElement).closest('[data-ex-switch]') as HTMLElement | null;
      if (!item?.dataset.exSwitch) return;
      if (manageMode) return; // 管理模式禁长按菜单（防干扰 checkbox/×）
      // 不 preventDefault（会阻止 click 导致会话点不动）；防文本选择靠 CSS user-select:none
      pressTarget = item;
      menuShown = false;
      pressTimer = setTimeout(() => {
        // 长按触发：显示菜单在长按位置
        if (!convMenu || !pressTarget) return;
        const rect = item.getBoundingClientRect();
        convMenu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - convMenu.offsetHeight - 8)}px`;
        convMenu.style.left = `${Math.min(rect.left, window.innerWidth - convMenu.offsetWidth - 8)}px`;
        const id = item.dataset.exSwitch!;
        convMenu.dataset.convId = id;
        const pinnedSet = loadPinned();
        convMenu.dataset.pinned = String(pinnedSet.has(id));
        convMenu.querySelector('[data-ex-menu-action="pin"]')!.textContent = pinnedSet.has(id) ? '取消置顶' : '置顶';
        closeAllMenus(); // v0.0.67：打开会话菜单前先关其他菜单
        convMenu.classList.add('show');
        menuShown = true; // 菜单已弹：松手不关
      }, 600);
    });
    convList.addEventListener('pointerup', () => {
      // 菜单已弹出则不关（让用户点菜单项）；未弹出则取消长按计时
      if (!menuShown) closeConvMenu();
    });
    // 长按触发过菜单后，本次按下的 click 要吞掉（防止松手瞬间误切会话）
    convList.addEventListener('click', (e) => {
      if (menuShown) {
        e.preventDefault();
        e.stopPropagation();
        menuShown = false;
      }
    }, true); // capture 阶段拦截，先于下方会话切换的 bubble click
    convList.addEventListener('pointerleave', () => {
      if (!menuShown) closeConvMenu();
    });
    convList.addEventListener('pointermove', (e) => {
      // 长按计时前 400ms 内手指移出目标 → 取消（防误触）；之后允许微动（长按触发菜单）
      if (pressTarget && pressTimer && !menuShown) {
        const item = (e.target as HTMLElement).closest('[data-ex-switch]') as HTMLElement | null;
        if (item !== pressTarget) closeConvMenu();
      }
    });
    // 菜单项点击
    convMenu?.addEventListener('click', (e) => {
      // v0.0.76：必须 stopPropagation——convMenu 在 .ex-app 外（fixed），点菜单项冒泡到 document 会被
      // "管理态点侧边栏外退出"监听（manageMode=false）瞬间复位，导致点"管理"无反应（子代理审查定位）
      e.stopPropagation();
      const btn = (e.target as HTMLElement).closest('[data-ex-menu-action]') as HTMLElement | null;
      const id = convMenu.dataset.convId;
      if (!btn || !id) return;
      const action = btn.dataset.exMenuAction;
      closeConvMenu();
      if (action === 'pin') {
        const set = loadPinned();
        if (set.has(id)) set.delete(id);
        else set.add(id);
        savePinned(set);
        void renderSessionList(controller.getSessionId());
      } else if (action === 'share') {
        // 分享（v0.0.65）：Web Share API（Android WebView 支持）分享会话文本；不支持则复制到剪贴板
        void ctx.storage.getConversation(id).then((s) => {
          const title = s?.title ?? 'KIRUSRAFT 会话';
          const bodyText = s?.nodes
            ?.map((n) => {
              const idx = n.selectIndex >= 0 && n.selectIndex < n.messages.length ? n.selectIndex : 0;
              const m = n.messages[idx];
              const role = m?.role === 'user' ? '我' : 'AI';
              const text = m?.parts.map((p) => (p.type === 'text' ? p.text : '[图片]')).join('\n') ?? '';
              return text.trim() ? `${role}: ${text}` : '';
            })
            .filter((t) => t)
            .join('\n\n') ?? '';
          const shareText = `${title}\n\n${bodyText}`;
          const canShare = typeof navigator.share === 'function';
          if (canShare) {
            void navigator
              .share({ title, text: shareText })
              .then(() => showToast('已分享'))
              .catch((err) => {
                if ((err as Error).name === 'AbortError') return;
                void navigator.clipboard.writeText(shareText).then(() => showToast('已复制会话内容')).catch(() => showToast('分享失败'));
              });
          } else {
            void navigator.clipboard.writeText(shareText).then(() => showToast('已复制会话内容')).catch(() => showToast('分享失败'));
          }
        });
      } else if (action === 'manage') {
        // 管理（v0.0.65 修正）：进入侧边栏就地管理模式（卡片 checkbox 批量 + × 单删），不再弹内核设置
        manageMode = true;
        manageSelected.clear();
        sidebar.classList.add('open'); // 打开侧边栏（移动端抽屉）
        updateManageBar();
        void renderSessionList(controller.getSessionId());
        showToast('管理模式：勾选会话可批量删除');
      } else if (action === 'delete') {
        if (window.confirm('确定删除该会话？')) {
          void ctx.storage.deleteConversation(id).then(() => {
            ctx.emit('session-deleted', id);
            void renderSessionList(controller.getSessionId());
            void updateTopbarTitle(controller.getSessionId());
          });
        }
      } else if (action === 'rename') {
        // 重新生成标题（v0.0.65）：取第一条用户消息文本前 30 字作标题（APITOOL autoTitle 截断规则）
        void ctx.storage.getConversation(id).then((s) => {
          const firstUser = s?.nodes
            ?.map((n) => {
              const idx = n.selectIndex >= 0 && n.selectIndex < n.messages.length ? n.selectIndex : 0;
              return n.messages[idx];
            })
            .find((m) => m?.role === 'user');
          const text = firstUser?.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim();
          if (!text) {
            showToast('会话无用户消息，无法生成标题');
            return;
          }
          const newTitle = text.replace(/["“”‘’]/g, '').slice(0, 30);
          void ctx.storage.getConversation(id).then((conv) => {
            if (!conv) return;
            conv.title = newTitle;
            void ctx.storage.saveConversation(conv).then(() => {
              void renderSessionList(controller.getSessionId());
              if (controller.getSessionId() === id) void updateTopbarTitle(id);
              showToast(`标题已更新：${newTitle}`);
            });
          });
        });
      }
    });
    // 点击别处关闭菜单（v0.0.67：全局 document 级，点任何非菜单处（含其他按钮/菜单）都收回）
    document.addEventListener('click', (e) => {
      if (convMenu && convMenu.classList.contains('show') && !convMenu.contains(e.target as Node)) closeConvMenu();
    });

    // 对话管理模式工具条（v0.0.65 修正：全选/删除选中/退出）
    const manageBar = container.querySelector('[data-ex="manage-bar"]') as HTMLElement | null;
    const manageSelectAllBtn = container.querySelector('[data-ex="manage-select-all"]') as HTMLElement | null;
    const manageDeleteBtn = container.querySelector('[data-ex="manage-delete"]') as HTMLElement | null;
    const manageExitBtn = container.querySelector('[data-ex="manage-exit"]') as HTMLElement | null;
    manageSelectAllBtn?.addEventListener('click', () => {
      // 全选 / 取消全选：切换当前可见会话的选中态
      const allIds = [...convList.querySelectorAll<HTMLElement>('[data-ex-switch]')]
        .map((el) => el.dataset.exSwitch)
        .filter((x): x is string => !!x);
      const allChecked = allIds.length > 0 && allIds.every((id) => manageSelected.has(id));
      if (allChecked) allIds.forEach((id) => manageSelected.delete(id));
      else allIds.forEach((id) => manageSelected.add(id));
      void renderSessionList(controller.getSessionId());
      updateManageBar();
    });
    manageDeleteBtn?.addEventListener('click', () => {
      const ids = [...manageSelected];
      if (ids.length === 0) {
        showToast('未选择会话');
        return;
      }
      if (!window.confirm(`确定删除选中的 ${ids.length} 个会话？此操作不可恢复。`)) return;
      void (async () => {
        for (const id of ids) {
          try {
            await ctx.storage.deleteConversation(id);
          } catch (error) {
            logger.error('storage', `批量删除失败 ${id}: ${String(error)}`);
          }
        }
        manageSelected.clear();
        ctx.emit('session-deleted', controller.getSessionId()); // 若删了当前会话，重建
        void renderSessionList(controller.getSessionId());
        void updateTopbarTitle(controller.getSessionId());
        updateManageBar();
        showToast(`已删除 ${ids.length} 个会话`);
      })();
    });
    manageExitBtn?.addEventListener('click', () => {
      manageMode = false;
      manageSelected.clear();
      updateManageBar();
      void renderSessionList(controller.getSessionId());
    });
    // v0.0.70：管理态点侧边栏外任意处 → 退出管理模式（管理是临时态，点无关区域就该收）
    // v0.0.76：排除 convMenu 内点击（点在长按菜单上不算"点侧边栏外"）
    document.addEventListener('click', (e) => {
      if (!manageMode) return;
      if (convMenu?.contains(e.target as Node)) return;
      const insideSidebar = sidebar.contains(e.target as Node);
      if (!insideSidebar) {
        manageMode = false;
        manageSelected.clear();
        updateManageBar();
        void renderSessionList(controller.getSessionId());
      }
    });
    // 初始化：工具条默认隐藏
    updateManageBar();

    // 插件管理入口：在设置弹窗左侧导航（唯一入口，不放在更多菜单）
    // 设置入口已移到更多菜单最上面（v0.0.66），侧边栏按钮已移除
    // 右侧栏：刷新分支列表（替代"查看分支图谱"占位）
    // 右侧栏分支总览已移除（v0.0.67：分支图谱不好实现，删掉）

    // ==================== 设置面板交互（APITOOL 复刻：功能占位）====================
    // 遮罩点击关闭（全屏页面下几乎不会触发，保留防御）
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettings();
    });
    // 横滑标签条：点击滚动到对应分区 + 高亮（用 settingsBody.scrollTo，避免被固定 head 遮挡）
    settingsNav.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-ex-nav]') as HTMLElement | null;
      if (!btn || !btn.dataset.exNav) return;
      settingsNav.querySelectorAll('.ex-nav-item').forEach((n) => n.classList.toggle('active', n === btn));
      const sec = settingsBody.querySelector('#' + btn.dataset.exNav) as HTMLElement | null;
      if (sec) {
        const top = sec.offsetTop - settingsBody.offsetTop;
        settingsBody.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
      }
    });
    // 竖向滚动联动：按分区 offsetTop 判断当前激活分区，切换横滑标签 active 态（Rikka 双向联动）
    settingsBody.addEventListener('scroll', () => {
      const scrollTop = settingsBody.scrollTop;
      const navIds = new Set(
        Array.from(settingsNav.querySelectorAll<HTMLElement>('[data-ex-nav]'))
          .map((n) => n.dataset.exNav)
          .filter((v): v is string => !!v)
      );
      let activeId: string | null = null;
      settingsBody.querySelectorAll<HTMLElement>('.ex-section').forEach((sec) => {
        // 只考虑有对应横滑标签的分区；危险区（sec-danger）无标签，滚到它时保持上一个标签激活
        if (!navIds.has(sec.id)) return;
        const top = sec.offsetTop - settingsBody.offsetTop;
        if (scrollTop >= top - 80) activeId = sec.id;
      });
      if (!activeId) return;
      settingsNav.querySelectorAll<HTMLElement>('.ex-nav-item').forEach((n) => n.classList.toggle('active', n.dataset.exNav === activeId));
    });
    // 帧率滑块（档位语义：滑块 0-3 映射 15/30/60/120 FPS，默认 60；v0.0.65 change 持久化 + 重建视差）
    const FPS_TIERS = [15, 30, 60, 120] as const;
    const fpsSlider = container.querySelector('[data-ex="fpsSlider"]') as HTMLInputElement | null;
    const fpsValueEl = container.querySelector('[data-ex="fpsValue"]') as HTMLElement | null;
    fpsSlider?.addEventListener('change', () => {
      const fps = FPS_TIERS[Number(fpsSlider.value)] ?? 60;
      if (fpsValueEl) fpsValueEl.textContent = String(fps);
      const ui = (ctx.config.get('ui') ?? {}) as Record<string, unknown>;
      ctx.config.set('ui', { ...ui, fps });
      // 重建视差（帧率生效）
      currentStopParallax?.();
      const uiCfg2 = (ctx.config.get('ui') ?? {}) as Record<string, unknown>;
      currentStopParallax = initParallax(parallaxSvg, {
        layerLevel: Number(uiCfg2.parallaxLayers) > 0 ? Number(uiCfg2.parallaxLayers) : 4,
        fpsLimit: fps,
      });
      showToast(`帧率已设为 ${fps} FPS`);
    });
    // 视差层数滑块（v0.0.65：change 持久化 + 重建视差）
    parallaxSlider.addEventListener('change', () => {
      const layers = Number(parallaxSlider.value);
      parallaxValueEl.textContent = String(layers);
      const ui = (ctx.config.get('ui') ?? {}) as Record<string, unknown>;
      ctx.config.set('ui', { ...ui, parallaxLayers: layers });
      // 重建视差（层数生效）
      currentStopParallax?.();
      const uiCfg3 = (ctx.config.get('ui') ?? {}) as Record<string, unknown>;
      currentStopParallax = initParallax(parallaxSvg, {
        layerLevel: layers,
        fpsLimit: Number(uiCfg3.fps) > 0 ? Number(uiCfg3.fps) : 60,
      });
      showToast(`视差层数已设为 ${layers}`);
    });
    // 对话 Temperature 滑块：实时更新数值显示；保存时由设置页 settingsSave 写入 config.chat.temperature
    const convTempSlider = container.querySelector('[data-ex="convTemp"]') as HTMLInputElement | null;
    const convTempValueEl = container.querySelector('[data-ex="convTempValue"]') as HTMLElement | null;
    convTempSlider?.addEventListener('input', () => {
      if (convTempValueEl) convTempValueEl.textContent = Number(convTempSlider.value).toFixed(1);
    });
    // 主题点（v0.0.65：仅 Exdark 内置，点选保持选中态）
    settingsBody.addEventListener('click', (e) => {
      const dot = (e.target as HTMLElement).closest('[data-ex-theme]') as HTMLElement | null;
      if (!dot) return;
      settingsBody.querySelectorAll('.ex-theme-dot').forEach((n) => n.classList.remove('selected'));
      dot.classList.add('selected');
    });
    // 计费区（v0.0.65 做实）：币种选择持久化 config.chat.currency（默认 CNY）；汇率同步已成熟（rate.sync 多源+缓存）
    const currencySel = container.querySelector('#exCurrency') as HTMLSelectElement | null;
    currencySel?.addEventListener('change', () => {
      const chat = (ctx.config.get('chat') ?? {}) as Record<string, unknown>;
      ctx.config.set('chat', { ...chat, currency: currencySel.value === '美元' ? 'USD' : 'CNY' });
      showToast(`币种已切换：${currencySel.value}`);
    });
    // 汇率手动输入：change 时校验 1~30 写入 config.chat.rate（供计费折算；同步按钮优先用 rate.sync 缓存）
    const rateInputEl = container.querySelector('#exRate') as HTMLInputElement | null;
    rateInputEl?.addEventListener('change', () => {
      const v = Number(rateInputEl.value);
      if (!Number.isFinite(v) || v <= 1 || v >= 30) {
        showToast('汇率无效（需在 1~30 之间）');
        return;
      }
      const chat = (ctx.config.get('chat') ?? {}) as Record<string, unknown>;
      ctx.config.set('chat', { ...chat, rate: Math.round(v * 10000) / 10000 });
      showToast(`已保存汇率 1 USD = ${rateInputEl.value} CNY`);
    });
    syncRateBtn.addEventListener('click', () => {
      void (async () => {
        syncRateBtn.disabled = true;
        syncRateBtn.textContent = '同步中...';
        try {
          const r = await ctx.rate.sync();
          // 写入汇率输入框 + 展示来源
          const rateInput = container.querySelector('#exRate') as HTMLInputElement | null;
          if (rateInput) rateInput.value = r.rate.toFixed(4);
          showToast(`已同步汇率 1 USD = ${r.rate.toFixed(4)} CNY${r.source === 'cache' ? '（缓存）' : ''}`);
        } catch (error) {
          showToast(`汇率同步失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          syncRateBtn.disabled = false;
          syncRateBtn.textContent = '同步汇率';
        }
      })();
    });
    // 导出 / 导入存档（v0.0.65：自己的 JSON 格式，不兼容 apitool；复用 logger.download Blob 范式）
    // 格式 { app:'kirusraft', version:1, exportedAt, conversations: Session[] }（不含 apiKey 等敏感配置）
    exportDataBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const conversations = await ctx.storage.exportAll();
          const data = {
            app: 'kirusraft',
            version: 1,
            exportedAt: Date.now(),
            conversations,
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const stamp = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `kirusraft-backup-${stamp}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showToast(`已导出 ${conversations.length} 个会话`);
        } catch (error) {
          showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
    importDataBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        void (async () => {
          try {
            const text = await file.text();
            const data = JSON.parse(text) as { app?: string; version?: number; conversations?: unknown };
            if (data.app !== 'kirusraft' || !Array.isArray(data.conversations)) {
              showToast('无效的存档格式（非 KIRUSRAFT 存档）');
              return;
            }
            // 按 id 去重合并：已存在跳过（避免覆盖本地新数据），只导入新会话
            const existing = await ctx.storage.listConversations();
            const existingIds = new Set(existing.map((s) => s.id));
            let imported = 0;
            for (const conv of data.conversations) {
              const c = conv as { id?: string; nodes?: unknown };
              if (!c || typeof c.id !== 'string' || existingIds.has(c.id)) continue;
              if (!Array.isArray(c.nodes)) continue;
              // 净化（v0.0.65）：钳制 selectIndex、丢弃空节点、过滤无文本 parts 的空消息，防损坏存档崩渲染
              const cleaned = (c.nodes as { messages?: unknown[]; selectIndex?: unknown }[])
                .filter((n) => Array.isArray(n.messages) && n.messages.length > 0)
                .map((n) => {
                  const msgs = (n.messages as { parts?: unknown[]; role?: string }[]).filter(
                    (m) => m && typeof m === 'object' && Array.isArray(m.parts) && m.parts.length > 0,
                  );
                  const sel = Number(n.selectIndex);
                  return {
                    ...n,
                    messages: msgs,
                    selectIndex: msgs.length > 0 && Number.isFinite(sel) && sel >= 0 && sel < msgs.length ? sel : 0,
                  };
                });
              if (cleaned.length === 0) continue;
              (c as { nodes?: unknown }).nodes = cleaned;
              existingIds.add(c.id);
              await ctx.storage.saveConversation(c as never);
              imported++;
            }
            showToast(`导入完成：新增 ${imported} 个会话`);
            void renderSessionList(controller.getSessionId());
          } catch (error) {
            showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      });
      input.click();
    });
    // 危险重置（v0.0.65：双重确认后清空会话 + config + 汇率缓存 + 日志，不可恢复）
    resetAppBtn.addEventListener('click', () => {
      const first = window.confirm('确定重置所有数据？\n将清空：全部会话、全部设置、汇率缓存、运行日志。\n此操作不可恢复，建议先导出存档。');
      if (!first) return;
      const second = window.confirm('最后确认：真的要清除全部数据吗？');
      if (!second) return;
      void (async () => {
        try {
          await ctx.storage.clearAll();
          // 清 config 分节（localStorage kirusraft.config.*）
          for (const s of ctx.config.list()) {
            try {
              localStorage.removeItem(`kirusraft.config.${s.namespace}`);
            } catch {
              /* 忽略 */
            }
          }
          // 清汇率缓存
          try {
            localStorage.removeItem('kirusraft.rate.usdcny');
          } catch {
            /* 忽略 */
          }
          // 清日志
          logger.clear();
          showToast('已重置全部数据');
          window.setTimeout(() => window.location.reload(), 600);
        } catch (error) {
          showToast(`重置失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
    // 取消 / 保存（v0.0.64：保存真实写入 config.chat + 会话级提示词，关闭弹窗）
    settingsCancelBtn.addEventListener('click', closeSettings);
    settingsSaveBtn.addEventListener('click', () => {
      const chatCfg = (ctx.config.get('chat') ?? {}) as Record<string, unknown>;
      const convPromptEl = container.querySelector('#exConvPrompt') as HTMLTextAreaElement | null;
      const convTempEl = container.querySelector('#exConvTemp') as HTMLInputElement | null;
      const convRoundsEl = container.querySelector('#exConvRounds') as HTMLInputElement | null;
      const sysPromptEl = container.querySelector('#exSystemPrompt') as HTMLTextAreaElement | null;
      // 温度：0~2 合法才写入，非法回退 1.0
      const temp = Number(convTempEl?.value);
      const temperature = Number.isFinite(temp) && temp >= 0 && temp <= 2 ? temp : 1.0;
      // 轮数：正整数或留空=不限（0）
      const roundsRaw = (convRoundsEl?.value ?? '').trim();
      let maxRounds = 0;
      if (roundsRaw) {
        const r = Number(roundsRaw);
        maxRounds = Number.isFinite(r) && r >= 1 ? Math.round(r) : 0;
      }
      ctx.config.set('chat', {
        ...chatCfg,
        temperature,
        maxRounds,
        systemPrompt: sysPromptEl?.value ?? '',
      });
      // 当前对话系统提示词（会话级覆盖全局，留空=用全局；落盘随会话走）
      controller.setConversationSystemPrompt(convPromptEl?.value ?? '');
      showToast('设置已保存');
      closeSettings();
    });

    // ==================== 能力设置独立页交互 ====================
    // 返回按钮：关闭本页
    capabilityBackBtn.addEventListener('click', closeCapability);
    initSandboxManage();
    // 模式切换：代理/对话（写 config.agent.mode + 高亮 + toast）
    capabilityModal.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-ex-mode]') as HTMLElement | null;
      if (!btn?.dataset.exMode) return;
      const mode = btn.dataset.exMode;
      const agent = (ctx.config.get('agent') ?? {}) as Record<string, unknown>;
      ctx.config.set('agent', { ...agent, mode });
      syncModeButtons();
      showToast(mode === 'chat' ? '已切换：对话模式（不带工具）' : '已切换：代理模式');
    });
    // 检查更新：update 服务可选（update-checker 停用时无此服务），缺失则提示不可用，不拖垮页面
    const checkUpdateBtn = container.querySelector('[data-ex="checkUpdate"]') as HTMLButtonElement | null;
    const updateResultEl = container.querySelector('[data-ex="update-result"]') as HTMLElement | null;
    checkUpdateBtn?.addEventListener('click', () => {
      void (async () => {
        const updateSvc = (ctx as unknown as {
          update?: {
            checkLatest(): Promise<{ info: { tagName?: string; apkUrl?: string } | null; error?: string }>;
            compareVersion(a: string, b: string): boolean;
            download(url: string): Promise<{ blob: Blob; filename: string } | null>;
          };
        }).update;
        if (!updateSvc) {
          if (updateResultEl) updateResultEl.textContent = '更新检测插件未启用';
          return;
        }
        if (checkUpdateBtn) {
          checkUpdateBtn.disabled = true;
          checkUpdateBtn.textContent = '检查中...';
        }
        if (updateResultEl) updateResultEl.textContent = '正在检查最新版本...';
        try {
          const latest = await updateSvc.checkLatest();
          // await 后 DOM 可能已重建（主题切换），失效则放弃
          if (!updateResultEl || !updateResultEl.isConnected) return;
          if (!latest.info) {
            updateResultEl.innerHTML = `<span class="ex-err">检查失败：${esc(latest.error || '未知错误')}</span>`;
            return;
          }
          const info = latest.info; // 局部变量：TS narrowing 对 latest.info 失效
          if (!info.tagName) {
            updateResultEl.textContent = '未找到版本信息';
            return;
          }
          if (updateSvc.compareVersion(info.tagName, VERSION)) {
            updateResultEl.innerHTML = `发现新版本 <span class="ex-ver">${esc(info.tagName)}</span>（当前 ${esc(VERSION)}）`;
            if (info.apkUrl) {
              const dlBtn = document.createElement('button');
              dlBtn.type = 'button';
              dlBtn.className = 'ex-update-dl';
              dlBtn.textContent = '下载 APK';
              dlBtn.addEventListener('click', () => {
                void (async () => {
                  dlBtn.textContent = '下载中...';
                  dlBtn.disabled = true;
                  const result = await updateSvc.download(info.apkUrl!);
                  if (!result) {
                    dlBtn.textContent = '下载失败';
                    return;
                  }
                  const url = URL.createObjectURL(result.blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = result.filename;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  dlBtn.textContent = '已下载';
                })();
              });
              updateResultEl.appendChild(dlBtn);
            }
          } else {
            updateResultEl.textContent = `已是最新版本 ${esc(VERSION)}（远端 ${esc(info.tagName)}）`;
          }
        } catch (error) {
          if (updateResultEl && updateResultEl.isConnected) {
            updateResultEl.innerHTML = `<span class="ex-err">检查失败：${esc(error instanceof Error ? error.message : String(error))}</span>`;
          }
        } finally {
          if (checkUpdateBtn && checkUpdateBtn.isConnected) {
            checkUpdateBtn.disabled = false;
            checkUpdateBtn.textContent = '检查更新';
          }
        }
      })();
    });

    // 运行记录（日志）：展开/收起（展开时自动刷新）/ 刷新 / 复制 / 导出 / 清空
    logExpandBtn.addEventListener('click', toggleLogView);
    logRefreshBtn.addEventListener('click', renderLogView);
    logClearBtn.addEventListener('click', () => {
      logger.clear();
      renderLogView();
    });
    // v0.0.96：日志范围真切换（今天/3天/7天/全部），复制/导出/视图随范围走
    const logRangeLabel = (r: LogRange): string => (r === 'today' ? '今日' : r === '3d' ? '最近3天' : r === '7d' ? '最近7天' : '全部');
    container.querySelectorAll('[data-ex-log-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        logRange = (btn as HTMLElement).dataset.exLogRange as LogRange;
        container.querySelectorAll('[data-ex-log-range]').forEach((b) => b.classList.toggle('active', b === btn));
        renderLogView();
      });
    });
    logCopyBtn.addEventListener('click', () => {
      void logger.copy(logRange).then((ok) => {
        showToast(ok ? `已复制${logRangeLabel(logRange)}日志到剪贴板` : '复制失败，请用导出下载文件');
      });
    });
    logExportBtn.addEventListener('click', () => {
      logger.download(logRange);
      showToast(`已导出${logRangeLabel(logRange)}日志文件`);
    });

    // 异常红点：有 FAILED 插件时更多按钮显示（点设置→插件管理查看）
    const updateDot = () => {
      try {
        const topo = ctx.topology.getTopology();
        moreDot.style.display = topo.nodes.some((n) => n.stateCode === 3) ? 'block' : 'none';
      } catch {
        moreDot.style.display = 'none';
      }
    };
    ctx.on('internal/status', updateDot);
    ctx.on('internal/plugin', updateDot);
    updateDot();

    // 模型显示：配置变化时刷新
    const offModel = ctx.config.onChange('profile', updateModelStatus);

    // 空态引导：messages 无气泡时显示（监听子节点增删 + 初次判定——加载已有会话时 observer 建立前已渲染）
    const syncEmptyGuide = (): void => {
      const hasMsg = messagesEl.querySelector(':scope > .ex-msg-wrap') !== null;
      emptyGuide.classList.toggle('hidden', hasMsg);
    };
    const guideObserver = new MutationObserver(syncEmptyGuide);
    guideObserver.observe(messagesEl, { childList: true });
    syncEmptyGuide();
    // v0.0.76：用户滚动意图——离底部>阈值=上滚看历史（停止自动跟随）；滚回底部=恢复
    const onMessagesScroll = (): void => {
      const distToBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
      userScrolledUp = distToBottom > 80;
    };
    messagesEl.addEventListener('scroll', onMessagesScroll);

    // 初次渲染会话列表
    void renderSessionList(controller.getSessionId());

    return () => {
      currentStopParallax = null;
      stopParallax();
      offModel();
      guideObserver.disconnect();
      messagesEl.removeEventListener('scroll', onMessagesScroll);
      document.removeEventListener('click', closeMoreMenu);
      controller.dispose();
      container.remove();
    };
  });
}
