import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { SharedModels } from '../server/shared-models.mjs';
import { WakeStorage } from '../server/wake-storage.mjs';
import { createWakeServer } from '../server/wake-server.mjs';
import { previewWakeRequest } from '../server/.wake-build/runner.mjs';
const model = { id: 'economy', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'fake', label: 'Fake', apiKey: 'NOT-A-REAL-KEY', enabled: true, dailyTokens: 1e8, maxOutputTokens: 1024 };
const contract = (totalTokens = 100000) => ({ confirmed: true, expectedRevision: 0, goal: 'Identify a supported need', acceptance: 'One actual interview with counterexamples', stopCondition: 'Wait for evidence', deadline: Date.now() + 86400000, tools: ['model_analysis', 'paper_search'], budgets: { economy: { totalTokens, dailyTokens: totalTokens, perCallTokens: totalTokens } } });
const chat = () => ({ requestId: randomUUID(), modelId: 'economy', messages: [{ role: 'user', content: 'Analyze supplied evidence' }], maxTokens: 1024 });
const response = (content = 'OK', tokens = 50) => Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: tokens, completion_tokens: 0 } });
async function ledgerFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-budget-')); t.after(() => fs.rm(dir, { force: true, recursive: true }));
  const storage = new WakeStorage(dir, randomBytes(32)); await storage.initialize(); let fetcher = async () => response(); let count = 0;
  const ledger = new SharedModels(storage, new Set(['api.deepseek.com']), (...args) => { count++; return fetcher(...args); }, async () => {});
  await ledger.initialize(); await ledger.saveModel(model);
  await ledger.grant('admin', { owner: 'alice', modelId: model.id, tokens: 1000000, note: 'fixture', requestId: randomUUID() });
  const body = contract(); await ledger.saveProject('alice', 'project', body);
  await ledger.projectAction('alice', 'project', { action: 'resume', expectedRevision: 1 });
  return { ledger, storage, body, setFetch: f => { fetcher = f; }, get count() { return count; } };
}
test('one project budget covers roles and branches; revisions never reset spending; other owners cannot alter it', async t => {
  const f = await ledgerFixture(t), scope = { projectId: 'project', branchId: 'main', role: 'manager', mandateRevision: 1 };
  await f.ledger.invoke('alice', chat(), scope);
  await f.ledger.invoke('alice', chat(), { ...scope, branchId: 'fork', role: 'auditor' });
  assert.equal((await f.ledger.project('alice', 'project')).usage.economy.spent, 100);
  assert.equal(await f.ledger.project('bob', 'project'), null);
  await assert.rejects(f.ledger.projectAction('bob', 'project', { action: 'resume', expectedRevision: 1 }));
  const changed = await f.ledger.saveProject('alice', 'project', { ...f.body, expectedRevision: 1, budgets: contract(100).budgets });
  assert.equal(changed.status, 'paused'); assert.equal(changed.termsRevision, 1); assert.equal(changed.usage.economy.remaining, 0);
  await f.ledger.projectAction('alice', 'project', { action: 'resume', expectedRevision: 2 });
  await assert.rejects(f.ledger.invoke('alice', chat(), { ...scope, mandateRevision: 2 }), e => e.code === 'PROJECT_BUDGET' && e.notSent);
  assert.equal(f.count, 2);
});
test('concurrent calls, duplicate IDs, daily and per-call caps cannot overspend', async t => {
  const f = await ledgerFixture(t); let release, started;
  const gate = new Promise(r => release = r), seen = new Promise(r => started = r);
  f.setFetch(async () => { started(); await gate; return response(); });
  const body = chat(), scope = { projectId: 'project' };
  const pending = f.ledger.invoke('alice', body, scope); await seen;
  await assert.rejects(f.ledger.invoke('alice', chat(), { ...scope, branchId: 'other' }), /执行中/);
  await assert.rejects(f.ledger.invoke('alice', body, scope), /已受理/); release(); await pending;
  for (const caps of [{ totalTokens: 100000, dailyTokens: 50, perCallTokens: 50 }, { totalTokens: 100000, dailyTokens: 100000, perCallTokens: 1 }]) {
    const old = await f.ledger.project('alice', 'project');
    await f.ledger.saveProject('alice', 'project', { ...f.body, expectedRevision: old.revision, budgets: { economy: caps } });
    await f.ledger.projectAction('alice', 'project', { action: 'resume', expectedRevision: old.revision + 1 });
    await assert.rejects(f.ledger.invoke('alice', chat(), scope), e => e.code === 'PROJECT_BUDGET');
  }
  assert.equal(f.count, 1);
});
test('uncertain usage freezes the whole project across model switches and survives restart until reconciled', async t => {
  const f = await ledgerFixture(t);
  await f.ledger.saveModel({ ...model, id: 'other' });
  await f.ledger.grant('admin', { owner: 'alice', modelId: 'other', tokens: 100000, note: 'fixture', requestId: randomUUID() });
  await f.ledger.saveProject('alice', 'project', { ...f.body, expectedRevision: 1, budgets: { ...f.body.budgets, other: f.body.budgets.economy } });
  await f.ledger.projectAction('alice', 'project', { action: 'resume', expectedRevision: 2 });
  f.setFetch(async () => { throw new Error('timeout after dispatch'); });
  await assert.rejects(f.ledger.invoke('alice', chat(), { projectId: 'project' }));
  const m = await f.ledger.project('alice', 'project'); assert.ok(m.uncertain); assert.ok(m.usage.economy.held > 0);
  const restarted = new SharedModels(f.storage, new Set(['api.deepseek.com']), async () => response(), async () => {}); await restarted.initialize();
  await assert.rejects(restarted.invoke('alice', { ...chat(), modelId: 'other' }, { projectId: 'project' }), e => e.code === 'PROJECT_UNCERTAIN');
  await restarted.reconcile('admin', { callId: m.calls[0].id, tokens: 23, note: 'mock provider receipt' });
  assert.equal((await restarted.project('alice', 'project')).usage.economy.spent, 23);
  await restarted.invoke('alice', { ...chat(), modelId: 'other' }, { projectId: 'project' });
});
test('deadline, permissions and revisions are server-enforced; completion needs human evidence', async t => {
  const f = await ledgerFixture(t);
  await assert.rejects(f.ledger.guardProject('alice', 'project', { now: f.body.deadline + 1 }), e => e.code === 'PROJECT_DEADLINE');
  await assert.rejects(f.ledger.guardProject('alice', 'project', { tool: 'purchase' }), e => e.code === 'PROJECT_PERMISSION');
  await assert.rejects(f.ledger.guardProject('alice', 'project', { revision: 0 }), e => e.code === 'PROJECT_CHANGED');
  await assert.rejects(f.ledger.saveProject('alice', 'project', { ...f.body, expectedRevision: 1, confirmed: false }));
  await assert.rejects(f.ledger.projectAction('alice', 'project', { action: 'complete', expectedRevision: 1 }));
  await f.ledger.projectAction('alice', 'project', { action: 'complete', expectedRevision: 1, note: 'Human checked fixture artifact' });
  await assert.rejects(f.ledger.projectAction('alice', 'project', { action: 'resume', expectedRevision: 1 }));
  await assert.rejects(f.ledger.projectAction('alice', 'project', { action: 'pause', expectedRevision: 1 }));
  assert.equal(f.count, 0);
});

const ctx = { projectId: 'p', branchId: 'main', scopeId: 'root', question: 'Will anyone use this?', background: '', facts: [], agents: {} };
const query = '?' + new URLSearchParams({ projectId: ctx.projectId, branchId: ctx.branchId, scopeId: ctx.scopeId });
async function serverFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mandate-api-'));
  const seen = []; let chargeFirst = 50, hook;
  const app = await createWakeServer({ env: { WAKE_DATA_DIR: dir, WAKE_MASTER_KEY: randomBytes(32).toString('base64'), WAKE_DEV_TOKEN: 'test', WAKE_HOST: '127.0.0.1', WAKE_ADMIN_IDENTITIES: 'development' }, collect: async () => [], fetch: async (_url, opts) => {
    const messages = JSON.parse(opts.body).messages;
    const role = messages[0].content.match(/职责：(\w+)/)?.[1]; seen.push(role);
    if (hook) await hook(role);
    const content = role === 'manager' ? { decision: 'research', role: 'thinker', reason: 'Design a bounded check', task: 'Review supplied material', stopCondition: 'One plan' } : role === 'thinker' ? { summary: 'Analysis only', findings: [{ claim: 'Collect an interview', kind: 'plan', evidenceIds: [] }] } : role === 'verifier' ? { summary: 'No real experiment done', problems: [] } : { verdict: 'progress', summary: 'A plan, no real evidence yet', next: 'Wait for interview', acceptedIndexes: [0] };
    return response(JSON.stringify(content), seen.length === 1 ? chargeFirst : 50);
  } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const req = async (route, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, { method, headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  await req('/admin/shared/models', 'PUT', model);
  await req('/admin/shared/grants', 'POST', { owner: 'development', modelId: model.id, tokens: 1000000, note: 'test only', requestId: randomUUID() });
  await req('/activate' + query, 'POST', { context: ctx, modelId: model.id, paperQuery: '' });
  return { app, req, seen, setFirstCharge: n => chargeFirst = n, setHook: f => hook = f };
}
test('budget pause saves a checkpoint; budget increase does not start it; resume never re-pays completed steps', async t => {
  const f = await serverFixture(t);
  const initial = (await f.req('/state' + query)).body.state;
  const preview = await previewWakeRequest(initial);
  // Add mandate context to preview to match the real manager prompt reservation.
  const draft = contract();
  initial.mandate = { revision: 1, termsRevision: 1, goal: draft.goal, acceptance: draft.acceptance, stopCondition: draft.stopCondition, deadline: draft.deadline };
  const exact = await previewWakeRequest(initial);
  const reserve = Buffer.byteLength(JSON.stringify(exact.request.messages)) * 2 + 2048 + 1024;
  const body = { ...draft, budgets: contract(reserve + 100).budgets };
  assert.equal((await f.req('/mandate' + query, 'PUT', body)).status, 200);
  assert.equal((await f.req('/state' + query)).body.state.policy.enabled, false);
  await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 1 });
  assert.equal((await f.req('/policy' + query, 'PUT', { enabled: true })).status, 200);
  f.setFirstCharge(reserve); await f.app.tick();
  let state = (await f.req('/state' + query)).body.state;
  assert.equal(state.stopCode, 'PROJECT_BUDGET'); assert.ok(state.checkpoint); assert.equal(f.seen.length, 1);
  const originalRun = state.checkpoint.runId;
  await f.req('/mandate' + query, 'PUT', { ...body, expectedRevision: 1, budgets: contract(100000).budgets });
  await f.app.tick(); assert.equal(f.seen.length, 1);
  await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 2 });
  assert.equal((await f.req('/policy' + query, 'PUT', { enabled: true })).status, 200);
  await f.app.tick(); state = (await f.req('/state' + query)).body.state;
  assert.deepEqual(f.seen, ['manager', 'thinker', 'verifier', 'auditor']);
  assert.equal(state.runs.length, 1); assert.equal(state.runs[0].id, originalRun); assert.equal(state.runs[0].outcome, 'progress'); assert.equal(state.checkpoint, undefined);
  assert.ok(preview.request);
});
test('pause during an in-flight request retains its result; changed evidence invalidates checkpoint without a call', async t => {
  const f = await serverFixture(t); const body = contract();
  await f.req('/mandate' + query, 'PUT', body); await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 1 }); await f.req('/policy' + query, 'PUT', { enabled: true });
  f.setHook(async role => { if (role === 'manager') await f.req('/mandate/action' + query, 'POST', { action: 'pause', expectedRevision: 1 }); });
  await f.app.tick(); let state = (await f.req('/state' + query)).body.state; assert.ok(state.checkpoint); assert.equal(f.seen.length, 1);
  await f.req('/context' + query, 'PUT', { ...ctx, background: 'New contradictory evidence' });
  await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 1 });
  const r = await f.req('/policy' + query, 'PUT', { enabled: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /检查点/); assert.equal(f.seen.length, 1);
  assert.equal((await f.req('/checkpoint/discard' + query, 'POST', {})).status, 200);
  assert.equal((await f.req('/state' + query)).body.state.checkpoint, undefined);
});
test('BYOK, forged permissions and repeated activation cannot bypass enrolled project caps', async t => {
  const f = await serverFixture(t); await f.req('/mandate' + query, 'PUT', contract(10));
  const byok = await f.req('/model' + query, 'PUT', { role: 'default', provider: 'openai-compatible', baseUrl: model.baseUrl, model: 'private', apiKey: 'FAKE' }); assert.equal(byok.status, 409);
  const enable = await f.req('/activate' + query, 'POST', { context: ctx, modelId: model.id, paperQuery: '' }); assert.equal(enable.status, 409);
  await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 1 });
  assert.equal((await f.req('/activate' + query, 'POST', { context: ctx, modelId: model.id, paperQuery: '' })).status, 402);
  assert.equal(f.seen.length, 0);
});

test('pause after reservation but before dispatch releases both account and project holds', async t => {
  const f = await ledgerFixture(t);
  f.ledger.beforeSend = async () => f.ledger.projectAction('alice', 'project', { action: 'pause', expectedRevision: 1 });
  await assert.rejects(f.ledger.invoke('alice', chat(), { projectId: 'project', mandateRevision: 1 }), e => e.notSent);
  const m = await f.ledger.project('alice', 'project');
  assert.equal(m.usage.economy.spent, 0); assert.equal(m.usage.economy.held, 0); assert.equal(m.calls[0].status, 'cancelled');
  assert.equal((await f.ledger.view('alice')).balances.economy.available, 1000000); assert.equal(f.count, 0);
});
test('budget-only revision preserves checkpoint terms; changed goal or deadline does not', async t => {
  const f = await ledgerFixture(t);
  let m = await f.ledger.saveProject('alice', 'project', { ...f.body, expectedRevision: 1, budgets: contract(200000).budgets });
  assert.equal(m.termsRevision, 1);
  m = await f.ledger.saveProject('alice', 'project', { ...f.body, expectedRevision: 2, deadline: f.body.deadline + 1000 }); assert.equal(m.termsRevision, 2);
  m = await f.ledger.saveProject('alice', 'project', { ...f.body, expectedRevision: 3, goal: 'Different acceptance problem' }); assert.equal(m.termsRevision, 3);
  assert.equal(f.count, 0);
});
test('idle enrolled project checks without model spend; expired or unpermitted work cannot start', async t => {
  const f = await serverFixture(t); const body = contract();
  await f.req('/mandate' + query, 'PUT', body);
  // Make an intentionally quiet fixture without generating fake research results.
  for (const key of await f.app.storage.keys()) await f.app.storage.update(key, s => ({ ...s, events: [], nextCheckAt: Date.now(), nextReviewAt: Date.now() + 86400000 }));
  await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 1 });
  await f.req('/policy' + query, 'PUT', { enabled: true }); await f.app.tick();
  assert.equal(f.seen.length, 0); assert.equal((await f.req('/state' + query)).body.state.status, 'sleeping');
  await f.req('/mandate' + query, 'PUT', { ...body, expectedRevision: 1, tools: ['model_analysis'] });
  await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 2 });
  await f.req('/policy' + query, 'PUT', { enabled: true, paperQuery: 'test data' }); await f.app.tick();
  assert.equal((await f.req('/state' + query)).body.state.stopCode, 'PROJECT_PERMISSION'); assert.equal(f.seen.length, 0);
});

test('resume preflights the next unpaid role model, not the already-completed manager model', async t => {
  const f = await serverFixture(t); const body = contract();
  await f.req('/mandate' + query, 'PUT', body); await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 1 }); await f.req('/policy' + query, 'PUT', { enabled: true });
  f.setHook(async role => { if (role === 'manager') await f.req('/mandate/action' + query, 'POST', { action: 'pause', expectedRevision: 1 }); });
  await f.app.tick(); assert.ok((await f.req('/state' + query)).body.state.checkpoint);
  await f.req('/admin/shared/models', 'PUT', { ...model, id: 'other' });
  await f.req('/admin/shared/grants', 'POST', { owner: 'development', modelId: 'other', tokens: 1, note: 'test only', requestId: randomUUID() });
  await f.req('/model' + query, 'PUT', { role: 'thinker', provider: 'platform', model: 'other' });
  await f.req('/mandate' + query, 'PUT', { ...body, expectedRevision: 1, budgets: { ...body.budgets, other: body.budgets.economy } });
  await f.req('/mandate/action' + query, 'POST', { action: 'resume', expectedRevision: 2 });
  const result = await f.req('/policy' + query, 'PUT', { enabled: true });
  assert.equal(result.status, 402); assert.match(result.body.error, /当前可用 1 Token/); assert.equal(f.seen.length, 1);
});
