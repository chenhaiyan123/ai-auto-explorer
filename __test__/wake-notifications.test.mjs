import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { WakeStorage } from '../server/wake-storage.mjs';
import { WakeNotifications, importantUpdates } from '../server/wake-notifications.mjs';
import { createAwakening, collectWaits, recordJudgments } from '../server/.wake-build/runner.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const context = { projectId: 'p', branchId: 'main', scopeId: 'root', question: '怎样让西晒房更凉快？', facts: [], agents: {}, background: '' };
const HOUR = 3600000;
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wake-email-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const storage = new WakeStorage(dir, randomBytes(32)); await storage.initialize();
  let now = 1790400000000; const requests = []; let fail = false;
  const env = { RESEND_API_KEY: 'FAKE_TEST_KEY', MAIL_FROM: 'HiExplore <hello@example.test>', WAKE_PUBLIC_URL: 'https://pay.example.test' };
  const fetcher = async (url, opts) => { requests.push({ url, ...opts }); if (fail) throw new Error('ambiguous timeout'); return Response.json({ id: 'fake-mail-id' }); };
  let mail = new WakeNotifications(storage, env, fetcher, () => now);
  let seq = 0; const key = hash('test scope');
  const state = () => createAwakening(context, now);
  await storage.update(key, state);
  const wait = async (key2 = key) => storage.update(key2, s => collectWaits(s, [{ kind: 'data', title: `补充真实数据 ${++seq}`, detail: '提供温度记录', condition: '收到实测温度', source: '', owner: 'You' }], now, () => `wait-${seq}`));
  return { key, storage, env, requests, state, wait, get mail() { return mail; }, advance: ms => { now += ms; }, fail: v => { fail = v; }, restart: () => { mail = new WakeNotifications(storage, env, fetcher, () => now); } };
}
test('默认不发送；订阅只发新重要事件；去重和重启保留；邮件只发到绑定账号', async t => {
  const f = await setup(t); await f.wait(); await f.mail.process(); assert.equal(f.requests.length, 0);
  f.advance(1000); await f.mail.subscribe('friend@example.test', f.key, true);
  await f.mail.process(); assert.equal(f.requests.length, 0);
  await f.wait(); await Promise.all([f.mail.process(), f.mail.process()]);
  assert.equal(f.requests.length, 1);
  const body = JSON.parse(f.requests[0].body); assert.deepEqual(body.to, ['friend@example.test']);
  assert.match(body.text, /提供温度记录/); assert.ok(!body.text.includes('FAKE_TEST_KEY'));
  assert.ok(f.requests[0].headers['Idempotency-Key']);
  f.restart(); await f.mail.process(); assert.equal(f.requests.length, 1);
  const files = await fs.readdir(f.storage.dir);
  const sealed = await fs.readFile(path.join(f.storage.dir, files.find(x => x.endsWith('.sealed'))), 'utf8');
  assert.ok(!sealed.includes('friend@example.test'));
  assert.equal((await f.mail.view('other@example.test', f.key)).enabled, false);
  await assert.rejects(f.mail.subscribe('other@example.test', f.key, true), /身份不匹配/);
});
test('跨项目按账号限频；12小时合并一次，每24小时最多2封', async t => {
  const f = await setup(t); const k2 = hash('other scope'); await f.storage.update(k2, f.state);
  for (const key of [f.key, k2]) await f.mail.subscribe('friend@example.test', key, true);
  await f.wait(); await f.wait(k2); await f.mail.process(); assert.equal(f.requests.length, 1);
  f.advance(12 * HOUR); await f.mail.process(); assert.equal(f.requests.length, 2);
  await f.wait(); f.advance(HOUR); await f.mail.process(); assert.equal(f.requests.length, 2);
});
test('超时在24小时幂等窗口内重试同一内容；不跨窗口重复发送', async t => {
  const f = await setup(t); await f.mail.subscribe('friend@example.test', f.key, true); await f.wait(); f.fail(true);
  await f.mail.process(); assert.equal(f.requests.length, 1);
  f.advance(16 * 60000); f.restart(); await f.mail.process(); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].body, f.requests[1].body); assert.equal(f.requests[0].headers['Idempotency-Key'], f.requests[1].headers['Idempotency-Key']);
  f.advance(24 * HOUR); f.fail(false); await f.mail.process(); assert.equal(f.requests.length, 2);
  assert.match((await f.mail.view('friend@example.test', f.key)).error, /停止重试/);
});
test('退订、安静模式、已处理待办和撤回事实不会发送', async t => {
  const f = await setup(t); await f.mail.subscribe('friend@example.test', f.key, true); await f.wait();
  await f.storage.update(f.key, s => ({ ...s, problemHeartbeat: { ...s.problemHeartbeat, preference: 'quiet' } }));
  await f.mail.process(); assert.equal(f.requests.length, 0);
  await f.storage.update(f.key, s => ({ ...s, problemHeartbeat: { ...s.problemHeartbeat, preference: 'important' } }));
  await f.mail.process(); assert.equal(f.requests.length, 1);
  const token = JSON.parse(f.requests[0].body).text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal(await f.mail.unsubscribe('bad'), false); assert.equal(await f.mail.unsubscribe(token), true);
  await f.wait(); f.advance(24 * HOUR); await f.mail.process(); assert.equal(f.requests.length, 1);
  let state = await f.storage.read(f.key);
  state.problemHeartbeat.waits.forEach(w => { w.status = 'received'; }); assert.equal(importantUpdates(state).length, 0);
  const fact = { id: 'f', claim: '真实测量', source: 'test', excerpt: '数据', scope: 'room', status: 'confirmed' };
  state.context.facts = [fact]; state = recordJudgments(state, [{ subject: '降温方法', after: '遮阳值得试验', reason: '测量', evidenceIds: ['f'] }], 'r', Date.now(), () => 'j');
  assert.equal(importantUpdates(state).length, 1); state.context.facts[0].status = 'disputed'; assert.equal(importantUpdates(state).length, 0);
});
test('未配置发信不假装订阅成功，正常阅读不产生邮件', async t => {
  const f = await setup(t); const mail = new WakeNotifications(f.storage, {});
  assert.equal((await mail.view('friend@example.test', f.key)).ready, false);
  await assert.rejects(mail.subscribe('friend@example.test', f.key, true), /邮件尚未配置/);
  await assert.rejects(f.mail.subscribe('development', f.key, true), /已验证邮箱/);
  await mail.process(); assert.equal(f.requests.length, 0);
});
