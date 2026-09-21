import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWakeServer } from '../server/wake-server.mjs';
import { addCalendarMonth, Billing } from '../server/billing.mjs';
import { canonical, amountInFen, signedResponse } from '../server/alipay-provider.mjs';
import { WakeStorage } from '../server/wake-storage.mjs';

const keys = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const merchant = keys(); const alipay = keys();
const report = { title: '测试研究：保留不确定性', abstract: '这是假数据，仅用于测试', sections: [{ title: '结果', content: '<script>alert(1)</script>没有实测结论' }], conclusions: ['需要真实数据'], openQuestions: ['是否可复现？'], references: ['https://example.test/source'] };
const pro = () => ({ sku: 'pro_month', provider: 'alipay', requestId: randomUUID() });
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-test-'));
  await fs.writeFile(path.join(dir, 'merchant.pem'), merchant.privateKey); await fs.writeFile(path.join(dir, 'platform.pem'), alipay.publicKey);
  const env = { WAKE_DATA_DIR: path.join(dir, 'data'), WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_ADMIN_IDENTITIES: 'admin@example.test',
    BILLING_SALES_ENABLED: 'true', BILLING_PRO_ENABLED: 'true', BILLING_PUBLIC_URL: 'https://billing.example.test', ALIPAY_APP_ID: '2026000000000001', ALIPAY_SELLER_ID: '2088000000000001',
    ALIPAY_PRIVATE_KEY_FILE: path.join(dir, 'merchant.pem'), ALIPAY_PUBLIC_KEY_FILE: path.join(dir, 'platform.pem'), ...overrides };
  let queryReply;
  const fetcher = async (url, options) => {
    if (String(url).startsWith(env.WAKE_AUTH_API)) {
      const token = options.headers.Authorization?.slice(7);
      return ['user', 'other', 'admin'].includes(token) ? Response.json({ user: { email: `${token}@example.test` } }) : new Response('{}', { status: 401 });
    }
    assert.equal(url, 'https://openapi.alipay.com/gateway.do');
    const params = Object.fromEntries(new URLSearchParams(options.body));
    assert.ok(verify('RSA-SHA256', Buffer.from(canonical(params)), merchant.publicKey, Buffer.from(params.sign, 'base64')));
    const body = queryReply || { code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST' }; const raw = JSON.stringify(body);
    return new Response(`{"alipay_trade_query_response":${raw},"sign":${JSON.stringify(sign('RSA-SHA256', Buffer.from(raw), alipay.privateKey).toString('base64'))}}`);
  };
  let app = await createWakeServer({ env, fetch: fetcher });
  const listen = () => new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); await listen();
  const base = () => `http://127.0.0.1:${app.server.address().port}`;
  const req = async (route, method = 'GET', body, token = 'user') => {
    const r = await fetch(base() + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  const callbackBody = (o, changes = {}) => {
    const data = { app_id: env.ALIPAY_APP_ID, seller_id: env.ALIPAY_SELLER_ID, out_trade_no: o.id, trade_no: `TEST${o.id}`, trade_status: 'TRADE_SUCCESS', total_amount: (o.amount / 100).toFixed(2), sign_type: 'RSA2', ...changes };
    return new URLSearchParams({ ...data, sign: sign('RSA-SHA256', Buffer.from(canonical(data, true)), alipay.privateKey).toString('base64') }).toString();
  };
  const notify = async raw => { const r = await fetch(base() + '/billing/notify/alipay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: raw }); return { status: r.status, text: await r.text() }; };
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { req, notify, callbackBody, env, setQuery: v => { queryReply = v; }, restart: async () => { await app.close(); app = await createWakeServer({ env, fetch: fetcher }); await listen(); } };
}
test('支付默认关闭、微信未接入、未登录与非管理员不能访问账本', async t => {
  const f = await fixture(t, { BILLING_SALES_ENABLED: 'false' });
  assert.equal((await f.req('/billing/catalog', 'GET', undefined, '')).body.salesEnabled, false);
  assert.equal((await f.req('/billing/catalog')).body.providers.find(p => p.id === 'wechat').ready, false);
  assert.equal((await f.req('/billing/orders', 'POST', pro())).status, 503);
  assert.equal((await f.req('/billing/account', 'GET', undefined, '')).status, 401);
  assert.equal((await f.req('/admin/billing')).status, 403);
  assert.equal((await f.req('/admin/billing', 'GET', undefined, 'admin')).body.totals.paid, 0);
});
test('价格、身份和套餐由后端固定；前端不能自授 Pro 或越权查单', async t => {
  const f = await fixture(t);
  const result = await f.req('/billing/orders', 'POST', { ...pro(), amount: 1, owner: 'other@example.test', plan: 'pro', paid: true });
  assert.equal(result.status, 200); const o = result.body; assert.equal(o.amount, 6900); assert.equal(o.status, 'pending');
  const params = Object.fromEntries(new URL(o.checkoutUrl).searchParams);
  assert.ok(verify('RSA-SHA256', Buffer.from(canonical(params)), merchant.publicKey, Buffer.from(params.sign, 'base64')));
  assert.equal(JSON.parse(params.biz_content).total_amount, '69.00');
  assert.equal((await f.req('/billing/account')).body.plan, 'free');
  assert.equal((await f.req(`/billing/orders/${o.id}`, 'POST', {}, 'other')).status, 404);
  assert.equal((await f.req('/billing/orders', 'POST', { ...pro(), provider: 'wechat' })).status, 503);
  assert.equal((await f.req('/billing/orders', 'POST', { ...pro(), provider: '__proto__' })).status, 503);
});
test('验收名单仅授权真实登录身份，公开接口不泄露名单，未授权账号不能创建订单', async t => {
  const f = await fixture(t, { BILLING_ALLOWED_IDENTITIES: ' user@example.test, ' });
  const catalog = (await f.req('/billing/catalog', 'GET', undefined, '')).body;
  assert.equal(catalog.salesRestricted, true);
  assert.ok(!JSON.stringify(catalog).includes('user@example.test'));
  assert.equal((await f.req('/billing/account')).body.purchaseAllowed, true);
  const otherAccount = (await f.req('/billing/account', 'GET', undefined, 'other')).body;
  assert.equal(otherAccount.purchaseAllowed, false);
  assert.ok(!JSON.stringify(otherAccount).includes('user@example.test'));
  const denied = await f.req('/billing/orders', 'POST', { ...pro(), owner: 'user@example.test', email: 'user@example.test', purchaseAllowed: true }, 'other');
  assert.equal(denied.status, 403);
  assert.equal((await f.req('/admin/billing', 'GET', undefined, 'admin')).body.totals.orders, 0);
  assert.equal((await f.req('/billing/orders', 'POST', pro())).status, 200);
  // Administrators do not bypass a separately configured payment test list.
  assert.equal((await f.req('/billing/orders', 'POST', pro(), 'admin')).status, 403);
  f.env.BILLING_ALLOWED_IDENTITIES = ''; await f.restart();
  assert.equal((await f.req('/billing/catalog')).body.salesRestricted, false);
  assert.equal((await f.req('/billing/account', 'GET', undefined, 'other')).body.purchaseAllowed, true);
  assert.equal((await f.req('/billing/orders', 'POST', pro(), 'other')).status, 200);
});
test('验收名单收紧不阻断旧订单回调、查单及已购下载，支付总开关仍优先关闭', async t => {
  const f = await fixture(t);
  const artifact = (await f.req('/billing/artifacts', 'POST', { report })).body;
  const order = (await f.req('/billing/orders', 'POST', { sku: 'export', provider: 'alipay', requestId: randomUUID(), artifactId: artifact.id })).body;
  f.env.BILLING_ALLOWED_IDENTITIES = 'other@example.test'; await f.restart();
  assert.equal((await f.req('/billing/account')).body.purchaseAllowed, false);
  assert.equal((await f.notify(f.callbackBody(order))).status, 200);
  assert.equal((await f.req(`/billing/orders/${order.id}`, 'POST')).body.status, 'paid');
  assert.equal((await f.req(`/billing/artifacts/${artifact.id}/download`, 'POST')).status, 200);
  assert.equal((await f.req('/billing/orders', 'POST', pro())).status, 403);
  f.env.BILLING_SALES_ENABLED = 'false'; await f.restart();
  assert.equal((await f.req('/billing/account', 'GET', undefined, 'other')).body.purchaseAllowed, false);
  assert.equal((await f.req('/billing/orders', 'POST', pro(), 'other')).status, 503);
});
test('重复及并发下单复用订单，幂等标识不能用于不同商品', async t => {
  const f = await fixture(t); const body = pro();
  const results = await Promise.all(Array.from({ length: 5 }, () => f.req('/billing/orders', 'POST', body)));
  assert.equal(new Set(results.map(r => r.body.id)).size, 1);
  assert.equal((await f.req('/billing/orders', 'POST', pro())).body.id, results[0].body.id);
  assert.equal((await f.req('/billing/orders', 'POST', { ...body, sku: 'export', artifactId: 'other' })).status, 409);
});
test('无效签名、错误金额/商户/应用/重复字段都不能开通会员', async t => {
  const f = await fixture(t); const o = (await f.req('/billing/orders', 'POST', pro())).body;
  for (const changes of [{ total_amount: '0.01' }, { seller_id: 'wrong' }, { app_id: 'wrong' }, { out_trade_no: 'wrong' }]) assert.equal((await f.notify(f.callbackBody(o, changes))).status, 400);
  assert.equal((await f.notify(f.callbackBody(o).replace('TRADE_SUCCESS', 'TRADE_FINISHED'))).status, 400);
  assert.equal((await f.notify(f.callbackBody(o) + '&total_amount=0.01')).status, 400);
  assert.equal((await f.notify(f.callbackBody(o, { trade_status: 'WAIT_BUYER_PAY' }))).status, 200);
  assert.equal((await f.req('/billing/account')).body.plan, 'free');
});
test('真实 RSA2 测试签名回调原子开通，重放与重启不重复延期', async t => {
  const f = await fixture(t); const o = (await f.req('/billing/orders', 'POST', pro())).body; const raw = f.callbackBody(o);
  const responses = await Promise.all(Array.from({ length: 6 }, () => f.notify(raw)));
  assert.ok(responses.every(r => r.text === 'success'));
  const account = (await f.req('/billing/account')).body; assert.equal(account.plan, 'pro'); assert.ok(account.proUntil > Date.now());
  assert.equal(account.orders[0].status, 'paid'); assert.equal(account.orders[0].checkoutUrl, undefined);
  await f.restart(); await f.notify(raw);
  assert.equal((await f.req('/billing/account')).body.proUntil, account.proUntil);
  assert.equal((await f.req('/billing/account', 'GET', undefined, 'other')).body.plan, 'free');
  assert.equal((await f.req('/admin/billing', 'GET', undefined, 'admin')).body.totals.paidAmount, 6900);
  for (const file of await fs.readdir(f.env.WAKE_DATA_DIR)) assert.ok(!(await fs.readFile(path.join(f.env.WAKE_DATA_DIR, file), 'utf8')).includes('user@example.test'));
});
test('丢失回调可经验签查单恢复，其他订单的结果不能错配', async t => {
  const f = await fixture(t); const o = (await f.req('/billing/orders', 'POST', pro())).body;
  f.setQuery({ code: '10000', trade_status: 'TRADE_SUCCESS', out_trade_no: o.id, trade_no: 'QUERY_TEST', total_amount: '69.00' });
  assert.equal((await f.req(`/billing/orders/${o.id}`, 'POST')).body.status, 'paid');
  const other = (await f.req('/billing/orders', 'POST', pro(), 'other')).body;
  assert.ok((await f.req(`/billing/orders/${other.id}`, 'POST', {}, 'other')).body.queryWarning);
  assert.equal((await f.req('/billing/account', 'GET', undefined, 'other')).body.plan, 'free');
});
test('成果内容固定版本，399 分付款只解锁对应用户对应版本', async t => {
  const f = await fixture(t);
  const a = (await f.req('/billing/artifacts', 'POST', { report })).body;
  assert.equal((await f.req('/billing/artifacts', 'POST', { report: { ...report } })).body.id, a.id);
  assert.equal((await f.req(`/billing/artifacts/${a.id}/download`, 'POST')).status, 402);
  assert.equal((await f.req(`/billing/artifacts/${a.id}/download`, 'POST', {}, 'other')).status, 404);
  const o = (await f.req('/billing/orders', 'POST', { sku: 'export', artifactId: a.id, provider: 'alipay', requestId: randomUUID() })).body;
  assert.equal(o.amount, 399); await f.notify(f.callbackBody(o));
  const downloaded = await f.req(`/billing/artifacts/${a.id}/download`, 'POST'); assert.deepEqual(downloaded.body.report, report);
  assert.equal((await f.req('/billing/orders', 'POST', { sku: 'export', artifactId: a.id, provider: 'alipay', requestId: randomUUID() })).status, 409);
  const b = (await f.req('/billing/artifacts', 'POST', { report: { ...report, abstract: 'new version' } })).body;
  assert.notEqual(b.id, a.id); assert.equal((await f.req(`/billing/artifacts/${b.id}/download`, 'POST')).status, 402);
  await f.restart(); assert.equal((await f.req(`/billing/artifacts/${a.id}/download`, 'POST')).status, 200);
});
test('Pro 下载版本永久解锁，到期的新版本仍需购买；续费按日历月', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-expiry-')); const storage = new WakeStorage(dir, randomBytes(32)); await storage.initialize();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = Date.UTC(2026, 0, 31, 10);
  const b = new Billing(storage, { alipay: { create: () => ({ checkoutUrl: 'test' }) } }, { BILLING_SALES_ENABLED: 'true', BILLING_PRO_ENABLED: 'true' }, () => now);
  const o = await b.createOrder('user', pro()); await b.settle('alipay', { orderId: o.id, amount: 6900, currency: 'CNY', transactionId: 't1' });
  assert.equal(new Date((await b.view('user')).proUntil).toISOString(), '2026-02-28T10:00:00.000Z');
  const a = await b.saveArtifact('user', { report }); await b.download('user', a.id);
  now = Date.UTC(2026, 2, 1); assert.equal((await b.view('user')).plan, 'free'); await b.download('user', a.id);
  const other = await b.saveArtifact('user', { report: { ...report, title: 'other' } }); await assert.rejects(() => b.download('user', other.id), e => e.status === 402);
  assert.equal(new Date(addCalendarMonth(Date.UTC(2028, 0, 31))).toISOString(), '2028-02-29T00:00:00.000Z');
});
test('支付响应原文验签保留转义与空白，金额解析拒绝模糊格式', () => {
  const raw = '{ "code": "10000", "message":"quote \\" ; escaped \\\\ ; 嵌套", "arr": [{"a":1}] }';
  const signature = sign('RSA-SHA256', Buffer.from(raw), alipay.privateKey).toString('base64');
  const response = ` {"sign": ${JSON.stringify(signature)}, "alipay_trade_query_response": ${raw}} `;
  assert.equal(signedResponse(response, 'alipay_trade_query_response', alipay.publicKey).code, '10000');
  assert.throws(() => signedResponse(response.replace('10000', '10001'), 'alipay_trade_query_response', alipay.publicKey));
  assert.equal(amountInFen('3.99'), 399); assert.equal(amountInFen('69.0'), 6900);
  for (const bad of ['3.990', '-1', '3e2', ' 69', 69, 'NaN']) assert.throws(() => amountInFen(bad));
});
