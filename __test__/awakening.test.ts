import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAwakening, configureAwakening, enqueueWake, recoverAwakening, availableCalls, visibleWakeStatus, wakePolicy, type Awakening, type WakeEvent } from '../services/awakening';
import { runWake, type WakeRuntime } from '../services/wakeRunner';

const event = (id = 'e1'): WakeEvent => ({ id, kind: 'input', title: '实验失败', body: '翻译测试在噪声条件下失败，需重新设计验证', source: '用户测试日志', at: 1000, status: 'pending' });
function fixture() {
  let now = Date.UTC(2026, 8, 9, 10); let serial = 0;
  let state = createAwakening({ projectId: 'p', branchId: 'b', scopeId: 'root', question: '眼镜能否在噪声中可靠翻译？', background: '', facts: [], agents: {} }, now);
  state.policy.enabled = true; const calls: string[] = [];
  const rt: WakeRuntime = {
    read: async () => structuredClone(state), update: async fn => (state = fn(structuredClone(state))),
    now: () => now, id: () => `r${++serial}`, collect: async () => [],
    model: async role => {
      calls.push(role);
      return JSON.stringify(role === 'manager' ? { decision: 'research', reason: '失败实验提示证据缺口', task: '提出最小验证方案', role: 'thinker', stopCondition: '提出一个方案后等待数据' } : role === 'verifier' ? { summary: '没有实验结果，只能确认方案存在', problems: [] } : role === 'auditor' ? { verdict: 'progress', summary: '制定了新的验证方案', next: '等待 20 个噪声样本的测试结果', acceptedIndexes: [0] } : { summary: '只制定方案，未执行实验', findings: [{ claim: '按噪声水平分层收集 20 个样本', kind: 'plan', evidenceIds: [] }] });
    },
  };
  return { rt, calls, get state() { return state; }, set state(s: Awakening) { state = s; }, advance: (ms: number) => { now += ms; }, enqueue: (e = event()) => { state = enqueueWake(state, e); } };
}
test('无新线索的检查不调用模型，睡眠灯不亮', async () => {
  const f = fixture(); await runWake(f.rt);
  assert.equal(f.calls.length, 0); assert.equal(f.state.status, 'sleeping'); assert.equal(f.state.checks, 1);
  assert.equal(visibleWakeStatus(f.state, true, f.rt.now()).active, false);
});
test('真实步骤预留预算，经理/分析/验证/审计完成后停止，不自动确认事实', async () => {
  const f = fixture(); f.enqueue(); await runWake(f.rt);
  assert.deepEqual(f.calls, ['manager', 'thinker', 'verifier', 'auditor']); assert.equal(f.state.budget.calls, 4);
  assert.equal(f.state.runs[0].outcome, 'progress'); assert.equal(f.state.events[0].status, 'consumed');
  assert.equal(f.state.context.facts.length, 0); assert.equal(f.state.status, 'sleeping');
  await runWake(f.rt); assert.equal(f.calls.length, 4);
});
test('相同事件不会重新消费，同一方案不会被重复算成进展', async () => {
  const f = fixture(); f.enqueue(); f.enqueue(); assert.equal(f.state.events.length, 1);
  await runWake(f.rt); f.enqueue(); await runWake(f.rt); assert.equal(f.calls.length, 4);
  f.enqueue(event('e2')); await runWake(f.rt); assert.equal(f.state.runs[1].outcome, 'waiting'); assert.deepEqual(f.state.runs[1].findings, []);
});
test('经理判定无关只花一次调用，批次中的线索全部归档', async () => {
  const f = fixture(); f.enqueue(); f.rt.model = async role => { f.calls.push(role); return JSON.stringify({ decision: 'wait', reason: '无关材料' }); };
  await runWake(f.rt); assert.deepEqual(f.calls, ['manager']); assert.equal(f.state.runs[0].outcome, 'waiting');
});
test('少于完整审计预算时不启动；跨 UTC 日恢复额度', async () => {
  const f = fixture(); f.enqueue(); f.state.budget.calls = 9;
  await runWake(f.rt); assert.equal(f.calls.length, 0); assert.equal(f.state.status, 'blocked');
  f.advance(86400000); await runWake(f.rt); assert.equal(f.calls.length, 4); assert.equal(availableCalls(f.state, f.rt.now()), 8);
});
test('调用超时保留已预留用量与线索，停用自动重试', async () => {
  const f = fixture(); f.enqueue(); f.rt.model = async () => { throw new Error('超时，可能已计费'); };
  await runWake(f.rt); assert.equal(f.state.budget.calls, 1); assert.equal(f.state.runs[0].outcome, 'failed');
  assert.equal(f.state.events[0].status, 'pending'); assert.equal(f.state.policy.enabled, false);
  await runWake(f.rt); assert.equal(f.state.budget.calls, 1);
});
test('暂停发生在请求中时，不调用下一角色，也不采纳返回成果', async () => {
  const f = fixture(); f.enqueue(); const original = f.rt.model;
  f.rt.model = async (...args) => { const result = await original(...args); f.state.policy.enabled = false; return result; };
  await runWake(f.rt); assert.equal(f.calls.length, 1); assert.equal(f.state.status, 'paused'); assert.equal(f.state.events[0].status, 'pending');
});
test('运行期间事实变化停止旧上下文，已完成步骤仍可追溯', async () => {
  const f = fixture(); f.enqueue(); const original = f.rt.model;
  f.rt.model = async (...args) => { const result = await original(...args); f.state.contextVersion++; return result; };
  await runWake(f.rt); assert.equal(f.calls.length, 1); assert.equal(f.state.runs[0].steps[0].completedAt, f.rt.now()); assert.equal(f.state.runs[0].outcome, 'failed');
});
test('编造证据 ID 无法进入研究结果', async () => {
  const f = fixture(); f.enqueue(); const original = f.rt.model;
  f.rt.model = async (...args) => args[0] === 'thinker' ? JSON.stringify({ summary: '编造引用', findings: [{ claim: '已证实有效', kind: 'observation', evidenceIds: ['fake-doi'] }] }) : original(...args);
  await runWake(f.rt); assert.equal(f.state.runs[0].outcome, 'failed'); assert.equal(f.state.runs[0].findings, undefined);
});
test('30 天离线合并到一次复盘，不补跑所有错过的周期', async () => {
  const f = fixture(); f.advance(30 * 86400000); await runWake(f.rt);
  assert.equal(f.state.checks, 1); assert.equal(f.state.events.filter(e => e.kind === 'review').length, 1); assert.equal(f.state.runs.length, 1); assert.equal(f.calls.length, 4);
  assert.ok(f.state.nextReviewAt > f.rt.now()); assert.ok(f.state.nextCheckAt > f.rt.now());
});
test('连续 30 天无新增证据，模型调用和记录有界', async () => {
  const f = fixture();
  for (let day = 0; day < 30; day++) { await runWake(f.rt); f.advance(86400000); }
  assert.equal(f.state.runs.length, 4); assert.equal(f.calls.length, 16); assert.equal(f.state.runs.filter(r => r.outcome === 'progress').length, 1);
  assert.ok(f.state.checks < 20);
});
test('事实记忆的新增和撤回来自状态差异，旧轮次保留快照', async () => {
  const f = fixture(); f.state.context.facts = [{ id: 'fact1', claim: '仅测试样本失败', source: '记录', excerpt: '失败', scope: '一个样本', status: 'confirmed' }];
  f.enqueue(); await runWake(f.rt); assert.deepEqual(f.state.runs[0].memoryChanges?.added, ['fact1']);
  f.state.context.facts[0].status = 'disputed'; f.enqueue(event('withdraw')); await runWake(f.rt);
  assert.deepEqual(f.state.runs[1].memoryChanges?.withdrawn, ['fact1']); assert.equal(f.state.runs[0].contextSnapshot?.facts[0].status, 'confirmed');
});
test('崩溃恢复不会重试未返回的已计费请求，心跳过期显示受阻', async () => {
  const f = fixture(); f.state.activeRunId = 'r'; f.state.status = 'researching'; f.state.heartbeatAt = f.rt.now() - 100000;
  f.state.runs = [{ id: 'r', eventIds: [], startedAt: f.rt.now(), outcome: 'running', reason: '', steps: [] }];
  assert.equal(visibleWakeStatus(f.state, true, f.rt.now()).status, 'blocked');
  assert.equal(visibleWakeStatus(f.state, false, f.rt.now()).active, false);
  const recovered = recoverAwakening(f.state, f.rt.now()); assert.equal(recovered.runs[0].outcome, 'interrupted'); assert.equal(recovered.policy.enabled, false);
});
test('不合法预算与满收件箱不会静默突破限制', () => {
  assert.throws(() => wakePolicy({ maxCallsPerDay: NaN })); assert.throws(() => wakePolicy({ maxCallsPerWake: 3 }));
  const f = fixture(); f.state.events = Array.from({ length: 2000 }, (_, i) => event(String(i)));
  assert.throws(() => f.enqueue(event('overflow'))); assert.equal(f.state.events.length, 2000);
});
test('修改周期重新计算检查时间，修改论文主题立即安排新检查', () => {
  const f = fixture();
  f.state = configureAwakening(f.state, { checkEveryHours: 2, reviewEveryDays: 1 }, f.rt.now());
  assert.equal(f.state.nextCheckAt, f.rt.now() + 7200000); assert.equal(f.state.nextReviewAt, f.rt.now() + 86400000);
  f.state = configureAwakening(f.state, { paperQuery: 'translation' }, f.rt.now()); assert.equal(f.state.nextCheckAt, f.rt.now());
});
