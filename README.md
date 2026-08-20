# KIRUSRAFT

插件化跨平台 AI 工作台（APITOOL 彻底重构版）。TypeScript 内核 + Cordis 4.0.1 插件系统 + Capacitor 8 Android 壳。

## 设计原则：全插件

- **内核薄**：内核只保留契约、模型、注册表（`src/core/`），一切能力经插件接入。
- **新能力 = 一个插件文件（含 manifest）+ `src/index.ts` 的 `PLUGINS` 数组加一行**，不改其他内核代码。
- **兜底 GUI（fallback-gui）属内核本体，不是插件**；主题（如 Exdark）才是 UI 插件。
- **插件统一插槽 = `PluginManifest`**（`src/core/manifest.ts`）：双语名/分组/依赖/服务声明/配置 schema/受保护/GUI 能力全部进 manifest，UI 直接读，无硬编码翻译表。
- Cordis 原生能力已激活：`inject` 依赖门控（依赖未就绪静默等待、服务出现自动装载）、`provide` 服务声明、`Config` 配置 schema 校验。详见 [docs/插件开发指南.md](docs/插件开发指南.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 内核 | TypeScript 7（esbuild 打包） |
| 插件系统 | @deepseek-ai/cordis 4.0.1 |
| 移动端壳 | Capacitor 8（Android WebView） |
| 构建 | esbuild + Gradle 8.14.3（JDK 21） |
| 测试 | Vitest 4 |

## 目录结构

```
src/
  index.ts            内核入口：bootstrap、PLUGINS 装配、GUI 仲裁
  core/               内核最小集（契约/模型/注册表/服务）
    manifest.ts       插件统一插槽（PluginManifest + toCordisPlugin）
    schema.ts         StandardSchemaV1 极简适配器（defineSchema）
    topology.ts       拓扑服务：插件状态机、受保护、启停、贴靠持久化
    tools.ts          工具注册表服务
    chat-controller.ts 会话控制器（消息/工具调用/审批）
    config.ts / storage.ts / db.ts / session.ts / logger.ts / gui-registry.ts
  plugins/            插件（每个文件含 manifest）
    core-services.ts  内核服务装配（受保护）
    fallback-gui.ts   兜底 GUI（属内核，受保护）
    theme-exdark.ts   Exdark 主题 GUI（ui-theme，providesGui）
    provider-deepseek.ts / tool-time.ts / update-checker.ts
  providers/          服务商实现
```

## 常用命令

```bash
npm run build                # esbuild 打包 web bundle -> www/kirusraft.js
npm test                     # vitest 全部测试（当前 30 个）
npx tsc --noEmit             # 类型检查
npm run serve                # 本地起静态服务预览 www/

# Android APK（用 Toolbox 便携 JDK/Gradle，勿用系统 gradlew 下载发行包）
node scripts/bump-version.cjs                  # 升版本（三处同步）
npx cap sync android                           # 同步 web 资源进 android 工程
gradle -p android assembleDebug --console=plain # 构建 debug APK（需 JAVA_HOME=jdk21）
```

## 版本管理

- 三段式 `X.Y.Z`，**每次更新只迭代 Z 位**（0.0.26 → 0.0.27）；X/Y 位只有用户明确指示才动。
- 版本号单一来源 `src/core/version.ts`；升版本一律用 `scripts/bump-version.cjs`（同步改 `android/app/build.gradle` 的 versionCode/versionName、`capacitor.config.ts` 的 version）。
- 交付物命名 `KIRUSRAFT-vX.Y.Z-debug.apk`，归档到 `KIRUSRAFT项目交付/`。

## 受保护插件（禁用会破坏内核/兜底，需二次确认）

`core-services`、`fallback-gui`、`update-checker` 等（受保护判定单一来源 = 各插件 manifest 的 `protected: true`，由 `topology.isProtected()` 读取，不再维护硬编码名单）。

## 开发插件

新增插件流程、PluginManifest 字段契约、inject/configSchema/provide 用法、健壮性约定，见 [docs/插件开发指南.md](docs/插件开发指南.md)。
