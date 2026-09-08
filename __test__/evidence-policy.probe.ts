/** Characterize the current scheduler with scripted outputs, not an LLM benchmark. */
import assert from 'node:assert/strict';
import { createInquiry, newRound, runInquiry, addFact, type InquiryWorkspace } from '../services/inquiry';

const question = '让用户读完文章后写下一个具体问题，相比仅收藏文章，是否提高七天后的回访比例？';
const hypotheses = ['写下问题促进后续回访', '额外提醒而非写问题促进回访', '额外操作负担抵消回访收益'];
let w = createInquiry('evaluation-only', question);
let calls = 0;
const audit = '证据不足，需新增真实对照实验；此处是预设测试输出，不是模型结论。';
async function round() {
  w = newRound(w);
  await runInquiry({ read: () => w, write: next => { w = next; }, shouldStop: () => false, model: async messages => {
    calls++;
    const sys = messages[0].content;
    if (sys.includes('团队的思想家')) return JSON.stringify({ summary: '固定输出，用于检查是否重复调度。', hypotheses: hypotheses.map(statement => ({ statement, falsification: '保持提醒一致的真实随机实验未显示该效应' })) });
    if (sys.includes('团队的执行者')) return JSON.stringify({ summary: '缺少真实数据，只能提出实验方案。', candidates: [] });
    return JSON.stringify({ summary: audit, verdict: 'uncertain' });
  }});
}
await round();
assert.equal(calls, 10);
assert.equal(w.facts.length, 0);
assert.equal(w.rounds[0].status, 'completed');
const firstRevision = w.factRevision;
await round();
assert.equal(calls, 20);
assert.equal(w.facts.length, 0);
assert.deepEqual(w.rounds[1].hypotheses.map(h => h.statement), hypotheses);
assert.ok(w.factRevision > firstRevision);
const repeatedFacts = addFact(addFact(createInquiry('duplicate-test', question), { claim: '合成记录 E1：对照20/100，干预30/100，提醒条件不同', source: '合成记录 E1', excerpt: '20/100 vs 30/100', scope: '仅测试' }), { claim: '合成记录 E1：对照20/100，干预30/100，提醒条件不同', source: '合成记录 E1', excerpt: '20/100 vs 30/100', scope: '仅测试' });
assert.equal(repeatedFacts.facts.length, 2);
console.log(JSON.stringify({ kind: 'scripted-output characterization; NOT real model performance', question, rounds: w.rounds.length, modelCallbackInvocations: calls, externalEvidence: 0, repeatedHypothesesAccepted: true, verdicts: w.rounds.map(r => r.tasks.filter(t => t.role === 'auditor').map(t => t.result?.verdict)), factRevisionsWithoutAnyFacts: [firstRevision, w.factRevision], duplicateSourceRecordsAccepted: repeatedFacts.facts.length, findings: ['没有新证据也可以开新轮次', '三个审计全部 uncertain 后仍标记 completed', '重复的三个假设仍完整执行10步', '没有事实时审核动作仍增加 factRevision，不能直接用它作为新证据唤醒信号', '相同来源相同陈述没有去重门槛'] }, null, 2));
