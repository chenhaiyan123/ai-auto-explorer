/**
 * 网站流量统计（Umami）+ 用户连接渠道（Tawk.to 聊天挂件）
 * 全部由环境变量开关：不配置则完全不加载，零影响。
 *
 * 需要的环境变量（本地 .env.local / GitHub 仓库 Variables）：
 * - VITE_UMAMI_WEBSITE_ID  Umami 网站 ID（必填才启用统计）
 * - VITE_UMAMI_SRC         Umami 脚本地址，默认 Umami Cloud
 * - VITE_TAWK_PROPERTY_ID  Tawk.to Property ID（必填才启用聊天）
 * - VITE_TAWK_WIDGET_ID    Tawk.to Widget ID，默认 'default'
 *
 * 接入步骤见 docs/接入流量统计与用户聊天.md
 */

const env = (k: string): string => ((import.meta as any).env?.[k] || '').trim();

/**
 * 是否不统计本机。
 * 开发机（localhost）自动排除；线上访问一次 `?notrack=1` 就把自己永久排除。
 * 自己开发时每天开十几次页面，会把本来就只有几十的分母冲得没法看。
 * （实现放在这里而不是 funnel.ts，是为了让 initAnalytics 不依赖 funnel 模块。）
 */
function noTrack(): boolean {
  try {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return true;
    if (new URLSearchParams(location.search).get('notrack') === '1') {
      localStorage.setItem('hiexplore_no_track', '1');
    }
    return localStorage.getItem('hiexplore_no_track') === '1';
  } catch {
    return false;
  }
}

/** Umami：无 cookie、匿名、轻量（~2KB），符合隐私要求，不用弹 cookie 提示 */
export function initAnalytics(): void {
  const websiteId = env('VITE_UMAMI_WEBSITE_ID');
  if (!websiteId || noTrack() || document.querySelector('script[data-website-id]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  s.src = env('VITE_UMAMI_SRC') || 'https://cloud.umami.is/script.js';
  s.setAttribute('data-website-id', websiteId);
  document.head.appendChild(s);
}

/** 自定义事件埋点（Umami 未启用、或本机已排除时静默忽略） */
export function trackEvent(name: string, data?: Record<string, string | number>): void {
  try {
    if (noTrack()) return;
    (window as any).umami?.track?.(name, data);
  } catch { /* 忽略 */ }
}

/** 是否配置了聊天挂件（没配就整个功能不存在，界面上也不出现按钮） */
export const isChatEnabled = (): boolean => !!env('VITE_TAWK_PROPERTY_ID');

/**
 * Tawk.to 聊天挂件。
 *
 * 这里刻意**把 Tawk 自带的气泡藏起来**，改由我们自己的 <ChatLauncher> 当入口。
 * 原因：Tawk 的气泡是固定在右下角的 iframe，位置写死、也没有关闭按钮，
 * 会长期压住界面右下角的内容，用户既挪不走也关不掉。
 * 自己做一个按钮就能既可拖动、又可关闭，点它再调 maximize() 打开真正的聊天窗。
 */
export function initChatWidget(): void {
  const propertyId = env('VITE_TAWK_PROPERTY_ID');
  if (!propertyId || (window as any).Tawk_API?.__hiexplore) return;
  const widgetId = env('VITE_TAWK_WIDGET_ID') || 'default';
  const api = (window as any).Tawk_API || {};
  api.__hiexplore = true;
  // 加载完先藏起来；聊天窗关掉后也藏回去，桌面上只留我们自己的按钮
  api.onLoad = () => { try { (window as any).Tawk_API?.hideWidget?.(); } catch { /* 忽略 */ } };
  api.onChatMinimized = () => { try { (window as any).Tawk_API?.hideWidget?.(); } catch { /* 忽略 */ } };
  api.onChatWindowClosed = () => { try { (window as any).Tawk_API?.hideWidget?.(); } catch { /* 忽略 */ } };
  (window as any).Tawk_API = api;
  (window as any).Tawk_LoadStart = new Date();
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://embed.tawk.to/${propertyId}/${widgetId}`;
  s.charset = 'UTF-8';
  s.setAttribute('crossorigin', '*');
  document.head.appendChild(s);
}

/** 打开聊天窗（由我们自己的按钮触发）。返回 false 表示挂件还没加载好。 */
export function openChat(): boolean {
  try {
    const api = (window as any).Tawk_API;
    if (!api?.maximize) return false;
    api.showWidget?.();
    api.maximize();
    return true;
  } catch {
    return false;
  }
}

// ---- 客服按钮的显示状态（关掉之后能在设置里找回来）----
const CHAT_HIDDEN_KEY = 'hiexplore_chat_hidden';

export const isChatDismissed = (): boolean => {
  try { return localStorage.getItem(CHAT_HIDDEN_KEY) === '1'; } catch { return false; }
};

export function setChatDismissed(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(CHAT_HIDDEN_KEY, '1');
    else localStorage.removeItem(CHAT_HIDDEN_KEY);
    window.dispatchEvent(new CustomEvent('chat-visibility'));
  } catch { /* 忽略 */ }
}

/** 登录后把用户名同步给聊天挂件，方便你知道在跟谁说话 */
export function identifyChatUser(name: string, email?: string): void {
  try {
    const api = (window as any).Tawk_API;
    api?.setAttributes?.({ name, email: email || '' }, () => {});
  } catch { /* 忽略 */ }
}
