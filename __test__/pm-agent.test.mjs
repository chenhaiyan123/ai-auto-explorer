// AI 项目经理在服务广场：真实后端 + 真实 pmAgent 代码（esbuild 打包），只有登录 / 支付 / 模型是假的
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const pm = await import('../node_modules/.cache/hiexplore-pm-agent.mjs');

const fakePay = { create: async () => ({ checkoutUrl: 'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay' }), query: async o => ({ orderId: o.id, amount: o.amount, currency: 'CNY', transactionId: `T${o.id}` }), verifyNotification: async () => null };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-test-'));
  const env = { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', BILLING_SALES_ENABLED: 'true', BILLING_TOPUP_ENABLED: 'true' };
  const fetcher = async (url, options) => {
    const token = options.headers.Authorization?.slice(7);
    if (!['user', 'other'].includes(token)) return new Response('{}', { status: 401 });
    return Response.json({ user: { email: `${token}@example.test` } });
  };
  const app = await createWakeServer({ env, fetch: fetcher, paymentProviders: { alipay: fakePay } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const raw = async (bearer, route, method = 'GET', body) => { const r = await fetch(base + route, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status }); return j; };
  const market = bearer => (p, m, b) => raw(bearer, '/market' + p, m, b);
  const topup = async (who, amount) => { const o = await raw(who, '/billing/orders', 'POST', { sku: 'topup', amount, provider: 'alipay', requestId: randomUUID() }); await raw(who, `/billing/orders/${o.id}`, 'POST'); };
  const wallet = async who => (await raw(who, '/billing/account')).wallet.balanceCents;
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { raw, market, topup, wallet };
}
const project = (charter) => ({ id: `p-${randomUUID().slice(0, 8)}`, name: '续费率项目', metaProblem: '提高续费率', createdAt: 0, nodes: [], charter });
const node = { id: 'n1', title: '找 5 位退费家长聊', status: 'validating', confidence: 0, dependencies: [], notes: '', hypothesis: { statement: '家长退费因为看不到作品', belief: 'medium', unknown: '电话访谈 5 位退费家长，问退费原因', evidence: [], updatedAt: 0 } };
const service = { revision: 0, title: '家长电话访谈', providerName: '小王调研', category: 'human', description: '电话访谈退费家长，整理访谈记录', inputs: '提纲', deliverables: '访谈记录', limits: '不保证结论', location: '线上', contact: 'c', unit: '次', deliveryDays: 3, published: true, confirmed: true };

test('花钱权限 → AI 授权：额度写进令牌，改权限换令牌，0 权限收回', async t => {
  const f = await fixture(t);
  const p = project({ autoBuyCNY: 50, monthlyCNY: 200, confirmedAt: 0 });
  const tok = await pm.ensurePmToken(p, f.market('user'));
  assert.equal(tok.maxOrderCents, 5000); assert.equal(tok.totalBudgetCents, 20000); assert.deepEqual(tok.permissions.sort(), ['demand_publish', 'order_commit']);
  assert.equal((await pm.ensurePmToken(p, f.market('user'))).id, tok.id, '没变就复用');
  const p2 = { ...p, charter: { ...p.charter, allowJobs: true } };
  const tok2 = await pm.ensurePmToken(p2, f.market('user'));
  assert.notEqual(tok2.id, tok.id); assert.ok(tok2.permissions.includes('demand_respond'));
  const tokens = (await f.raw('user', '/market/state')).tokens;
  assert.equal(tokens.find(x => x.id === tok.id).revoked, true, '旧授权已撤销');
  assert.equal(await pm.ensurePmToken({ ...p, charter: { autoBuyCNY: 0, confirmedAt: 0 } }, f.market('user')), null);
});

test('卡住的一步：权限内的现成服务 → AI 用钱包担保下单；贵的不买，改发需求', async t => {
  const f = await fixture(t);
  await f.raw('other', '/market/services', 'PUT', { ...service, priceCents: 3000 });
  await f.topup('user', 10000);
  const p = project({ autoBuyCNY: 50, confirmedAt: 0 });
  const tok = await pm.ensurePmToken(p, f.market('user'));
  const r = await pm.pmBuyOrPost(p, node, tok, f.market(tok.token));
  assert.equal(r.kind, 'order', JSON.stringify(r)); assert.equal(r.priceCents, 3000);
  assert.equal(await f.wallet('user'), 7000, '冻结 ¥30');
  const o = (await f.raw('user', '/market/state')).orders[0];
  assert.equal(o.settlement.method, 'wallet'); assert.equal(o.status, 'requested'); assert.match(o.requestedBy, /AI 项目经理/);
  // 权限只有 ¥20：服务 ¥30 买不起 → 发布需求，预算 ¥20，不扣钱
  const cheap = project({ autoBuyCNY: 20, confirmedAt: 0 });
  const tok2 = await pm.ensurePmToken(cheap, f.market('user'));
  const r2 = await pm.pmBuyOrPost(cheap, { ...node, id: 'n2' }, tok2, f.market(tok2.token));
  assert.equal(r2.kind, 'demand'); assert.equal(r2.budgetCents, 2000);
  assert.equal(await f.wallet('user'), 7000);
  const again = await pm.pmBuyOrPost(cheap, { ...node, id: 'n2' }, tok2, f.market(tok2.token));
  assert.equal(again.demandId, r2.demandId, '同一步不重复发需求');
});

test('钱包没钱：AI 下单失败，订单没确认、也没扣钱', async t => {
  const f = await fixture(t);
  await f.raw('other', '/market/services', 'PUT', { ...service, priceCents: 1000 });
  const p = project({ autoBuyCNY: 50, confirmedAt: 0 });
  const tok = await pm.ensurePmToken(p, f.market('user'));
  await assert.rejects(pm.pmBuyOrPost(p, node, tok, f.market(tok.token)), /余额不足/);
  assert.equal(await f.wallet('user'), 0);
  assert.equal((await f.raw('user', '/market/state')).orders[0].status, 'cancelled', '挂着的申请自动撤掉');
});

test('接单赚钱：AI 只投自己做得了的，报价不超预算；中标后交付，对方验收后钱进钱包', async t => {
  const f = await fixture(t);
  await f.topup('other', 10000);
  const d1 = await f.raw('other', '/market/demands', 'POST', { requestId: randomUUID(), title: '整理 10 家机构的续费做法', requirements: '公开资料对比表', acceptance: '对比表 + 建议', budgetCents: 1000, deadline: Date.now() + 7 * 864e5, confirmed: true });
  const p = project({ autoBuyCNY: 0, allowJobs: true, confirmedAt: 0 });
  const tok = await pm.ensurePmToken(p, f.market('user'));
  assert.deepEqual(tok.permissions.sort(), ['demand_respond', 'order_execute'], '只接单、不花钱');
  const llm = async msgs => {
    const all = msgs.map(m => m.content).join('\n');
    if (all.includes('可以在服务广场接单赚钱')) return JSON.stringify({ bids: [{ demandId: d1.id, proposal: '检索公开资料整理对比表', priceYuan: 8, deliveryDays: 2 }, { demandId: 'not-a-demand', proposal: 'x', priceYuan: 1, deliveryDays: 1 }, { demandId: d1.id, proposal: '超预算', priceYuan: 99, deliveryDays: 1 }] });
    return '# 对比表\n| A | 作品展 |\n\n局限：只用了公开资料';
  };
  const r1 = await pm.pmWorkJobs(tok, llm, '少儿编程', f.market(tok.token));
  assert.equal(r1.bids.length, 1); assert.equal(r1.bids[0].priceCents, 800);
  const d = (await f.raw('other', '/market/state')).demands.find(x => x.id === d1.id);
  await f.raw('other', `/market/demands/${d.id}/action`, 'POST', { action: 'award', bidId: d.bids[0].id, revision: d.revision, confirmed: true, pay: 'wallet', contact: 'x' });
  const r2 = await pm.pmWorkJobs(tok, llm, '少儿编程', f.market(tok.token));
  assert.equal(r2.delivered.length, 1); assert.equal(r2.bids.length, 0, '已投过的不重复投');
  const o = (await f.raw('other', '/market/state')).orders.find(x => x.demandId === d1.id);
  assert.equal(o.status, 'delivered'); assert.equal(o.delivery.source, ''); assert.match(o.delivery.summary, /对比表/); assert.match(o.delivery.limitation, /公开资料/);
  await f.raw('other', `/market/orders/${o.id}/action`, 'POST', { action: 'complete', revision: o.revision, note: 'ok' });
  assert.equal(await f.wallet('user'), 800);
  // 没授权花钱的 AI：不能买东西
  await assert.rejects(f.market(tok.token)('/demands', 'POST', { requestId: randomUUID(), title: 't', requirements: 'r', acceptance: 'a', budgetCents: 100, deadline: Date.now() + 864e5, confirmed: true }), e => e.status === 403);
});
