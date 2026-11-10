import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';

// 管理员发体验金：直接进对方用户钱包；幂等；有上限；可收回（只收回没花掉的）；不算收入、不算活跃
const fakeFetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://auth.example.test')) return Response.json({ email: opts.headers.Authorization.replace('Bearer ', '') });
  throw new Error('unexpected ' + url);
};
async function boot(t, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grants-'));
  const app = await createWakeServer({ env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_HOST: '127.0.0.1', WAKE_ADMIN_IDENTITIES: '357755590@qq.com', ...extra }, fetch: fakeFetch });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (who, route, method = 'GET', body) => { const r = await fetch(base + route, { method, headers: { Authorization: `Bearer ${who}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  return { app, call };
}
const ADMIN = '357755590@qq.com';

test('只有管理员能发；发给多个邮箱（大小写、重复会合并）；对方钱包到账并能看到流水', async t => {
  const { call } = await boot(t);
  assert.equal((await call('u@x.cn', '/admin/billing/grants', 'POST', { emails: 'u@x.cn', cents: 1000, note: 'x', requestId: randomUUID() })).status, 403);
  assert.equal((await call('u@x.cn', '/admin/billing/grants')).status, 403);
  const r = await call(ADMIN, '/admin/billing/grants', 'POST', { emails: 'A@x.cn, b@x.cn\na@x.cn', cents: 1000, note: '内测体验', requestId: 'req-00000001' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.granted.map(g => g.email), ['a@x.cn', 'b@x.cn']); assert.equal(r.body.totalCents, 2000);
  const w = (await call('a@x.cn', '/billing/account')).body.wallet;
  assert.equal(w.balanceCents, 1000);
  assert.equal(w.tx[0].type, 'grant'); assert.equal(w.tx[0].note, '体验金：内测体验');
  // 同一批重复提交：不重复发
  const again = await call(ADMIN, '/admin/billing/grants', 'POST', { emails: 'a@x.cn b@x.cn', cents: 1000, note: '内测体验', requestId: 'req-00000001' });
  assert.equal(again.body.totalCents, 0);
  assert.equal((await call('a@x.cn', '/billing/account')).body.wallet.balanceCents, 1000);
  const v = (await call(ADMIN, '/admin/billing/grants')).body;
  assert.equal(v.totalCents, 2000); assert.equal(v.people, 2); assert.equal(v.items.length, 2); assert.equal(v.items[0].admin, ADMIN);
});

test('参数校验和上限：金额范围、要写原因、邮箱格式、每天总额', async t => {
  const { call } = await boot(t, { GRANT_MAX_CENTS: '5000', GRANT_DAILY_CENTS: '8000' });
  const post = b => call(ADMIN, '/admin/billing/grants', 'POST', { requestId: randomUUID(), note: '体验', emails: 'a@x.cn', cents: 1000, ...b });
  assert.match((await post({ cents: 50 })).body.error, /¥1 – ¥50/);
  assert.match((await post({ cents: 6000 })).body.error, /¥1 – ¥50/);
  assert.match((await post({ note: ' ' })).body.error, /原因/);
  assert.match((await post({ emails: 'a@x.cn, 不是邮箱' })).body.error, /格式不对/);
  assert.equal((await post({ emails: 'a@x.cn b@x.cn', cents: 3000 })).status, 200);
  const over = await post({ emails: 'c@x.cn d@x.cn', cents: 2000 });
  assert.equal(over.status, 429); assert.match(over.body.error, /今天已发 ¥60.00/);
  assert.equal((await call('c@x.cn', '/billing/account')).body.wallet.balanceCents, 0, '超额那批一个都不发');
});

test('收回：只收回没花掉的部分；重复收回不重复扣；花光了收不回', async t => {
  const { call, app } = await boot(t);
  await call(ADMIN, '/admin/billing/grants', 'POST', { emails: 'a@x.cn, b@x.cn', cents: 1000, note: '体验', requestId: 'req-00000002' });
  await app.billing.spendWallet('a@x.cn', 400, 'spend-test-0001', '用模型');
  const items = (await call(ADMIN, '/admin/billing/grants')).body.items;
  const ga = items.find(i => i.email === 'a@x.cn');
  const r = await call(ADMIN, '/admin/billing/grants/revoke', 'POST', { txId: ga.txId });
  assert.equal(r.body.revokedCents, 600);
  assert.equal((await call('a@x.cn', '/billing/account')).body.wallet.balanceCents, 0);
  assert.equal((await call(ADMIN, '/admin/billing/grants/revoke', 'POST', { txId: ga.txId })).body.duplicate, true);
  assert.equal((await call('a@x.cn', '/billing/account')).body.wallet.balanceCents, 0);
  const gb = items.find(i => i.email === 'b@x.cn');
  await app.billing.spendWallet('b@x.cn', 1000, 'spend-test-0002', '用模型');
  assert.match((await call(ADMIN, '/admin/billing/grants/revoke', 'POST', { txId: gb.txId })).body.error, /收不回/);
  assert.equal((await call('u@x.cn', '/admin/billing/grants/revoke', 'POST', { txId: gb.txId })).status, 403);
  const v = (await call(ADMIN, '/admin/billing/grants')).body;
  assert.equal(v.revokedCents, 600);
});

test('运营数据：体验金不算收入、不让收到的人变成「活跃用户」，单独列出', async t => {
  const { call } = await boot(t);
  await call(ADMIN, '/admin/billing/grants', 'POST', { emails: 'new1@x.cn new2@x.cn', cents: 1000, note: '体验', requestId: 'req-00000003' });
  const m = (await call(ADMIN, '/admin/metrics?days=30&internal=1')).body;
  assert.equal(m.money.paidCents, 0);
  assert.equal(m.money.grantCents, 2000); assert.equal(m.money.grantPeople, 2);
  const u = m.users;
  assert.ok(!(u.total >= 3), `收到体验金的人不算用户（total=${u.total}）`);
});
