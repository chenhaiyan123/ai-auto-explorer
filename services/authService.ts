
import { User } from '../types';

const AUTH_KEY = 'exploration_auth_session';
const TOKEN_KEY = 'aae-auth-token';
// 托管版后端地址；不配置则不启用真实登录（开源/本地版保持免登录）
const AUTH_API = ((import.meta as any).env?.VITE_AUTH_API || '').replace(/\/+$/, '');
export const hasAuthBackend = (): boolean => !!AUTH_API;
// 密码登录在自己的后台（登录服务没有用户表，密码存不了）
const WAKE = String((import.meta as any).env?.VITE_WAKE_API || '').replace(/\/+$/, '');
export const hasPasswordLogin = (): boolean => !!WAKE && !!AUTH_API;
async function wakeCall<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let token = ''; try { token = localStorage.getItem('aae-auth-token') || ''; } catch { /* 隐私模式 */ }
  let r: Response;
  try { r = await fetch(`${WAKE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('连不上服务器，过几秒再试'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || '请求失败');
  return d as T;
}
/** 验证码登录签发的令牌里带着过期时间；密码登录的令牌（hxs_）由后台自己续期 */
const tokenExp = (t: string): number => { try { return JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0; } catch { return 0; } };

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

  /** 邮箱 + 密码登录（密码要先用验证码登录后在个人中心设置） */
  public async loginWithPassword(email: string, password: string): Promise<User> {
    const d = await wakeCall<{ token: string; user: { email: string; username: string } }>('/auth/password/login', 'POST', { email: email.trim().toLowerCase(), password });
    this.currentUser = { username: d.user.username, role: 'user', email: d.user.email };
    this.save();
    try { localStorage.setItem(TOKEN_KEY, d.token); } catch {}
    return this.currentUser;
  }
  public passwordStatus() { return wakeCall<{ hasPassword: boolean; setAt: number | null }>('/auth/password/status'); }
  public setPassword(password: string) { return wakeCall<{ ok: boolean }>('/auth/password/set', 'POST', { password }); }

  /**
   * 记住登录：验证码登录的令牌 30 天有效，剩不到 25 天时悄悄换一张新的。
   * 常来的人一直续着，基本不用再收验证码；超过 30 天没来才需要重新登录。
   */
  public async refreshIfNeeded(): Promise<void> {
    let t = ''; try { t = localStorage.getItem(TOKEN_KEY) || ''; } catch { return; }
    if (!AUTH_API || !t || t.startsWith('hxs_')) return;
    const exp = tokenExp(t);
    if (!exp || exp - Date.now() > 25 * 864e5 || exp < Date.now()) return;
    try {
      const r = await fetch(`${AUTH_API}/auth/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000) });
      if (r.ok) { const d = await r.json(); if (d.token) localStorage.setItem(TOKEN_KEY, d.token); }
    } catch { /* 下次再续 */ }
  }

  private save() {
    localStorage.setItem(AUTH_KEY, JSON.stringify(this.currentUser));
  }

  public logout() {
    this.currentUser = null;
    try { const t = localStorage.getItem(TOKEN_KEY) || ''; if (t.startsWith('hxs_') && WAKE) void fetch(`${WAKE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {}); } catch {}
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
