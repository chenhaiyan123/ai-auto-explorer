
import { User } from '../types';

const AUTH_KEY = 'exploration_auth_session';

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

  private save() {
    localStorage.setItem(AUTH_KEY, JSON.stringify(this.currentUser));
  }

  public logout() {
    this.currentUser = null;
    localStorage.removeItem(AUTH_KEY);
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
