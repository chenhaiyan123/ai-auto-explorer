import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';

// 假的支付渠道：查单时就当已付款（只用于测试，不涉及真实收款）
const fakePay = { create: async () => ({ checkoutUrl: 'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay' }), query: async o => ({ orderId: o.id, amount: o.amount, currency: 'CNY', transactionId: `T${o.id}` }), verifyNotification: async () => null };
const model = { id: 'economy', label: '测试经济模型', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'fake-model', apiKey: 'FAKE-KEY', enabled: true, dailyTokens: 1000000, maxOutputTokens: 4096 };
const chat = () => ({ requestId: randomUUID(), modelId: model.id, maxTokens: 256, messages: [{ role: 'user', content: '模拟请求' }] });

async function fixture(t, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-test-'));
  const env = { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_ADMIN_IDENTITIES: 'admin@example.test', WAKE_GLOBAL_DAILY_CALLS: '100',
    BILLING_SALES_ENABLED: 'true', BILLING_TOPUP_ENABLED: 'true', ...extra };
  const modelCalls = [];
  const fetcher = async (url, options) => {
    if (String(url).startsWith(env.WAKE_AUTH_API)) {
      const token = options.headers.Authorization?.slice(7);
      if (!['admin', 'user', 'other'].includes(token)) return new Response('{}', { status: 401 });
      return Response.json({ user: { email: `${token}@example.test`, role: 'user' } });
    }
    modelCalls.push(url);
    return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } });
  };
  const app = await createWakeServer({ env, fetch: fetcher, collect: async () => [], paymentProviders: { alipay: fakePay } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const req = async (route, method = 'GET', body, token = 'user') => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { req, modelCalls };
}
const topup = async (f, amount, token = 'user') => {
  const o = await f.req('/billing/orders', 'POST', { sku: 'topup', amount, provider: 'alipay', requestId: randomUUID() }, token);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const paid = await f.req(`/billing/orders/${o.body.id}`, 'POST', undefined, token);
  assert.equal(paid.body.status, 'paid');
  return o.body;
};

test('充值默认关闭；只能选后端规定的档位；金额由后端定', async t => {
  const off = await fixture(t, { BILLING_TOPUP_ENABLED: 'false' });
  assert.equal((await off.req('/billing/orders', 'POST', { sku: 'topup', amount: 1000, provider: 'alipay', requestId: randomUUID() })).status, 503);
  assert.equal((await off.req('/billing/catalog')).body.topupEnabled, false);
  const f = await fixture(t);
  const cat = (await f.req('/billing/catalog')).body;
  assert.deepEqual(cat.topupAmounts, [1000, 3000, 10000, 30000]);
  assert.equal((await f.req('/billing/orders', 'POST', { sku: 'topup', amount: 1, provider: 'alipay', requestId: randomUUID() })).status, 400);
  assert.equal((await f.req('/billing/orders', 'POST', { sku: 'topup', amount: 1500, provider: 'alipay', requestId: randomUUID() })).status, 400);
  const o = (await f.req('/billing/orders', 'POST', { sku: 'topup', amount: 3000, provider: 'alipay', requestId: randomUUID(), owner: 'other@example.test', paid: true })).body;
  assert.equal(o.amount, 3000); assert.equal(o.status, 'pending'); assert.match(o.title, /AI 钱包充值 ¥30/);
  assert.equal((await f.req('/billing/account')).body.wallet.balanceCents, 0, '没付款不到账');
});

test('付款核验后到账一次；重复查单不重复加钱；别人看不到我的钱包', async t => {
  const f = await fixture(t);
  const o = await topup(f, 1000);
  await f.req(`/billing/orders/${o.id}`, 'POST');
  await f.req(`/billing/orders/${o.id}`, 'POST');
  const me = (await f.req('/billing/account')).body.wallet;
  assert.equal(me.balanceCents, 1000);
  assert.equal(me.tx.length, 1); assert.equal(me.tx[0].type, 'topup');
  assert.equal((await f.req('/billing/account', 'GET', undefined, 'other')).body.wallet.balanceCents, 0);
  // 同一个请求标识不能换金额
  const rid = randomUUID();
  assert.equal((await f.req('/billing/orders', 'POST', { sku: 'topup', amount: 1000, provider: 'alipay', requestId: rid })).status, 200);
  assert.equal((await f.req('/billing/orders', 'POST', { sku: 'topup', amount: 3000, provider: 'alipay', requestId: rid })).status, 409);
});

test('额度不够时按模型价从钱包自动兑换；没定价的模型不碰钱包；余额不够给出明确提示', async t => {
  const f = await fixture(t);
  // 先不定价：没有额度、钱包有钱也不能用
  assert.equal((await f.req('/admin/shared/models', 'PUT', model, 'admin')).status, 200);
  await topup(f, 1000);
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 402);
  assert.equal((await f.req('/billing/account')).body.wallet.balanceCents, 1000, '没定价不扣钱');
  // 定价 ¥2 / 百万 Token：额度不够 → 至少兑换 ¥1 = 50 万 Token
  assert.equal((await f.req('/admin/shared/models', 'PUT', { ...model, apiKey: '', priceCentsPerM: 200 }, 'admin')).status, 200);
  const r = await f.req('/shared/chat', 'POST', chat());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = (await f.req('/billing/account')).body.wallet;
  assert.equal(w.balanceCents, 900);
  assert.equal(w.tx[0].type, 'spend'); assert.equal(w.tx[0].cents, 100);
  const cat = (await f.req('/shared/catalog')).body;
  assert.equal(cat.walletCents, 900);
  assert.equal(cat.balances.economy.granted, 500000);
  assert.equal(cat.balances.economy.spent, 100);
  assert.equal(cat.models[0].priceCentsPerM, 200);
  // 兑换来的额度够用时不再扣钱
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 200);
  assert.equal((await f.req('/billing/account')).body.wallet.balanceCents, 900);
  // 钱包空的人：照旧是额度不足（没充过钱不提示钱包）
  const other = await f.req('/shared/chat', 'POST', chat(), 'other');
  assert.equal(other.status, 402); assert.doesNotMatch(other.body.error, /钱包/);
});

test('钱包里有钱但不够这次兑换：提示余额不足，不透支', async t => {
  const f = await fixture(t);
  assert.equal((await f.req('/admin/shared/models', 'PUT', { ...model, priceCentsPerM: 2_000_000 }, 'admin')).status, 200); // ¥20,000 / 百万 → 一次要 >¥10
  await topup(f, 1000);
  const r = await f.req('/shared/chat', 'POST', chat());
  assert.equal(r.status, 402); assert.match(r.body.error, /AI 钱包余额不足/);
  assert.equal((await f.req('/billing/account')).body.wallet.balanceCents, 1000);
});

// ===== 服务广场用 AI 钱包结算 =====
const listing = { revision: 0, title: '帮忙访谈 5 位家长', providerName: '其他用户的工作室', category: 'human', description: '电话访谈并整理记录', inputs: '访谈提纲', deliverables: '访谈记录', limits: '不保证结论', location: '线上', contact: 'seller-contact', unit: '次', priceCents: 1000, deliveryDays: 3, published: true, confirmed: true };
const deliver = { action: 'deliver', summary: '访谈完成，记录见链接', source: 'https://example.test/notes.md', limitation: '样本小' };
async function market(f) {
  const service = (await f.req('/market/services', 'PUT', listing, 'other')).body;
  const order = async (token = 'user') => (await f.req('/market/requests', 'POST', { requestId: randomUUID(), serviceId: service.id, revision: service.revision, quantity: 1, requirements: '访谈退费家长', acceptance: '5 份记录' }, token)).body;
  const act = async (o, token, extra) => (await f.req(`/market/orders/${o.id}/action`, 'POST', { revision: o.revision, ...extra }, token));
  const wallet = async token => (await f.req('/billing/account', 'GET', undefined, token)).body.wallet;
  return { service, order, act, wallet };
}

test('钱包付款 → 冻结 → 卖方交付、买方验收 → 钱进卖方钱包（只能在平台内花）', async t => {
  const f = await fixture(t); const m = await market(f);
  await topup(f, 3000);
  let o = await m.order();
  let r = await m.act(o, 'user', { action: 'confirm', confirmed: true, pay: 'wallet', contact: 'buyer-contact' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); o = r.body;
  assert.equal(o.settlement.method, 'wallet');
  assert.equal((await m.wallet('user')).balanceCents, 2000, '下单就冻结 ¥10');
  r = await m.act(o, 'user', { action: 'report_paid' }); assert.equal(r.status, 409, '钱包订单不需要线下确认');
  o = (await m.act(o, 'other', { action: 'accept' })).body;
  r = await m.act(o, 'user', { action: 'cancel', note: '不想要了' }); assert.equal(r.status, 409, '接单后买方不能单方面取消');
  o = (await m.act(o, 'other', deliver)).body;
  assert.equal((await m.wallet('other')).balanceCents, 0, '没验收不放款');
  o = (await m.act(o, 'user', { action: 'complete', note: '验收通过' })).body;
  const seller = await m.wallet('other');
  assert.equal(seller.balanceCents, 1000); assert.equal(seller.tx[0].type, 'income');
  // 放款只一次
  await f.req('/market/state', 'GET', undefined, 'user'); await m.act(o, 'user', { action: 'complete', note: 'again' });
  assert.equal((await m.wallet('other')).balanceCents, 1000);
  assert.equal((await m.wallet('user')).balanceCents, 2000);
  // 卖方赚到的钱可以继续在平台内用：拿去兑换模型额度
  assert.equal((await f.req('/admin/shared/models', 'PUT', { ...model, priceCentsPerM: 200 }, 'admin')).status, 200);
  assert.equal((await f.req('/shared/chat', 'POST', chat(), 'other')).status, 200);
  assert.equal((await m.wallet('other')).balanceCents, 900);
});

test('卖方拒单 / 买方在接单前取消：担保款全额退回；余额不够不能下单', async t => {
  const f = await fixture(t); const m = await market(f);
  let o = await m.order();
  let r = await m.act(o, 'user', { action: 'confirm', confirmed: true, pay: 'wallet', contact: 'buyer-contact' });
  assert.equal(r.status, 402); assert.match(r.body.error, /余额不足/);
  o = (await f.req('/market/state', 'GET', undefined, 'user')).body.orders.find(x => x.id === o.id);
  assert.equal(o.status, 'proposed', '没付成，订单还是待确认');
  await topup(f, 1000);
  o = (await m.act(o, 'user', { action: 'confirm', confirmed: true, pay: 'wallet', contact: 'buyer-contact' })).body;
  assert.equal((await m.wallet('user')).balanceCents, 0);
  o = (await m.act(o, 'other', { action: 'reject', note: '排不过来' })).body;
  assert.equal((await m.wallet('user')).balanceCents, 1000, '拒单退款');
  let o2 = await m.order();
  o2 = (await m.act(o2, 'user', { action: 'confirm', confirmed: true, pay: 'wallet', contact: 'buyer-contact' })).body;
  o2 = (await m.act(o2, 'user', { action: 'cancel', note: '改主意了' })).body;
  assert.equal((await m.wallet('user')).balanceCents, 1000, '接单前取消退款');
  assert.equal((await m.wallet('other')).balanceCents, 0);
});

test('AI 项目经理（Agent 令牌）只能在授权额度内用钱包下单；超额不扣钱', async t => {
  const f = await fixture(t); const m = await market(f);
  await topup(f, 3000);
  const c = { projectId: 'p', branchId: 'main', scopeId: 'root' };
  const small = (await f.req('/market/tokens', 'POST', { name: 'AI 项目经理', context: c, permissions: ['order_commit', 'demand_publish'], maxOrderCents: 500, totalBudgetCents: 3000 })).body.token;
  let o = await m.order(small);
  let r = await m.act(o, small, { action: 'confirm', confirmed: true, pay: 'wallet', contact: 'buyer-contact' });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.match(r.body.error, /额度/);
  assert.equal((await m.wallet('user')).balanceCents, 3000, '超出 AI 的单笔授权：钱退回、不扣');
  const ok = (await f.req('/market/tokens', 'POST', { name: 'AI 项目经理', context: c, permissions: ['order_commit'], maxOrderCents: 1000, totalBudgetCents: 3000 })).body.token;
  o = await m.order(ok);
  r = await m.act(o, ok, { action: 'confirm', confirmed: true, pay: 'wallet', contact: 'buyer-contact' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await m.wallet('user')).balanceCents, 2000);
});

test('发布需求 → 别人（或 AI）接单报价 → 选中时钱包担保 → 验收后放款给接单方', async t => {
  const f = await fixture(t); const m = await market(f);
  await topup(f, 3000);
  const d = (await f.req('/market/demands', 'POST', { requestId: randomUUID(), title: '找 5 位家长聊续费', requirements: '电话访谈', acceptance: '5 份记录', budgetCents: 2000, deadline: Date.now() + 7 * 864e5, confirmed: true })).body;
  const sellerAgent = (await f.req('/market/tokens', 'POST', { name: '别人的 AI 接单员', context: { projectId: 'q', branchId: 'main', scopeId: 'root' }, permissions: ['demand_respond', 'order_execute'], maxOrderCents: 0, totalBudgetCents: 0 }, 'other')).body.token;
  const bidded = (await f.req(`/market/demands/${d.id}/respond`, 'POST', { proposal: '我能做：AI 先拟提纲，人工电话访谈', priceCents: 1500, deliveryDays: 3, confirmed: true }, sellerAgent)).body;
  const mine = (await f.req('/market/state')).body.demands.find(x => x.id === d.id);
  const bid = mine.bids[0];
  const r = await f.req(`/market/demands/${d.id}/action`, 'POST', { action: 'award', bidId: bid.id, revision: mine.revision, confirmed: true, pay: 'wallet' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await m.wallet('user')).balanceCents, 1500);
  // 重复提交选中：不重复冻结，也不会把已成功订单的钱退掉
  const again = await f.req(`/market/demands/${d.id}/action`, 'POST', { action: 'award', bidId: bid.id, revision: mine.revision, confirmed: true, pay: 'wallet' });
  assert.equal(again.status, 409); assert.equal((await m.wallet('user')).balanceCents, 1500);
  let o = (await f.req('/market/state')).body.orders.find(x => x.demandId === d.id);
  assert.equal(o.settlement.method, 'wallet');
  o = (await m.act(o, sellerAgent, deliver)).body;
  o = (await m.act(o, 'user', { action: 'complete', note: '收到' })).body;
  assert.equal((await m.wallet('other')).balanceCents, 1500, '接单方（其 AI）赚到的钱进了它主人的钱包');
});

test('手动把钱包余额充成某个模型的 API 额度', async t => {
  const f = await fixture(t);
  assert.equal((await f.req('/admin/shared/models', 'PUT', { ...model, priceCentsPerM: 200 }, 'admin')).status, 200);
  assert.equal((await f.req('/shared/wallet-convert', 'POST', { modelId: model.id, cents: 500, requestId: randomUUID() })).status, 402);
  await topup(f, 1000);
  const rid = randomUUID();
  const r = await f.req('/shared/wallet-convert', 'POST', { modelId: model.id, cents: 500, requestId: rid });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await f.req('/shared/wallet-convert', 'POST', { modelId: model.id, cents: 500, requestId: rid });
  assert.equal((await f.req('/billing/account')).body.wallet.balanceCents, 500, '同一请求只扣一次');
  assert.equal((await f.req('/shared/catalog')).body.balances.economy.granted, 2_500_000);
  assert.equal((await f.req('/shared/wallet-convert', 'POST', { modelId: model.id, cents: 50, requestId: randomUUID() })).status, 400, '至少 ¥1');
});
