#!/usr/bin/env node
/**
 * HiExplore 托管版登录后端 · 阿里云函数计算(FC) Web 函数版
 *
 * 零依赖：只用 Node 内置模块(http / crypto / fetch)，不需要 npm install，
 * 可以把这一个文件直接粘进 FC 控制台代码编辑器运行。
 *
 * 接口：
 *   POST /auth/email/send-code   发送验证码
 *   POST /auth/email/verify      校验验证码并签发令牌
 *   GET  /auth/health            健康检查
 *   GET  /auth/me                校验令牌
 *   POST /api/chat               体验代理：按额度调用 DeepSeek(藏 Key)
 *   GET  /api/quota              查询当前剩余体验次数
 *
 * 环境变量(在 FC 函数配置里设置)：
 *   RESEND_API_KEY        Resend 邮件 Key(必填，否则验证码只打印日志)
 *   MAIL_FROM             发信地址，如 HiExplore <noreply@hiexplore.com>
 *   AUTH_SECRET           令牌签名密钥(务必改成随机长串)
 *   ALLOW_ORIGIN          允许的前端来源，如 https://www.hiexplore.com (多个用逗号分隔)
 *   PORT                  监听端口(FC Web 函数默认 9000；本地测试可设 8787)
 *   ── 体验代理(可选) ──
 *   DEEPSEEK_API_KEY      你的 DeepSeek Key(不填则体验代理关闭)
 *   DEEPSEEK_MODEL        默认 deepseek-chat
 *   TRIAL_ANON_QUOTA      匿名每天次数(默认 5)
 *   TRIAL_USER_QUOTA      登录用户每天次数(默认 30)
 *   TRIAL_GLOBAL_DAILY_CAP 全站每天总次数上限(默认 2000，护钱包)
 *   TRIAL_IP_PER_MIN      每 IP 每分钟限流(默认 20)
 *   TRIAL_MAX_TOKENS      单次最大输出 token(默认 2048，封顶成本)
 *
 * 注意：额度为内存计数，函数冷启动会重置(A 方案 MVP)。要持久化改用表格存储/Redis。
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 9000;            // FC Web 函数默认端口 9000
const SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'HiExplore <onboarding@resend.dev>';
const CODE_TTL = 10 * 60 * 1000;     // 验证码 10 分钟有效
const RESEND_COOLDOWN = 60 * 1000;   // 同邮箱 60 秒内只能发一次

// ---- 体验代理(免/匿名额度) 配置 ----
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE = (process.env.DEEPSEEK_BASE || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const TRIAL_ANON_QUOTA = Number(process.env.TRIAL_ANON_QUOTA || 5);          // 匿名每天次数
const TRIAL_USER_QUOTA = Number(process.env.TRIAL_USER_QUOTA || 30);         // 登录用户每天次数
const TRIAL_GLOBAL_CAP = Number(process.env.TRIAL_GLOBAL_DAILY_CAP || 2000); // 全站每天总次数上限
const TRIAL_IP_PER_MIN = Number(process.env.TRIAL_IP_PER_MIN || 20);         // 每 IP 每分钟限流
const TRIAL_MAX_TOKENS = Number(process.env.TRIAL_MAX_TOKENS || 2048);       // 单次最大输出 token

/** email -> { code, exp, lastSent, attempts } */
const store = new Map();
const usage = new Map();   // `${scope}:${id}:${date}` -> 次数；`g:${date}` -> 全站次数
const ipHits = new Map();  // ip -> { count, windowStart }
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

// ---- 体验额度 ----
const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD(UTC)
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}
function rateLimited(ip) {
  const now = Date.now();
  const rec = ipHits.get(ip);
  if (!rec || now - rec.windowStart > 60000) { ipHits.set(ip, { count: 1, windowStart: now }); return false; }
  rec.count++;
  return rec.count > TRIAL_IP_PER_MIN;
}
/** 识别身份：登录用户优先，否则匿名设备 */
function identify(req) {
  const p = verifyToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (p?.email) return { scope: 'user', id: p.email, limit: TRIAL_USER_QUOTA };
  const dev = String(req.headers['x-device-id'] || '').slice(0, 64);
  return { scope: 'anon', id: dev || 'nodev', limit: TRIAL_ANON_QUOTA };
}
function quotaState(ident) {
  const key = `${ident.scope}:${ident.id}:${today()}`;
  const gkey = `g:${today()}`;
  const used = usage.get(key) || 0;
  const gUsed = usage.get(gkey) || 0;
  return { key, gkey, used, gUsed, remaining: Math.max(0, ident.limit - used) };
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

// ---- 工具：读取 JSON body ----
function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// 允许来源列表(逗号分隔)；'*' 表示全部
const ORIGIN_LIST = ALLOW_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
function pickOrigin(reqOrigin) {
  if (ALLOW_ORIGIN === '*') return '*';
  if (reqOrigin && ORIGIN_LIST.includes(reqOrigin)) return reqOrigin; // 回显命中的来源
  return ORIGIN_LIST[0] || '*';
}

// ---- 工具：统一响应(带 CORS) ----
function send(res, status, obj, reqOrigin) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': pickOrigin(reqOrigin),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Device-Id',
    'Access-Control-Max-Age': '86400',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const reqOrigin = req.headers.origin;
  const send2 = (status, obj) => send(res, status, obj, reqOrigin);
  // CORS 预检
  if (req.method === 'OPTIONS') return send2(204, {});

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  try {
    if (req.method === 'GET' && path === '/auth/health') {
      return send2(200, { ok: true, provider: RESEND_API_KEY ? 'resend' : 'dev-console' });
    }

    if (req.method === 'POST' && path === '/auth/email/send-code') {
      const { email: raw } = await readJson(req);
      const email = (raw || '').trim().toLowerCase();
      if (!isEmail(email)) return send2(400, { error: '邮箱格式不正确' });
      const now = Date.now();
      const prev = store.get(email);
      if (prev && now - prev.lastSent < RESEND_COOLDOWN) {
        return send2(429, { error: `请 ${Math.ceil((RESEND_COOLDOWN - (now - prev.lastSent)) / 1000)} 秒后再试` });
      }
      const code = gen6();
      store.set(email, { code, exp: now + CODE_TTL, lastSent: now, attempts: 0 });
      try { await sendEmail(email, code); } catch (e) { return send2(502, { error: e.message }); }
      return send2(200, { ok: true, devCode: RESEND_API_KEY ? undefined : code });
    }

    if (req.method === 'POST' && path === '/auth/email/verify') {
      const body = await readJson(req);
      const email = (body.email || '').trim().toLowerCase();
      const code = (body.code || '').trim();
      const rec = store.get(email);
      if (!rec) return send2(400, { error: '请先获取验证码' });
      if (Date.now() > rec.exp) { store.delete(email); return send2(400, { error: '验证码已过期，请重新获取' }); }
      if (rec.attempts >= 5) { store.delete(email); return send2(429, { error: '尝试次数过多，请重新获取' }); }
      rec.attempts++;
      if (code !== rec.code) return send2(400, { error: '验证码不正确' });
      store.delete(email);
      const user = { email, username: email.split('@')[0], role: 'user' };
      return send2(200, { token: issueToken({ email }), user });
    }

    if (req.method === 'GET' && path === '/auth/me') {
      const p = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!p) return send2(401, { error: '未登录或登录已过期' });
      return send2(200, { user: { email: p.email, username: p.email.split('@')[0], role: 'user' } });
    }

    // ---- 体验额度：查询剩余次数 ----
    if (req.method === 'GET' && path === '/api/quota') {
      const ident = identify(req);
      const q = quotaState(ident);
      return send2(200, { enabled: !!DEEPSEEK_API_KEY, scope: ident.scope, limit: ident.limit, used: q.used, remaining: q.remaining });
    }

    // ---- 体验代理：按额度调用 DeepSeek(藏 Key) ----
    if (req.method === 'POST' && path === '/api/chat') {
      if (!DEEPSEEK_API_KEY) return send2(503, { error: '体验服务未开启' });
      const ident = identify(req);
      if (ident.scope === 'anon' && ident.id === 'nodev') return send2(400, { error: '缺少设备标识' });
      if (rateLimited(clientIp(req))) return send2(429, { error: '请求过于频繁，请稍后再试' });
      const q = quotaState(ident);
      if (q.gUsed >= TRIAL_GLOBAL_CAP) return send2(429, { error: '今日体验名额已满，请明天再来，或在设置里填入你自己的模型 Key', code: 'GLOBAL_CAP' });
      if (q.remaining <= 0) {
        return send2(402, {
          code: 'QUOTA_EXCEEDED', scope: ident.scope,
          error: ident.scope === 'anon'
            ? '免费体验次数已用完～ 登录后可获得更多，或在设置里填入你自己的模型 Key'
            : '今日体验次数已用完，明天再来，或在设置里填入你自己的模型 Key',
        });
      }
      const bodyIn = await readJson(req);
      const messages = Array.isArray(bodyIn.messages) ? bodyIn.messages : null;
      if (!messages || !messages.length) return send2(400, { error: 'messages 不能为空' });
      // 先占额度，防并发刷
      usage.set(q.key, q.used + 1);
      usage.set(q.gkey, q.gUsed + 1);
      const refund = () => {
        usage.set(q.key, Math.max(0, (usage.get(q.key) || 1) - 1));
        usage.set(q.gkey, Math.max(0, (usage.get(q.gkey) || 1) - 1));
      };
      try {
        const dsBody = {
          model: DEEPSEEK_MODEL,
          messages,
          max_tokens: Math.min(Number(bodyIn.max_tokens) || TRIAL_MAX_TOKENS, TRIAL_MAX_TOKENS),
          temperature: typeof bodyIn.temperature === 'number' ? bodyIn.temperature : 0.7,
        };
        if (bodyIn.jsonMode || bodyIn.response_format) dsBody.response_format = { type: 'json_object' };
        const r = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(dsBody),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { refund(); return send2(502, { error: data?.error?.message || '上游模型调用失败' }); }
        const remaining = Math.max(0, ident.limit - (usage.get(q.key) || 0));
        return send2(200, { ...data, _trial: { scope: ident.scope, remaining, limit: ident.limit } });
      } catch (e) {
        refund();
        return send2(502, { error: e?.message || '体验调用失败' });
      }
    }

    // 根路径健康探测(FC 有时会探活)
    if (req.method === 'GET' && path === '/') return send2(200, { ok: true, service: 'hiexplore-auth' });

    return send2(404, { error: 'not found' });
  } catch (e) {
    return send2(500, { error: e?.message || 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () =>
  console.log(`HiExplore 登录服务(FC)已启动 :${PORT} · 邮件: ${RESEND_API_KEY ? 'Resend' : '控制台(开发)'} · 体验代理: ${DEEPSEEK_API_KEY ? `DeepSeek(匿名${TRIAL_ANON_QUOTA}/注册${TRIAL_USER_QUOTA}/日，全站封顶${TRIAL_GLOBAL_CAP})` : '关'} · 允许来源: ${ALLOW_ORIGIN}`)
);
