import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWakeServer } from '../server/wake-server.mjs';
import { SEARCH_FEE_TOKENS } from '../server/shared-models.mjs';
import { collectWeb } from '../server/wake-server.mjs';
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

const qwen = { id: 'qwen', label: '通义千问', provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', apiKey: 'FAKE-QWEN-KEY', enabled: true, dailyTokens: 1000000, maxOutputTokens: 2048 };
async function fundQwen(f, tokens = 100000) {
  assert.equal((await f.req('/admin/shared/models', 'PUT', qwen, 'admin')).status, 200);
  assert.equal((await f.req('/admin/shared/grants', 'POST', { requestId: randomUUID(), owner: 'user@example.test', tokens, modelId: 'qwen', note: '模拟测试额度' }, 'admin')).status, 200);
}
const native = { output: { choices: [{ message: { role: 'assistant', content: '{"items":[{"title":"新数据","summary":"相关","source":1}]}' }, finish_reason: 'stop' }], search_info: { search_results: [{ index: 1, title: '某报道', url: 'https://news.example.cn/a', site_name: '示例网' }] } }, usage: { input_tokens: 3000, output_tokens: 50, total_tokens: 3050, plugins: { search: { count: 1, strategy: 'turbo' } } } };

test('联网搜索：千问走 DashScope 原生接口，返回来源，按实际用量 + 搜索费结算', async t => {
  const f = await fixture(t); await fundQwen(f);
  f.setResponse(native);
  const r = await f.req('/shared/chat', 'POST', { requestId: randomUUID(), modelId: 'qwen', maxTokens: 500, webSearch: true, messages: [{ role: 'user', content: '搜一下' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sources[0].url, 'https://news.example.cn/a');
  const sent = f.requests.at(-1);
  assert.equal(String(sent.url), 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation');
  const body = JSON.parse(sent.options.body);
  assert.equal(body.parameters.enable_search, true); assert.equal(body.parameters.search_options.enable_source, true); assert.equal(body.parameters.enable_thinking, false);
  assert.ok(!('response_format' in body));
  const cat = (await f.req('/shared/catalog')).body;
  assert.equal(cat.balances.qwen.spent, 3050 + SEARCH_FEE_TOKENS);
  assert.equal(cat.balances.qwen.held, 0);
});
test('联网搜索只允许千问模型；其它模型直接拒绝且不发请求', async t => {
  const f = await fixture(t); await fund(f, 100000);
  const r = await f.req('/shared/chat', 'POST', { ...chat(), webSearch: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /只支持通义千问/);
  assert.equal(f.requests.length, 0);
});
test('供应商 401/429 直接按 0 结算并释放预留，不再卡在「待核对」', async t => {
  const f = await fixture(t); await fund(f, 100000);
  f.setHook(async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }), { status: 401 }));
  const r = await f.req('/shared/chat', 'POST', chat());
  assert.equal(r.status, 502); assert.match(r.body.error, /401.*Incorrect API key.*已自动释放/);
  const cat = (await f.req('/shared/catalog')).body;
  assert.equal(cat.calls[0].status, 'rejected'); assert.equal(cat.calls[0].charged, 0);
  assert.equal(cat.balances[model.id].held, 0); assert.equal(cat.balances[model.id].available, 100000);
  assert.ok(!JSON.stringify(cat).includes('FAKE-SHARED-KEY'));
});
test('供应商 5xx 仍保持待核对（可能已计费）', async t => {
  const f = await fixture(t); await fund(f, 100000);
  f.setHook(async () => new Response('{}', { status: 503 }));
  const r = await f.req('/shared/chat', 'POST', chat());
  assert.equal(r.status, 502);
  const cat = (await f.req('/shared/catalog')).body;
  assert.equal(cat.calls[0].status, 'uncertain');
});
test('网页线索：只保留能对上搜索来源编号的条目', async () => {
  let n = 0;
  const events = await collectWeb({ question: '少儿编程续费', query: '续费率', id: () => `id${n++}`, invoke: async body => {
    assert.equal(body.webSearch, true);
    return { content: '结果：{"items":[{"title":"真实的","summary":"有出处","source":1},{"title":"编的","summary":"没出处","source":9}]}', sources: [{ index: 1, title: 't', url: 'https://a.example/x' }] };
  } });
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'https://a.example/x'); assert.equal(events[0].kind, 'evidence');
  assert.match(JSON.parse(events[0].body).note, /未核验/);
});
