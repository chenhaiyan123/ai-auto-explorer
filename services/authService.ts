
import { User } from '../types';

const AUTH_KEY = 'exploration_auth_session';
const TOKEN_KEY = 'aae-auth-token';
// 托管版后端地址；不配置则不启用真实登录（开源/本地版保持免登录）
const AUTH_API = ((import.meta as any).env?.VITE_AUTH_API || '').replace(/\/+$/, '');
export const hasAuthBackend = (): boolean => !!AUTH_API;

class AuthService {
  private currentUser: User | null = null;

  constructor() {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      this.currentUser = JSON.parse(saved);
    }
  }

  public loginAsAdmin(username: string, password: string): boolean {
    // 管理密码由部署者通过环境变量 VITE_ADMIN_PASSWORD 设置；未设置时禁用管理员登录
    const adminPassword = (import.meta as any).env?.VITE_ADMIN_PASSWORD || '';
    if (adminPassword && username === 'admin' && password === adminPassword) {
      this.currentUser = { username: 'admin', role: 'admin' };
      this.save();
      return true;
    }
    return false;
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
    const r = await fetch(`${AUTH_API}/auth/email/send-code`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '发送失败');
    return d;
  }

  public async verifyEmailCode(email: string, code: string): Promise<User> {
    const r = await fetch(`${AUTH_API}/auth/email/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }),
    });
    const d = await r.json().catch(() => ({}));
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
