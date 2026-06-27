#!/usr/bin/env node
/**
 * HiExplore 托管版登录后端 · 邮箱验证码
 *
 * 仅托管版(www.hiexplore.com)需要；开源/本地版不部署它即可（前端不配 VITE_AUTH_API 就不走登录）。
 * 零额外依赖：用项目已有的 express + cors，令牌用 Node 内置 crypto 签发，邮件走 Resend HTTP API（可选）。
 *
 * 配置(环境变量)：
 *   PORT            监听端口(默认 8787)
 *   AUTH_SECRET     令牌签名密钥(务必改成随机长串)
 *   ALLOW_ORIGIN    允许的前端来源(默认 *)，如 https://www.hiexplore.com
 *   RESEND_API_KEY  Resend 邮件服务 Key(不填则把验证码打印到控制台，便于本地联调)
 *   MAIL_FROM       发信地址，如 HiExplore <noreply@hiexplore.com>
 *
 * 运行： node server/auth-server.mjs   （或 npm run auth）
 */
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 8787;
const SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'HiExplore <onboarding@resend.dev>';
const CODE_TTL = 10 * 60 * 1000;     // 验证码 10 分钟有效
const RESEND_COOLDOWN = 60 * 1000;   // 同邮箱 60 秒内只能发一次

const app = express();
app.use(cors({ origin: ALLOW_ORIGIN === '*' ? true : ALLOW_ORIGIN.split(',') }));
app.use(express.json());

/** email -> { code, exp, lastSent, attempts } */
const store = new Map();
const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const gen6 = () => String(Math.floor(100000 + Math.random() * 900000));

// ---- 极简签名令牌(HMAC，无需 jwt 库) ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
function issueToken(payload) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + 7 * 864e5 }));
  return `${body}.${sign(body)}`;
}
function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || sign(body) !== sig) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}

async function sendEmail(to, code) {
  const subject = 'HiExplore 登录验证码';
  const text = `你的 HiExplore 登录验证码是：${code}（10 分钟内有效）。若非本人操作请忽略。`;
  if (!RESEND_API_KEY) { console.log(`[DEV] 验证码 -> ${to}: ${code}`); return; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, text }),
  });
  if (!r.ok) throw new Error('邮件发送失败：' + (await r.text().catch(() => r.status)));
}

app.get('/auth/health', (_req, res) => res.json({ ok: true, provider: RESEND_API_KEY ? 'resend' : 'dev-console' }));

app.post('/auth/email/send-code', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  const now = Date.now();
  const prev = store.get(email);
  if (prev && now - prev.lastSent < RESEND_COOLDOWN) {
    return res.status(429).json({ error: `请 ${Math.ceil((RESEND_COOLDOWN - (now - prev.lastSent)) / 1000)} 秒后再试` });
  }
  const code = gen6();
  store.set(email, { code, exp: now + CODE_TTL, lastSent: now, attempts: 0 });
  try { await sendEmail(email, code); } catch (e) { return res.status(502).json({ error: e.message }); }
  res.json({ ok: true, devCode: RESEND_API_KEY ? undefined : code }); // 无邮件服务时回显，便于本地联调
});

app.post('/auth/email/verify', (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const code = (req.body?.code || '').trim();
  const rec = store.get(email);
  if (!rec) return res.status(400).json({ error: '请先获取验证码' });
  if (Date.now() > rec.exp) { store.delete(email); return res.status(400).json({ error: '验证码已过期，请重新获取' }); }
  if (rec.attempts >= 5) { store.delete(email); return res.status(429).json({ error: '尝试次数过多，请重新获取' }); }
  rec.attempts++;
  if (code !== rec.code) return res.status(400).json({ error: '验证码不正确' });
  store.delete(email);
  const user = { email, username: email.split('@')[0], role: 'user' };
  res.json({ token: issueToken({ email }), user });
});

app.get('/auth/me', (req, res) => {
  const p = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!p) return res.status(401).json({ error: '未登录或登录已过期' });
  res.json({ user: { email: p.email, username: p.email.split('@')[0], role: 'user' } });
});

app.listen(PORT, () => console.log(`HiExplore 登录服务已启动 :${PORT} · 邮件: ${RESEND_API_KEY ? 'Resend' : '控制台(开发)'}`));
