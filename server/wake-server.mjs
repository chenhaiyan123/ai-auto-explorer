import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WakeNotifications } from './wake-notifications.mjs';
import { SharedModels } from './shared-models.mjs';
import { createBilling } from './billing.mjs';
import { WakeStorage, scopeKey } from './wake-storage.mjs';
import { createAwakening, enqueueWake, heartbeatAction, configureAwakening, recoverAwakening, runWake, buildModelRequest, parseModelResponse } from './.wake-build/runner.mjs';
const ROLES = ['manager', 'thinker', 'executor', 'verifier', 'auditor'];
const hash = text => createHash('sha256').update(text).digest('hex');
const claimedDirectories = new Set();
const cleanText = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function sanitizeContext(value) {
  if (!value || !['projectId', 'branchId', 'scopeId', 'question'].every(k => typeof value[k] === 'string' && value[k].trim() && value[k].length <= (k === 'question' ? 2500 : 160))) throw new Error('项目范围或问题无效');
  const agents = {};
  for (const role of ROLES) if (value.agents?.[role]) agents[role] = { name: cleanText(value.agents[role].name, 80), description: cleanText(value.agents[role].description, 2400), model: { provider: 'default', baseUrl: '', model: '' } };
  if (value.facts !== undefined && (!Array.isArray(value.facts) || value.facts.length > 50)) throw new Error('当前问题最多同步 50 条事实，请缩小研究范围；不会静默截断事实');
  const facts = (value.facts || []).map(f => {
    for (const [field, max] of Object.entries({ id: 160, claim: 1000, source: 1200, excerpt: 1800, scope: 600 })) if (typeof f?.[field] !== 'string' || f[field].length > max) throw new Error(`事实 ${field} 缺失或过长，不能截断后冒充完整证据`);
    if (!f.id.trim() || !f.claim.trim()) throw new Error('事实标识或陈述为空');
    return { id: f.id, claim: f.claim, source: f.source, excerpt: f.excerpt, scope: f.scope, status: ['confirmed', 'disputed', 'rejected'].includes(f.status) ? f.status : 'pending' };
  });
  if (new Set(facts.map(f => f.id)).size !== facts.length) throw new Error('事实 ID 重复');
  const background = cleanText(value.background, 12000) + (typeof value.background === 'string' && value.background.length > 12000 ? '\n[背景过长，后续内容尚未同步]' : '');
  return { projectId: value.projectId, branchId: value.branchId, scopeId: value.scopeId, question: value.question, background, agents, facts, language: value.language === 'en' ? 'en' : 'zh-CN' };
}
export async function collectPapers(query, fetcher = fetch) {
  const url = new URL('https://api.crossref.org/works');
  // Crossref's default relevance ranking avoids letting an incidental word in a new paper dominate the inbox.
  url.searchParams.set('query', query); url.searchParams.set('rows', '20');
  const response = await fetcher(url, { headers: { 'User-Agent': 'HiExplore-Wake/1.0 (https://www.hiexplore.com)' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`论文检索失败 HTTP ${response.status}`);
  const raw = await response.text(); if (raw.length > 2_000_000) throw new Error('论文元数据响应过大');
  const data = JSON.parse(raw); const events = [];
  for (const item of (data.message?.items || []).slice(0, 20)) {
    if (typeof item.DOI !== 'string' || !/^10\.\d{4,9}\/\S+$/i.test(item.DOI)) continue;
    const doi = item.DOI.toLowerCase(); const title = cleanText(item.title?.[0], 600); if (!title) continue;
    if (!paperMatchesQuery(query, `${title}\n${cleanText(item.abstract, 12000)}`)) continue;
    const body = JSON.stringify({ doi, title, published: item.published?.['date-parts'], publisher: cleanText(item.publisher, 500), abstract: cleanText(item.abstract, 12000).replace(/<[^>]*>/g, '').slice(0, 2500), updates: item['update-to'] || [], note: 'Crossref 元数据；未取得全文，未核验研究结论。' });
    events.push({ id: hash(`paper:${doi}:${body}`), kind: 'paper', title, body, source: `https://doi.org/${encodeURI(doi)}`, at: Date.now(), status: 'pending' });
    if (events.length === 5) break;
  }
  return events;
}
export function paperMatchesQuery(query, content) {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'how', 'can', 'does', 'are', 'could', 'would', 'into', 'about']);
  const tokens = [...new Set((query.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) || []).filter(t => !stop.has(t)))];
  if (!tokens.length) return false;
  const haystack = new Set(content.toLowerCase().match(/[a-z0-9]{2,}/g) || []);
  const text = content.toLowerCase();
  const matched = tokens.filter(t => /[\u4e00-\u9fff]/.test(t) ? text.includes(t) : haystack.has(t)).length;
  return matched >= Math.min(3, Math.ceil(tokens.length * 0.6));
}
export async function createWakeServer(options = {}) {
  const env = options.env || process.env;
  const externalFetch = options.fetch || fetch;
  const host = env.WAKE_HOST || '127.0.0.1';
  const testMode = env.WAKE_TEST_MODE === 'true';
  if (testMode && !['127.0.0.1', '::1'].includes(host)) throw new Error('模拟模式只能在本机监听');
  const masterKey = Buffer.from(env.WAKE_MASTER_KEY || '', 'base64');
  if (masterKey.length !== 32) throw new Error('WAKE_MASTER_KEY 必须是 32 字节随机密钥的 base64，且需要持久保存');
  const starterTokens = Number(env.WAKE_STARTER_TOKENS || 0);
  const starterPool = Number(env.WAKE_STARTER_POOL_TOKENS || 0);
  if (![starterTokens, starterPool].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 10000000)) throw new Error('初始体验额度配置无效');
  const globalCap = Number(env.WAKE_GLOBAL_DAILY_CALLS || 100);
  if (!Number.isInteger(globalCap) || globalCap < 1 || globalCap > 1000) throw new Error('后台总调用上限必须是 1–1000 的整数');
  const authAPI = (env.WAKE_AUTH_API || '').replace(/\/+$/, '');
  if (!authAPI && !env.WAKE_DEV_TOKEN) throw new Error('必须配置 WAKE_AUTH_API；独立开发可配置 WAKE_DEV_TOKEN');
  if (authAPI && !authAPI.startsWith('https://')) throw new Error('登录验证接口必须使用 HTTPS');
  if (env.WAKE_DEV_TOKEN && !testMode && !['127.0.0.1', '::1'].includes(host)) throw new Error('公开服务必须使用正式登录验证');
  const allowedOrigins = new Set((env.WAKE_ALLOWED_ORIGINS || 'https://www.hiexplore.com,http://127.0.0.1:3000,http://localhost:3000').split(',').map(x => x.trim()));
  const allowedModels = new Set((env.WAKE_MODEL_HOSTS || 'api.openai.com,api.anthropic.com,api.deepseek.com,generativelanguage.googleapis.com,dashscope.aliyuncs.com,open.bigmodel.cn,ark.cn-beijing.volces.com,api.moonshot.cn,api.x.ai').split(',').map(x => x.trim()));
  const storage = new WakeStorage(path.resolve(env.WAKE_DATA_DIR || './wake-data'), masterKey); await storage.initialize();
  const billing = await createBilling(storage, env, externalFetch, options.paymentProviders);
  if (claimedDirectories.has(storage.dir)) throw new Error('此数据目录已有执行器运行');
  // This deployment supports one process with a persistent volume. Never silently share a local file store across replicas.
  const lockFile = path.join(storage.dir, '.worker-lock');
  try { await fs.writeFile(lockFile, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(await fs.readFile(lockFile, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('执行器锁损坏，请由管理员核对后修复');
    // A restarted single container often has the same PID (1). This process has not claimed the directory yet.
    if (pid !== process.pid) try { process.kill(pid, 0); throw new Error('此数据目录已有执行器运行'); } catch (err) { if (err.code !== 'ESRCH') throw err; }
    await fs.unlink(lockFile); await fs.writeFile(lockFile, String(process.pid), { flag: 'wx', mode: 0o600 });
  }
  claimedDirectories.add(storage.dir);
  for (const key of await storage.keys()) await storage.update(key, s => recoverAwakening(s, Date.now()));
  const active = new Set(); const credentialQueues = new Map();
  const ledgerFile = path.join(storage.dir, '.budget-ledger.json'); let ledgerQueue = Promise.resolve();
  const reserveGlobal = () => {
    const next = ledgerQueue.catch(() => {}).then(async () => {
      const day = new Date().toISOString().slice(0, 10); let record;
      try { record = JSON.parse(await fs.readFile(ledgerFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const used = record?.day === day ? record.calls : 0;
      if (used >= globalCap) throw new Error('后台今日总调用预算已用完');
      await storage.atomic(ledgerFile, { day, calls: used + 1 });
    }); ledgerQueue = next; return next;
  };
  const shared = new SharedModels(storage, allowedModels, externalFetch, reserveGlobal);
  await shared.initialize();
  const notifications = new WakeNotifications(storage, env, externalFetch);
  const activationQueues = new Map();
  const admins = new Set((env.WAKE_ADMIN_IDENTITIES || '').split(',').map(x => x.trim()).filter(Boolean));
  const model = async (key, role, messages, state) => {
    if (options.model) return options.model(role, messages, state);
    if (testMode) {
      await new Promise(r => setTimeout(r, 100));
      if (role === 'manager') return JSON.stringify({ decision: 'research', reason: '模拟：为新线索设计验证方案', task: '指出证据局限', role: 'thinker', stopCondition: '形成一个可验证方案即停止' });
      if (role === 'verifier') return JSON.stringify({ summary: '模拟核验：只有方案，没有实验结果', problems: [] });
      if (role === 'auditor') return JSON.stringify({ verdict: 'progress', summary: '模拟：形成了待执行的验证方案，没有新增真实事实。', next: '等待真实实验数据', acceptedIndexes: [0] });
      return JSON.stringify({ summary: '模拟材料分析，未执行实验', findings: [{ claim: '下一步收集真实样本并预先规定证伪条件', kind: 'plan', evidenceIds: [] }] });
    }
    const credentials = await storage.credentials(key); const settings = credentials[role] || credentials.default;
    if (!settings) throw new Error(`后台尚未配置 ${role} 的模型，浏览器密钥不会自动上传`);
    // Persist the exact public model identity used for this step, never its credential.
    await storage.update(key, s => ({ ...s, runs: s.runs.map(r => r.id === s.activeRunId ? { ...r, steps: r.steps.map((step, i) => i === r.steps.length - 1 ? { ...step, model: { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl } } : step) } : r) }));
    if (settings.provider === 'platform') {
      const result = await shared.invoke(settings.owner, { requestId: randomUUID(), modelId: settings.model, messages, jsonMode: true, maxTokens: state.policy.maxOutputTokens }, { projectId: state.context.projectId, branchId: state.context.branchId, scopeId: state.context.scopeId, role, runId: state.activeRunId });
      return result.content;
    }
    await reserveGlobal();
    const request = buildModelRequest(settings, messages, { jsonMode: true, maxTokens: state.policy.maxOutputTokens });
    delete request.headers['anthropic-dangerous-direct-browser-access'];
    let response;
    try { response = await externalFetch(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(60000), redirect: 'error' }); }
    catch { throw new Error(`${role} 模型连接失败或超时；请求可能已计费，不自动重试`); }
    if (!response.ok) throw new Error(`${role} 模型请求失败 HTTP ${response.status}`);
    const raw = await response.text(); if (raw.length > 1_000_000) throw new Error('模型响应过大');
    const parsed = parseModelResponse(JSON.parse(raw), settings.provider);
    if (!parsed.content.trim()) throw new Error('模型没有返回正文');
    return parsed.content.split(settings.apiKey).join('[REDACTED]');
  };
  const tickKey = async key => {
    if (active.has(key)) return; const state = await storage.read(key); if (!state?.policy.enabled) return;
    if (!state.events.some(e => e.status === 'pending') && state.nextCheckAt > Date.now() && state.nextReviewAt > Date.now()) return;
    active.add(key);
    const heartbeat = setInterval(() => storage.update(key, s => ({ ...s, heartbeatAt: Date.now() })).catch(() => {}), 10000);
    try { await runWake({ read: () => storage.read(key), update: fn => storage.update(key, fn), model: (role, messages, s) => model(key, role, messages, s), collect: options.collect || collectPapers, now: Date.now, id: randomUUID }); }
    finally { clearInterval(heartbeat); active.delete(key); }
  };
  let ticking = false; let closing = false;
  const tick = async () => { if (ticking || closing) return; ticking = true; try { for (const key of await storage.keys()) { if (closing) break; await tickKey(key); } await notifications.process(); } finally { ticking = false; } };
  const interval = setInterval(() => tick().catch(e => console.error('wake tick:', e.message)), 10000);
  interval.unref();
  const authenticate = async req => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!token || token.length > 8192) throw new Error('请先登录');
    if (env.WAKE_DEV_TOKEN && Buffer.byteLength(token) === Buffer.byteLength(env.WAKE_DEV_TOKEN) && timingSafeEqual(Buffer.from(token), Buffer.from(env.WAKE_DEV_TOKEN))) return 'development';
    if (!authAPI) throw new Error('登录无效');
    const r = await externalFetch(`${authAPI}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!r.ok) throw new Error('登录已过期');
    const body = await r.json(); const identity = body.user?.email || body.user?.username || body.email || body.username;
    if (typeof identity !== 'string' || !identity) throw new Error('无法核对登录身份'); return identity;
  };
  const readBody = async req => { let raw = ''; for await (const chunk of req) { raw += chunk.toString(); if (raw.length > 300000) throw new Error('请求内容超过限制'); } return JSON.parse(raw || '{}'); };
  const server = http.createServer(async (req, res) => {
    const requestURL = new URL(req.url, 'http://wake');
    if (requestURL.pathname === '/notifications/unsubscribe' && ['GET', 'POST'].includes(req.method)) {
      const token = requestURL.searchParams.get('token');
      if (!/^[a-f0-9]{64}$/.test(token || '')) { res.writeHead(400); res.end('Invalid link'); return; }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
      if (req.method === 'POST') {
        try {
          const removed = await notifications.unsubscribe(token);
          res.writeHead(removed ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(removed ? '已退订此问题的邮件提醒。Unsubscribed. 云端研究不受影响。' : 'Invalid link');
        } catch {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('暂时无法保存退订，请稍后重试。Please try again later.');
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><title>HiExplore</title><h1>退订重要事件邮件 / Unsubscribe</h1><p>仅停止此问题的邮件，保留云端研究。</p><form method="post"><button>确认退订 / Confirm unsubscribe</button></form>');
      }
      return;
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) { res.writeHead(403); res.end(); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS'); res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    const url = new URL(req.url, 'http://wake');
    if (url.pathname === '/health') { send(200, { service: 'hiexplore-wake', version: 1, persistent: true, testMode, capabilities: { activation: true, importantEmail: notifications.ready }, now: Date.now() }); return; }
    if (req.method === 'GET' && url.pathname === '/billing/catalog') { send(200, billing.catalog()); return; }
    if (req.method === 'POST' && url.pathname === '/billing/notify/alipay') {
      try {
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw new Error('通知类型错误');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 100000) throw new Error('通知过大'); chunks.push(chunk); }
        await billing.notify('alipay', Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('success');
      } catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('failure'); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/billing/notify/wechat') {
      try {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('通知类型错误');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 100000) throw new Error('通知过大'); chunks.push(chunk); }
        await billing.notify('wechat', Buffer.concat(chunks).toString('utf8'), req.headers);
        res.writeHead(204); res.end();
      } catch { send(400, { code: 'FAIL', message: '通知未通过核验，请重试' }); }
      return;
    }
    let owner;
    try { owner = await authenticate(req); } catch (e) { send(401, { error: e.message }); return; }
    try {
      if (url.pathname.startsWith('/billing/') || url.pathname === '/admin/billing') {
        if (url.pathname === '/admin/billing') {
          if (!admins.has(owner)) { send(403, { error: '需要后台授权的管理员身份' }); return; }
          if (req.method === 'GET') { send(200, await billing.adminView()); return; }
        }
        if (req.method === 'GET' && url.pathname === '/billing/account') { send(200, await billing.view(owner)); return; }
        const orderMatch = url.pathname.match(/^\/billing\/orders\/(HE[a-f0-9]{30})$/);
        if (orderMatch && ['GET', 'POST'].includes(req.method)) { send(200, await billing.getOrder(owner, orderMatch[1], req.method === 'POST')); return; }
        if (req.method === 'POST' && url.pathname === '/billing/orders') { send(200, await billing.createOrder(owner, await readBody(req))); return; }
        if (req.method === 'POST' && url.pathname === '/billing/artifacts') { send(200, await billing.saveArtifact(owner, await readBody(req))); return; }
        const artifactMatch = url.pathname.match(/^\/billing\/artifacts\/([a-f0-9]{64})\/download$/);
        if (req.method === 'POST' && artifactMatch) { send(200, await billing.download(owner, artifactMatch[1])); return; }
        send(404, { error: '支付接口不存在' }); return;
      }
      if (url.pathname.startsWith('/shared/') || url.pathname.startsWith('/admin/shared')) {
        const isAdmin = admins.has(owner);
        if (url.pathname.startsWith('/admin/') && !isAdmin) { send(403, { error: '需要后台授权的管理员身份' }); return; }
        if (req.method === 'GET' && url.pathname === '/shared/catalog') { send(200, await shared.view(owner)); return; }
        if (req.method === 'GET' && url.pathname === '/admin/shared') { send(200, await shared.view(owner, true)); return; }
        if (req.method === 'GET' && url.pathname === '/shared/session') { send(200, { isAdmin, owner }); return; }
        const body = await readBody(req);
        if (req.method === 'PUT' && url.pathname === '/admin/shared/models') { send(200, await shared.saveModel(body)); return; }
        if (req.method === 'POST' && url.pathname === '/admin/shared/grants') { send(200, await shared.grant(owner, body)); return; }
        if (req.method === 'POST' && url.pathname === '/admin/shared/reconcile') { send(200, await shared.reconcile(owner, body)); return; }
        if (req.method === 'POST' && url.pathname === '/shared/chat') { send(200, await shared.invoke(owner, body)); return; }
        send(404, { error: '接口不存在' }); return;
      }
      const projectId = url.searchParams.get('projectId'); const branchId = url.searchParams.get('branchId'); const scopeId = url.searchParams.get('scopeId') || 'root';
      if (![projectId, branchId, scopeId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 160)) throw new Error('项目范围无效');
      const key = scopeKey(owner, projectId, branchId, scopeId);
      if (req.method === 'GET' && url.pathname === '/project-status') {
        const scopes = [];
        for (const candidate of await storage.keys()) {
          const s = await storage.read(candidate);
          if (s.context.projectId !== projectId || s.context.branchId !== branchId || candidate !== scopeKey(owner, projectId, branchId, s.context.scopeId)) continue;
          scopes.push({ scopeId: s.context.scopeId, question: s.context.question, status: s.status, enabled: s.policy.enabled, activeRunId: s.activeRunId, reason: s.reason, pending: s.events.filter(e => e.status === 'pending').length,
            runs: s.runs.slice(-2).map(r => ({ id: r.id, outcome: r.outcome, summary: r.summary?.slice(0, 2000), next: r.next, completedAt: r.completedAt })) });
        }
        send(200, { scopes: scopes.slice(0, 30), total: scopes.length }); return;
      }
      if (req.method === 'GET' && url.pathname === '/state') {
        const state = await storage.read(key); const creds = await storage.credentials(key);
        send(200, { state, models: Object.fromEntries(Object.entries(creds).map(([role, c]) => [role, { provider: c.provider, model: c.model, baseUrl: c.baseUrl }])), testMode, notifications: await notifications.view(owner, key), starterTokens }); return;
      }
      const body = await readBody(req);
      if (req.method === 'POST' && url.pathname === '/activate') {
        const previous = activationQueues.get(key) || Promise.resolve();
        const activate = previous.catch(() => {}).then(async () => {
          const old = await storage.read(key);
          if (old?.policy.enabled) return old; // Retry is harmless, never resets a running project.
          if (old?.activeRunId) throw new Error('等待当前研究结束后再开启');
          const context = sanitizeContext(body.context);
          if (context.projectId !== projectId || context.branchId !== branchId || context.scopeId !== scopeId) throw new Error('项目范围不一致');
          if (typeof body.paperQuery !== 'string' || body.paperQuery.length > 300) throw new Error('观察关键词无效');
          if (body.emailEnabled !== undefined && typeof body.emailEnabled !== 'boolean') throw new Error('邮件订阅选项无效');
          if (body.emailEnabled && (!notifications.ready || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner))) throw new Error('重要事件邮件尚未就绪，请暂不勾选或由管理员完成配置');
          // Validate policy before any credits or credentials are changed.
          const base = old || createAwakening(context);
          const policy = { checkEveryHours: 24, reviewEveryDays: 7, maxCallsPerDay: 8, maxCallsPerWake: 4, maxOutputTokens: 1024, paperQuery: body.paperQuery.trim(), enabled: true };
          configureAwakening(base, policy);
          await shared.starter(owner, body.modelId, starterTokens, starterPool);
          const catalog = await shared.view(owner);
          const selected = catalog.models.find(m => m.id === body.modelId && m.enabled && m.hasKey);
          if (!selected) throw new Error('请选择已开放的共享模型');
          if ((catalog.balances[body.modelId]?.available || 0) < 4096) throw new Error('共享模型额度不足 4096 Token，请联系管理员补充，或在唤醒设置中接入自有 API');
          if (selected.dailyTokens - selected.usedToday < 4096) throw new Error('模型今日剩余额度不足，请选择其他模型或稍后再试');
          const credentialPrevious = credentialQueues.get(key) || Promise.resolve();
          const write = credentialPrevious.catch(() => {}).then(() => storage.credentials(key, { default: { provider: 'platform', model: body.modelId, baseUrl: '', owner } }));
          credentialQueues.set(key, write); await write; if (credentialQueues.get(key) === write) credentialQueues.delete(key);
          if (body.emailEnabled !== undefined) await notifications.subscribe(owner, key, body.emailEnabled);
          return storage.update(key, current => {
            if (current?.policy.enabled || current?.activeRunId) throw new Error('项目状态已变化，请刷新后重试');
            const source = current || createAwakening(context);
            const changed = JSON.stringify(source.context) !== JSON.stringify(context);
            let next = { ...source, context, contextVersion: source.contextVersion + (changed ? 1 : 0), updatedAt: Date.now() };
            next = enqueueWake(next, { id: hash(`activation:${JSON.stringify(context)}`), kind: 'input', title: '研究约定与首次规划', body: '先梳理暂定判断、可证伪假设、缺少的证据、等待条件和最小下一步。尚无证据时明确未知，不承诺执行未接入的实验或监测。', source: '用户开启长期关注', at: Date.now(), status: 'pending' });
            if (next.problemHeartbeat?.lifecycle === 'resolved') next.problemHeartbeat = { ...next.problemHeartbeat, lifecycle: 'watching' };
            return configureAwakening(next, policy);
          });
        });
        activationQueues.set(key, activate);
        try { send(200, { state: await activate }); } finally { if (activationQueues.get(key) === activate) activationQueues.delete(key); }
        return;
      }
      if (req.method === 'PUT' && url.pathname === '/notifications') {
        if (!(await storage.read(key))) throw new Error('请先开启或同步当前问题');
        await notifications.subscribe(owner, key, body.enabled);
        send(200, await notifications.view(owner, key)); return;
      }
      if (req.method === 'POST' && url.pathname === '/pause-project') {
        let paused = 0;
        for (const candidate of await storage.keys()) {
          const s = await storage.read(candidate);
          if (s.context.projectId !== projectId || candidate !== scopeKey(owner, projectId, s.context.branchId, s.context.scopeId)) continue;
          await storage.update(candidate, state => ({ ...state, policy: { ...state.policy, enabled: false }, status: 'paused', reason: '项目停止后台研究；已发送请求返回后停止', updatedAt: Date.now() })); paused++;
        }
        send(200, { paused }); return;
      }
      if (req.method === 'PUT' && url.pathname === '/context') {
        const context = sanitizeContext(body); if (context.projectId !== projectId || context.branchId !== branchId || context.scopeId !== scopeId) throw new Error('项目范围不一致');
        const state = await storage.update(key, old => {
          const s = old || createAwakening(context); const changed = JSON.stringify(s.context) !== JSON.stringify(context);
          const next = { ...s, context, contextVersion: s.contextVersion + (changed ? 1 : 0), updatedAt: Date.now() };
          if (!changed && old) return next;
          return enqueueWake(next, { id: hash(JSON.stringify(context)), kind: 'evidence', title: old ? '项目目标、角色或事实更新' : '首次问题规划', body: '请依据最新项目上下文判断需要核验或规划的工作。', source: '项目同步', at: Date.now(), status: 'pending' });
        }); send(200, { state }); return;
      }
      if (!(await storage.read(key))) throw new Error('请先同步当前问题');
      if (req.method === 'POST' && url.pathname === '/heartbeat') {
        const state = await storage.update(key, s => heartbeatAction(s, body, Date.now(), randomUUID));
        send(200, { state }); return;
      }
      if (req.method === 'PUT' && url.pathname === '/policy') {
        if (body.enabled === true && !testMode && !options.model) {
          const creds = await storage.credentials(key);
          if (!creds.default && !ROLES.every(role => creds[role])) throw new Error('请先设置后台通用模型，或为全部角色分别配置模型');
        }
        const state = await storage.update(key, s => configureAwakening(s, body, Date.now()));
        send(200, { state }); return;
      }
      if (req.method === 'POST' && url.pathname === '/events') {
        const kind = ['input', 'manual'].includes(body.kind) ? body.kind : 'input'; const content = cleanText(body.body, 12000); if (!content) throw new Error('请填写线索内容');
        const source = cleanText(body.source, 1200); const event = { id: kind === 'manual' ? randomUUID() : hash(`${kind}:${content}:${source}`), kind, title: cleanText(body.title, 200) || '用户新线索', body: content, source, at: Date.now(), status: 'pending' };
        const state = await storage.update(key, s => enqueueWake(s, event)); send(200, { state }); return;
      }
      if (req.method === 'PUT' && url.pathname === '/model') {
        if (![...ROLES, 'default'].includes(body.role)) throw new Error('模型角色无效');
        if (body.provider === 'platform') {
          const catalog = await shared.view(owner);
          if (!catalog.models.some(m => m.id === body.model && m.enabled && m.hasKey)) throw new Error('共享模型不存在或未启用');
          const previous = credentialQueues.get(key) || Promise.resolve();
          const write = previous.catch(() => {}).then(async () => { const creds = await storage.credentials(key); creds[body.role] = { provider: 'platform', model: body.model, baseUrl: '', owner }; await storage.credentials(key, creds); });
          credentialQueues.set(key, write); await write; if (credentialQueues.get(key) === write) credentialQueues.delete(key);
          send(200, { saved: true }); return;
        }
        const endpoint = new URL(body.baseUrl); if (endpoint.protocol !== 'https:' || !allowedModels.has(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.port && endpoint.port !== '443')) throw new Error('模型地址不在后台允许的 HTTPS 服务列表中');
        if (!['openai', 'openai-compatible', 'anthropic'].includes(body.provider)) throw new Error('不支持的模型协议');
        const settings = { provider: body.provider, baseUrl: endpoint.toString().replace(/\/+$/, ''), model: cleanText(body.model, 160), apiKey: cleanText(body.apiKey, 4096) };
        if (!settings.model || !settings.apiKey) throw new Error('请填写模型 ID 和 API Key');
        const previous = credentialQueues.get(key) || Promise.resolve();
        const write = previous.catch(() => {}).then(async () => { const creds = await storage.credentials(key); creds[body.role] = settings; await storage.credentials(key, creds); });
        credentialQueues.set(key, write); await write; if (credentialQueues.get(key) === write) credentialQueues.delete(key);
        send(200, { saved: true }); return;
      }
      send(404, { error: '接口不存在' });
    } catch (e) { send(e.status || 400, { error: e instanceof SyntaxError ? 'JSON 格式错误' : e.message }); }
  });
  return { server, storage, tick, close: async () => { closing = true; clearInterval(interval); await new Promise(resolve => server.close(resolve)); while (ticking || active.size) await new Promise(r => setTimeout(r, 100)); await fs.unlink(lockFile); claimedDirectories.delete(storage.dir); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createWakeServer(); const port = Number(process.env.PORT || 8790); const host = process.env.WAKE_HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`HiExplore wake service listening on ${host}:${port}`));
  const stop = () => app.close().then(() => process.exit(0)); process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
