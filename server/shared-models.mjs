import { createHash } from 'node:crypto';
import { buildModelRequest, parseModelResponse } from './.wake-build/runner.mjs';

const STORE = createHash('sha256').update('hiexplore-shared-models-v1').digest('hex');
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const int = (value, min, max, label) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}超出范围`); return value; };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const day = () => new Date().toISOString().slice(0, 10);
const empty = () => ({ version: 1, models: {}, accounts: {}, grants: [], calls: [] });
const publicModel = ({ apiKey, ...model }) => ({ ...model, hasKey: !!apiKey });
const accountKey = owner => createHash('sha256').update(owner).digest('hex');
const wallet = (s, owner, modelId) => s.accounts[accountKey(owner)]?.balances[modelId];
const usedToday = (s, id) => s.calls.filter(c => c.modelId === id && c.day === day()).reduce((n, c) => n + (c.charged ?? c.reserved), 0);

/** One encrypted ledger and one serialization queue. Requires the wake server's single-process lock. */
export class SharedModels {
  constructor(storage, allowedHosts, fetcher, beforeSend) {
    this.storage = storage; this.allowedHosts = allowedHosts; this.fetcher = fetcher; this.beforeSend = beforeSend;
    this.queue = Promise.resolve(); this.active = new Set();
  }
  transaction(fn) {
    const next = this.queue.catch(() => {}).then(async () => {
      const stored = await this.storage.credentials(STORE);
      const s = stored.version ? stored : empty();
      const result = await fn(s);
      await this.storage.credentials(STORE, s);
      return result;
    });
    this.queue = next; return next;
  }
  async initialize() {
    await this.transaction(s => {
      for (const c of s.calls) if (c.status === 'reserved') { c.status = 'uncertain'; c.error = '后台重启，等待管理员核对供应商用量'; }
    });
  }
  async view(owner, admin = false) {
    return this.transaction(s => ({
      isAdmin: admin,
      models: Object.values(s.models).map(m => ({ ...publicModel(m), usedToday: usedToday(s, m.id) })),
      balances: walletView(s.accounts[accountKey(owner)]),
      calls: s.calls.filter(c => admin || c.owner === owner).slice(-100).reverse(),
      ...(admin ? { accounts: Object.values(s.accounts).map(a => ({ owner: a.owner, balances: walletView(a) })), grants: s.grants.slice(-100).reverse() } : {}),
    }));
  }
  async saveModel(body) {
    if (!idOK(body.id)) throw fail('模型标识仅允许字母、数字、下划线和短横线');
    const url = new URL(body.baseUrl);
    if (url.protocol !== 'https:' || !this.allowedHosts.has(url.hostname) || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443')) throw fail('模型地址不在后台允许的 HTTPS 服务列表中');
    if (!['openai', 'openai-compatible', 'anthropic'].includes(body.provider)) throw fail('模型协议无效');
    if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80 || typeof body.model !== 'string' || !body.model.trim() || body.model.length > 160) throw fail('请填写模型显示名称和供应商模型 ID');
    if (typeof body.enabled !== 'boolean') throw fail('启用状态无效');
    const baseUrl = url.toString().replace(/\/+$/, '');
    return this.transaction(s => {
      const old = s.models[body.id];
      if (!old && Object.keys(s.models).length >= 50) throw fail('首版最多配置 50 个共享模型');
      const sameTarget = old?.provider === body.provider && old?.baseUrl === baseUrl;
      const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : sameTarget ? old.apiKey : '';
      if ((body.enabled && !apiKey) || apiKey.length > 4096) throw fail('开放模型前请填写 API Key；更改接口地址或协议后必须重新填写');
      const model = { id: body.id, label: body.label.trim(), provider: body.provider, baseUrl, model: body.model.trim(), apiKey, enabled: body.enabled,
        dailyTokens: int(body.dailyTokens, 0, 1e9, '模型每日 Token 上限'), maxOutputTokens: int(body.maxOutputTokens, 64, 16384, '单次输出 Token 上限'), updatedAt: Date.now() };
      s.models[body.id] = model; return { model: publicModel(model) };
    });
  }
  async grant(admin, body) {
    if (!idOK(body.requestId) || typeof body.owner !== 'string' || !body.owner.trim() || body.owner.length > 200 || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500) throw fail('请填写用户登录邮箱、分配备注和操作标识');
    const tokens = int(body.tokens, 1, 1e9, '增加的 Token'); const owner = body.owner.trim();
    return this.transaction(s => {
      const previous = s.grants.find(g => g.id === body.requestId);
      if (previous) {
        if (previous.owner !== owner || previous.modelId !== body.modelId || previous.tokens !== tokens || previous.note !== body.note.trim()) throw fail('操作标识已用于不同的额度分配', 409);
        return { grant: previous, duplicate: true };
      }
      if (!s.models[body.modelId]) throw fail('共享模型不存在');
      if (s.grants.length >= 10000) throw fail('额度记录已达首版上限，请先由运维归档');
      const key = accountKey(owner); const account = s.accounts[key] ||= { owner, balances: {} };
      const balance = account.balances[body.modelId] ||= { granted: 0, available: 0, spent: 0, held: 0 };
      int(balance.granted + tokens, 0, 1e12, '累计分配额度');
      balance.granted += tokens; balance.available += tokens;
      const grant = { id: body.requestId, owner, modelId: body.modelId, tokens, note: body.note.trim(), admin, at: Date.now(), type: 'manual-token-grant' };
      s.grants.push(grant); return { grant };
    });
  }
  async settle(id, tokens, status, note, admin) {
    return this.transaction(s => {
      const call = s.calls.find(c => c.id === id); if (!call) throw fail('调用记录不存在');
      if (call.status !== 'reserved' && call.status !== 'uncertain') throw fail('该调用已经结算', 409);
      if (admin && (this.active.has(id) || call.status === 'reserved')) throw fail('请求仍在执行，不能人工结算', 409);
      int(tokens, 0, 1e9, '实际 Token');
      const balance = wallet(s, call.owner, call.modelId);
      balance.held -= call.reserved; balance.available += call.reserved - tokens; balance.spent += tokens;
      Object.assign(call, { charged: tokens, status, completedAt: Date.now(), note, ...(admin ? { reconciledBy: admin } : {}) });
      if (tokens > call.reserved) { s.models[call.modelId].enabled = false; call.overrun = true; }
      return { call };
    });
  }
  async reconcile(admin, body) {
    if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500) throw fail('请填写核对供应商用量的依据');
    return this.settle(body.callId, body.tokens, 'reconciled', body.note.trim(), admin);
  }
  async invoke(owner, body, scope = {}) {
    if (!idOK(body.requestId) || !idOK(body.modelId)) throw fail('请求标识或共享模型标识无效');
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 || body.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) throw fail('仅支持纯文本对话');
    const messages = body.messages.map(({ role, content }) => ({ role, content }));
    const bytes = Buffer.byteLength(JSON.stringify(messages)); if (bytes > 120000) throw fail('上下文过长，请缩小任务范围');
    const id = createHash('sha256').update(`${owner}:${body.requestId}`).digest('hex');
    // Conservative reservation, not a tokenizer or a promised invoice amount. Actual provider usage settles it.
    const reservation = await this.transaction(s => {
      if (s.calls.some(c => c.id === id)) throw fail('此请求已受理，不会重复调用或扣款；请查看使用记录', 409);
      const settings = s.models[body.modelId]; if (!settings?.enabled || !settings.apiKey) throw fail('共享模型尚未启用或已暂停');
      if (s.calls.length >= 10000) throw fail('用量记录已达首版上限，请由运维归档');
      if (s.calls.some(c => c.owner === owner && c.modelId === body.modelId && c.status === 'uncertain')) throw fail('此模型有待核对用量，请联系管理员处理后继续', 409);
      const maxTokens = Math.min(int(body.maxTokens ?? 2048, 1, 16384, '请求输出上限'), settings.maxOutputTokens);
      const reserved = bytes * 2 + 2048 + maxTokens;
      const balance = wallet(s, owner, body.modelId);
      if (!balance || balance.available < reserved) throw fail(`此模型额度不足，本次需预留 ${reserved} Token；可联系管理员增加额度或使用自己的 API Key`, 402);
      if (usedToday(s, body.modelId) + reserved > settings.dailyTokens) throw fail('此共享模型今日额度已用完', 429);
      if (s.calls.some(c => c.owner === owner && c.status === 'reserved')) throw fail('已有共享模型请求执行中，请等待返回', 429);
      balance.available -= reserved; balance.held += reserved;
      s.calls.push({ id, requestId: body.requestId, owner, modelId: body.modelId, model: settings.model, provider: settings.provider,
        reserved, status: 'reserved', day: day(), at: Date.now(), scope });
      this.active.add(id); return { settings: { ...settings }, maxTokens };
    });
    let dispatched = false;
    try {
      const request = buildModelRequest(reservation.settings, messages, { maxTokens: reservation.maxTokens, jsonMode: body.jsonMode === true });
      delete request.headers['anthropic-dangerous-direct-browser-access'];
      await this.beforeSend(); dispatched = true;
      const response = await this.fetcher(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw fail(`模型供应商返回 HTTP ${response.status}；用量待核对`, 502);
      const raw = await response.text(); if (raw.length > 1_000_000) throw fail('模型响应过大，用量待核对', 502);
      const data = JSON.parse(raw); const usage = providerUsage(data.usage, reservation.settings.provider);
      const settled = await this.settle(id, usage.total, 'settled', '按供应商返回用量结算');
      const parsed = parseModelResponse(data, reservation.settings.provider);
      if (!parsed.content?.trim()) throw fail('模型没有返回正文；已按实际用量结算', 502);
      return { content: parsed.content.split(reservation.settings.apiKey).join('[REDACTED]'), usage: { prompt_tokens: usage.input, completion_tokens: usage.output }, callId: settled.call.id };
    } catch (e) {
      await this.transaction(s => {
        const call = s.calls.find(c => c.id === id);
        if (call.status !== 'reserved') return;
        if (dispatched) { call.status = 'uncertain'; call.error = '请求已发送，用量尚未确认；保留预留额度，不自动重试'; }
        else { const balance = wallet(s, owner, body.modelId); balance.held -= call.reserved; balance.available += call.reserved; Object.assign(call, { status: 'cancelled', charged: 0, completedAt: Date.now() }); }
      });
      throw fail(e.status ? e.message : '共享模型请求失败，用量状态见使用记录；不会自动重试', e.status || 502);
    } finally { this.active.delete(id); }
  }
}
function walletView(account) { return account?.balances || {}; }
export function providerUsage(u, provider) {
  if (!u || typeof u !== 'object') throw fail('供应商没有返回 Token 用量，需人工核对', 502);
  const number = v => int(v, 0, 1e9, '供应商 Token 用量');
  if (provider === 'anthropic') {
    const input = number(u.input_tokens) + number(u.cache_creation_input_tokens ?? 0) + number(u.cache_read_input_tokens ?? 0);
    const output = number(u.output_tokens); return { input, output, total: input + output };
  }
  const input = number(u.prompt_tokens); const output = number(u.completion_tokens);
  const total = u.total_tokens === undefined ? input + output : number(u.total_tokens);
  if (total < input + output) throw fail('供应商用量字段不一致，需人工核对', 502);
  return { input, output: total - input, total };
}
