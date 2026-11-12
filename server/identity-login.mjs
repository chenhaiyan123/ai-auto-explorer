import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * 微信登录 + 手机号登录（都在自己的后台，登录后签发和密码登录一样的会话令牌 hxs_）。
 *
 * 账号：
 * - 已有邮箱账号的人，可以在个人中心把微信 / 手机号「绑」到邮箱账号上，以后用哪种方式登录都是同一个账号；
 * - 没有邮箱账号的人，微信 / 手机号第一次登录就新建一个账号，账号名是一个内部地址
 *   （wx_xxxx@wx.hiexplore.com / p_xxxx@phone.hiexplore.com），不是真邮箱，不会往这里发邮件。
 *
 * 微信：网页上用开放平台「网站应用」扫码（WECHAT_LOGIN_WEB_APPID / SECRET）；
 *       在微信里打开网站时用服务号网页授权（WECHAT_LOGIN_MP_APPID / SECRET）。
 *       两个都绑在同一个开放平台账号下时有 unionid，扫码和微信里登录是同一个账号。
 * 手机：阿里云短信（ALIYUN_SMS_ACCESS_KEY_ID / SECRET / SIGN_NAME / TEMPLATE_CODE，模板里用 ${code}）。
 *       防刷：同一号码 60 秒一条、每天 10 条；同一 IP 每小时 10 条、每天 30 条；全站每天 SMS_DAILY_CAP（默认 500）条。
 *       验证码 15 分钟有效（和短信模板里写的一致），输错 5 次作废。
 */
const KEY = createHash('sha256').update('hiexplore-identities-v1').digest('hex');
const DAY = 86400000;
const PSEUDO = /@(wx|phone)\.hiexplore\.com$/i;
export const isPseudoOwner = owner => PSEUDO.test(String(owner || ''));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sha = s => createHash('sha256').update(s).digest('hex');
export const normalizePhone = raw => {
  let p = String(raw || '').replace(/[\s-]/g, '');
  if (p.startsWith('+86')) p = p.slice(3); else if (p.startsWith('0086')) p = p.slice(4);
  return /^1[3-9]\d{9}$/.test(p) ? p : '';
};
export const maskPhone = p => `${p.slice(0, 3)}****${p.slice(-4)}`;
const pct = s => encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
/** 阿里云 RPC 接口签名（HMAC-SHA1，SignatureVersion 1.0） */
export function aliyunSignedUrl(endpoint, params, secret) {
  const q = Object.keys(params).sort().map(k => `${pct(k)}=${pct(params[k])}`).join('&');
  const sig = createHmac('sha1', `${secret}&`).update(`GET&${pct('/')}&${pct(q)}`).digest('base64');
  return `${endpoint}/?Signature=${pct(sig)}&${q}`;
}

export class IdentityLogin {
  constructor(storage, passwords, env = {}, fetchImpl = fetch, now = () => Date.now()) {
    this.storage = storage; this.passwords = passwords; this.env = env; this.fetch = fetchImpl; this.now = now;
    this.queue = Promise.resolve();
    this.codes = new Map(); // phone -> { hash, exp, tries, sentAt, purpose }
    this.counters = new Map(); // key -> { n, until }
  }
  async state() { const s = (await this.storage.credentials(KEY)) || {}; s.version ||= 1; s.links ||= {}; s.accounts ||= {}; return s; }
  tx(fn) { const run = this.queue.catch(() => {}).then(async () => { const s = await this.state(); const out = await fn(s); await this.storage.credentials(KEY, s); return out; }); this.queue = run; return run; }
  wx(kind) {
    const e = this.env;
    return kind === 'mp' ? { appid: e.WECHAT_LOGIN_MP_APPID, secret: e.WECHAT_LOGIN_MP_SECRET } : { appid: e.WECHAT_LOGIN_WEB_APPID, secret: e.WECHAT_LOGIN_WEB_SECRET };
  }
  smsReady() { const e = this.env; return !!(e.ALIYUN_SMS_ACCESS_KEY_ID && e.ALIYUN_SMS_ACCESS_KEY_SECRET && e.ALIYUN_SMS_SIGN_NAME && e.ALIYUN_SMS_TEMPLATE_CODE) || e.SMS_DEV_LOG === 'true'; }
  /** 给登录页看：开了哪些登录方式（AppID 是公开的，密钥不给） */
  methods() {
    const web = this.wx('web'), mp = this.wx('mp');
    return { wechatWeb: web.appid && web.secret ? web.appid : null, wechatMp: mp.appid && mp.secret ? mp.appid : null, phone: this.smsReady() };
  }
  count(key, limit, windowMs) {
    const now = this.now(), c = this.counters.get(key);
    const cur = c && c.until > now ? c : { n: 0, until: now + windowMs };
    if (cur.n >= limit) return false;
    cur.n++; this.counters.set(key, cur);
    if (this.counters.size > 50000) for (const [k, v] of this.counters) if (v.until <= now) this.counters.delete(k);
    return true;
  }

  // ===== 手机号 =====
  async sendPhoneCode(rawPhone, ip = '', purpose = 'login') {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw fail('请输入正确的中国大陆手机号');
    if (!this.smsReady()) throw fail('手机号登录还没开通', 503);
    const now = this.now(), prev = this.codes.get(phone);
    if (prev && now - prev.sentAt < 60000) throw fail(`发得太快了，${Math.ceil((60000 - (now - prev.sentAt)) / 1000)} 秒后再试`, 429);
    if (!this.count(`pd:${phone}`, 10, DAY)) throw fail('这个号码今天收的验证码太多了，明天再试，或者换邮箱登录', 429);
    if (ip && (!this.count(`ih:${ip}`, 10, 3600000) || !this.count(`id:${ip}`, 30, DAY))) throw fail('请求太频繁，过一会儿再试', 429);
    if (!this.count('global', Number(this.env.SMS_DAILY_CAP || 500), DAY)) throw fail('今天的短信发送量到上限了，请先用邮箱登录', 429);
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    if (this.env.SMS_DEV_LOG === 'true' && !this.env.ALIYUN_SMS_ACCESS_KEY_ID) {
      this.codes.set(phone, { hash: sha(code), exp: now + 15 * 60000, tries: 0, sentAt: now, purpose });
      return { ok: true, devCode: code };
    }
    const e = this.env;
    const url = aliyunSignedUrl('https://dysmsapi.aliyuncs.com', {
      AccessKeyId: e.ALIYUN_SMS_ACCESS_KEY_ID, Action: 'SendSms', Format: 'JSON', PhoneNumbers: phone, RegionId: 'cn-hangzhou',
      SignName: e.ALIYUN_SMS_SIGN_NAME, SignatureMethod: 'HMAC-SHA1', SignatureNonce: randomBytes(12).toString('hex'), SignatureVersion: '1.0',
      TemplateCode: e.ALIYUN_SMS_TEMPLATE_CODE, TemplateParam: JSON.stringify({ code }), Timestamp: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'), Version: '2017-05-25',
    }, e.ALIYUN_SMS_ACCESS_KEY_SECRET);
    let body;
    try { const r = await this.fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' }); body = await r.json(); }
    catch { throw fail('短信服务连不上，过一会儿再试', 502); }
    if (body?.Code !== 'OK') {
      const why = body?.Code === 'isv.BUSINESS_LIMIT_CONTROL' ? '这个号码收的短信太多，被运营商限流了，过一会儿再试' : body?.Code === 'isv.MOBILE_NUMBER_ILLEGAL' ? '手机号不对' : '短信没发出去，过一会儿再试';
      console.error('[sms] send failed', body?.Code, body?.Message);
      throw fail(why, 502);
    }
    this.codes.set(phone, { hash: sha(code), exp: now + 15 * 60000, tries: 0, sentAt: now, purpose });
    return { ok: true };
  }
  checkPhoneCode(rawPhone, code, purpose = 'login') {
    const phone = normalizePhone(rawPhone);
    if (!phone || !/^\d{6}$/.test(String(code || ''))) throw fail('请输入手机号和 6 位验证码');
    const c = this.codes.get(phone);
    if (!c || c.exp < this.now() || c.purpose !== purpose) throw fail('验证码过期了，重新获取一个');
    if (c.tries >= 5) { this.codes.delete(phone); throw fail('输错太多次，重新获取一个验证码', 429); }
    const ok = timingSafeEqual(Buffer.from(sha(String(code))), Buffer.from(c.hash));
    if (!ok) { c.tries++; throw fail('验证码不对', 401); }
    this.codes.delete(phone);
    return phone;
  }
  async loginPhone(rawPhone, code) {
    const phone = this.checkPhoneCode(rawPhone, code, 'login');
    const owner = await this.resolve(`phone:${sha(KEY + phone)}`, () => `p_${randomBytes(5).toString('hex')}@phone.hiexplore.com`, { kind: 'phone', phone: maskPhone(phone) });
    return this.session(owner);
  }
  async bindPhone(owner, rawPhone, code) {
    const phone = this.checkPhoneCode(rawPhone, code, 'bind');
    await this.link(owner, `phone:${sha(KEY + phone)}`, { phone: maskPhone(phone) });
    return this.identities(owner);
  }

  // ===== 微信 =====
  async wechatUser(kind, code) {
    if (!['web', 'mp'].includes(kind)) throw fail('登录方式不对');
    const { appid, secret } = this.wx(kind);
    if (!appid || !secret) throw fail('微信登录还没开通', 503);
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) throw fail('微信授权码无效，重新扫码');
    const get = async u => { try { const r = await this.fetch(u, { signal: AbortSignal.timeout(15000), redirect: 'error' }); return await r.json(); } catch { throw fail('连不上微信，过一会儿再试', 502); } };
    const t = await get(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`);
    if (!t?.openid || !t?.access_token) { console.error('[wechat] token failed', t?.errcode, t?.errmsg); throw fail(t?.errcode === 40163 || t?.errcode === 40029 ? '这个授权已经用过或过期了，重新扫码' : '微信授权没成功，重新试一次', 401); }
    let info = {};
    if (String(t.scope || '').includes('userinfo') || kind === 'web') info = await get(`https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(t.access_token)}&openid=${encodeURIComponent(t.openid)}&lang=zh_CN`).catch(() => ({}));
    const unionid = t.unionid || info.unionid;
    const nick = String(info.nickname || '').slice(0, 40);
    return { key: unionid ? `wx:u:${unionid}` : `wx:${appid}:${t.openid}`, nick: nick && nick !== '微信用户' ? nick : '' };
  }
  async loginWechat(kind, code) {
    const u = await this.wechatUser(kind, code);
    const owner = await this.resolve(u.key, () => `wx_${randomBytes(5).toString('hex')}@wx.hiexplore.com`, { kind: 'wechat', nick: u.nick });
    return this.session(owner);
  }
  async bindWechat(owner, kind, code) {
    const u = await this.wechatUser(kind, code);
    await this.link(owner, u.key, { wechat: true, ...(u.nick ? { nick: u.nick } : {}) });
    return this.identities(owner);
  }

  // ===== 账号 =====
  /** 找到这个微信 / 手机号对应的账号，没有就新建一个 */
  async resolve(linkKey, makeOwner, info) {
    return this.tx(s => {
      const hit = s.links[linkKey];
      if (hit) { const a = s.accounts[hit.owner] ||= {}; if (info.nick) a.nick = info.nick; return hit.owner; }
      let owner = makeOwner(); while (s.accounts[owner]) owner = makeOwner();
      s.links[linkKey] = { owner, at: this.now() };
      s.accounts[owner] = { kind: info.kind, createdAt: this.now(), ...(info.nick ? { nick: info.nick } : {}), ...(info.phone ? { phone: info.phone } : {}), ...(info.kind === 'wechat' ? { wechat: true } : {}) };
      return owner;
    });
  }
  async link(owner, linkKey, info) {
    if (!owner) throw fail('请先登录', 401);
    return this.tx(s => {
      const hit = s.links[linkKey];
      if (hit && hit.owner !== owner) throw fail(info.phone ? '这个手机号已经绑在另一个账号上了' : '这个微信已经绑在另一个账号上了', 409);
      const a = s.accounts[owner] ||= { kind: isPseudoOwner(owner) ? 'unknown' : 'email', createdAt: this.now() };
      // 一个账号只绑一个微信、一个手机号：换绑时把旧的解开
      const kindOf = k => (k.startsWith('phone:') ? 'phone' : 'wx');
      for (const [k, v] of Object.entries(s.links)) if (v.owner === owner && kindOf(k) === kindOf(linkKey) && k !== linkKey) delete s.links[k];
      s.links[linkKey] = { owner, at: this.now() };
      Object.assign(a, info);
      return true;
    });
  }
  async identities(owner) {
    const s = await this.state();
    const a = s.accounts[owner] || {};
    const has = p => Object.entries(s.links).some(([k, v]) => v.owner === owner && k.startsWith(p));
    return { owner, emailAccount: !isPseudoOwner(owner), wechat: has('wx:'), phone: has('phone:') ? (a.phone || '已绑定') : null, nick: a.nick || '', methods: this.methods() };
  }
  /** 后台用户列表用：微信 / 手机号账号显示昵称或打码手机号 */
  async displayNames() { const s = await this.state(); const out = {}; for (const [o, a] of Object.entries(s.accounts)) { const n = a.nick || a.phone; if (n) out[o] = n; } return out; }
  async session(owner) {
    const s = await this.state(); const a = s.accounts[owner] || {};
    const display = a.nick || a.phone || (isPseudoOwner(owner) ? (owner.startsWith('wx_') ? '微信用户' : '手机用户') : owner.split('@')[0]);
    const issued = await this.passwords.issue(owner);
    return { ...issued, user: { email: owner, username: isPseudoOwner(owner) ? owner.split('@')[0] : owner.split('@')[0], displayName: display, role: 'user', kind: isPseudoOwner(owner) ? (owner.startsWith('wx_') ? 'wechat' : 'phone') : 'email' } };
  }
}
