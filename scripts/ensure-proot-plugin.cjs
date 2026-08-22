/**
 * 确保 capacitor.plugins.json 包含 ProotPlugin 条目
 * cap sync 会覆盖此文件（只保留 package.json 依赖的插件），
 * 自定义插件 ProotPlugin 需要手动追加。
 * 用法：node scripts/ensure-proot-plugin.cjs
 */
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'capacitor.plugins.json');

let plugins;
try {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  plugins = JSON.parse(raw);
} catch {
  plugins = [];
}

const hasProot = plugins.some((p) => p.pkg === 'com.kirusi.kirusraft' || p.classpath === 'com.kirusi.kirusraft.ProotPlugin');
if (!hasProot) {
  plugins.push({ pkg: 'com.kirusi.kirusraft', classpath: 'com.kirusi.kirusraft.ProotPlugin' });
  fs.writeFileSync(jsonPath, JSON.stringify(plugins), 'utf8');
  console.log('[ensure-proot-plugin] 已追加 ProotPlugin 到 capacitor.plugins.json');
} else {
  console.log('[ensure-proot-plugin] ProotPlugin 已存在');
}