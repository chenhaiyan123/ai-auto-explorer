import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';

test('密码登录：验证码登录后设密码 → 邮箱+密码直接登录 → 会话令牌能用后台；输错多次锁定；改密码踢掉旧会话', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-'));
  const app = await createWakeServer({ env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_HOST: '127.0.0.1' },
    fetch: async (url, opts) => { const tok = opts.headers.Authorization.replace('Bearer ', ''); return tok.includes('@') ? Response.json({ user: { email: tok } }) : new Response('{}', { status: 401 }); } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (route, method = 'GET', body, token) => { const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  // 没设密码：登录失败
  let r = await call('/auth/password/login', 'POST', { email: 'a@qq.com', password: 'abc12345' });
  assert.equal(r.status, 401, JSON.stringify(r.body)); assert.match(r.body.error, /验证码登录/);
  assert.equal((await call('/auth/password/status', 'GET', undefined, 'a@qq.com')).body.hasPassword, false);
  assert.equal((await call('/auth/password/set', 'POST', { password: '12345678' }, 'a@qq.com')).status, 400, '纯数字太简单');
  assert.equal((await call('/auth/password/set', 'POST', { password: 'short1' }, 'a@qq.com')).status, 400);
  assert.equal((await call('/auth/password/set', 'POST', { password: 'Seabird2026' }, 'a@qq.com')).status, 200);
  r = await call('/auth/password/login', 'POST', { email: 'A@QQ.com ', password: 'Seabird2026' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.token, /^hxs_/); assert.equal(r.body.user.email, 'a@qq.com');
  const tok = r.body.token;
  // 会话令牌能正常用后台
  assert.equal((await call('/billing/account', 'GET', undefined, tok)).status, 200);
  assert.equal((await call('/auth/password/status', 'GET', undefined, tok)).body.hasPassword, true);
  // 存的是哈希，不是明文
  const files = await fs.readdir(dir); let raw = ''; for (const f of files) if (f.endsWith('.json')) raw += await fs.readFile(path.join(dir, f), 'utf8');
  assert.ok(!raw.includes('Seabird2026'));
  // 输错 5 次锁定
  for (let i = 0; i < 5; i++) assert.equal((await call('/auth/password/login', 'POST', { email: 'a@qq.com', password: 'wrong-pass1' })).status, 401);
  assert.equal((await call('/auth/password/login', 'POST', { email: 'a@qq.com', password: 'Seabird2026' })).status, 429);
  // 改密码：旧会话失效
  assert.equal((await call('/auth/password/set', 'POST', { password: 'NewPass2026x' }, 'a@qq.com')).status, 200);
  assert.equal((await call('/billing/account', 'GET', undefined, tok)).status, 401);
  // 退出
  app.passwords && null;
  assert.equal((await call('/auth/password/login', 'POST', { email: 'b@qq.com', password: 'x' })).status, 401);
});
