/**
 * 原生壳适配层。
 *
 * 同一套代码要跑在三个地方：浏览器、PWA（添加到主屏）、Capacitor 原生 App。
 * 这个文件把「只有原生壳里才有」的能力收在一处，其余代码不用到处判断环境。
 *
 * 所有 Capacitor 插件都用**动态 import + try/catch**，浏览器里插件不存在也不会炸——
 * 这样 web 构建不需要装任何原生依赖，dist 也不会变大。
 */

type AnyFn = (...a: any[]) => any;

/** 是否跑在 Capacitor 原生壳里（Android / iOS App） */
export function isNative(): boolean {
  try {
    const cap = (window as any).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** 'android' | 'ios' | 'web' */
export function platform(): string {
  try {
    return (window as any).Capacitor?.getPlatform?.() || 'web';
  } catch {
    return 'web';
  }
}

/** 是否以独立应用形态运行（原生壳，或"添加到主屏"后的 PWA） */
export function isStandalone(): boolean {
  if (isNative()) return true;
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches
      || (window.navigator as any).standalone === true;
  } catch {
    return false;
  }
}

const load = async (name: string): Promise<any | null> => {
  try {
    // @vite-ignore：这些包只在原生构建里存在，web 构建不应该因为解析不到就失败
    return await import(/* @vite-ignore */ name);
  } catch {
    return null;
  }
};

/**
 * 原生壳启动初始化：状态栏配色、收起启动图、安卓返回键。
 * 在浏览器里调用是空操作。
 */
export async function initNative(opts: { onBack?: () => boolean } = {}): Promise<void> {
  if (!isNative()) return;

  const sb = await load('@capacitor/status-bar');
  try {
    await sb?.StatusBar?.setStyle?.({ style: 'DARK' });
    if (platform() === 'android') await sb?.StatusBar?.setBackgroundColor?.({ color: '#0f172a' });
  } catch { /* 某些机型不支持，忽略 */ }

  const splash = await load('@capacitor/splash-screen');
  try { await splash?.SplashScreen?.hide?.(); } catch { /* 忽略 */ }

  // 安卓物理返回键：交给页面自己决定；页面说"我处理了"就不退出，
  // 否则再按一次才退出——直接退出会让人一不小心就把 App 关掉。
  const appPlugin = await load('@capacitor/app');
  if (appPlugin?.App && platform() === 'android') {
    let lastBack = 0;
    appPlugin.App.addListener('backButton', () => {
      if (opts.onBack?.()) return;
      const now = Date.now();
      if (now - lastBack < 2000) {
        appPlugin.App.exitApp();
      } else {
        lastBack = now;
        toast('再按一次退出');
      }
    });
  }
}

/** 轻提示。原生壳用系统 Toast，浏览器里退化成一个自绘的小条 */
export async function toast(message: string): Promise<void> {
  const t = await load('@capacitor/toast');
  if (t?.Toast) {
    try { await t.Toast.show({ text: message, duration: 'short' }); return; } catch { /* 落到下面 */ }
  }
  try {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9999;'
      + 'background:#1e293b;color:#e2e8f0;padding:8px 14px;border-radius:999px;font-size:13px;'
      + 'border:1px solid #334155;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  } catch { /* 忽略 */ }
}

/** 触感反馈：回填提交这种"确定性动作"给一下震动，手机上体感差别很大 */
export async function haptic(kind: 'light' | 'medium' = 'light'): Promise<void> {
  const h = await load('@capacitor/haptics');
  try {
    await h?.Haptics?.impact?.({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
  } catch { /* 忽略 */ }
}

/**
 * 申请推送权限并拿到设备 token。
 *
 * ⚠️ 只做到"拿到 token"为止。真正的推送还需要：
 * - Android：Firebase 项目 + google-services.json（国内可换成厂商推送通道）
 * - iOS：Apple 开发者账号 + APNs 证书
 * - 服务端：存 token + 在路标到点时发推送
 * 这三样都还没有，所以现在调用它只会返回 null，不会假装成功。
 */
export async function registerPush(onToken: (token: string) => void): Promise<boolean> {
  if (!isNative()) return false;
  const pn = await load('@capacitor/push-notifications');
  if (!pn?.PushNotifications) return false;
  try {
    const perm = await pn.PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return false;
    pn.PushNotifications.addListener('registration', (t: any) => onToken(t?.value || ''));
    await pn.PushNotifications.register();
    return true;
  } catch {
    return false;
  }
}

/** 给 App 图标打角标（待办数）。iOS 需要通知权限；安卓看桌面启动器是否支持 */
export async function setBadge(count: number): Promise<void> {
  if (!isNative()) return;
  const b = await load('@capacitor/badge');
  try {
    if (count > 0) await b?.Badge?.set?.({ count });
    else await b?.Badge?.clear?.();
  } catch { /* 忽略 */ }
}

export type { AnyFn };
