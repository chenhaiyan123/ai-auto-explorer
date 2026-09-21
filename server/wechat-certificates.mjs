// One-shot certificate bootstrap. Uses the API v3 key to authenticate the
// encrypted certificates before verifying the complete signed response.
// https://pay.wechatpay.cn/doc/v3/merchant/4012551764
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey, createPublicKey, createDecipheriv, randomBytes, sign, verify, X509Certificate } from 'node:crypto';

export async function downloadWechatCertificates(env, outputDirectory, fetcher = fetch) {
  const required = ['WECHAT_MCH_ID', 'WECHAT_CERT_SERIAL', 'WECHAT_CERT_FILE', 'WECHAT_PRIVATE_KEY_FILE', 'WECHAT_API_V3_KEY_FILE'];
  if (required.some(k => !env[k])) throw new Error('微信支付证书配置尚未齐全');
  if (!/^\d{6,20}$/.test(env.WECHAT_MCH_ID) || !/^[A-F0-9]{32,64}$/i.test(env.WECHAT_CERT_SERIAL)) throw new Error('商户号或证书序列号格式错误');
  const apiKey = await fs.readFile(env.WECHAT_API_V3_KEY_FILE);
  if (!/^[A-Za-z0-9]{32}$/.test(apiKey.toString('utf8'))) throw new Error('API v3 密钥文件必须恰好包含 32 位字母数字，不含换行');
  const merchant = new X509Certificate(await fs.readFile(env.WECHAT_CERT_FILE));
  const privateKey = createPrivateKey(await fs.readFile(env.WECHAT_PRIVATE_KEY_FILE));
  if (merchant.serialNumber.toUpperCase() !== env.WECHAT_CERT_SERIAL.toUpperCase()
    || !merchant.subject.split('\n').includes(`CN=${env.WECHAT_MCH_ID}`)
    || !merchant.publicKey.equals(createPublicKey(privateKey))) throw new Error('商户证书、商户号或私钥不匹配');
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048
    || Date.now() < Date.parse(merchant.validFrom) || Date.now() >= Date.parse(merchant.validTo)) throw new Error('商户证书无效或过期');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const signature = sign('RSA-SHA256', Buffer.from(`GET\n/v3/certificates\n${timestamp}\n${nonce}\n\n`), privateKey).toString('base64');
  const response = await fetcher('https://api.mch.weixin.qq.com/v3/certificates', {
    headers: { Accept: 'application/json', 'Accept-Language': 'zh-CN', 'User-Agent': 'HiExplore/WechatCertificateSetup',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${env.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${env.WECHAT_CERT_SERIAL}",signature="${signature}"` },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  if (raw.length > 1000000) throw new Error('微信证书响应超过限制');
  if (!response.ok) {
    let code = ''; let message = '';
    try {
      const data = JSON.parse(raw);
      if (/^[A-Z_]{1,80}$/.test(data.code)) code = data.code;
      if (typeof data.message === 'string') message = data.message.slice(0, 300).replace(/[A-Za-z0-9+/=_-]{24,}/g, '[已隐藏]');
    } catch {}
    throw new Error(`微信证书接口返回 HTTP ${response.status} ${code} ${message}`);
  }
  const data = JSON.parse(raw);
  if (!Array.isArray(data.data) || !data.data.length || data.data.length > 10) throw new Error('微信证书列表无效');
  const certificates = data.data.map(entry => {
    const encrypted = entry.encrypt_certificate;
    if (encrypted?.algorithm !== 'AEAD_AES_256_GCM' || encrypted.associated_data !== 'certificate'
      || typeof encrypted.nonce !== 'string' || typeof encrypted.ciphertext !== 'string') throw new Error('微信证书加密格式不匹配');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
    if (ciphertext.length < 17) throw new Error('微信证书密文无效');
    const decipher = createDecipheriv('aes-256-gcm', apiKey, Buffer.from(encrypted.nonce));
    decipher.setAAD(Buffer.from(encrypted.associated_data));
    decipher.setAuthTag(ciphertext.subarray(-16));
    let pem;
    try { pem = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'); }
    catch { throw new Error('API v3 密钥解密校验失败，请确认商户后台保存的密钥与本机文件一致'); }
    const cert = new X509Certificate(pem);
    if (!/^[A-F0-9]{32,64}$/i.test(entry.serial_no) || cert.serialNumber.toUpperCase() !== entry.serial_no.toUpperCase()
      || cert.publicKey.asymmetricKeyType !== 'rsa' || cert.publicKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error('平台证书参数不匹配');
    const from = Math.max(Date.parse(cert.validFrom), Date.parse(entry.effective_time));
    const to = Math.min(Date.parse(cert.validTo), Date.parse(entry.expire_time));
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('平台证书有效期无效');
    return { cert, pem, serial: cert.serialNumber, from, to };
  });
  const serial = response.headers.get('wechatpay-serial');
  const signing = certificates.find(c => c.serial.toUpperCase() === serial?.toUpperCase());
  const ts = response.headers.get('wechatpay-timestamp'); const replyNonce = response.headers.get('wechatpay-nonce');
  const replySignature = response.headers.get('wechatpay-signature');
  if (!signing || !/^\d{10,12}$/.test(ts || '') || Math.abs(Date.now() / 1000 - Number(ts)) > 300
    || Date.now() < signing.from || Date.now() >= signing.to || !replyNonce || !replySignature
    || !verify('RSA-SHA256', Buffer.from(`${ts}\n${replyNonce}\n${raw}\n`), signing.cert.publicKey, Buffer.from(replySignature, 'base64'))) throw new Error('微信平台响应验签失败');
  // Persist only after authenticated decryption AND response signature validation.
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const result = [];
  for (const c of certificates) {
    const target = path.join(outputDirectory, `wechatpay_${c.serial}.pem`);
    await fs.writeFile(target, c.pem, { mode: 0o600 });
    result.push({ serial: c.serial, validFrom: new Date(c.from).toISOString(), validTo: new Date(c.to).toISOString(), path: target });
  }
  return { verified: true, certificates: result, signingCertificatePath: result.find(c => c.serial === signing.serial).path };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  try {
    if (!process.argv[2]) throw new Error('请指定平台证书保存目录');
    console.log(JSON.stringify(await downloadWechatCertificates(process.env, process.argv[2]), null, 2));
  } catch (error) {
    // Do not log request headers, response bodies, key material or full exceptions.
    console.error(error.message === 'fetch failed' ? `连接微信支付失败：${error.cause?.code || '网络不可用'}` : error.message);
    process.exitCode = 1;
  }
}
