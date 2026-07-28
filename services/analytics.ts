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

/** Umami：无 cookie、匿名、轻量（~2KB），符合隐私要求，不用弹 cookie 提示 */
export function initAnalytics(): void {
  const websiteId = env('VITE_UMAMI_WEBSITE_ID');
  if (!websiteId || document.querySelector('script[data-website-id]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  s.src = env('VITE_UMAMI_SRC') || 'https://cloud.umami.is/script.js';
  s.setAttribute('data-website-id', websiteId);
  document.head.appendChild(s);
}

/** 自定义事件埋点（Umami 未启用时静默忽略） */
export function trackEvent(name: string, data?: Record<string, string | number>): void {
  try {
    (window as any).umami?.track?.(name, data);
  } catch { /* 忽略 */ }
}

/** Tawk.to 聊天挂件：右下角气泡，用户可实时找到你；离线自动转留言，手机 App 可收消息 */
export function initChatWidget(): void {
  const propertyId = env('VITE_TAWK_PROPERTY_ID');
  if (!propertyId || (window as any).Tawk_API) return;
  const widgetId = env('VITE_TAWK_WIDGET_ID') || 'default';
  (window as any).Tawk_API = (window as any).Tawk_API || {};
  (window as any).Tawk_LoadStart = new Date();
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://embed.tawk.to/${propertyId}/${widgetId}`;
  s.charset = 'UTF-8';
  s.setAttribute('crossorigin', '*');
  document.head.appendChild(s);
}

/** 登录后把用户名同步给聊天挂件，方便你知道在跟谁说话 */
export function identifyChatUser(name: string, email?: string): void {
  try {
    const api = (window as any).Tawk_API;
    api?.setAttributes?.({ name, email: email || '' }, () => {});
  } catch { /* 忽略 */ }
}
