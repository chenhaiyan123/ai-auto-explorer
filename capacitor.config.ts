import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置：把 dist/ 打包进原生壳，出 Android APK / iOS IPA。
 *
 * 几个刻意的取舍：
 *
 * 1. **webDir 指向 dist，不用 server.url 指远程站点**。
 *    打包本地资源意味着：冷启动没有白屏、断网也能打开、审核方看得到实际内容。
 *    （远程加载虽然能热更新，但 App Store 对"壳套网页"审得很严，容易被拒。）
 *
 * 2. **androidScheme 用 https**。Capacitor 在 Android 上默认 http://localhost，
 *    那样 localStorage 会和 https 站点隔离，而且部分 API 需要安全上下文。
 *
 * 3. **允许明文 HTTP**（见 android/app/src/main/res/xml/network_security_config.xml，
 *    由 `npx cap add android` 后按文档手动加）。这是原生壳相对 PWA 的关键增量：
 *    托管版是 https 页面，浏览器混合内容拦截让它连不上 `http://192.168.x.x` 的实验设备；
 *    原生壳没有这个限制，手机可以直连局域网里的 IoT 设备。
 */
const config: CapacitorConfig = {
  appId: 'com.hiexplore.app',
  appName: 'HiExplore 现实反馈',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    // 允许访问用户自己填的实验设备地址（局域网明文 HTTP）
    cleartext: true,
  },

  android: {
    // 键盘弹出时把输入框顶上来，回填表单不会被挡住
    adjustMarginsForEdgeToEdge: 'auto',
  },

  ios: {
    contentInset: 'always',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0f172a',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
    StatusBar: {
      style: 'DARK',            // 深色底 → 浅色图标
      backgroundColor: '#0f172a',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
