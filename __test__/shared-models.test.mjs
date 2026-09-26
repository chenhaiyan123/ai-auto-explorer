import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';
import { providerUsage, SharedModels } from '../server/shared-models.mjs';
import { WakeStorage } from '../server/wake-storage.mjs';

const model = { id: 'economy', label: '测试经济模型', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'fake-model', apiKey: 'FAKE-SHARED-KEY-NEVER-REAL', enabled: true, dailyTokens: 1000000, maxOutputTokens: 4096 };
const ctx = { projectId: 'p', branchId: 'main', scopeId: 'root', question: '西晒房如何改善舒适度？', background: '', facts: [], agents: {} };
const query = '?projectId=p&branchId=main&scopeId=root';
const grant = (owner = 'user@example.test', tokens = 100000) => ({ requestId: randomUUID(), owner, tokens, modelId: model.id, note: '模拟测试额度，不涉及收款' });
const chat = () => ({ requestId: randomUUID(), modelId: model.id, maxTokens: 256, messages: [{ role: 'user', content: '模拟请求' }] });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-test-'));
  const env = { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_AUTH_API: 'https://auth.example.test', WAKE_ADMIN_IDENTITIES: 'admin@example.test', WAKE_GLOBAL_DAILY_CALLS: '100' };
  const requests = []; let response = { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } };
  let fetchHook;
  const fetcher = async (url, options) => {
    if (String(url).startsWith(env.WAKE_AUTH_API)) {
      const token = options.headers.Authorization?.slice(7);
      if (!['admin', 'user', 'other'].includes(token)) return new Response('{}', { status: 401 });
      return Response.json({ user: { email: `${token}@example.test`, role: 'user' } });
    }
    requests.push({ url, options }); if (fetchHook) return fetchHook(url, options);
    return Response.json(response);
  };
  let app = await createWakeServer({ env, fetch: fetcher, collect: async () => [] });
  const listen = () => new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); await listen();
  const req = async (route, method = 'GET', body, token = 'user') => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { req, requests, dir, get app() { return app; }, setResponse: v => { response = v; }, setHook: v => { fetchHook = v; }, restart: async () => { await app.close(); app = await createWakeServer({ env, fetch: fetcher, collect: async () => [] }); await listen(); } };
}
async function fund(f, tokens) {
  assert.equal((await f.req('/admin/shared/models', 'PUT', model, 'admin')).status, 200);
  assert.equal((await f.req('/admin/shared/grants', 'POST', grant('user@example.test', tokens), 'admin')).status, 200);
}
test('只有服务端指定的真实身份能管理模型，前端 admin 标志无效', async t => {
  const f = await fixture(t);
  assert.equal((await f.req('/admin/shared')).status, 403);
  assert.equal((await f.req('/admin/shared/models', 'PUT', { ...model, role: 'admin' })).status, 403);
  assert.equal((await f.req('/shared/catalog', 'GET', undefined, 'bad')).status, 401);
  assert.equal((await f.req('/shared/session', 'GET', undefined, 'admin')).body.isAdmin, true);
  assert.equal((await f.req('/shared/session')).body.isAdmin, false);
});
test('未配置 Key 的草稿保持灰色；用户可见暂停模型但无法调用或绑定', async t => {
  const f = await fixture(t);
  const draft = { ...model, apiKey: '', enabled: false };
  assert.equal((await f.req('/admin/shared/models', 'PUT', draft, 'admin')).status, 200);
  const catalog = (await f.req('/shared/catalog')).body;
  assert.equal(catalog.models[0].hasKey, false);
  assert.equal(catalog.models[0].enabled, false);
  assert.equal('apiKey' in catalog.models[0], false);
  assert.equal((await f.req('/admin/shared/models', 'PUT', { ...draft, enabled: true }, 'admin')).status, 400);
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 400);
  await f.req('/context' + query, 'PUT', ctx);
  assert.equal((await f.req('/model' + query, 'PUT', { role: 'default', provider: 'platform', model: model.id })).status, 400);
  await fund(f);
  assert.equal((await f.req('/shared/catalog')).body.models[0].hasKey, true);
  await f.req('/admin/shared/models', 'PUT', { ...model, apiKey: '', enabled: false }, 'admin');
  assert.equal((await f.req('/shared/catalog')).body.models[0].enabled, false);
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 400);
  assert.equal(f.requests.length, 0);
});
test('国内四家接口允许通过后台调用，预留模型不会自动启用', async t => {
  const f = await fixture(t);
  assert.equal((await f.req('/shared/catalog')).body.models.length, 0);
  const urls = ['https://api.deepseek.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://ark.cn-beijing.volces.com/api/v3', 'https://api.moonshot.cn/v1'];
  for (const [i, baseUrl] of urls.entries()) {
    const id = `domestic-${i}`;
    assert.equal((await f.req('/admin/shared/models', 'PUT', { ...model, id, baseUrl }, 'admin')).status, 200);
    assert.equal((await f.req('/admin/shared/grants', 'POST', { ...grant(), modelId: id }, 'admin')).status, 200);
    assert.equal((await f.req('/shared/chat', 'POST', { ...chat(), modelId: id })).status, 200);
    assert.equal(new URL(f.requests.at(-1).url).hostname, new URL(baseUrl).hostname);
  }
});
test('共享密钥不回显且加密落盘；调用只使用后台模型和密钥', async t => {
  const f = await fixture(t); await fund(f);
  const request = { ...chat(), apiKey: 'attack-key', baseUrl: 'http://127.0.0.1', model: 'attack-model' };
  assert.equal((await f.req('/shared/chat', 'POST', request)).status, 200);
  const outgoing = f.requests[0]; assert.match(outgoing.url, /^https:\/\/api.deepseek.com/);
  assert.equal(outgoing.options.headers.Authorization, `Bearer ${model.apiKey}`);
  assert.equal(JSON.parse(outgoing.options.body).model, 'fake-model');
  for (const route of ['/shared/catalog', '/admin/shared']) assert.ok(!JSON.stringify((await f.req(route, 'GET', undefined, 'admin')).body).includes(model.apiKey));
  for (const name of await fs.readdir(f.dir)) assert.ok(!(await fs.readFile(path.join(f.dir, name), 'utf8')).includes(model.apiKey));
  const denied = await f.req('/admin/shared/models', 'PUT', { ...model, baseUrl: 'https://127.0.0.1' }, 'admin'); assert.equal(denied.status, 400);
});
test('额度按实际 Token 结算、不同用户与模型隔离、重复请求不会再调用', async t => {
  const f = await fixture(t); await fund(f);
  const body = chat(); assert.equal((await f.req('/shared/chat', 'POST', body)).status, 200);
  assert.equal((await f.req('/shared/chat', 'POST', body)).status, 409);
  assert.equal((await f.req('/shared/chat', 'POST', chat(), 'other')).status, 402);
  const view = (await f.req('/shared/catalog')).body;
  assert.equal(view.balances.economy.available, 99900); assert.equal(view.balances.economy.held, 0); assert.equal(view.calls[0].charged, 100);
  assert.equal((await f.req('/shared/catalog', 'GET', undefined, 'other')).body.calls.length, 0);
  await f.req('/admin/shared/models', 'PUT', { ...model, id: 'premium' }, 'admin');
  assert.equal((await f.req('/shared/chat', 'POST', { ...chat(), modelId: 'premium' })).status, 402);
  assert.equal(f.requests.length, 1);
  await f.restart(); assert.equal((await f.req('/shared/catalog')).body.balances.economy.spent, 100);
  assert.equal((await f.req('/shared/chat', 'POST', body)).status, 409);
});
test('加额度幂等、备注留痕，重启不会再次赠送', async t => {
  const f = await fixture(t); await fund(f);
  const g = grant(); await f.req('/admin/shared/grants', 'POST', g, 'admin'); await f.req('/admin/shared/grants', 'POST', g, 'admin');
  assert.equal((await f.req('/shared/catalog')).body.balances.economy.granted, 200000);
  assert.equal((await f.req('/admin/shared/grants', 'POST', { ...g, tokens: 1 }, 'admin')).status, 409);
  await f.restart(); assert.equal((await f.req('/admin/shared/grants', 'POST', g, 'admin')).body.duplicate, true);
  const admin = (await f.req('/admin/shared', 'GET', undefined, 'admin')).body; assert.equal(admin.grants.length, 2); assert.equal(admin.grants[0].admin, 'admin@example.test');
});
test('模型每日上限和并发预留阻止超额请求', async t => {
  const f = await fixture(t); await fund(f);
  await f.req('/admin/shared/models', 'PUT', { ...model, dailyTokens: 10 }, 'admin');
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 429); assert.equal(f.requests.length, 0);
  await f.req('/admin/shared/models', 'PUT', model, 'admin');
  let release; let started; const gate = new Promise(resolve => { release = resolve; }); const seen = new Promise(resolve => { started = resolve; });
  f.setHook(async () => { started(); await gate; return Response.json({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); });
  const pending = f.req('/shared/chat', 'POST', chat()); await seen;
  const second = await f.req('/shared/chat', 'POST', chat()); release(); assert.equal(second.status, 429); assert.equal((await pending).status, 200);
  assert.equal(f.requests.length, 1);
});
test('缺少用量保留预留额度，管理员核对后恢复，不自动重试', async t => {
  const f = await fixture(t); await fund(f); f.setResponse({ choices: [{ message: { content: 'OK' } }] });
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 502);
  let view = (await f.req('/shared/catalog')).body; assert.equal(view.calls[0].status, 'uncertain'); assert.ok(view.balances.economy.held > 0);
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 409);
  const callId = view.calls[0].id; assert.equal((await f.req('/admin/shared/reconcile', 'POST', { callId, tokens: 250, note: '已核对模拟账单' })).status, 403);
  await f.restart();
  assert.equal((await f.req('/admin/shared/reconcile', 'POST', { callId, tokens: 250, note: '已核对模拟账单' }, 'admin')).status, 200);
  view = (await f.req('/shared/catalog')).body; assert.equal(view.balances.economy.available, 99750); assert.equal(view.balances.economy.held, 0);
  assert.equal((await f.req('/admin/shared/reconcile', 'POST', { callId, tokens: 0, note: '重复操作' }, 'admin')).status, 409);
});
test('Claude 用量包含缓存读写 Token，达到输出限制仍结算已消耗用量', async t => {
  assert.deepEqual(providerUsage({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }, 'anthropic'), { input: 160, output: 20, total: 180 });
  const f = await fixture(t); await fund(f);
  f.setResponse({ choices: [{ finish_reason: 'length', message: { content: '截断' } }], usage: { prompt_tokens: 20, completion_tokens: 30 } });
  assert.equal((await f.req('/shared/chat', 'POST', chat())).status, 502);
  const v = (await f.req('/shared/catalog')).body; assert.equal(v.balances.economy.spent, 50); assert.equal(v.calls[0].status, 'settled');
});
test('云端团队可绑定共享模型，费用扣在真实所有者名下；自带 Key 不扣共享额度', async t => {
  const f = await fixture(t); await fund(f);
  f.setResponse({ choices: [{ message: { content: JSON.stringify({ decision: 'wait', reason: '尚无新证据', next: '等待实验数据' }) } }], usage: { prompt_tokens: 60, completion_tokens: 40 } });
  await f.req('/context' + query, 'PUT', ctx);
  assert.equal((await f.req('/model' + query, 'PUT', { role: 'default', provider: 'platform', model: 'economy', owner: 'other@example.test' })).status, 200);
  await f.req('/policy' + query, 'PUT', { enabled: true }); await f.app.tick();
  assert.equal((await f.req('/shared/catalog')).body.balances.economy.spent, 100);
  assert.equal((await f.req('/shared/catalog', 'GET', undefined, 'other')).body.calls.length, 0);
  await f.req('/model' + query, 'PUT', { role: 'default', provider: 'openai-compatible', baseUrl: model.baseUrl, model: 'private-model', apiKey: 'FAKE-PRIVATE-KEY' });
  await f.req('/events' + query, 'POST', { kind: 'input', body: '新的用户线索' }); await f.app.tick();
  assert.equal((await f.req('/shared/catalog')).body.balances.economy.spent, 100);
  assert.equal(f.requests.at(-1).options.headers.Authorization, 'Bearer FAKE-PRIVATE-KEY');
});
test('进程中断后预留不会丢失或重发，实际用量超预留暂停模型', async t => {
  const f = await fixture(t); await fund(f);
  f.setResponse({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 20000, completion_tokens: 10000 } });
  await f.req('/shared/chat', 'POST', chat());
  const admin = (await f.req('/admin/shared', 'GET', undefined, 'admin')).body; assert.equal(admin.models[0].enabled, false); assert.equal(admin.calls[0].overrun, true); assert.equal(admin.calls[0].charged, 30000);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-crash-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const storage = new WakeStorage(dir, randomBytes(32)); await storage.initialize(); const ledger = new SharedModels(storage, new Set(['api.deepseek.com']), fetch, async () => {}); await ledger.initialize();
  await ledger.transaction(s => { s.calls.push({ id: 'crash', status: 'reserved', owner: 'user', modelId: 'x', reserved: 100 }); });
  await ledger.initialize(); assert.equal((await ledger.view('user')).calls[0].status, 'uncertain');
});

test('长期关注体验额度按账号仅一次，跨模型和并发也不突破全站池', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starter-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const storage = new WakeStorage(dir, randomBytes(32)); await storage.initialize();
  const shared = new SharedModels(storage, new Set(['api.deepseek.com']), async () => { throw new Error('should not call'); }, async () => {});
  await shared.initialize(); await shared.saveModel(model); await shared.saveModel({ ...model, id: 'other' });
  await Promise.all([shared.starter('a@example.test', model.id, 30000, 30000), shared.starter('a@example.test', 'other', 30000, 30000)]);
  const a = await shared.view('a@example.test'); assert.equal(Object.values(a.balances).reduce((s, b) => s + b.granted, 0), 30000);
  await assert.rejects(shared.starter('b@example.test', model.id, 30000, 30000), /已领完/);
  const restarted = new SharedModels(storage, new Set(['api.deepseek.com']), fetch, async () => {});
  await restarted.starter('a@example.test', 'other', 30000, 30000);
  assert.equal(Object.values((await restarted.view('a@example.test')).balances).reduce((s, b) => s + b.granted, 0), 30000);
});
