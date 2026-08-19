// KIRUSRAFT 版本号统一升级脚本
// 用法：node scripts/bump-version.cjs
// 只迭代第二小数点后数字（Z 位），同步更新三处：
//   1. src/core/version.ts 的 VERSION
//   2. android/app/build.gradle 的 versionCode(+1) / versionName
//   3. capacitor.config.ts 的 version
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8');
}
function write(p, content) {
  fs.writeFileSync(path.join(root, p), content, 'utf8');
}

// 1. 读当前版本（唯一来源）
const versionFile = 'src/core/version.ts';
const vContent = read(versionFile);
const m = vContent.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
if (!m) {
  console.error('无法解析 src/core/version.ts 的 VERSION');
  process.exit(1);
}
const newVersion = `${m[1]}.${m[2]}.${parseInt(m[3], 10) + 1}`;

// 2. 更新 version.ts
write(versionFile, vContent.replace(/VERSION = '[^']+'/, `VERSION = '${newVersion}'`));

// 3. 更新 build.gradle
const gradleFile = 'android/app/build.gradle';
let gradle = read(gradleFile);
const codeMatch = gradle.match(/versionCode (\d+)/);
if (!codeMatch) {
  console.error('无法解析 build.gradle 的 versionCode');
  process.exit(1);
}
const newCode = parseInt(codeMatch[1], 10) + 1;
gradle = gradle.replace(/versionCode \d+/, `versionCode ${newCode}`);
gradle = gradle.replace(/versionName "[^"]+"/, `versionName "${newVersion}"`);
write(gradleFile, gradle);

// 4. 更新 capacitor.config.ts
const capFile = 'capacitor.config.ts';
let cap = read(capFile);
cap = cap.replace(/version: '[^']+'/, `version: '${newVersion}'`);
write(capFile, cap);

console.log(`版本已升级：${m[0]} -> VERSION='${newVersion}'，versionCode=${newCode}`);
console.log('后续步骤：npm run build:web && npx cap sync android && 重新构建 APK');
