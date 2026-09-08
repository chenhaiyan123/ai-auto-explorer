import './manager.test';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInquiry, newRound, addFact, reviewFact, runInquiry, taskMessages } from '../services/inquiry';
import { AGENT_ROLES, profilesOf, editAgentProfile, applyDescriptions, validateAgentModel, reconfigurePendingAgent, type AgentModelConfig } from '../services/agentProfiles';
import { activeAgentMemory, agentMemoryContext, syncAgentMemories } from '../services/agentMemory';
import { buildModelRequest, parseModelResponse } from '../services/modelRequest';
import { callLLM, loadLLMSettings } from '../services/llmProvider';
import { agentModelCaller, saveAgentCredential, resolveAgentModel, snapshotAgentModels } from '../services/agentModel';
import { ensureWorktree, saveStage, branchFromStage, switchExplorationBranch } from '../services/projectWorktree';
import type { Project } from '../types';

const local = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => local.get(key) || null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) }, configurable: true });
const fact = { claim: '样本中有 8/10 人选择翻译', source: '独立测试记录第2页', excerpt: '1–8选择翻译；9、10选择导航', scope: '仅测试样本，不能代表市场' };
const confirmed = () => { const w = addFact(createInquiry('q', '为什么使用翻译？'), fact); return reviewFact(w, w.facts[0].id, 'confirmed', '已核对测试原始记录'); };
const output = (sys: string) => sys.includes('团队的思想家') ? JSON.stringify({ summary: '竞争假设', hypotheses: [1, 2, 3].map(i => ({ statement: `H${i}`, falsification: `F${i}` })) }) : sys.includes('团队的执行者') ? JSON.stringify({ summary: '没有更多已核验资料', candidates: [] }) : JSON.stringify({ summary: '不能扩大适用范围', verdict: 'uncertain' });

test('AI 描述只更新指定角色，保留模型设置；缺少字段时原子失败', () => {
  let w = createInquiry('q', '问题');
  const p = { ...profilesOf(w).executor, description: '用户已有描述', model: { provider: 'openai' as const, baseUrl: 'https://example.test/v1', model: 'test-model' } };
  w = editAgentProfile(w, 'executor', p);
  const generated = applyDescriptions(w, JSON.stringify({ agents: { thinker: { name: '反例研究员', description: '主动寻找竞争解释' } } }), ['thinker']);
  assert.equal(generated.agents?.thinker?.descriptionOrigin, 'ai');
  assert.equal(generated.agents?.executor?.description, '用户已有描述');
  assert.equal(generated.agents?.executor?.model.model, 'test-model');
  assert.throws(() => applyDescriptions(w, '{"agents":{"thinker":{"name":"x","description":"y"}}}', ['thinker', 'auditor']));
  assert.equal(w.agents?.thinker, undefined);
});

test('每轮冻结角色配置和模型，后续编辑只影响新轮次且不跨问题', () => {
  let w = createInquiry('q', '问题');
  w = editAgentProfile(w, 'thinker', { ...profilesOf(w).thinker, name: '旧名称', description: '先找反例' });
  w = newRound(w);
  w = editAgentProfile(w, 'thinker', { ...profilesOf(w).thinker, name: '新名称', description: '优先设计实验' });
  const r = w.rounds[0];
  assert.equal(r.agents?.thinker.name, '旧名称');
  assert.ok(taskMessages(w, r, r.tasks[0]).some(m => m.content.includes('先找反例')));
  w = { ...w, rounds: [{ ...r, status: 'completed' }] };
  assert.equal(newRound(w).rounds[1].agents?.thinker.name, '新名称');
  assert.equal(profilesOf(createInquiry('other', '另一个问题')).thinker.description, '');
});

test('未核验或只有 AI 审核的事实不能进入记忆，已核验陈述不被扩写', () => {
  let w = addFact(createInquiry('q', '问题'), fact);
  w = syncAgentMemories(w, 'round-completed', 'r');
  assert.equal(activeAgentMemory(w, 'thinker').length, 0);
  assert.equal(w.memoryHistory?.length, AGENT_ROLES.length);
  const c = confirmed();
  for (const role of AGENT_ROLES) assert.equal(activeAgentMemory(c, role)[0].claim, fact.claim);
  const forged = { ...c, facts: c.facts.map(f => ({ ...f, reviews: f.reviews.filter(r => r.actor !== 'human') })) };
  assert.equal(activeAgentMemory(forged, 'thinker').length, 0);
});

test('事实撤回立即清除有效记忆，保留前后证据及撤回原因', () => {
  const w = confirmed(); const fid = w.facts[0].id;
  const next = reviewFact(w, fid, 'disputed', '发现样本重复');
  assert.equal(activeAgentMemory(next, 'auditor').length, 0);
  assert.ok(!agentMemoryContext(next, 'auditor').includes(fact.claim));
  const changes = next.memoryHistory!.filter(e => e.role === 'auditor').at(-1)!.changes;
  assert.equal(changes[0].kind, 'withdrawn');
  assert.equal(changes[0].before?.excerpt, fact.excerpt);
  assert.match(changes[0].reason, /样本重复/);
  assert.equal(activeAgentMemory(w, 'auditor').length, 1);
});

test('每轮记录无变化，重复完成不会重复留痕，记忆读取保留事实范围', async () => {
  let w = newRound(confirmed());
  await runInquiry({ read: () => w, write: next => { w = next; }, shouldStop: () => false, model: async messages => output(messages[0].content) });
  assert.equal(w.memoryHistory?.filter(e => e.trigger === 'round-completed').length, AGENT_ROLES.length);
  assert.ok(w.memoryHistory?.filter(e => e.trigger === 'round-completed').every(e => e.changes.length === 0));
  const count = w.memoryHistory!.length;
  w = syncAgentMemories(w, 'round-completed', w.rounds[0].id);
  assert.equal(w.memoryHistory!.length, count);
  assert.match(agentMemoryContext(w, 'executor'), /不能代表市场/);
});

test('记忆正文预算不能截断原始证据并假装已读取', () => {
  let w = confirmed();
  w = { ...w, facts: w.facts.map(f => ({ ...f, excerpt: 'x'.repeat(6000) })) };
  w = syncAgentMemories(w, 'fact-review');
  const context = agentMemoryContext(w, 'thinker');
  assert.match(context, /另有 1 条/);
  assert.ok(!context.includes('xxxx'));
});

test('Claude 使用 Messages 协议；OpenAI 与兼容接口的参数独立', () => {
  const messages = [{ role: 'system', content: '规则' }, { role: 'user', content: '问题' }];
  const claude = buildModelRequest({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'configured-claude', apiKey: 'test-secret' }, messages, { jsonMode: true });
  assert.equal(claude.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(claude.headers['x-api-key'], 'test-secret');
  assert.equal(claude.headers['anthropic-version'], '2023-06-01');
  assert.equal(claude.body.system, '规则');
  assert.deepEqual(claude.body.messages, [messages[1]]);
  assert.ok(!('response_format' in claude.body));
  const openai = buildModelRequest({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'configured-openai', apiKey: 'test-secret' }, messages, { jsonMode: true });
  assert.equal(openai.headers.Authorization, 'Bearer test-secret');
  assert.ok('max_completion_tokens' in openai.body && !('max_tokens' in openai.body));
  const compatible = buildModelRequest({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', apiKey: '' }, messages);
  assert.equal(compatible.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.ok('max_tokens' in compatible.body);
  assert.deepEqual(parseModelResponse({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '结果' }], usage: { input_tokens: 10, output_tokens: 2 } }, 'anthropic'), { content: '结果', usage: { prompt_tokens: 10, completion_tokens: 2 } });
  assert.throws(() => parseModelResponse({ stop_reason: 'max_tokens' }, 'anthropic'), /长度限制/);
});

test('角色密钥按账号和 API 地址绑定；项目和全局配置均不包含新密钥', () => {
  local.clear();
  const config: AgentModelConfig = { provider: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'model-a' };
  config.credentialId = saveAgentCredential('owner-a', config, 'secret-for-a');
  assert.equal(resolveAgentModel(config, 'owner-a').apiKey, 'secret-for-a');
  assert.throws(() => resolveAgentModel(config, 'owner-b'), /不存在/);
  assert.throws(() => resolveAgentModel({ ...config, baseUrl: 'https://another.test/v1' }, 'owner-a'), /地址或协议/);
  let w = editAgentProfile(createInquiry('q', '问题'), 'thinker', { ...profilesOf(createInquiry('q', '问题')).thinker, model: config });
  assert.ok(!JSON.stringify(w).includes('secret-for-a'));
  assert.equal(localStorage.getItem('ai_explorer_llm_settings'), null);
  assert.throws(() => validateAgentModel({ ...config, baseUrl: 'https://example.test/v1?api_key=secret' }));
  assert.throws(() => validateAgentModel({ ...config, baseUrl: 'https://user:password@example.test/v1' }));
});

test('跟随全局的模型在开轮时冻结，密钥只保存为引用', () => {
  local.clear();
  localStorage.setItem('ai_explorer_llm_settings', JSON.stringify({ provider: 'openai', baseUrl: 'https://example.test/v1', model: 'global-model', apiKey: 'global-secret' }));
  const profiles = snapshotAgentModels(profilesOf(createInquiry('q', '问题')), 'owner');
  assert.equal(profiles.thinker.model.model, 'global-model');
  assert.ok(!JSON.stringify(profiles).includes('global-secret'));
  assert.equal(resolveAgentModel(profiles.thinker.model, 'owner').apiKey, 'global-secret');
  assert.equal(loadLLMSettings().model, 'global-model');
  local.clear();
});

test('真实调用层按角色路由不同端点，不改全局设置；结果进入原任务', async () => {
  const oldFetch = globalThis.fetch; const requests: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url, options) => {
    const body = JSON.parse(String(options?.body)); requests.push({ url: String(url), body });
    const sys = body.system || body.messages[0].content;
    const content = output(sys);
    return new Response(JSON.stringify(body.system ? { content: [{ type: 'text', text: content }] } : { choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    let w = createInquiry('q', '问题');
    for (const role of AGENT_ROLES) w = editAgentProfile(w, role, { ...profilesOf(w)[role], description: `${role}定制描述`, model: { provider: role === 'thinker' ? 'anthropic' : role === 'auditor' ? 'openai' : 'openai-compatible', baseUrl: `https://${role}.test/v1`, model: `${role}-model` } });
    w = newRound(w);
    await runInquiry({ read: () => w, write: next => { w = next; }, shouldStop: () => false, model: agentModelCaller('test') });
    assert.equal(w.rounds[0].status, 'completed');
    assert.equal(requests.length, 10);
    assert.equal(requests[0].url, 'https://thinker.test/v1/messages');
    assert.equal(requests[1].url, 'https://executor.test/v1/chat/completions');
    assert.equal(requests[2].body.model, 'verifier-model');
    assert.equal(requests[3].body.model, 'auditor-model');
    assert.equal(w.rounds[0].tasks[3].agentSnapshot?.description, 'auditor定制描述');
    assert.equal(localStorage.getItem('ai_explorer_llm_settings'), null);
  } finally { globalThis.fetch = oldFetch; }
});

test('失败信息不会把服务端回显的角色密钥写入任务历史', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'bad key fake-secret' } }), { status: 401 })) as typeof fetch;
  try { await assert.rejects(callLLM([{ role: 'user', content: 'test' }], {}, { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'x', apiKey: 'fake-secret' }), error => !String(error).includes('fake-secret') && String(error).includes('401')); }
  finally { globalThis.fetch = oldFetch; }
});

test('探索分支恢复角色配置和记忆历史，另一条分支的撤回不污染原分支', () => {
  const p: Project = { id: 'p', name: '项目', metaProblem: '问题', createdAt: 1, nodes: [], inquiries: { q: confirmed() } };
  let saved = saveStage(ensureWorktree(p), '已核验');
  const main = saved.worktree!.activeBranchId;
  saved = branchFromStage(saved, saved.worktree!.currentStageId, '验证反证');
  saved = { ...saved, inquiries: { q: reviewFact(saved.inquiries!.q, saved.inquiries!.q.facts[0].id, 'disputed', '反证') } };
  const restored = switchExplorationBranch(saved, main);
  assert.equal(activeAgentMemory(restored.inquiries!.q, 'thinker').length, 1);
  assert.equal(activeAgentMemory(saved.inquiries!.q, 'thinker').length, 0);
});

test('失败后显式修复未完成角色配置，保留完成步骤并记录变更', async () => {
  let w = newRound(createInquiry('q', '问题')); let calls = 0;
  await runInquiry({ read: () => w, write: next => { w = next; }, shouldStop: () => false, model: async messages => { calls++; if (calls === 3) throw new Error('原验证模型失效'); return output(messages[0].content); } });
  const oldTask = JSON.stringify(w.rounds[0].tasks[0]);
  w = reconfigurePendingAgent(w, 'verifier', { ...profilesOf(w).verifier, description: '使用替代模型检查来源', model: { provider: 'openai', baseUrl: 'https://replacement.test/v1', model: 'replacement-model' } });
  let remaining = 0;
  await runInquiry({ read: () => w, write: next => { w = next; }, shouldStop: () => false, model: async (messages, context) => { remaining++; if (context?.role === 'verifier') assert.equal(context.agent.model.model, 'replacement-model'); return output(messages[0].content); } });
  assert.equal(remaining, 8);
  assert.equal(JSON.stringify(w.rounds[0].tasks[0]), oldTask);
  assert.equal(w.rounds[0].configHistory?.length, 1);
  assert.equal(w.rounds[0].status, 'completed');
  assert.throws(() => reconfigurePendingAgent(w, 'thinker', profilesOf(w).thinker), /只有暂停/);
});

test('自定义体验代理不能接收应用登录令牌', async () => {
  local.clear();
  localStorage.setItem('ai_explorer_llm_settings', JSON.stringify({ provider: 'trial', baseUrl: 'https://trusted.test', model: 'trial-model', apiKey: '' }));
  localStorage.setItem('aae-auth-token', 'test-login-token');
  const original = globalThis.fetch; let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error('不应发送请求'); }) as typeof fetch;
  try {
    await assert.rejects(callLLM([{ role: 'user', content: 'test' }], {}, { provider: 'trial', baseUrl: 'https://unrelated.test', model: 'x', apiKey: '' }), /仅允许使用全局/);
    assert.equal(called, false);
  } finally { globalThis.fetch = original; local.clear(); }
});
