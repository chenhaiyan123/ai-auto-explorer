import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * 密码登录（可选）：用户用邮箱验证码登录过一次后，可以给自己设一个密码，以后用「邮箱 + 密码」直接登录。
 *
 * - 登录服务（FC）没有用户表，所以密码存在这里（加密存储，只存 scrypt 哈希，不存明文）；
 * - 密码登录签发的是本服务自己的会话令牌（hxs_ 开头，只存哈希），90 天有效，用着就自动续期；
 * - 忘了密码：用邮箱验证码登录后重新设置；
 * - 同一个邮箱 15 分钟内输错 5 次就暂停 15 分钟，防暴力猜。
 */
const scrypt = promisify(scryptCb);
const KEY = createHash('sha256').update('hiexplore-passwords-v1').digest('hex');
const DAY = 86400000;
const SESSION_DAYS = 90;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const isEmail = s => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const sha = s => createHash('sha256').update(s).digest('hex');

export class PasswordAuth {
  constructor(storage, now = () => Date.now()) { this.storage = storage; this.now = now; this.queue = Promise.resolve(); this.fails = new Map(); this.cache = new Map(); }
  async state() { const s = (await this.storage.credentials(KEY)) || {}; s.version ||= 1; s.users ||= {}; s.sessions ||= {}; return s; }
  tx(fn) {
    const run = this.queue.catch(() => {}).then(async () => { const s = await this.state(); const out = await fn(s); await this.storage.credentials(KEY, s); return out; });
    this.queue = run; return run;
  }
  static async hash(password, salt = randomBytes(16)) {
    const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
    return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
  }
  static async check(password, stored) {
    const [kind, salt, key] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !key) return false;
    const got = await scrypt(password, Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
    const want = Buffer.from(key, 'base64');
    return got.length === want.length && timingSafeEqual(got, want);
  }
  async status(owner) { const s = await this.state(); const u = s.users[String(owner).toLowerCase()]; return { hasPassword: !!u, setAt: u?.setAt || null }; }
  async setPassword(owner, password) {
    if (!isEmail(owner)) throw fail('只有邮箱账号可以设置密码');
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw fail('密码要 8–72 位');
    if (/^\d+$/.test(password) || new Set(password).size < 4) throw fail('密码太简单了：至少混用字母和数字');
    const hash = await PasswordAuth.hash(password);
    const email = owner.toLowerCase();
    return this.tx(s => {
      s.users[email] = { hash, setAt: this.now() };
      // 改了密码：这个人以前用密码登录的设备都要重新登录
      for (const [k, v] of Object.entries(s.sessions)) if (v.owner === email) delete s.sessions[k];
      this.cache.clear();
      return { ok: true };
    });
  }
  async login(email, password) {
    email = String(email || '').trim().toLowerCase();
    if (!isEmail(email) || typeof password !== 'string' || !password) throw fail('请输入邮箱和密码');
    const f = this.fails.get(email);
    if (f && f.n >= 5 && this.now() - f.at < 15 * 60000) throw fail('输错太多次了，15 分钟后再试，或者用验证码登录', 429);
    const s = await this.state();
    const ok = s.users[email] ? await PasswordAuth.check(password, s.users[email].hash) : (await PasswordAuth.hash(password), false); // 没这个人也算一次哈希，别让响应时间暴露账号是否存在
    if (!ok) {
      const cur = f && this.now() - f.at < 15 * 60000 ? f : { n: 0, at: this.now() };
      this.fails.set(email, { n: cur.n + 1, at: cur.at });
      if (this.fails.size > 10000) this.fails.clear();
      throw fail(s.users[email] ? '邮箱或密码不对' : '邮箱或密码不对（还没设过密码的话，先用验证码登录，再到「个人中心」设密码）', 401);
    }
    this.fails.delete(email);
    const token = 'hxs_' + randomBytes(32).toString('base64url');
    await this.tx(st => {
      const now = this.now();
      for (const [k, v] of Object.entries(st.sessions)) if (v.exp < now) delete st.sessions[k];
      st.sessions[sha(token)] = { owner: email, at: now, exp: now + SESSION_DAYS * DAY };
    });
    return { token, user: { email, username: email.split('@')[0], role: 'user' }, expiresAt: this.now() + SESSION_DAYS * DAY };
  }
  /** 会话令牌 → 邮箱；快过期的自动续到 90 天 */
  async verify(token) {
    if (typeof token !== 'string' || !token.startsWith('hxs_') || token.length > 200) return null;
    const k = sha(token), now = this.now();
    const c = this.cache.get(k);
    if (c && c.exp > now && c.checked > now - 60000) return c.owner;
    const s = await this.state();
    const v = s.sessions[k];
    if (!v || v.exp < now) { this.cache.delete(k); return null; }
    if (v.exp - now < (SESSION_DAYS - 7) * DAY) await this.tx(st => { if (st.sessions[k]) st.sessions[k].exp = now + SESSION_DAYS * DAY; });
    this.cache.set(k, { owner: v.owner, exp: v.exp, checked: now });
    if (this.cache.size > 5000) this.cache.clear();
    return v.owner;
  }
  async logout(token) {
    if (typeof token !== 'string' || !token.startsWith('hxs_')) return { ok: true };
    const k = sha(token); this.cache.delete(k);
    return this.tx(s => { delete s.sessions[k]; return { ok: true }; });
  }
}
