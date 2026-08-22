import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kirusi.kirusraft',
  appName: 'KIRUSRAFT',
  webDir: 'www',
  // 版本号：三段式 X.Y.Z，只迭代第二小数点后数字。升版本用 scripts/bump-version.cjs 统一改，勿手改
  version: '0.0.92'
};

export default config;
