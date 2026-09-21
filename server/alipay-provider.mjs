import fs from 'node:fs/promises';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

const gateway = 'https://openapi.alipay.com/gateway.do';
export const canonical = (values, notification = false) => Object.keys(values).sort()
  .filter(k => k !== 'sign' && (!notification || k !== 'sign_type') && values[k] !== '')
  .map(k => `${k}=${values[k]}`).join('&');
export const amountInFen = value => {
  if (typeof value !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error('支付金额格式无效');
  const [yuan, fraction = ''] = value.split('.');
  return Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
};
const timestamp = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');

// Signature verification needs the exact response substring, not re-serialized JSON.
export function signedResponse(raw, name, publicKey) {
  let i = 0; const values = new Map();
  const whitespace = () => { while (/\s/.test(raw[i] || '') && i < raw.length) i++; };
  const stringEnd = start => { let p = start + 1; for (; p < raw.length; p++) { if (raw[p] === '\\') p++; else if (raw[p] === '"') return p + 1; } throw new Error('支付响应格式错误'); };
  whitespace(); if (raw[i++] !== '{') throw new Error('支付响应格式错误');
  while (true) {
    whitespace(); if (raw[i] === '}') { i++; break; }
    if (raw[i] !== '"') throw new Error('支付响应格式错误');
    const end = stringEnd(i); const key = JSON.parse(raw.slice(i, end)); i = end; whitespace();
    if (raw[i++] !== ':' || values.has(key)) throw new Error('支付响应字段重复或格式错误');
    whitespace(); const start = i; let depth = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (c === '"') { i = stringEnd(i); continue; }
      if (c === '{' || c === '[') depth++;
      if (c === '}' || c === ']') { if (!depth) break; depth--; }
      if (c === ',' && !depth) break;
      i++;
    }
    values.set(key, raw.slice(start, i).trim());
    if (raw[i] === ',') { i++; continue; }
    if (raw[i++] === '}') break;
    throw new Error('支付响应格式错误');
  }
  whitespace(); if (i !== raw.length) throw new Error('支付响应格式错误');
  const body = values.get(name); const signature = values.get('sign');
  if (!body || !signature || !verify('RSA-SHA256', Buffer.from(body), publicKey, Buffer.from(JSON.parse(signature), 'base64'))) throw new Error('支付宝响应验签失败');
  return JSON.parse(body);
}

/** Direct merchant / RSA2 public-key mode. Secrets are loaded from server-only files. */
export async function createAlipayProvider(env, fetcher = fetch) {
  const required = ['ALIPAY_APP_ID', 'ALIPAY_SELLER_ID', 'ALIPAY_PRIVATE_KEY_FILE', 'ALIPAY_PUBLIC_KEY_FILE', 'BILLING_PUBLIC_URL'];
  if (!required.every(k => env[k])) return null;
  if (!/^\d{10,32}$/.test(env.ALIPAY_APP_ID) || !/^\d{10,32}$/.test(env.ALIPAY_SELLER_ID)) throw new Error('支付宝商户标识格式错误');
  const base = new URL(env.BILLING_PUBLIC_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('支付回调基础地址必须为 HTTPS');
  const privateKey = createPrivateKey(await fs.readFile(env.ALIPAY_PRIVATE_KEY_FILE));
  const publicKey = createPublicKey(await fs.readFile(env.ALIPAY_PUBLIC_KEY_FILE));
  for (const key of [privateKey, publicKey]) if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('支付必须使用至少 2048 位 RSA 密钥');
  const appId = env.ALIPAY_APP_ID; const sellerId = env.ALIPAY_SELLER_ID;
  const signedParams = (method, biz, extras = {}) => {
    const params = { app_id: appId, method, format: 'JSON', charset: 'utf-8', sign_type: 'RSA2', timestamp: timestamp(), version: '1.0', biz_content: JSON.stringify(biz), ...extras };
    return { ...params, sign: sign('RSA-SHA256', Buffer.from(canonical(params)), privateKey).toString('base64') };
  };
  const payment = data => {
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(data.trade_status)) return null;
    if (typeof data.trade_no !== 'string' || !/^[\w-]{1,100}$/.test(data.trade_no)) throw new Error('支付宝交易号无效');
    return { orderId: data.out_trade_no, transactionId: data.trade_no, amount: amountInFen(data.total_amount), currency: 'CNY' };
  };
  return {
    id: 'alipay',
    create(order) {
      const params = signedParams('alipay.trade.page.pay', { out_trade_no: order.id, product_code: 'FAST_INSTANT_TRADE_PAY', total_amount: (order.amount / 100).toFixed(2), subject: order.title, seller_id: sellerId,
        time_expire: new Date(order.expiresAt + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') },
      { notify_url: `${base.href.replace(/\/$/, '')}/billing/notify/alipay` });
      return { checkoutUrl: `${gateway}?${new URLSearchParams(params)}` };
    },
    verifyNotification(raw) {
      const params = new URLSearchParams(raw); const data = {};
      for (const [key, value] of params) { if (Object.hasOwn(data, key)) throw new Error('通知字段重复'); Object.defineProperty(data, key, { value, enumerable: true }); }
      if (data.sign_type !== 'RSA2' || !data.sign || !verify('RSA-SHA256', Buffer.from(canonical(data, true)), publicKey, Buffer.from(data.sign, 'base64'))) throw new Error('支付宝通知验签失败');
      if (data.app_id !== appId || data.seller_id !== sellerId) throw new Error('支付宝商户或应用不匹配');
      return payment(data);
    },
    async query(order) {
      const response = await fetcher(gateway, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(signedParams('alipay.trade.query', { out_trade_no: order.id })).toString(), signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error('支付宝查单暂不可用');
      const raw = await response.text(); if (raw.length > 100000) throw new Error('支付宝响应过大');
      const data = signedResponse(raw, 'alipay_trade_query_response', publicKey);
      if (data.code === '40004' && data.sub_code === 'ACQ.TRADE_NOT_EXIST') return null;
      if (data.code !== '10000') throw new Error('支付宝尚未返回有效订单状态');
      return payment(data);
    },
  };
}
