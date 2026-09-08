import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addFact, createInquiry, factContext, newRound, parseInquiryResult, questionFactContext, recoverInquiry, reviewFact, runInquiry, taskMessages, type InquiryWorkspace } from '../services/inquiry';

const draft = { claim: '访谈中 8/10 人选择实时翻译', source: '访谈记录 2026-09，第 2 页', excerpt: '受访者 1–8 选择翻译，9–10 选择导航', scope: '仅本次 10 人样本，2026-09' };
const thinker = JSON.stringify({ summary: '竞争解释', hypotheses: [1, 2, 3].map(i => ({ statement: `假设 ${i}`, falsification: `观察 ${i} 会推翻它` })) });
const executor = JSON.stringify({ summary: '材料分析已完成，实地实验尚未执行', candidates: [draft] });
const review = JSON.stringify({ summary: '核对所提供材料后仍需要查验原始记录', verdict: 'supported' });
function response(messages: { role: string; content: string }[]) {
  const sys = messages[0].content;
  return sys.includes('团队的思想家') ? thinker : sys.includes('团队的执行者') ? executor : review;
}
function fixture() {
  let w = newRound(createInquiry('q1', '用户为什么选择翻译？'));
  return { read: () => w, write: (next: InquiryWorkspace) => { w = next; } };
}

test('确认事实需要来源、原始证据、范围与理由；不接受 AI 自信代替', () => {
  let w = addFact(createInquiry('q', '问题'), { ...draft, source: '' });
  assert.throws(() => reviewFact(w, w.facts[0].id, 'confirmed', '相信模型'), /来源/);
  assert.throws(() => reviewFact(w, w.facts[0].id, 'confirmed', '', draft), /理由/);
  for (const field of ['source', 'excerpt', 'scope']) {
    assert.throws(() => reviewFact(w, w.facts[0].id, 'confirmed', '查验', { ...draft, [field]: '' }));
  }
  w = reviewFact(w, w.facts[0].id, 'confirmed', '逐条比对原始访谈记录', draft);
  assert.equal(w.facts[0].status, 'confirmed');
  assert.equal(w.factRevision, 2);
  assert.match(factContext(w), /8\/10/);
  assert.throws(() => reviewFact(w, w.facts[0].id, 'confirmed', '直接覆盖'), /先标记争议/);
});

test('状态变更保留审核历史和历史证据，争议不能继续作为可信前提', () => {
  let w = addFact(createInquiry('q', '问题'), draft);
  const fid = w.facts[0].id;
  w = reviewFact(w, fid, 'confirmed', '核对原件');
  w = reviewFact(w, fid, 'disputed', '受访者重复计数');
  assert.match(factContext(w), /disputed/);
  w = reviewFact(w, fid, 'pending', '补充新来源', { ...draft, source: '修订版记录' });
  assert.equal(w.facts[0].reviews[1].evidence?.source, draft.source);
  assert.equal(w.facts[0].source, '修订版记录');
  assert.ok(!factContext(w).includes(draft.claim));
  w = reviewFact(w, fid, 'rejected', '原始记录不支持');
  assert.equal(w.facts[0].reviews.length, 5);
  assert.ok(!factContext(w).includes(draft.claim));
});

test('按问题隔离事实，超出预算时明确告知，记录不会被截断成假证据', () => {
  let a = addFact(createInquiry('a', 'A'), draft);
  a = reviewFact(a, a.facts[0].id, 'confirmed', '查验原件');
  const b = createInquiry('b', 'B');
  assert.ok(!questionFactContext({ root: a, b }, 'b').includes(draft.claim));
  assert.match(questionFactContext({ root: a }, 'missing'), /8\/10/);
  const huge = { ...a, facts: [{ ...a.facts[0], excerpt: 'x'.repeat(6000) }] };
  assert.match(factContext(huge), /另有 1 条/);
  assert.ok(!factContext(huge).includes('xxxx'));
});

test('解析失败与畸形模型输出必须阻断，不能静默跳过审计', () => {
  assert.throws(() => parseInquiryResult('not json', 'thinker'));
  assert.throws(() => parseInquiryResult('{"summary":"x","hypotheses":[]}', 'thinker'));
  assert.throws(() => parseInquiryResult('{"summary":"x","verdict":"certain"}', 'auditor'));
  assert.throws(() => parseInquiryResult('{"summary":"x","candidates":{}}', 'executor'));
  assert.equal(parseInquiryResult('```json\n' + thinker + '\n```', 'thinker').hypotheses?.length, 3);
});

test('完整团队：3 个假设各执行、验证、审计，真实交接上游成果并保存快照', async () => {
  const f = fixture();
  const seen: string[] = [];
  await runInquiry({ ...f, shouldStop: () => false, model: async m => { seen.push(m.map(x => x.content).join('\n')); return response(m); } });
  const w = f.read(); const r = w.rounds[0];
  assert.equal(r.status, 'completed');
  assert.equal(seen.length, 10);
  assert.deepEqual(r.tasks.map(t => t.role), ['thinker', 'executor', 'verifier', 'auditor', 'executor', 'verifier', 'auditor', 'executor', 'verifier', 'auditor']);
  assert.ok(seen[2].includes('材料分析已完成'));
  assert.ok(seen[3].includes('核对所提供材料'));
  assert.ok(r.tasks.every(t => t.factSnapshot && t.status === 'completed'));
  assert.ok(w.facts.every(f => f.status === 'pending'), '所有模型都支持也不能自动确认');
  assert.ok(w.facts.every(f => f.reviews.map(r => r.actor).join(',') === 'executor,verifier,auditor'));
  assert.throws(() => taskMessages(w, { ...r, tasks: r.tasks.map((t, i) => i === 1 ? { ...t, status: 'failed' } : t) }, r.tasks[2]), /前置任务/);
});

test('失败阻断后续步骤，重试保留已完成成果且不重复写入候选事实', async () => {
  const f = fixture(); let calls = 0;
  await runInquiry({ ...f, shouldStop: () => false, model: async m => { calls++; if (calls === 3) throw new Error('测试网络失败'); return response(m); } });
  assert.equal(calls, 3);
  assert.equal(f.read().rounds[0].status, 'failed');
  assert.equal(f.read().facts.length, 1);
  assert.equal(f.read().rounds[0].tasks[3].status, 'pending');
  let retries = 0;
  await runInquiry({ ...f, shouldStop: () => false, model: async m => { retries++; return response(m); } });
  assert.equal(retries, 8);
  assert.equal(f.read().rounds[0].status, 'completed');
  assert.equal(f.read().facts.length, 3);
});

test('模型等待期间新增事实不丢失，下一个角色读取新的事实版本', async () => {
  const f = fixture(); let calls = 0;
  await runInquiry({ ...f, shouldStop: () => false, model: async m => {
    calls++;
    if (calls === 1) {
      let w = addFact(f.read(), draft);
      w = reviewFact(w, w.facts[0].id, 'confirmed', '人工核验');
      f.write(w);
    }
    if (calls === 2) assert.ok(m.some(x => x.content.includes(draft.claim)));
    return response(m);
  } });
  assert.equal(f.read().facts.length, 4);
  assert.equal(f.read().facts[0].status, 'confirmed');
  assert.equal(f.read().rounds[0].tasks[0].factRevision, 0);
  assert.equal(f.read().rounds[0].tasks[1].factRevision, 2);
});

test('暂停后续跑，从中断步骤恢复；下一轮包含上一轮审计反馈', async () => {
  const f = fixture(); let stop = false;
  await runInquiry({ ...f, shouldStop: () => stop, model: async m => { stop = true; return response(m); } });
  assert.equal(f.read().rounds[0].status, 'paused');
  assert.equal(f.read().rounds[0].tasks[0].status, 'completed');
  assert.throws(() => newRound(f.read()), /先继续/);
  await runInquiry({ ...f, shouldStop: () => false, model: async m => response(m) });
  f.write(newRound(f.read()));
  let secondCalls = 0;
  await runInquiry({ ...f, shouldStop: () => secondCalls > 0, model: async m => {
    secondCalls++;
    assert.ok(m.some(x => x.content.includes('第 1 轮认知记录') && x.content.includes('核对所提供材料')));
    return response(m);
  } });
  assert.equal(f.read().rounds.length, 2);
  assert.equal(f.read().rounds[0].status, 'completed');
  assert.equal(f.read().rounds[1].number, 2);
});

test('刷新恢复运行状态，保留已完成任务和事实；JSON 持久化可往返', () => {
  const w = fixture().read();
  w.rounds[0].status = 'running';
  w.rounds[0].tasks[0].status = 'running';
  const loaded = recoverInquiry(JSON.parse(JSON.stringify(w)));
  assert.equal(loaded.rounds[0].status, 'paused');
  assert.equal(loaded.rounds[0].tasks[0].status, 'pending');
  assert.equal(w.rounds[0].status, 'running', '不可修改旧对象');
});

test('最后一步期间请求暂停，全部完成后仍显示完成而非假暂停', async () => {
  const f = fixture(); let calls = 0;
  await runInquiry({ ...f, shouldStop: () => calls === 10, model: async m => { calls++; return response(m); } });
  assert.equal(f.read().rounds[0].status, 'completed');
  assert.equal(calls, 10);
});
