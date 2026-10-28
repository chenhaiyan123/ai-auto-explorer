
import { User } from '../types';

const AUTH_KEY = 'exploration_auth_session';
const TOKEN_KEY = 'aae-auth-token';
// 托管版后端地址；不配置则不启用真实登录（开源/本地版保持免登录）
const AUTH_API = ((import.meta as any).env?.VITE_AUTH_API || '').replace(/\/+$/, '');
export const hasAuthBackend = (): boolean => !!AUTH_API;

/**
 * 调登录服务：网络抖动 / 函数冷启动时浏览器只会报「Failed to fetch」，
 * 这里自动重试一次，并把错误换成人能看懂的话。
 */
async function authPost(path: string, body: unknown, retried = false): Promise<{ r: Response; d: any; retried: boolean }> {
  try {
    const r = await fetch(`${AUTH_API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) }); // 后端发信最多重试 3 次（约 20 秒），这里要等得更久
    const d = await r.json().catch(() => ({}));
    return { r, d, retried };
  } catch (e) {
    if (!retried) { await new Promise(res => setTimeout(res, 1500)); return authPost(path, body, true); }
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    throw new Error(local
      ? '连不上登录服务。本地开发地址可能不在登录服务允许的来源里（FC 的 ALLOW_ORIGIN 要加上 ' + location.origin + '），也可能是网络波动，过几秒再试。'
      : '连不上登录服务（网络波动或服务刚启动），已自动重试一次，请过几秒再点一下。');
  }
}

class AuthService {
  private currentUser: User | null = null;

  constructor() {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      this.currentUser = JSON.parse(saved);
    }
  }

  public loginWithEmail(email: string): User {
    const username = email.split('@')[0];
    this.currentUser = { username, role: 'user', email };
    this.save();
    return this.currentUser;
  }

  /** 免注册体验：游客身份进入（无令牌，后端按匿名设备给小额度） */
  public loginAsGuest(): User {
    this.currentUser = { username: '体验用户', role: 'user', email: '' };
    this.save();
    return this.currentUser;
  }

  // ===== 托管版：真实邮箱验证码登录（需配置 VITE_AUTH_API + 部署 auth-server） =====
  public async sendEmailCode(email: string): Promise<{ devCode?: string }> {
    const { r, d, retried } = await authPost('/auth/email/send-code', { email });
    // 第一次其实发出去了只是没收到回应，重试会撞上「60 秒内只能发一次」：当作已发送
    if (r.status === 429 && retried) return {};
    if (!r.ok) throw new Error(d.error || '发送失败');
    return d;
  }

  public async verifyEmailCode(email: string, code: string): Promise<User> {
    const { r, d } = await authPost('/auth/email/verify', { email, code });
    if (!r.ok) throw new Error(d.error || '验证失败');
    this.currentUser = { username: d.user.username, role: 'user', email: d.user.email };
    this.save();
    try { localStorage.setItem(TOKEN_KEY, d.token); } catch {}
    return this.currentUser;
  }

  private save() {
    localStorage.setItem(AUTH_KEY, JSON.stringify(this.currentUser));
  }

  public logout() {
    this.currentUser = null;
    localStorage.removeItem(AUTH_KEY);
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    // 移除导致 404 的页面刷新逻辑，改由 App.tsx 的状态控制直接回到登录页
  }

  public getUser(): User | null {
    return this.currentUser;
  }

  public isAdmin(): boolean {
    return this.currentUser?.role === 'admin';
  }
}

export const auth = new AuthService();
