import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createWakeServer, collectPapers, paperMatchesQuery } from '../server/wake-server.mjs';
import { scopeKey } from '../server/wake-storage.mjs';

const context = { projectId: 'p', branchId: 'main', scopeId: 'root', question: '翻译眼镜噪声环境是否可靠？', background: '', facts: [], agents: {} };
async function setup(t, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wake-test-'));
  const env = { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_DEV_TOKEN: 'isolated-fake-test-token', WAKE_TEST_MODE: 'true', ...extra.env };
  const config = { ...extra, env, collect: async () => [] };
  let app = await createWakeServer(config);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const request = async (route, method = 'GET', body, overrides = {}, token = env.WAKE_DEV_TOKEN) => {
    const query = new URLSearchParams({ projectId: 'p', branchId: 'main', scopeId: 'root', ...overrides });
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${route}?${query}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { get app() { return app; }, dir, env, request, restart: async () => { await app.close(); app = await createWakeServer(config); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); } };
}
test('后台独立运行、重复 tick 不重复研究、重启后历史还在', async t => {
  const f = await setup(t);
  assert.equal((await f.request('/context', 'PUT', context)).status, 200);
  await f.request('/policy', 'PUT', { enabled: true });
  // No browser connection or UI is involved after queue submission.
  await Promise.all([f.app.tick(), f.app.tick()]);
  let result = await f.request('/state'); assert.equal(result.body.state.runs.length, 1); assert.equal(result.body.state.budget.calls, 4);
  await f.restart(); await f.app.tick(); result = await f.request('/state'); assert.equal(result.body.state.runs.length, 1); assert.equal(result.body.state.policy.enabled, true);
});
test('鉴权、项目/分支/想法隔离和模型地址限制', async t => {
  const f = await setup(t);
  assert.equal((await f.request('/context', 'PUT', context, {}, 'wrong-token')).status, 401);
  await f.request('/context', 'PUT', context);
  for (const overrides of [{ projectId: 'other' }, { branchId: 'other' }, { scopeId: 'idea' }]) assert.equal((await f.request('/state', 'GET', undefined, overrides)).body.state, null);
  assert.notEqual(scopeKey('owner1', 'p', 'main', 'root'), scopeKey('owner2', 'p', 'main', 'root'));
  assert.equal((await f.request('/context', 'PUT', { ...context, projectId: 'different' })).status, 400);
  assert.equal((await f.request('/model', 'PUT', { role: 'default', baseUrl: 'http://169.254.169.254', provider: 'openai-compatible', model: 'fake', apiKey: 'fake' })).status, 400);
});
test('密钥持久化为密文，不出现在状态、上下文、模型返回中', async t => {
  const f = await setup(t); await f.request('/context', 'PUT', { ...context, agents: { manager: { name: '经理', description: '验证', apiKey: 'MUST-DROP', model: { credentialId: 'MUST-DROP' } } } });
  const fake = 'FAKE-UNUSABLE-TEST-KEY-123';
  assert.equal((await f.request('/model', 'PUT', { role: 'default', baseUrl: 'https://api.deepseek.com', model: 'test-model', provider: 'openai-compatible', apiKey: fake })).status, 200);
  const response = JSON.stringify((await f.request('/state')).body); assert.ok(!response.includes(fake)); assert.ok(!response.includes('MUST-DROP')); assert.ok(response.includes('test-model'));
  for (const filename of await fs.readdir(f.dir)) assert.ok(!(await fs.readFile(path.join(f.dir, filename), 'utf8')).includes(fake));
  await f.restart(); const key = scopeKey('development', 'p', 'main', 'root'); assert.equal((await f.app.storage.credentials(key)).default.apiKey, fake);
});
test('相同输入去重；暂停后有线索也不运行；崩溃保留记录并停用', async t => {
  const f = await setup(t); await f.request('/context', 'PUT', context);
  for (let i = 0; i < 2; i++) await f.request('/events', 'POST', { body: '噪声测试失败', source: '实验一' });
  await f.app.tick(); let result = (await f.request('/state')).body.state; assert.equal(result.events.length, 2); assert.equal(result.runs.length, 0);
  const key = scopeKey('development', 'p', 'main', 'root');
  await f.app.storage.update(key, s => ({ ...s, activeRunId: 'crash', policy: { ...s.policy, enabled: true }, runs: [{ id: 'crash', eventIds: [], startedAt: Date.now(), reason: '中断', outcome: 'running', steps: [] }] }));
  await f.restart(); result = (await f.request('/state')).body.state; assert.equal(result.policy.enabled, false); assert.equal(result.runs[0].outcome, 'interrupted');
});
test('Crossref 只收集带 DOI 的元数据、相同记录去重标识稳定', async () => {
  let seen;
  const mock = async url => { seen = url; return { ok: true, text: async () => JSON.stringify({ message: { items: [{ DOI: '10.1234/ABC', title: ['Translation Paper'], abstract: '<jats:p>abstract</jats:p>' }, { DOI: 'javascript:bad', title: ['bad'] }] } }) }; };
  const first = await collectPapers('translation', mock); const next = await collectPapers('translation', mock);
  assert.equal(first.length, 1); assert.equal(first[0].id, next[0].id); assert.equal(seen.hostname, 'api.crossref.org');
  assert.match(first[0].body, /未核验研究结论/); assert.equal(first[0].source, 'https://doi.org/10.1234/abc');
});
test('论文采集先核对主题，单个偶然命中词不能消耗研究调用', () => {
  assert.equal(paperMatchesQuery('smart glasses speech translation noise', 'Normative translation audit for AI ethics'), false);
  assert.equal(paperMatchesQuery('smart glasses speech translation noise', 'Smart environmental governance'), false);
  assert.equal(paperMatchesQuery('smart glasses speech translation noise', 'Speech translation with smart glasses'), true);
  assert.equal(paperMatchesQuery('AI glasses', 'RAIL eyeglasses feature comparison'), false);
  assert.equal(paperMatchesQuery('the and for', 'any content'), false);
});
test('公开开发令牌、错误预算和模拟公网模式在启动时拒绝', async () => {
  await assert.rejects(createWakeServer({ env: { WAKE_GLOBAL_DAILY_CALLS: 'NaN', WAKE_MASTER_KEY: randomBytes(32).toString('base64') } }), /总调用上限/);
  await assert.rejects(createWakeServer({ env: { WAKE_HOST: '0.0.0.0', WAKE_TEST_MODE: 'true' } }), /本机监听/);
  await assert.rejects(createWakeServer({ env: { WAKE_HOST: '0.0.0.0', WAKE_DEV_TOKEN: 'fake', WAKE_MASTER_KEY: randomBytes(32).toString('base64') } }), /正式登录/);
});
test('真实请求路径使用用户凭据与持久全局预算，额度耗尽不继续发请求', async t => {
  const requests = [];
  const f = await setup(t, { env: { WAKE_TEST_MODE: 'false', WAKE_GLOBAL_DAILY_CALLS: '1' }, fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: 'research', reason: '新材料', task: '制定方案', role: 'thinker', stopCondition: '一个方案' }) } }] }) };
  } });
  await f.request('/context', 'PUT', context);
  assert.equal((await f.request('/policy', 'PUT', { enabled: true })).status, 400);
  await f.request('/model', 'PUT', { role: 'default', baseUrl: 'https://api.deepseek.com', model: 'test-only', provider: 'openai-compatible', apiKey: 'fake-only' });
  await f.request('/policy', 'PUT', { enabled: true }); await f.app.tick();
  assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fake-only');
  let state = (await f.request('/state')).body.state; assert.equal(state.policy.enabled, false); assert.match(state.reason, /总调用预算/);
  assert.equal(state.runs[0].steps[0].model.model, 'test-only');
  await f.restart(); await f.request('/policy', 'PUT', { enabled: true }); await f.app.tick(); assert.equal(requests.length, 1);
});
test('正式身份验证按账号隔离；项目暂停覆盖全部分支，保留其他项目', async t => {
  const f = await setup(t, { env: { WAKE_AUTH_API: 'https://login.example.test', WAKE_DEV_TOKEN: '' }, fetch: async (_url, options) => ({ ok: true, json: async () => ({ user: { email: options.headers.Authorization } }) }) });
  const req = (route, method, body, scope = {}, token = 'owner-A') => f.request(route, method, body, scope, token);
  await req('/context', 'PUT', context);
  await req('/policy', 'PUT', { enabled: true });
  await req('/context', 'PUT', { ...context, branchId: 'branch2' }, { branchId: 'branch2' });
  await req('/policy', 'PUT', { enabled: true }, { branchId: 'branch2' });
  await req('/context', 'PUT', { ...context, projectId: 'other' }, { projectId: 'other' });
  await req('/policy', 'PUT', { enabled: true }, { projectId: 'other' });
  assert.equal((await req('/state', 'GET', undefined, {}, 'owner-B')).body.state, null);
  assert.equal((await req('/project-status', 'GET', undefined, {}, 'owner-B')).body.total, 0);
  assert.equal((await req('/project-status', 'GET')).body.total, 1);
  assert.equal((await req('/pause-project', 'POST', {})).body.paused, 2);
  assert.equal((await req('/state', 'GET', undefined, { branchId: 'branch2' })).body.state.policy.enabled, false);
  assert.equal((await req('/state', 'GET', undefined, { projectId: 'other' })).body.state.policy.enabled, true);
});
test('超长或重复事实原子拒绝，不能变为截断的可信上下文', async t => {
  const f = await setup(t); const fact = { id: 'f1', claim: 'claim', source: 'source', excerpt: 'excerpt', scope: 'scope', status: 'confirmed' };
  assert.equal((await f.request('/context', 'PUT', { ...context, facts: [fact, fact] })).status, 400);
  assert.equal((await f.request('/context', 'PUT', { ...context, facts: [{ ...fact, excerpt: 'x'.repeat(1801) }] })).status, 400);
  assert.equal((await f.request('/state')).body.state, null);
});

test('问题提醒设置按范围保存，重启不丢失，未认证不可写入', async t => {
 const f=await setup(t);await f.request('/context','PUT',{...context,language:'en'});
 assert.equal((await f.request('/heartbeat','POST',{action:'preferences',preference:'quiet',priority:'low'}, {}, 'wrong-token')).status,401);
 assert.equal((await f.request('/heartbeat','POST',{action:'preferences',preference:'quiet',priority:'low'})).status,200);
 await f.restart();let s=(await f.request('/state')).body.state;assert.equal(s.context.language,'en');assert.equal(s.problemHeartbeat.preference,'quiet');assert.equal(s.problemHeartbeat.priority,'low');
 assert.equal((await f.request('/state','GET',undefined,{branchId:'other'})).body.state,null);
 await f.request('/heartbeat','POST',{action:'lifecycle',lifecycle:'resolved'});s=(await f.request('/state')).body.state;assert.equal(s.policy.enabled,false);
});

test('一键开启验证模型与额度、只领取一次，重试和重启不重复入队', async t => {
  const f = await setup(t, { env: { WAKE_ADMIN_IDENTITIES: 'development', WAKE_STARTER_TOKENS: '30000', WAKE_STARTER_POOL_TOKENS: '30000' } });
  const input = { context, modelId: 'deepseek', paperQuery: '', emailEnabled: false };
  assert.equal((await f.request('/activate', 'POST', input)).status, 400);
  assert.equal((await f.request('/state')).body.state, null);
  await f.request('/admin/shared/models', 'PUT', { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'fake-model', apiKey: 'FAKE_TEST_ONLY', enabled: true, dailyTokens: 100000, maxOutputTokens: 2048 });
  assert.equal((await f.request('/activate', 'POST', { ...input, emailEnabled: true })).status, 400);
  const results = await Promise.all([f.request('/activate', 'POST', input), f.request('/activate', 'POST', input)]);
  assert.ok(results.every(r => r.status === 200));
  let result = (await f.request('/state')).body;
  assert.equal(result.state.policy.enabled, true); assert.equal(result.state.events.length, 1);
  assert.equal(result.models.default.provider, 'platform'); assert.equal(result.notifications.enabled, false);
  assert.equal((await f.request('/shared/catalog')).body.balances.deepseek.granted, 30000);
  await f.restart(); await f.request('/activate', 'POST', input);
  result = (await f.request('/state')).body;
  assert.equal(result.state.events.length, 1); assert.equal((await f.request('/shared/catalog')).body.balances.deepseek.granted, 30000);
  await f.app.tick(); result = (await f.request('/state')).body;
  assert.ok(result.state.runs[0].plan); assert.ok(result.state.lastCheckedAt);
});
test('无额度不会开启研究；邮件收件人只能由服务端认证身份决定', async t => {
  const f = await setup(t, { env: { WAKE_ADMIN_IDENTITIES: 'development' } });
  await f.request('/admin/shared/models', 'PUT', { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'fake-model', apiKey: 'FAKE_TEST_ONLY', enabled: true, dailyTokens: 100000, maxOutputTokens: 2048 });
  assert.equal((await f.request('/activate', 'POST', { context, modelId: 'deepseek', paperQuery: '' })).status, 400);
  assert.equal((await f.request('/state')).body.state, null);
  const paid = await setup(t, { env: { WAKE_AUTH_API: 'https://auth.example.test', WAKE_DEV_TOKEN: '', RESEND_API_KEY: 'FAKE_TEST_ONLY', MAIL_FROM: 'hello@example.test', WAKE_PUBLIC_URL: 'https://pay.example.test' }, fetch: async () => Response.json({ user: { email: 'owner@example.test' } }) });
  await paid.request('/context', 'PUT', context);
  assert.equal((await paid.request('/notifications', 'PUT', { enabled: true, recipient: 'attacker@example.test' })).status, 200);
  const status = (await paid.request('/state')).body.notifications;
  assert.equal(status.recipient, 'owner@example.test'); assert.equal(status.enabled, true);
});
