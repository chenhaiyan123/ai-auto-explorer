import IOSWelcome from './components/IOSWelcome';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MobileInbox from './components/MobileInbox';
import ErrorBoundary from './components/ErrorBoundary';
import { initAnalytics, initChatWidget } from './services/analytics';
import { isNative, platform, initNative } from './services/native';
import { recordVisit } from './services/funnel';

// 流量统计 + 用户聊天挂件（未配置环境变量时不会加载任何东西）
if (!isNative()) { initAnalytics(); initChatWidget(); }
if (isNative()) { document.documentElement.dataset.native = platform(); void initNative(); }
// 留存与漏斗：算「第二天/第七天还回来吗」，并记下漏斗第一级
recordVisit();

/**
 * 入口路由：`#/m` 进手机端「现实反馈」App；装成 PWA 后在窄屏上默认也进这里。
 *
 * 为什么在这里分叉而不是在 App 里判断：App 里有大量 hook，
 * 在它内部提前 return 会踩 hook 顺序；在挂载前分开最干净，
 * 手机端也就不用把桌面版那一大坨状态全初始化一遍。
 */
const Root: React.FC = () => {
  const [intro, setIntro] = React.useState(() => platform() === 'ios' && localStorage.getItem('hiexplore-ios-welcome') !== '1');
  const [hash, setHash] = React.useState(() => window.location.hash);
  React.useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  if (intro) return <IOSWelcome onContinue={() => { localStorage.setItem('hiexplore-ios-welcome', '1'); setIntro(false); }} />;
  // iOS opens the full research workspace. Preserve the existing Android/PWA inbox route.
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
    || (window.navigator as any).standalone === true;
  const mobile = platform() === 'android' || (!isNative() && (hash.startsWith('#/m') || (standalone && window.innerWidth < 768)));

  if (mobile) {
    // 原生 App 里不给"去桌面版"的出口：那边在手机上根本没法用
    return <MobileInbox onExit={isNative() ? undefined : () => { window.location.hash = ''; }} />;
  }
  return <App />;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);

// PWA：注册 Service Worker（只为「装到主屏 + 断网能打开」，不缓存任何 API 请求，见 public/sw.js）
if (!isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[PWA] SW 注册失败', e));
  });
}
