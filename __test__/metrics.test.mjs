import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { computeMetrics, mask, cnDay, UserRegistry } from '../server/metrics.mjs';
import { WakeStorage } from '../server/wake-storage.mjs';
import { createWakeServer } from '../server/wake-server.mjs';

const DAY = 86400000, NOW = Date.UTC(2026, 9, 26, 4);
const raw = {
  users: {
    'a@qq.com': { first: NOW - 10 * DAY, last: NOW - DAY, days: [cnDay(NOW - 10 * DAY), cnDay(NOW - 9 * DAY), cnDay(NOW - DAY)] },
    'b@163.com': { first: NOW - 3 * DAY, last: NOW - 3 * DAY, days: [cnDay(NOW - 3 * DAY)] },
    'boss@hiexplore.com': { first: NOW - 20 * DAY, last: NOW, days: [cnDay(NOW)] },
  },
  billing: {
    orders: [
      { owner: 'a@qq.com', sku: 'topup', amount: 1000, status: 'paid', createdAt: NOW - 5 * DAY, paidAt: NOW - 5 * DAY, provider: 'wechat' },
      { owner: 'a@qq.com', sku: 'topup', amount: 3000, status: 'paid', createdAt: NOW - 2 * DAY, paidAt: NOW - 2 * DAY, provider: 'wechat' },
      { owner: 'b@163.com', sku: 'topup', amount: 1000, status: 'pending', createdAt: NOW - DAY },
      { owner: 'boss@hiexplore.com', sku: 'topup', amount: 1000, status: 'paid', createdAt: NOW - DAY, paidAt: NOW - DAY },
      { owner: 'x@example.test', sku: 'topup', amount: 9999, status: 'paid', createdAt: NOW - DAY, paidAt: NOW - DAY },
    ],
    walletTx: [
      { id: 'spend:1', owner: 'a@qq.com', type: 'spend', cents: 300, at: NOW - 4 * DAY },
      { id: 'refund:1', owner: 'a@qq.com', type: 'refund', cents: 100, at: NOW - 4 * DAY },
      { id: 'escrow:o1', owner: 'a@qq.com', type: 'escrow', cents: 2000, ref: 'o1', at: NOW - 2 * DAY },
      { id: 'income:o1', owner: 'c@gmail.com', type: 'income', cents: 1900, ref: 'o1', at: NOW - DAY },
    ],
  },
  shared: { calls: [{ owner: 'a@qq.com', status: 'charged', at: NOW - 4 * DAY }, { owner: 'd@qq.com', status: 'charged', at: NOW - 40 * DAY }] },
  market: {
    services: [{ owner: 'c@gmail.com', published: true, createdAt: NOW - 6 * DAY }],
    demands: [{ owner: 'b@163.com', createdAt: NOW - 3 * DAY, status: 'open', bids: [{ owner: 'c@gmail.com' }, { owner: 'a@qq.com' }] }],
    orders: [
      { buyer: 'a@qq.com', seller: 'c@gmail.com', status: 'completed', totalCents: 2000, createdAt: NOW - 2 * DAY, tokenId: 't1', settlement: { method: 'wallet' }, quote: { title: '访谈' } },
      { buyer: 'b@163.com', seller: 'c@gmail.com', status: 'accepted', totalCents: 500, createdAt: NOW - DAY, sellerTokenId: 's1', settlement: { method: 'external' } },
      { buyer: 'b@163.com', seller: 'c@gmail.com', status: 'cancelled', totalCents: 800, createdAt: NOW - DAY },
      { buyer: 'b@163.com', seller: 'c@gmail.com', status: 'proposed', totalCents: 700, createdAt: NOW - DAY },
    ],
  },
};

test('metrics: users from every source, internal / test accounts excluded by default', () => {
  const m = computeMetrics(raw, { internal: new Set(['boss@hiexplore.com']), now: NOW });
  assert.equal(m.users.total, 4, 'a, b, c, d — not boss, not example.test');
  assert.equal(m.users.payers, 1); assert.equal(m.users.repeatPayers, 1);
  assert.equal(m.users.usedAI, 2); assert.equal(m.users.market, 3);
  assert.equal(m.users.new7, 2, 'b (3 days) and c (6 days)');
  assert.equal(m.users.mau, 4 - 1, 'd 40 days ago is not monthly active');
  assert.equal(m.users.dau >= 1, true);
  const full = computeMetrics(raw, { internal: new Set(['boss@hiexplore.com']), includeInternal: true, now: NOW });
  assert.equal(full.users.total, 6); assert.equal(full.money.paidCents, 1000 + 3000 + 1000 + 9999);
});

test('metrics: only paid orders count as revenue; market GMV excludes cancelled / unconfirmed', () => {
  const m = computeMetrics(raw, { internal: new Set(['boss@hiexplore.com']), now: NOW });
  assert.equal(m.money.paidOrders, 2); assert.equal(m.money.paidCents, 4000); assert.equal(m.money.topupCents, 4000);
  assert.equal(m.money.arppuCents, 4000);
  assert.equal(m.money.walletSpendCents, 200, 'spend minus refunds');
  assert.equal(m.money.market.orders, 2); assert.equal(m.money.market.gmvCents, 2500);
  assert.equal(m.money.market.completed, 1); assert.equal(m.money.market.completedCents, 2000);
  assert.equal(m.money.market.byAIBuyer, 1); assert.equal(m.money.market.byAISeller, 1);
  assert.equal(m.money.market.walletPaidOrders, 1); assert.equal(m.money.market.feeCents, 100);
  assert.equal(m.money.market.bids, 2); assert.equal(m.money.market.services, 1);
  assert.equal(m.money.daily.length, 30); assert.equal(m.money.daily.at(-3).paidCents, 3000);
  assert.ok(m.money.recent.every(r => !/qq\.com|163\.com|gmail/.test(r.who) || r.who.includes('***')), 'emails masked');
});

test('mask hides user names', () => { assert.equal(mask('seabird@gmail.com'), 's***@gmail.com'); assert.equal(mask('dev'), 'de***'); });

test('registry persists daily visits; /admin/metrics is admin-only and counts real visits', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metrics-'));
  const app = await createWakeServer({ env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_HOST: '127.0.0.1', WAKE_ADMIN_IDENTITIES: 'boss@hiexplore.com' },
    fetch: async (url, opts) => Response.json({ email: opts.headers.Authorization.replace('Bearer ', '') }) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const call = async (who, route) => { const r = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, { headers: { Authorization: `Bearer ${who}` } }); return { status: r.status, body: await r.json() }; };
  await call('u1@qq.com', '/billing/account');
  await call('u2@qq.com', '/market/state');
  await call('u1@qq.com', '/billing/account');
  assert.equal((await call('u1@qq.com', '/admin/metrics')).status, 403);
  const m = (await call('boss@hiexplore.com', '/admin/metrics')).body;
  assert.equal(m.users.total, 2, 'two real users, admin excluded'); assert.equal(m.users.dau, 2);
  assert.equal((await call('boss@hiexplore.com', '/admin/metrics?internal=1')).body.users.total, 3);
  const reg = await app.registry.read();
  assert.ok(reg['u1@qq.com'].days.length === 1 && reg['u1@qq.com'].kinds.includes('billing'));
});

test('大家在研究什么：体验用户和登录用户的问题都记下，同一个项目只记一条，管理员才能看', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'questions-'));
  const app = await createWakeServer({ env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_HOST: '127.0.0.1', WAKE_ADMIN_IDENTITIES: 'boss@hiexplore.com' },
    fetch: async (url, opts) => Response.json({ email: opts.headers.Authorization.replace('Bearer ', '') }) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const log = (q, pid, who, dev = 'dev-1') => fetch(`${base}/questions/log`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': dev, ...(who ? { Authorization: `Bearer ${who}` } : {}) }, body: JSON.stringify({ question: q, projectId: pid }) }).then(r => r.status);
  assert.equal(await log('怎么做一台太阳能无人机', 'p1'), 200);
  assert.equal(await log('怎么做一台太阳能无人机', 'p1'), 200);
  assert.equal(await log('怎么做一台高效的太阳能无人机', 'p1'), 200, '改了问题：更新同一条');
  assert.equal(await log('新项目', 'p2'), 200);
  assert.equal(await log('少儿编程怎么提高续费', 'p3', 'a@qq.com'), 200);
  assert.equal(await log('管理员自己的测试问题', 'p4', 'boss@hiexplore.com'), 200);
  const get = who => fetch(`${base}/admin/questions`, { headers: { Authorization: `Bearer ${who}` } }).then(async r => ({ status: r.status, body: await r.json() }));
  assert.equal((await get('a@qq.com')).status, 403);
  const d = (await get('boss@hiexplore.com')).body;
  assert.equal(d.total, 2, '「新项目」不算，管理员默认剔除'); assert.equal(d.guests, 1); assert.equal(d.people, 2);
  assert.ok(d.items.some(x => x.q === '怎么做一台高效的太阳能无人机' && x.who === '体验用户'));
  assert.ok(d.items.some(x => x.who === 'a***@qq.com'));
});
