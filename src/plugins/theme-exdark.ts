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
import type { PluginManifest } from '../core/manifest';

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
  --ex-sidebar-transition: 0.35s cubic-bezier(0.68,-0.55,0.27,1.55);
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
/* 侧边栏底部设置入口（参考 rikka 列表底部设置）：右下角固定 */
.ex-sidebar-settings { margin:auto 10px 10px; padding:10px; background:var(--ex-surface2); color:var(--ex-text2); border:1px solid var(--ex-border2); font-weight:900; text-transform:uppercase; letter-spacing:1px; cursor:pointer; font-family:var(--ex-font); font-size:11px; transition:all .2s; }
.ex-sidebar-settings:hover { background:var(--ex-border2); color:var(--ex-bg); }
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
/* ---- 消息区（气泡 = meta + 内容；A2：去粗边，明度分层 + 青绿左边条签名） ---- */
.ex-msgwrap { flex:1; position:relative; display:flex; flex-direction:column; min-height:0; }
.ex-messages { flex:1; overflow-y:auto; padding:24px 16px 8px; display:flex; flex-direction:column; position:relative; z-index:1; }
.ex-message { max-width:88%; margin-bottom:30px; background:var(--ex-surface2); color:var(--ex-text); line-height:1.6; font-size:13px; position:relative; padding:12px 16px; min-width:80px; word-wrap:break-word; word-break:break-word; white-space:pre-wrap; }
.ex-message.ex-user { margin-left:auto; background:var(--ex-accent); color:var(--ex-bg); }
.ex-message.ex-ai { margin-right:auto; background:var(--ex-surface2); border-left:3px solid var(--ex-accent); }
/* 消息 meta：角色标识 + 时间戳 + 操作按钮（复制/重发） */
.ex-msg-meta { display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:10px; color:var(--ex-text3); }
.ex-user .ex-msg-meta { color:rgba(26,26,26,0.75); }
.ex-msg-role { font-weight:900; letter-spacing:1px; text-transform:uppercase; }
.ex-ai .ex-msg-role { color:var(--ex-accent); }
.ex-user .ex-msg-role { color:var(--ex-bg); }
.ex-msg-btn { background:none; border:1px solid var(--ex-border2); color:var(--ex-text2); font-size:10px; padding:1px 7px; cursor:pointer; transition:all .2s; font-weight:bold; font-family:var(--ex-font); }
.ex-msg-btn:hover { background:var(--ex-accent); color:var(--ex-bg); border-color:var(--ex-accent); }
.ex-user .ex-msg-btn { border-color:rgba(26,26,26,0.5); color:var(--ex-bg); }
.ex-user .ex-msg-btn:hover { background:var(--ex-bg); color:var(--ex-accent); border-color:var(--ex-bg); }
.ex-msg-btn.copied { background:var(--ex-accent2) !important; color:var(--ex-bg); border-color:var(--ex-accent2) !important; }
/* ---- 消息 Markdown 渲染（仅白名单标签，文本已 esc 全量转义） ---- */
.ex-msg-content > :first-child { margin-top:0; }
.ex-msg-content > :last-child { margin-bottom:0; }
.ex-msg-content p { margin:6px 0; }
.ex-msg-content h1, .ex-msg-content h2, .ex-msg-content h3 { font-weight:900; color:var(--ex-accent); margin:10px 0 6px; letter-spacing:1px; line-height:1.3; }
.ex-ai .ex-msg-content h1, .ex-ai .ex-msg-content h2 { border-bottom:3px solid var(--ex-border); padding-bottom:4px; }
.ex-msg-content h1 { font-size:17px; }
.ex-msg-content h2 { font-size:15px; }
.ex-msg-content h3 { font-size:14px; }
.ex-msg-content code { background:var(--ex-bg2); color:var(--ex-accent2); padding:1px 6px; border:1px solid var(--ex-border2); font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace; font-size:0.88em; word-break:break-word; }
.ex-user .ex-msg-content code { background:rgba(255,255,255,0.25); color:var(--ex-bg); border-color:rgba(255,255,255,0.4); }
.ex-msg-content pre { background:var(--ex-bg); border:2px solid var(--ex-border); border-left:5px solid var(--ex-accent2); padding:10px 12px; margin:8px 0; overflow-x:auto; box-shadow:0 1px 6px rgba(0,0,0,.25); }
.ex-msg-content pre::before { content:attr(data-lang); display:block; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:var(--ex-text3); margin-bottom:6px; font-family:var(--ex-font); }
.ex-msg-content pre code { background:transparent; border:none; color:var(--ex-text); padding:0; font-size:12px; line-height:1.6; display:block; white-space:pre; }
.ex-user .ex-msg-content pre { background:rgba(26,26,26,0.85); }
.ex-msg-content blockquote { border-left:4px solid var(--ex-accent); background:var(--ex-bg2); padding:6px 10px; margin:8px 0; color:var(--ex-text2); }
.ex-user .ex-msg-content blockquote { background:rgba(255,255,255,0.15); color:var(--ex-bg); }
.ex-msg-content ul, .ex-msg-content ol { padding-left:20px; margin:6px 0; }
.ex-msg-content li { margin:2px 0; }
.ex-msg-content a { color:var(--ex-accent); text-decoration:underline; word-break:break-all; }
.ex-user .ex-msg-content a { color:var(--ex-bg); }
.ex-msg-content hr { border:none; border-top:2px dashed var(--ex-border2); margin:10px 0; }
/* 空会话引导（欢迎卡：装饰旋转方块 + 硬投影标题） */
.ex-empty-guide { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; pointer-events:none; text-align:center; padding:24px; z-index:2; }
.ex-empty-guide.hidden { display:none; }
.ex-empty-badge { width:28px; height:28px; background:var(--ex-accent); border:1px solid var(--ex-border); box-shadow:var(--ex-shadow); transform:rotate(15deg); }
.ex-empty-title { font-size:26px; font-weight:900; letter-spacing:6px; color:var(--ex-accent); text-transform:uppercase; text-shadow:4px 4px 0 var(--ex-border); }
.ex-empty-sub { font-size:12px; color:var(--ex-text2); line-height:1.7; }
.ex-empty-hint { font-size:10px; color:var(--ex-text3); letter-spacing:1px; }
.ex-empty-start { pointer-events:auto; max-width:220px; }
.ex-status { padding:6px 16px 4px; font-size:11px; color:var(--ex-text2); min-height:20px; text-align:center; position:relative; z-index:1; }
/* ---- 输入区（Rikka ChatInput 复刻：圆角0 + 1px 半透明描边 + 半透明 surface + blur；内部工具行 + 输入框） ---- */
.ex-input-area { margin:8px 12px; padding:8px 10px; padding-bottom:calc(8px + env(safe-area-inset-bottom,0px)); background:rgba(42,42,42,0.72); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.12); box-shadow:var(--ex-shadow); z-index:5; display:flex; flex-direction:column; gap:8px; }
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
  .ex-message { max-width:92%; font-size:12px; padding:10px 12px; margin-bottom:22px; }
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
}
@media (hover:none){
  /* 触屏无 hover：会话项操作已改为长按菜单，无需此规则 */
}
/* ==================== 设置页（RikkaHub 竖向设置页复刻：全屏 + 横滑标签条 + 竖向卡片组） ==================== */
.ex-modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:var(--ex-bg); z-index:2000; }
.ex-modal.show { display:block; }
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
.ex-save-btn { background:var(--ex-accent); color:var(--ex-bg); }
.ex-save-btn:hover { background:var(--ex-accent2); transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.35); }
.ex-cancel-btn { background:var(--ex-surface2); color:var(--ex-text2); }
.ex-cancel-btn:hover { background:var(--ex-border); color:var(--ex-bg); }
.ex-footer-ver { text-align:center; font-size:10px; color:var(--ex-text3); margin:24px 0 16px; line-height:1.5; }
.ex-settings-body::-webkit-scrollbar, .ex-settings-nav::-webkit-scrollbar { width:6px; height:6px; }
.ex-settings-body::-webkit-scrollbar-track, .ex-settings-nav::-webkit-scrollbar-track { background:var(--ex-bg2); border-radius:0; }
.ex-settings-body::-webkit-scrollbar-thumb, .ex-settings-nav::-webkit-scrollbar-thumb { background:var(--ex-border2); border-radius:0; }
.ex-settings-body::-webkit-scrollbar-thumb:hover, .ex-settings-nav::-webkit-scrollbar-thumb:hover { background:var(--ex-accent); }
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
        <div class="ex-sidebar-search">
          <input data-ex="convsearch" type="text" placeholder="搜索会话…" />
        </div>
        <div class="ex-conv-list" data-ex="convlist"></div>
        <!-- 设置入口：侧边栏右下角（参考 rikka 列表底部设置） -->
        <button class="ex-sidebar-settings" data-ex="sidebar-settings">设置</button>
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
        <div class="ex-status" data-ex="status"></div>
        <!-- 输入区（Rikka ChatInput：容器 + 输入框在上 + 工具行在下） -->
        <div class="ex-input-area">
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
            <button class="ex-send-btn" data-ex="send" disabled>发送</button>
            <button class="ex-send-btn ex-stop-btn" data-ex="stop" style="display:none;">中止</button>
          </div>
        </div>
      </main>
      <!-- 右侧边栏（APITOOL right-sidebar 复刻：统计/信息，打开放更多菜单） -->
      <aside class="ex-right-sidebar hidden" data-ex="right-sidebar">
        <div class="ex-right-sidebar-header"><h2>会话详情</h2></div>
        <div class="ex-right-sidebar-content">
          <!-- APITOOL 分支树占位（功能未实装，仅视觉展示） -->
          <div class="ex-right-branch">消息分支（开发中）</div>
          <button type="button" class="ex-right-link" data-ex="branch-graph">查看分支图谱</button>
          <!-- 信息卡（保留） -->
          <div class="ex-right-stats" data-ex="right-stats">
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">插件</span><span class="ex-right-stats-value" data-ex="stat-plugins">-</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">工具</span><span class="ex-right-stats-value" data-ex="stat-tools">-</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">服务商</span><span class="ex-right-stats-value" data-ex="stat-providers">-</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">配置分节</span><span class="ex-right-stats-value" data-ex="stat-configs">-</span></div>
          </div>
          <!-- APITOOL 底部统计卡占位（功能未实装，仅视觉展示） -->
          <div class="ex-right-stats" style="margin-top:12px;">
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">本场计费</span><span class="ex-right-stats-value">–</span></div>
            <div class="ex-right-stats-divider"></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">账户余额</span><span class="ex-right-stats-value">–</span></div>
            <div class="ex-right-stats-divider"></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">请求数</span><span class="ex-right-stats-value">0</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">对话 token</span><span class="ex-right-stats-value">0</span></div>
            <div class="ex-right-stats-divider"></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">本次输入</span><span class="ex-right-stats-value">–</span></div>
            <div class="ex-right-stats-row"><span class="ex-right-stats-label">本次输出</span><span class="ex-right-stats-value">–</span></div>
          </div>
        </div>
      </aside>
      <div class="ex-right-mask" data-ex="right-mask"></div>
    </div>
    <!-- 更多菜单（侧栏开关；设置入口已在侧边栏右下角，不再重复） -->
    <div class="ex-more-menu" data-ex="more-menu">
      <button type="button" class="ex-more-item" data-ex="more-sidebar">侧栏</button>
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
                  <div class="ex-theme-dot soviet" data-ex-theme="soviet" title="Soviet"></div>
                  <div class="ex-theme-dot cyber" data-ex-theme="cyber" title="Cyber"></div>
                </div>
              </div>
              <div class="ex-hint">当前版本仅内置 Exdark 主题，其余为视觉占位。</div>
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
                  <span class="ex-logrange"><button type="button" class="ex-top-btn active">7天</button></span>
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
  const stopEl = container.querySelector('[data-ex="stop"]') as HTMLButtonElement;
  const statusEl = container.querySelector('[data-ex="status"]') as HTMLElement;
  const webSearchEl = container.querySelector('[data-ex="websearch"]') as HTMLInputElement;
  const webSearchBtn = container.querySelector('[data-ex="websearch-btn"]') as HTMLButtonElement;
  const newChatBtn = container.querySelector('[data-ex="newchat"]') as HTMLButtonElement;
  const sidebarSettingsBtn = container.querySelector('[data-ex="sidebar-settings"]') as HTMLButtonElement;
  const moreDot = container.querySelector('[data-ex="more-dot"]') as HTMLElement;
  const branchGraphBtn = container.querySelector('[data-ex="branch-graph"]') as HTMLButtonElement;
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
  const logRefreshBtn = container.querySelector('[data-ex="logRefresh"]') as HTMLButtonElement;
  const logClearBtn = container.querySelector('[data-ex="logClear"]') as HTMLButtonElement;
  const logCopyBtn = container.querySelector('[data-ex="logCopy"]') as HTMLButtonElement;
  const logExportBtn = container.querySelector('[data-ex="logExport"]') as HTMLButtonElement;
  const logExpandBtn = container.querySelector('[data-ex="logExpand"]') as HTMLButtonElement;
  const logView = container.querySelector('[data-ex="logView"]') as HTMLElement;
  /** 运行记录日志范围：固定保留最近 7 天（logger 轮转上限），无切换 */
  const logRange: LogRange = 'all';
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

  /** 渲染右侧边栏统计（插件/工具/服务商/配置分节数） */
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
  }

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

  /** 单张插件卡片（状态徽标 + 权限行 + 就地展开；与 kernel-gui 功能开关页统一） */
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
  function initParallax(svg: SVGSVGElement): () => void {
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
    const count = 26;
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
    const tick = (t: number): void => {
      const dt = Math.min((t - t0) / 1000, 0.05);
      t0 = t;
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
      const count = s.node && Array.isArray(s.node.messages) ? s.node.messages.length : 0;
      const time = new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric' });
      // 平铺：无 hover 按钮（▲/× 已删），长按弹二级菜单（置顶/分享/管理/删除/重新生成标题）
      item.innerHTML = `
        <div class="ex-conv-title">${esc(s.title || '新对话')}</div>
        <div class="ex-conv-info"><span>${count} 条</span><span>${esc(time)}</span></div>
      `;
      convList.appendChild(item);
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
  function updateSendState(): void {
    sendEl.disabled = !inputEl.value.trim();
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
  const controller = createChatController(ctx, {
    messages: messagesEl,
    input: inputEl,
    send: sendEl,
    stop: stopEl,
    status: statusEl,
    webSearch: webSearchEl,
    // 对话超 100k 字符：右上角确认 toast（带"确定发送"按钮），点确定后放行
    onLengthWarn: (count, confirm) => {
      confirmOversize(count, confirm);
    },
    renderMessage: (role: 'user' | 'ai', parts: UIMessagePart[], message?: Message): HTMLElement => {
      const bubble = document.createElement('div');
      bubble.className = `ex-message ex-${role}`;
      const text = parts.map((p) => (p.type === 'text' ? p.text : '[图片]')).join('\n');

      // meta 区：角色标识 + 时间戳 + 复制（AI 另加重发）
      const meta = document.createElement('div');
      meta.className = 'ex-msg-meta';
      const roleLabel = document.createElement('span');
      roleLabel.className = 'ex-msg-role';
      roleLabel.textContent = role === 'user' ? '你' : 'AI';
      const timeLabel = document.createElement('span');
      timeLabel.className = 'ex-msg-time';
      timeLabel.textContent = new Date(message?.createdAt ?? Date.now()).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ex-msg-btn';
      copyBtn.textContent = '复制';
      copyBtn.title = '复制内容';
      copyBtn.addEventListener('click', () => {
        copyToClipboard(content.textContent || text);
        copyBtn.textContent = '已复制';
        copyBtn.classList.add('copied');
        window.setTimeout(() => {
          copyBtn.textContent = '复制';
          copyBtn.classList.remove('copied');
        }, 1200);
      });
      meta.append(roleLabel, timeLabel, copyBtn);
      if (role === 'ai') {
        const regenBtn = document.createElement('button');
        regenBtn.className = 'ex-msg-btn';
        regenBtn.textContent = '重发';
        regenBtn.title = '重新生成此回复';
        regenBtn.addEventListener('click', () => {
          controller.regenerate();
        });
        meta.appendChild(regenBtn);
      }

      // 内容区：完整消息直接渲染 Markdown；流式空气泡等 onStreamEnd 收尾再渲染
      const content = document.createElement('div');
      content.className = 'ex-msg-content';
      content.setAttribute('data-msg-content', '');
      content.innerHTML = text ? renderMarkdown(text) : '';

      bubble.append(meta, content);
      lastAiBubble = bubble;
      return bubble;
    },
    onRequireSettings: () => openSettings(),
    onSessionChange: (id) => {
      void renderSessionList(id);
      void updateTopbarTitle(id);
    },
    onStreamEnd: () => {
      if (lastAiBubble && lastAiBubble.isConnected) {
        const c = lastAiBubble.querySelector('[data-msg-content]') as HTMLElement | null;
        if (c) c.innerHTML = c.textContent ? renderMarkdown(c.textContent) : '';
      }
    },
  });

  logger.info('gui', 'Exdark 主题 GUI 已挂载');

  // ---- 生命周期 ----
  ctx.effect(() => {
    const stopParallax = initParallax(parallaxSvg);
    updateModelStatus();
    resetInputUI();

    // 发送 / 中止 / Enter（中文输入法组合态回车不发送）
    sendEl.addEventListener('click', () => {
      controller.send();
      window.setTimeout(resetInputUI, 0);
    });
    stopEl.addEventListener('click', controller.stop);
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
    const deepThinkBtn = container.querySelector('[data-ex="deepthink"]') as HTMLButtonElement;
    const thinkPop = container.querySelector('[data-ex="think-pop"]') as HTMLElement | null;
    const thinkSlider = container.querySelector('[data-ex="think-slider"]') as HTMLInputElement | null;
    const thinkValueEl = container.querySelector('[data-ex="think-value"]') as HTMLElement | null;
    // 强度档位：0=不思考 1=自动 2=低 3=中 4=高 5=最大（6 档对应刻度 6 个字）
    let thinkLevel = 1; // 默认自动
    const THINK_LABELS = ['不思考', '自动', '低', '中', '高', '最大'];
    const updateThinkLabel = (): void => {
      deepThinkBtn.textContent = thinkLevel === 0 ? 'Think' : `Think: ${THINK_LABELS[thinkLevel]}`;
      deepThinkBtn.classList.toggle('on', thinkLevel > 0);
    };
    updateThinkLabel();
    deepThinkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!thinkPop || !thinkSlider) return;
      // rikka 式底部面板：位置由 CSS（bottom 固定）决定，无需 top/left 计算
      thinkSlider.value = String(thinkLevel);
      if (thinkValueEl) thinkValueEl.textContent = THINK_LABELS[thinkLevel];
      thinkPop.classList.add('show');
    });
    thinkSlider?.addEventListener('input', () => {
      thinkLevel = Number(thinkSlider.value);
      if (thinkValueEl) thinkValueEl.textContent = THINK_LABELS[thinkLevel];
    });
    thinkSlider?.addEventListener('change', () => {
      thinkLevel = Number(thinkSlider.value);
      updateThinkLabel();
      thinkPop?.classList.remove('show');
      showToast(thinkLevel === 0 ? '思考已关闭' : thinkLevel === 1 ? '思考：自动' : `思考强度：${THINK_LABELS[thinkLevel]}`);
    });
    // 点击别处关闭思考弹层
    container.addEventListener('click', (e) => {
      if (thinkPop && thinkPop.classList.contains('show') && !thinkPop.contains(e.target as Node) && e.target !== deepThinkBtn) {
        thinkPop.classList.remove('show');
      }
    });

    // 功能工具栏：上传文件（显示文件名占位）
    const fileInput = container.querySelector('[data-ex="file"]') as HTMLInputElement;
    const fileIndicator = container.querySelector('[data-ex="file-indicator"]') as HTMLElement;
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        fileIndicator.textContent = [...fileInput.files].map((f) => f.name).join(', ');
        showToast(`已选择 ${fileInput.files.length} 个文件（上传功能开发中）`);
      }
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
              .map(
                (m) =>
                  `<button type="button" class="ex-model-item${m === cur ? ' active' : ''}" data-ex-model="${esc(m)}">${esc(m)}</button>`,
              )
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
    // 更多菜单：右侧边栏开关（APITOOL：右侧栏打开放更多里）
    moreSidebarBtn.addEventListener('click', () => {
      moreMenu.classList.remove('show');
      rightSidebar.classList.toggle('hidden');
      rightMask.classList.toggle('show', !rightSidebar.classList.contains('hidden'));
      void renderRightStats();
    });
    // 右侧边栏遮罩点外关闭
    rightMask.addEventListener('click', () => {
      rightSidebar.classList.add('hidden');
      rightMask.classList.remove('show');
    });

    // 会话列表：点击切换 + 长按二级菜单（置顶/分享/管理/删除/重新生成标题）
    convList.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('[data-ex-switch]') as HTMLElement | null;
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
    convList.addEventListener('pointerdown', (e) => {
      const item = (e.target as HTMLElement).closest('[data-ex-switch]') as HTMLElement | null;
      if (!item?.dataset.exSwitch) return;
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
        void ctx.storage.getConversation(id).then((s) => {
          const title = s?.title ?? 'KIRUSRAFT 会话';
          void navigator.clipboard.writeText(title).then(() => showToast('已复制会话标题')).catch(() => showToast('分享功能开发中'));
        });
      } else if (action === 'manage') {
        showToast('功能开发中：管理会话');
      } else if (action === 'delete') {
        if (window.confirm('确定删除该会话？')) {
          void ctx.storage.deleteConversation(id).then(() => {
            ctx.emit('session-deleted', id);
            void renderSessionList(controller.getSessionId());
            void updateTopbarTitle(controller.getSessionId());
          });
        }
      } else if (action === 'rename') {
        showToast('功能开发中：重新生成标题');
      }
    });
    // 点击别处关闭菜单
    container.addEventListener('click', (e) => {
      if (convMenu && !convMenu.contains(e.target as Node)) closeConvMenu();
    });

    // 插件管理入口：在设置弹窗左侧导航（唯一入口，不放在更多菜单）
    // 侧边栏底部：设置入口（参考 rikka 列表底部）
    sidebarSettingsBtn.addEventListener('click', () => openSettings());
    // 右侧栏：查看分支图谱（占位）
    branchGraphBtn.addEventListener('click', () => showToast('功能开发中：分支图谱'));

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
    // 帧率滑块（档位语义：滑块 0-3 映射 15/30/60/120 FPS，默认 60）
    const FPS_TIERS = [15, 30, 60, 120] as const;
    const fpsSlider = container.querySelector('[data-ex="fpsSlider"]') as HTMLInputElement | null;
    const fpsValueEl = container.querySelector('[data-ex="fpsValue"]') as HTMLElement | null;
    fpsSlider?.addEventListener('input', () => {
      const fps = FPS_TIERS[Number(fpsSlider.value)] ?? 60;
      if (fpsValueEl) fpsValueEl.textContent = String(fps);
      showToast(`功能开发中：帧率 ${fps} FPS`);
    });
    // 视差层数滑块（占位：仅更新数值显示）
    parallaxSlider.addEventListener('input', () => {
      parallaxValueEl.textContent = parallaxSlider.value;
    });
    // 对话 Temperature 滑块（占位：仅更新数值显示）
    const convTempSlider = container.querySelector('[data-ex="convTemp"]') as HTMLInputElement | null;
    const convTempValueEl = container.querySelector('[data-ex="convTempValue"]') as HTMLElement | null;
    convTempSlider?.addEventListener('input', () => {
      if (convTempValueEl) convTempValueEl.textContent = Number(convTempSlider.value).toFixed(1);
    });
    // 主题点（占位：仅 Exdark 可选）
    settingsBody.addEventListener('click', (e) => {
      const dot = (e.target as HTMLElement).closest('[data-ex-theme]') as HTMLElement | null;
      if (!dot) return;
      const theme = dot.dataset.exTheme;
      if (theme !== 'exdark') {
        showToast('功能开发中：仅内置 Exdark 主题');
        return;
      }
      settingsBody.querySelectorAll('.ex-theme-dot').forEach((n) => n.classList.remove('selected'));
      dot.classList.add('selected');
    });
    // 计费同步汇率（占位）
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
    // 导出 / 导入存档（占位）
    exportDataBtn.addEventListener('click', () => showToast('功能开发中：导出存档'));
    importDataBtn.addEventListener('click', () => showToast('功能开发中：导入存档'));
    // 危险重置（占位：仅确认提示，不动数据层）
    resetAppBtn.addEventListener('click', () => {
      if (window.confirm('确定重置所有数据？当前为占位，不会真正清空数据。')) {
        showToast('功能开发中：重置所有数据');
      }
    });
    // 取消 / 保存（占位）
    settingsCancelBtn.addEventListener('click', closeSettings);
    settingsSaveBtn.addEventListener('click', () => showToast('功能开发中：保存设置'));

    // 运行记录（日志）：展开/收起（展开时自动刷新）/ 刷新 / 复制 / 导出 / 清空
    logExpandBtn.addEventListener('click', toggleLogView);
    logRefreshBtn.addEventListener('click', renderLogView);
    logClearBtn.addEventListener('click', () => {
      logger.clear();
      renderLogView();
    });
    logCopyBtn.addEventListener('click', () => {
      void logger.copy(logRange).then((ok) => {
        showToast(ok ? '已复制最近 7 天日志到剪贴板' : '复制失败，请用导出下载文件');
      });
    });
    logExportBtn.addEventListener('click', () => {
      logger.download(logRange);
      showToast('已导出最近 7 天日志文件');
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

    // 空态引导：messages 无气泡时显示（监听子节点增删）
    const guideObserver = new MutationObserver(() => {
      const hasMsg = messagesEl.querySelector(':scope > .ex-message') !== null;
      emptyGuide.classList.toggle('hidden', hasMsg);
    });
    guideObserver.observe(messagesEl, { childList: true });

    // 初次渲染会话列表
    void renderSessionList(controller.getSessionId());

    return () => {
      stopParallax();
      offModel();
      guideObserver.disconnect();
      document.removeEventListener('click', closeMoreMenu);
      controller.dispose();
      container.remove();
    };
  });
}
