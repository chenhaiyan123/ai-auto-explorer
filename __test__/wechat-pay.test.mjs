import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCipheriv, randomBytes, randomUUID, sign, verify, X509Certificate } from 'node:crypto';
import { createWechatProvider, validWechatCodeUrl } from '../server/wechat-provider.mjs';
import { downloadWechatCertificates } from '../server/wechat-certificates.mjs';
import { Billing } from '../server/billing.mjs';
import { WakeStorage } from '../server/wake-storage.mjs';
import { createWakeServer } from '../server/wake-server.mjs';

async function fixture(t, autoCleanup = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-pay-test-'));
  if (autoCleanup) t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const [name, cn] of [['merchant', '1900000001'], ['platform', 'WeChat-Test']]) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, `${name}.key`), '-out', path.join(dir, `${name}.pem`), '-days', '2', '-subj', `/CN=${cn}`, '-set_serial', `0x${randomBytes(20).toString('hex')}`], { stdio: 'ignore' });
  const merchant = new X509Certificate(await fs.readFile(path.join(dir, 'merchant.pem')));
  const platformPem = await fs.readFile(path.join(dir, 'platform.pem'), 'utf8');
  const platform = new X509Certificate(platformPem); const platformKey = await fs.readFile(path.join(dir, 'platform.key'));
  const key = randomBytes(16).toString('hex'); await fs.writeFile(path.join(dir, 'api.key'), key);
  const env = { WECHAT_MCH_ID: '1900000001', WECHAT_APP_ID: 'wx0000000000000000', WECHAT_CERT_SERIAL: merchant.serialNumber,
    WECHAT_CERT_FILE: path.join(dir, 'merchant.pem'), WECHAT_PRIVATE_KEY_FILE: path.join(dir, 'merchant.key'), WECHAT_API_V3_KEY_FILE: path.join(dir, 'api.key'), WECHAT_PLATFORM_CERT_FILE: path.join(dir, 'platform.pem'), BILLING_PUBLIC_URL: 'https://billing.example.test', BILLING_SALES_ENABLED: 'true', BILLING_PRO_ENABLED: 'true' };
  const encrypt = (text, associated_data) => {
    const nonce = randomBytes(6).toString('hex'); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce)); cipher.setAAD(Buffer.from(associated_data));
    return { algorithm: 'AEAD_AES_256_GCM', associated_data, nonce, ciphertext: Buffer.concat([cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString('base64') };
  };
  const headers = (raw, timestamp = String(Math.floor(Date.now() / 1000))) => {
    const nonce = randomUUID(); return { 'wechatpay-serial': platform.serialNumber, 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce,
      'wechatpay-signature': sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`), platformKey).toString('base64') };
  };
  const paid = (order, changes = {}) => ({ appid: env.WECHAT_APP_ID, mchid: env.WECHAT_MCH_ID, out_trade_no: order.id, transaction_id: 'WX_TEST_TRANSACTION', trade_type: 'NATIVE', trade_state: 'SUCCESS', amount: { total: order.amount, currency: 'CNY' }, ...changes });
  const notification = (data, changes = {}) => {
    const raw = JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource_type: 'encrypt-resource', resource: encrypt(JSON.stringify(data), 'transaction'), ...changes });
    return { raw, headers: headers(raw) };
  };
  const seen = []; let query; let corrupt = false;
  const fetcher = async (url, options) => {
    const u = new URL(url); assert.equal(u.origin, 'https://api.mch.weixin.qq.com'); assert.equal(options.headers['Accept-Language'], 'zh-CN');
    const auth = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    assert.equal(auth.mchid, env.WECHAT_MCH_ID); assert.equal(auth.serial_no, merchant.serialNumber);
    assert.ok(verify('RSA-SHA256', Buffer.from(`${options.method || 'GET'}\n${u.pathname}${u.search}\n${auth.timestamp}\n${auth.nonce_str}\n${options.body || ''}\n`), merchant.publicKey, Buffer.from(auth.signature, 'base64')));
    seen.push({ route: u.pathname, body: options.body && JSON.parse(options.body) });
    let data;
    if (u.pathname === '/v3/certificates') data = { data: [{ serial_no: platform.serialNumber, effective_time: new Date(platform.validFrom).toISOString(), expire_time: new Date(platform.validTo).toISOString(), encrypt_certificate: encrypt(platformPem, 'certificate') }] };
    else if (u.pathname.endsWith('/native')) data = { code_url: 'weixin://wxpay/bizpayurl?pr=TEST123' };
    else data = query || { code: 'ORDER_NOT_EXIST' };
    const raw = JSON.stringify(data); const h = headers(raw); if (corrupt) h['wechatpay-signature'] = 'invalid';
    return new Response(raw, { status: data.code ? 404 : 200, headers: h });
  };
  return { env, dir, key, headers, paid, notification, fetcher, seen, setQuery: v => { query = v; }, corrupt: v => { corrupt = v; } };
}

test('平台证书：认证解密和响应验签全部通过才保存', async t => {
  const f = await fixture(t); const result = await downloadWechatCertificates(f.env, path.join(f.dir, 'download'), f.fetcher);
  assert.equal(result.verified, true); assert.equal(result.certificates.length, 1);
  f.corrupt(true); await assert.rejects(downloadWechatCertificates(f.env, path.join(f.dir, 'invalid'), f.fetcher), /验签失败/);
  await assert.rejects(fs.access(path.join(f.dir, 'invalid')));
  f.corrupt(false); await fs.writeFile(f.env.WECHAT_API_V3_KEY_FILE, 'A'.repeat(32));
  await assert.rejects(downloadWechatCertificates(f.env, path.join(f.dir, 'wrong-key'), f.fetcher), /解密校验失败/);
});
test('微信 Native 请求签名、服务端价格、二维码和查单结果', async t => {
  const f = await fixture(t); const p = await createWechatProvider(f.env, f.fetcher);
  const order = { id: `HE${'a'.repeat(30)}`, amount: 399, title: '测试成果包', expiresAt: Date.now() + 900000 };
  assert.equal((await p.create(order)).codeUrl, 'weixin://wxpay/bizpayurl?pr=TEST123');
  const body = f.seen.find(v => v.route.endsWith('/native')).body;
  assert.equal(body.amount.total, 399); assert.equal(body.notify_url, 'https://billing.example.test/billing/notify/wechat');
  assert.equal(await p.query(order), null);
  f.setQuery(f.paid(order)); assert.equal((await p.query(order)).amount, 399);
  f.setQuery(f.paid(order, { appid: 'other' })); await assert.rejects(p.query(order), /应用不匹配/);
  f.corrupt(true); await assert.rejects(p.create(order), /验签失败/);
  assert.equal(validWechatCodeUrl('https://example.test/fake'), false);
  assert.equal(validWechatCodeUrl('weixin://evil/bizpayurl?pr=123'), false);
});
test('微信通知：拒绝过期、伪造、密文篡改和错误商户', async t => {
  const f = await fixture(t); const p = await createWechatProvider(f.env, f.fetcher);
  const order = { id: `HE${'a'.repeat(30)}`, amount: 399 }; const n = f.notification(f.paid(order));
  assert.equal((await p.verifyNotification(n.raw, n.headers)).amount, 399);
  await assert.rejects(p.verifyNotification(n.raw, { ...n.headers, 'wechatpay-signature': 'bad' }), /验签失败/);
  await assert.rejects(p.verifyNotification(n.raw, f.headers(n.raw, '1000000000')), /签名头无效/);
  const wrong = f.notification(f.paid(order, { mchid: 'other' })); await assert.rejects(p.verifyNotification(wrong.raw, wrong.headers), /商户或应用不匹配/);
  const event = JSON.parse(n.raw); event.resource.ciphertext = Buffer.alloc(40).toString('base64'); const raw = JSON.stringify(event);
  await assert.rejects(p.verifyNotification(raw, f.headers(raw)));
});
test('远端下单前持久化；超时重试和重启沿用同一订单；重复回调只解锁一次', async t => {
  const f = await fixture(t); const store = new WakeStorage(path.join(f.dir, 'data'), randomBytes(32)); await store.initialize();
  let fail = true; const ids = [];
  const provider = { create: async o => { ids.push(o.id); if (fail) throw new Error('timeout'); return { codeUrl: 'weixin://wxpay/bizpayurl?pr=TEST123' }; } };
  let billing = new Billing(store, { wechat: provider }, f.env);
  const report = { title: 'Test', abstract: '', sections: [], conclusions: [], openQuestions: [], references: [] };
  const artifact = await billing.saveArtifact('owner', { report });
  const body = { sku: 'export', provider: 'wechat', artifactId: artifact.id, requestId: randomUUID() };
  await assert.rejects(billing.createOrder('owner', body), /timeout/);
  assert.equal((await billing.view('owner')).orders.length, 1);
  billing = new Billing(store, { wechat: provider }, f.env); fail = false;
  const [a, b] = await Promise.all([billing.createOrder('owner', body), billing.createOrder('owner', body)]);
  assert.equal(a.id, b.id); assert.equal(new Set(ids).size, 1);
  await assert.rejects(billing.settle('wechat', { orderId: a.id, transactionId: 'WX_TEST', amount: 1, currency: 'CNY' }), /金额/);
  await Promise.all(Array.from({ length: 3 }, () => billing.settle('wechat', { orderId: a.id, transactionId: 'WX_TEST', amount: 399, currency: 'CNY' })));
  assert.deepEqual((await billing.view('owner')).unlocked, [artifact.id]);
  assert.equal((await billing.view('owner')).orders[0].codeUrl, undefined);
  await assert.rejects(billing.getOrder('other', a.id), /不存在/);
});
test('HTTP 微信回调无需登录，但必须验签；重复回调、查单补偿与权限隔离', async t => {
  const f = await fixture(t, false); const p = await createWechatProvider(f.env, f.fetcher);
  const env = { ...f.env, WAKE_DATA_DIR: path.join(f.dir, 'server'), WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_ADMIN_IDENTITIES: 'admin@example.test' };
  const app = await createWakeServer({ env, paymentProviders: { wechat: p }, fetch: async () => Response.json({ user: { email: 'user@example.test' } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(async () => { await app.close(); await fs.rm(f.dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const create = async () => { const r = await fetch(`${base}/billing/orders`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ sku: 'pro_month', provider: 'wechat', requestId: randomUUID() }) }); assert.equal(r.status, 200); return r.json(); };
  const order = await create(); const n = f.notification(f.paid(order));
  const post = h => fetch(`${base}/billing/notify/wechat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: n.raw });
  assert.equal((await post({ ...n.headers, 'wechatpay-signature': 'bad' })).status, 400);
  assert.equal((await post(n.headers)).status, 204); assert.equal((await post(n.headers)).status, 204);
  const get = async route => (await fetch(base + route, { headers: { Authorization: 'Bearer test' } })).json();
  assert.equal((await get('/billing/account')).plan, 'pro');
  const second = await create(); f.setQuery(f.paid(second, { transaction_id: 'WX_TEST_QUERY' }));
  const result = await fetch(`${base}/billing/orders/${second.id}`, { method: 'POST', headers: { Authorization: 'Bearer test' } });
  assert.equal((await result.json()).status, 'paid');
});
