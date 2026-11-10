import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';
import { aliyunSignedUrl, normalizePhone } from '../server/identity-login.mjs';

// 微信 / 手机号登录：签名、防刷、新建账号、绑到已有邮箱账号、令牌可用、内部地址不能设密码
let sms = [];
const wxCodes = { 'webcode-alice': { openid: 'o-web-a', unionid: 'U-ALICE' }, 'mpcode-alice': { openid: 'o-mp-a', unionid: 'U-ALICE', scope: 'snsapi_userinfo' }, 'webcode-bob1': { openid: 'o-web-b', unionid: 'U-BOB' } };
const fakeFetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.origin === 'https://auth.example.test') return Response.json({ email: opts.headers.Authorization.replace('Bearer ', '') });
  if (u.origin === 'https://dysmsapi.aliyuncs.com') {
    const p = Object.fromEntries(u.searchParams);
    sms.push(p);
    return Response.json(p.PhoneNumbers === '13900000000' ? { Code: 'isv.BUSINESS_LIMIT_CONTROL', Message: 'limit' } : { Code: 'OK', Message: 'OK' });
  }
  if (u.pathname === '/sns/oauth2/access_token') {
    const c = wxCodes[u.searchParams.get('code')];
    assert.ok(['wx-web-app', 'wx-mp-app'].includes(u.searchParams.get('appid')));
    return Response.json(c ? { access_token: 'AT-' + c.openid, openid: c.openid, unionid: c.unionid, scope: c.scope || 'snsapi_login' } : { errcode: 40029, errmsg: 'invalid code' });
  }
  if (u.pathname === '/sns/userinfo') return Response.json({ nickname: u.searchParams.get('openid') === 'o-web-a' ? '小艾' : '微信用户', unionid: 'x' });
  throw new Error('unexpected ' + url);
};
const ENV = { WECHAT_LOGIN_WEB_APPID: 'wx-web-app', WECHAT_LOGIN_WEB_SECRET: 's1', WECHAT_LOGIN_MP_APPID: 'wx-mp-app', WECHAT_LOGIN_MP_SECRET: 's2',
  ALIYUN_SMS_ACCESS_KEY_ID: 'AKID', ALIYUN_SMS_ACCESS_KEY_SECRET: 'AKSECRET', ALIYUN_SMS_SIGN_NAME: '海探科技', ALIYUN_SMS_TEMPLATE_CODE: 'SMS_123' };
async function boot(t, extra = {}) {
  sms = [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ident-'));
  const app = await createWakeServer({ env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_HOST: '127.0.0.1', WAKE_ADMIN_IDENTITIES: 'boss@x.cn', ...ENV, ...extra }, fetch: fakeFetch });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (route, method = 'GET', body, who, ip = '1.1.1.1') => { const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(who ? { Authorization: `Bearer ${who}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  const lastCode = () => JSON.parse(sms.at(-1).TemplateParam).code;
  return { call, lastCode };
}

test('阿里云签名：和官方文档示例一致；手机号规范化', () => {
  // 官方文档（RPC 签名机制）的示例：AccessKeySecret = testsecret
  const url = aliyunSignedUrl('https://ecs.aliyuncs.com', { AccessKeyId: 'testid', Action: 'DescribeRegions', Format: 'XML', SignatureMethod: 'HMAC-SHA1', SignatureNonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf', SignatureVersion: '1.0', Timestamp: '2016-02-23T12:46:24Z', Version: '2014-05-26' }, 'testsecret');
  assert.equal(new URL(url).searchParams.get('Signature'), 'OLeaidS1JvxuMvnyHOwuJ+uX5qY=');
  assert.equal(normalizePhone('+86 138-0013-8000'), '13800138000');
  assert.equal(normalizePhone('12345678901'), '');
});

test('登录方式：只公开 AppID，不公开密钥；没配置的不开', async t => {
  const { call } = await boot(t, { WECHAT_LOGIN_MP_SECRET: '', ALIYUN_SMS_TEMPLATE_CODE: '' });
  const m = (await call('/auth/methods')).body;
  assert.deepEqual(m, { wechatWeb: 'wx-web-app', wechatMp: null, phone: false });
  assert.equal((await call('/auth/phone/code', 'POST', { phone: '13800138000' })).status, 503);
});

test('手机号：发码 → 登录新建账号 → 令牌能用；同号再登是同一账号；防刷；输错', async t => {
  const { call, lastCode } = await boot(t);
  assert.match((await call('/auth/phone/code', 'POST', { phone: '1380013800' })).body.error, /正确的/);
  assert.equal((await call('/auth/phone/code', 'POST', { phone: '13800138000' })).status, 200);
  assert.equal(sms.at(-1).SignName, '海探科技'); assert.equal(sms.at(-1).TemplateCode, 'SMS_123'); assert.ok(sms.at(-1).Signature);
  assert.match((await call('/auth/phone/code', 'POST', { phone: '13800138000' })).body.error, /秒后再试/);
  assert.equal((await call('/auth/phone/login', 'POST', { phone: '13800138000', code: '000000' === lastCode() ? '111111' : '000000' })).status, 401);
  const r = await call('/auth/phone/login', 'POST', { phone: '13800138000', code: lastCode() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.user.email, /^p_[a-f0-9]{10}@phone\.hiexplore\.com$/); assert.equal(r.body.user.displayName, '138****8000'); assert.equal(r.body.user.kind, 'phone');
  assert.ok(r.body.token.startsWith('hxs_'));
  const me = await call('/auth/identities', 'GET', null, r.body.token);
  assert.equal(me.body.owner, r.body.user.email); assert.equal(me.body.phone, '138****8000'); assert.equal(me.body.emailAccount, false);
  assert.equal((await call('/billing/account', 'GET', null, r.body.token)).status, 200, '令牌在别的接口也能用');
  assert.match((await call('/auth/password/set', 'POST', { password: 'abc12345xyz' }, r.body.token)).body.error, /只有邮箱账号/);
  assert.match((await call('/auth/phone/login', 'POST', { phone: '13800138000', code: lastCode() })).body.error, /过期/, '验证码只能用一次');
  // 运营商限流：给出能看懂的话
  assert.match((await call('/auth/phone/code', 'POST', { phone: '13900000000' })).body.error, /限流/);
});

test('同一 IP 一小时最多 10 条', async t => {
  const { call } = await boot(t);
  for (let i = 0; i < 10; i++) assert.equal((await call('/auth/phone/code', 'POST', { phone: `1370000000${i}` }, null, '9.9.9.9')).status, 200);
  assert.equal((await call('/auth/phone/code', 'POST', { phone: '13600000000' }, null, '9.9.9.9')).status, 429);
  assert.equal((await call('/auth/phone/code', 'POST', { phone: '13600000000' }, null, '8.8.8.8')).status, 200);
});

test('微信：扫码新建账号；在微信里（服务号）登录是同一个账号（unionid）；授权码无效', async t => {
  const { call } = await boot(t);
  const a = await call('/auth/wechat/login', 'POST', { kind: 'web', code: 'webcode-alice' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.user.email, /^wx_[a-f0-9]{10}@wx\.hiexplore\.com$/); assert.equal(a.body.user.displayName, '小艾');
  const b = await call('/auth/wechat/login', 'POST', { kind: 'mp', code: 'mpcode-alice' });
  assert.equal(b.body.user.email, a.body.user.email);
  assert.equal((await call('/auth/wechat/login', 'POST', { kind: 'web', code: 'expired-code-1' })).status, 401);
  assert.equal((await call('/auth/wechat/login', 'POST', { kind: 'evil', code: 'webcode-alice' })).status, 400);
});

test('绑定：邮箱账号绑微信和手机号 → 之后用微信 / 手机号登录进的就是这个邮箱账号；已被别人绑的不能再绑', async t => {
  const { call, lastCode } = await boot(t);
  const me = 'alice@school.edu.cn';
  assert.equal((await call('/auth/bind/wechat', 'POST', { kind: 'web', code: 'webcode-bob1' })).status, 401, '要先登录');
  const bw = await call('/auth/bind/wechat', 'POST', { kind: 'web', code: 'webcode-bob1' }, me);
  assert.equal(bw.status, 200, JSON.stringify(bw.body)); assert.equal(bw.body.wechat, true);
  assert.equal((await call('/auth/wechat/login', 'POST', { kind: 'web', code: 'webcode-bob1' })).body.user.email, me);
  await call('/auth/bind/phone/code', 'POST', { phone: '13800138001' }, me);
  assert.equal((await call('/auth/bind/phone', 'POST', { phone: '13800138001', code: lastCode() }, me)).body.phone, '138****8001');
  await call('/auth/phone/code', 'POST', { phone: '13800138001' });
  const pl = await call('/auth/phone/login', 'POST', { phone: '13800138001', code: lastCode() });
  assert.equal(pl.body.user.email, me); assert.equal(pl.body.user.kind, 'email');
  // 别人想绑同一个微信
  assert.equal((await call('/auth/bind/wechat', 'POST', { kind: 'web', code: 'webcode-bob1' }, 'other@x.cn')).status, 409);
  // 登录用的验证码不能拿去绑定（用途分开）
  await call('/auth/phone/code', 'POST', { phone: '13800138002' });
  assert.match((await call('/auth/bind/phone', 'POST', { phone: '13800138002', code: lastCode() }, 'other@x.cn')).body.error, /过期/);
});
