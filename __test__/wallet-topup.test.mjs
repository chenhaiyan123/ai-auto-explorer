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
