// 沙箱三页静态核对：HTML data-ex 元素 与 JS querySelector 绑定双向比对（v0.0.87）
import { readFileSync } from 'node:fs';
const src = readFileSync('src/plugins/theme-exdark.ts', 'utf8');

// 提取沙箱管理区块（从 <!-- 沙箱管理三页 到 删除确认对话框 结束）
const start = src.indexOf('<!-- 沙箱管理三页');
const end = src.indexOf('<!-- 会话长按二级菜单');
if (start < 0 || end < 0) { console.log('FAIL: 沙箱区块边界未找到'); process.exit(1); }
const block = src.slice(start, end);
const html = block.slice(0, block.indexOf('</div>\n    <div class="ex-toast-container'));

// HTML 中的 data-ex 属性
const htmlAttrs = new Set();
for (const m of html.matchAll(/data-ex="([^"]+)"/g)) htmlAttrs.add(m[1]);

// 沙箱 JS 函数范围（initSandboxManage 到 parseSandboxList 结束）
const jsStart = src.indexOf('function initSandboxManage');
const jsEnd = src.indexOf('function renderCapabilityTools');
const js = src.slice(jsStart, jsEnd);

// JS 中引用的 data-ex
const jsRefs = new Set();
for (const m of js.matchAll(/querySelector(?:All)?\(['"](?:[^'"]*data-ex[^'"]*)['"]\)/g)) {
  for (const a of m[0].matchAll(/data-ex="([^"]+)"/g)) jsRefs.add(a[1]);
}
for (const m of js.matchAll(/(?:data-ex\^=|data-ex=)["']([^"']+)["']/g)) jsRefs.add(m[1]);

// 旧选择器不应再出现在沙箱 JS（已迁移到三页）
const legacy = ['sandbox-shell-input', 'sandbox-shell-run', 'sandbox-shell-out', 'sandbox-manage-head', 'sandbox-manage-body', 'ex-sandbox-file-row'];
const legacyHits = legacy.filter((s) => js.includes(s));

const missingJsRefs = [...jsRefs].filter((r) => !htmlAttrs.has(r));
const unusedHtml = [...htmlAttrs].filter((r) => !jsRefs.has(r));
// 合理误报排除：container 级（sandboxManage/toast 在设置页主体）、动态生成模板（ws-menu/ws-rename/ws-delete/fileview-*）、前缀匹配（sb-key-* 走 [data-ex^=]）
const dynamic = ['sandboxManage', 'toast', 'ws-menu', 'ws-rename', 'ws-delete', 'sb-key-', 'sandbox-fileview-text', 'sandbox-fileview-save', 'sandbox-fileview-status', 'sandbox-fileview-export'];
const realMissing = missingJsRefs.filter((r) => !dynamic.includes(r));
const realUnused = unusedHtml.filter((r) => !r.startsWith('sb-key-'));

console.log('HTML data-ex 数量:', htmlAttrs.size);
console.log('JS 引用数量:', jsRefs.size);
console.log('JS 引用但 HTML 缺失:', realMissing.length ? realMissing : '无');
console.log('HTML 存在但 JS 未引用:', realUnused.length ? realUnused : '无');
console.log('旧选择器残留:', legacyHits.length ? legacyHits : '无');

// 关键导航结构
const pages = ['sb-page-list', 'sb-page-detail', 'sb-page-term'].map((p) => `${p}:${htmlAttrs.has(p) ? 'OK' : 'MISSING'}`);
console.log('三页结构:', pages.join(' '));
const keyBtns = ['sb-add', 'sb-terminal', 'sb-refresh', 'sb-tab-basic-btn', 'sb-tab-files-btn', 'sb-seg-files', 'sb-seg-rootfs', 'sb-path-up', 'sb-rootfs-install', 'sb-term-run', 'sb-name-ok', 'sb-del-ok'].map((b) => `${b}:${htmlAttrs.has(b) ? 'OK' : 'MISSING'}`);
console.log('关键按钮:', keyBtns.join(' '));

const ok = realMissing.length === 0 && realUnused.length === 0 && legacyHits.length === 0;
console.log(ok ? 'STATIC_CHECK_PASS' : 'STATIC_CHECK_FAIL');
process.exit(ok ? 0 : 1);
