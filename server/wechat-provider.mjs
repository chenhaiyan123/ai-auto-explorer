import fs from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate, createPrivateKey, createPublicKey, createDecipheriv, randomBytes, sign, verify } from 'node:crypto';
import { downloadWechatCertificates } from './wechat-certificates.mjs';

export const validWechatCodeUrl = value => typeof value === 'string' && /^weixin:\/\/wxpay\/bizpayurl\?[A-Za-z0-9%=&_-]{1,500}$/.test(value);

export async function createWechatProvider(env, fetcher = fetch) {
  const required = ['WECHAT_MCH_ID', 'WECHAT_APP_ID', 'WECHAT_CERT_SERIAL', 'WECHAT_CERT_FILE', 'WECHAT_PRIVATE_KEY_FILE', 'WECHAT_API_V3_KEY_FILE', 'WECHAT_PLATFORM_CERT_FILE', 'BILLING_PUBLIC_URL'];
  if (required.some(k => !env[k])) return null;
  if (!/^\d{6,20}$/.test(env.WECHAT_MCH_ID) || !/^wx[a-zA-Z0-9]{16}$/.test(env.WECHAT_APP_ID)) throw new Error('微信商户或 AppID 格式无效');
  const base = new URL(env.BILLING_PUBLIC_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('支付回调基础地址必须为 HTTPS');
  const merchant = new X509Certificate(await fs.readFile(env.WECHAT_CERT_FILE));
  const privateKey = createPrivateKey(await fs.readFile(env.WECHAT_PRIVATE_KEY_FILE));
  const apiKey = await fs.readFile(env.WECHAT_API_V3_KEY_FILE);
  if (!/^[A-Za-z0-9]{32}$/.test(apiKey.toString())) throw new Error('API v3 密钥必须为 32 位字母数字');
  if (merchant.serialNumber !== env.WECHAT_CERT_SERIAL.toUpperCase() || !merchant.subject.split('\n').includes(`CN=${env.WECHAT_MCH_ID}`)
    || !merchant.publicKey.equals(createPublicKey(privateKey)) || privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error('微信商户证书或私钥不匹配');
  const usable = cert => Date.now() >= Date.parse(cert.validFrom) && Date.now() < Date.parse(cert.validTo);
  if (!usable(merchant)) throw new Error('微信商户证书已过期或尚未生效');
  let platform = new X509Certificate(await fs.readFile(env.WECHAT_PLATFORM_CERT_FILE));
  let certificates = new Map([[platform.serialNumber, { cert: platform, from: Date.parse(platform.validFrom), to: Date.parse(platform.validTo) }]]);
  let lastRefresh = 0; let lastAttempt = 0; let refreshing;
  const refreshCertificates = async () => {
    if (refreshing) return refreshing;
    if (Date.now() - lastAttempt < 60000) throw new Error('平台证书暂未更新，请稍后重试');
    lastAttempt = Date.now();
    refreshing = (async () => {
      const result = await downloadWechatCertificates(env, path.dirname(env.WECHAT_PLATFORM_CERT_FILE), fetcher);
      const next = new Map();
      for (const c of result.certificates) next.set(c.serial, { cert: new X509Certificate(await fs.readFile(c.path)), from: Date.parse(c.validFrom), to: Date.parse(c.validTo) });
      certificates = next; lastRefresh = Date.now();
    })();
    try { await refreshing; } finally { refreshing = null; }
  };
  const verifyMessage = async (raw, headers) => {
    const get = name => headers instanceof Headers ? headers.get(name) : headers[name];
    const timestamp = get('wechatpay-timestamp'); const nonce = get('wechatpay-nonce'); const signature = get('wechatpay-signature'); const serial = get('wechatpay-serial');
    if (typeof serial !== 'string' || !/^[A-F0-9]{32,64}$/i.test(serial) || typeof timestamp !== 'string' || !/^\d{10,12}$/.test(timestamp)
      || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || typeof nonce !== 'string' || !nonce || nonce.length > 128 || typeof signature !== 'string') throw new Error('微信响应或通知签名头无效');
    if (!certificates.has(serial.toUpperCase()) || Date.now() - lastRefresh > 6 * 3600000) await refreshCertificates();
    const trusted = certificates.get(serial.toUpperCase());
    if (!trusted || Date.now() < trusted.from || Date.now() >= trusted.to
      || !verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`), trusted.cert.publicKey, Buffer.from(signature, 'base64'))) throw new Error('微信响应或通知验签失败');
  };
  const request = async (method, route, body) => {
    if (!usable(merchant)) throw new Error('微信商户证书已过期');
    if (Date.now() - lastRefresh > 6 * 3600000) await refreshCertificates();
    const timestamp = String(Math.floor(Date.now() / 1000)); const nonce = randomBytes(16).toString('hex'); const raw = body ? JSON.stringify(body) : '';
    const signature = sign('RSA-SHA256', Buffer.from(`${method}\n${route}\n${timestamp}\n${nonce}\n${raw}\n`), privateKey).toString('base64');
    const response = await fetcher(`https://api.mch.weixin.qq.com${route}`, { method, headers: {
      Accept: 'application/json', 'Accept-Language': 'zh-CN', 'Content-Type': 'application/json', 'User-Agent': 'HiExplore/WechatNative',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${env.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${merchant.serialNumber}",signature="${signature}"`,
    }, ...(raw ? { body: raw } : {}), redirect: 'error', signal: AbortSignal.timeout(15000) });
    const text = await response.text(); if (text.length > 100000) throw new Error('微信支付响应过大');
    await verifyMessage(text, response.headers);
    const data = JSON.parse(text);
    if (!response.ok) {
      if (method === 'GET' && response.status === 404 && data.code === 'ORDER_NOT_EXIST') return null;
      throw new Error('微信支付请求暂未成功，请稍后核对订单，勿重复付款');
    }
    return data;
  };
  const payment = data => {
    if (!data) return null;
    if (data.mchid !== env.WECHAT_MCH_ID || data.appid !== env.WECHAT_APP_ID) throw new Error('微信支付商户或应用不匹配');
    if (data.trade_state !== 'SUCCESS') return null;
    if (data.trade_type !== 'NATIVE' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.transaction_id || '')
      || !/^HE[a-f0-9]{30}$/.test(data.out_trade_no || '') || !Number.isSafeInteger(data.amount?.total) || data.amount.total <= 0 || data.amount.currency !== 'CNY') throw new Error('微信支付交易内容无效');
    return { orderId: data.out_trade_no, transactionId: data.transaction_id, amount: data.amount.total, currency: data.amount.currency };
  };
  return {
    id: 'wechat',
    async create(order) {
      const data = await request('POST', '/v3/pay/transactions/native', { appid: env.WECHAT_APP_ID, mchid: env.WECHAT_MCH_ID, description: order.title,
        out_trade_no: order.id, time_expire: new Date(order.expiresAt).toISOString(), notify_url: `${base.href.replace(/\/$/, '')}/billing/notify/wechat`, amount: { total: order.amount, currency: 'CNY' } });
      if (!validWechatCodeUrl(data.code_url)) throw new Error('微信支付二维码链接无效');
      return { codeUrl: data.code_url };
    },
    async query(order) { return payment(await request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.id)}?mchid=${env.WECHAT_MCH_ID}`)); },
    async verifyNotification(raw, headers) {
      await verifyMessage(raw, headers);
      const event = JSON.parse(raw);
      if (event.event_type !== 'TRANSACTION.SUCCESS' || event.resource_type !== 'encrypt-resource' || event.resource?.algorithm !== 'AEAD_AES_256_GCM') throw new Error('微信支付通知类型无效');
      const resource = event.resource;
      if (typeof resource.ciphertext !== 'string' || typeof resource.nonce !== 'string' || (resource.associated_data !== undefined && typeof resource.associated_data !== 'string')) throw new Error('微信支付通知密文格式无效');
      const encrypted = Buffer.from(resource.ciphertext, 'base64');
      if (encrypted.length < 17) throw new Error('微信支付通知密文无效');
      const decipher = createDecipheriv('aes-256-gcm', apiKey, Buffer.from(resource.nonce));
      decipher.setAAD(Buffer.from(resource.associated_data || '')); decipher.setAuthTag(encrypted.subarray(-16));
      const data = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
      const result = payment(data); if (!result) throw new Error('通知未确认支付成功');
      return result;
    },
  };
}
