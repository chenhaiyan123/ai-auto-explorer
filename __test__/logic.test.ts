/* 纯逻辑测试：不碰 DOM、不调模型。esbuild bundle 后用 node 跑。 */
import { ProblemNode, NodeStatus, Hypothesis, Evidence, EvidenceLayer, Probe, ProbeResult } from '../types';
import {
  checkTriggers, statEvidence, isContradictedByReality, duplicateRatio, normalizeTitle,
  isBlockedOnReality, realityQueue, summarizeHits, NO_NEW_INFO_ROUNDS, STALE_DAYS,
} from '../services/validationTrigger';
import { nodeScore, buildDashboard } from '../services/dashboardService';
import { noteToMarkdown, hypothesisSection } from '../services/vault';
import { buildAIHypothesis } from '../services/geminiService';
import { parseProbes, applyProbeResult, probesOf, pendingProbeCount, parseCondition, parseDeviceSpec } from '../services/probeService';
import { pickNumber, getByPath, aggregate, evalCondition, judgeSamples, describeSpec, describeCondition, resolveTarget } from '../services/deviceProbe';
import { actionMode, validateParams, guardCall, needsConfirm, IoTDevice, IoTAction } from '../services/iotService';
import {
  currentAnchor, explorableNodes, legReady, reachAnchor, settleAnchor, skipAnchor,
  mergeRevision, anchorEvidence, isSettled, isWaitingAtAnchor, routeProgress,
  nodesOfAnchor, normalizeAnchor,
} from '../services/routeService';
import { renderMarkdown, joinSoftLines } from '../services/markdown';
import { buildInbox, normalizeReplies, parseItemId, isValidVerdict, inboxDigest } from '../services/inbox';
import { nextPollDelay } from '../services/inboxSync';
import {
  computeVisitEvents, computeMilestone, furthestStage, dayKey, daysBetween,
  emptyState, MILESTONES,
} from '../services/funnel';

let pass = 0, fail = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e: any) { fail++; console.error('  ✗', name, '\n     ', e.message); }
};
const eq = (a: any, b: any, msg = '') => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg} 期望 ${sb}，实际 ${sa}`);
};
const ok = (v: any, msg = '') => { if (!v) throw new Error(msg || '期望为真'); };
const no = (v: any, msg = '') => { if (v) throw new Error(msg || '期望为假'); };

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

let seq = 0;
const ev = (stance: 'support' | 'refute', layer: EvidenceLayer, origin: 'ai' | 'human' | 'probe'): Evidence =>
  ({ id: 'e' + (++seq), stance, layer, claim: 'c' + seq, origin, createdAt: NOW });

const hyp = (belief: Hypothesis['belief'], evidence: Evidence[] = [], unknown?: string): Hypothesis =>
  ({ statement: '年轻用户最在意实时翻译', belief, evidence, unknown, updatedAt: NOW });

const node = (p: Partial<ProblemNode> = {}): ProblemNode => ({
  id: p.id || 'n' + (++seq), title: p.title || '节点', status: p.status || NodeStatus.UNEXPLORED,
  confidence: 0, dependencies: p.dependencies || [], notes: '', ...p,
} as ProblemNode);

console.log('\n== statEvidence / 层级权重 ==');
t('AI 语言层证据权重最低，real 计数为 0', () => {
  const s = statEvidence(hyp('high', [ev('support', 'stated', 'ai'), ev('support', 'stated', 'ai')]));
  eq(s.support, 2); eq(s.real, 0); eq(s.supportWeight, 2); eq(s.topLayer, 1);
});
t('市场层反证权重最高', () => {
  const s = statEvidence(hyp('high', [ev('refute', 'market', 'human')]));
  eq(s.refuteWeight, 6); eq(s.realRefuteWeight, 6); eq(s.real, 1);
});
t('空假设不炸', () => { const s = statEvidence(undefined); eq(s.support, 0); eq(s.topLayer, 0); });

console.log('\n== isContradictedByReality：AI 不能自己宣布自己错了 ==');
t('一万条 AI 反证也不算被现实推翻', () => {
  no(isContradictedByReality(hyp('high', Array.from({ length: 20 }, () => ev('refute', 'stated', 'ai')))));
});
t('一条人工行为层反证就能推翻（无现实支持时）', () => {
  ok(isContradictedByReality(hyp('high', [ev('support', 'stated', 'ai'), ev('refute', 'behavior', 'human')])));
});
t('现实支持压过现实反证时不算推翻', () => {
  no(isContradictedByReality(hyp('high', [ev('support', 'market', 'human'), ev('refute', 'behavior', 'human')])));
});
t('探针结果也算现实证据', () => {
  ok(isContradictedByReality(hyp('medium', [ev('refute', 'outcome', 'probe')])));
});

console.log('\n== 标题查重 ==');
t('归一化去标点空格大小写', () => { eq(normalizeTitle(' 用户-需求，分析 '), '用户需求分析'); });
t('包含关系算重复', () => { eq(duplicateRatio(['用户需求'], ['用户需求分析']), 1); });
t('全新标题重复率 0', () => { eq(duplicateRatio(['电池续航'], ['用户需求']), 0); });
t('空输入返回 0，不除以 0', () => { eq(duplicateRatio([], ['a']), 0); eq(duplicateRatio(['a'], []), 0); });
t('一半重复 = 0.5', () => { eq(duplicateRatio(['甲', '乙'], ['甲']), 0.5); });

console.log('\n== checkTriggers ==');
t('自信但零外部证据 → weak_evidence', () => {
  const hits = checkTriggers(node({ hypothesis: hyp('high', [ev('support', 'stated', 'ai')]) }), [], { now: NOW });
  eq(hits.map(h => h.reason), ['weak_evidence']);
});
t('信念低时不因缺证据触发（本来就没自信）', () => {
  const hits = checkTriggers(node({ hypothesis: hyp('low', [ev('support', 'stated', 'ai')]) }), [], { now: NOW });
  eq(hits.length, 0);
});
t('有现实证据就不触发 weak_evidence', () => {
  const hits = checkTriggers(node({ hypothesis: hyp('high', [ev('support', 'behavior', 'human')]) }), [], { now: NOW });
  eq(hits.length, 0);
});
t('支持/反对各 2 条 → contradiction', () => {
  const h = hyp('high', [
    ev('support', 'behavior', 'human'), ev('support', 'stated', 'ai'),
    ev('refute', 'stated', 'ai'), ev('refute', 'stated', 'ai'),
  ]);
  const hits = checkTriggers(node({ hypothesis: h }), [], { now: NOW });
  eq(hits.map(x => x.reason), ['contradiction']);
});
t(`连续 ${NO_NEW_INFO_ROUNDS} 轮无产出 → no_new_info`, () => {
  const hits = checkTriggers(node(), [], { emptyRounds: NO_NEW_INFO_ROUNDS, now: NOW });
  eq(hits.map(h => h.reason), ['no_new_info']);
});
t('新方向都是老调重弹 → no_new_info', () => {
  const hits = checkTriggers(node(), [], {
    recentTitles: ['用户需求', '电池续航'], newTitles: ['用户需求分析', '电池续航'], now: NOW,
  });
  eq(hits.map(h => h.reason), ['no_new_info']);
});
t('无新信息与重复率不会重复计两次', () => {
  const hits = checkTriggers(node(), [], {
    emptyRounds: NO_NEW_INFO_ROUNDS, recentTitles: ['甲'], newTitles: ['甲'], now: NOW,
  });
  eq(hits.filter(h => h.reason === 'no_new_info').length, 1);
});
t(`探索中超过 ${STALE_DAYS} 天没动 → stalled`, () => {
  const n = node({ status: NodeStatus.EXPLORING, noteUpdatedAt: NOW - 5 * DAY });
  eq(checkTriggers(n, [], { now: NOW }).map(h => h.reason), ['stalled']);
});
t('从未更新过（noteUpdatedAt=0）不算停滞', () => {
  const n = node({ status: NodeStatus.EXPLORING });
  eq(checkTriggers(n, [], { now: NOW }).length, 0);
});
t('干净节点不触发任何东西', () => {
  eq(checkTriggers(node({ hypothesis: hyp('medium', [ev('support', 'market', 'human')]) }), [], { now: NOW }).length, 0);
});
t('无假设的节点不因 weak_evidence 触发', () => {
  eq(checkTriggers(node(), [], { now: NOW }).length, 0);
});
t('summarizeHits 拼成一句话且截断', () => {
  const hits = checkTriggers(node({ hypothesis: hyp('high') }), [], { now: NOW });
  ok(summarizeHits(hits).includes('缺外部证据'));
  eq(summarizeHits([]), '');
});

console.log('\n== isBlockedOnReality：什么时候才该叫人 ==');
t('还有待探索节点时不叫人', () => {
  no(isBlockedOnReality([node({ status: NodeStatus.VALIDATING }), node({ status: NodeStatus.UNEXPLORED })]));
});
t('还有探索中节点时不叫人', () => {
  no(isBlockedOnReality([node({ status: NodeStatus.VALIDATING }), node({ status: NodeStatus.EXPLORING })]));
});
t('剩下的全在等现实 → 叫人', () => {
  ok(isBlockedOnReality([node({ status: NodeStatus.SOLVED }), node({ status: NodeStatus.VALIDATING })]));
});
t('全部完成、没人等现实 → 不叫人（走原本的"探索完成"）', () => {
  no(isBlockedOnReality([node({ status: NodeStatus.SOLVED }), node({ status: NodeStatus.SOLVED })]));
});
t('空项目不叫人', () => { no(isBlockedOnReality([])); });
t('被推翻的节点也算在等现实', () => {
  ok(isBlockedOnReality([node({ status: NodeStatus.CONTRADICTED })]));
});
t('realityQueue 最近在前并带上未知量', () => {
  const q = realityQueue([
    node({ id: 'a', title: '旧', status: NodeStatus.VALIDATING, noteUpdatedAt: 1, hypothesis: hyp('high', [], '愿不愿意付费') }),
    node({ id: 'b', title: '新', status: NodeStatus.VALIDATING, noteUpdatedAt: 9 }),
    node({ id: 'c', title: '无关', status: NodeStatus.SOLVED }),
  ]);
  eq(q.map(x => x.id), ['b', 'a']);
  eq(q[1].unknown, '愿不愿意付费');
});

console.log('\n== nodeScore：新状态不能掉进 default ==');
t('VALIDATING = 0.6（推理做完了，只差现实）', () => {
  eq(nodeScore(node({ status: NodeStatus.VALIDATING })), 0.6);
});
t('CONTRADICTED = 0.2（排除错路也是价值）', () => {
  eq(nodeScore(node({ status: NodeStatus.CONTRADICTED })), 0.2);
});
t('VALIDATING 不受正文字数影响（没走 default 分支）', () => {
  eq(nodeScore(node({ status: NodeStatus.VALIDATING, fullNote: '短' })), 0.6);
  eq(nodeScore(node({ status: NodeStatus.VALIDATING, fullNote: 'x'.repeat(500) })), 0.6);
});
t('老状态分值没变', () => {
  eq(nodeScore(node({ status: NodeStatus.SOLVED })), 1);
  eq(nodeScore(node({ status: NodeStatus.EXPLORING })), 0.5);
  eq(nodeScore(node({ status: NodeStatus.INVALID })), 0);
  eq(nodeScore(node({ status: NodeStatus.UNEXPLORED })), 0);
});

console.log('\n== buildDashboard 对新状态的处理 ==');
t('等现实 / 被推翻 会计数并冒泡成告警', () => {
  const nodes = [
    node({ id: 'ov', title: '总览', noteType: 'overview', status: NodeStatus.SOLVED }),
    node({ id: 'd1', title: '方向一', status: NodeStatus.VALIDATING, assignedAgent: '市场分析师', fullNote: 'x'.repeat(200), hypothesis: hyp('high', [], '用户愿不愿意付费') }),
    node({ id: 'd2', title: '方向二', status: NodeStatus.CONTRADICTED, assignedAgent: '工程师', fullNote: 'x'.repeat(200) }),
    node({ id: 'd3', title: '子节点', status: NodeStatus.VALIDATING, dependencies: ['d1'], assignedAgent: '工程师', fullNote: 'x'.repeat(200) }),
  ];
  const d = buildDashboard(nodes, NOW);
  eq(d.awaitingReality, 2);
  eq(d.contradicted, 1);
  ok(d.alerts.some(a => a.kind === 'validating' && a.nodeId === 'd1'), '一级方向应有 validating 告警');
  ok(d.alerts.some(a => a.kind === 'validating' && a.nodeId === 'd3'), '子节点的 validating 应冒泡');
  ok(d.alerts.some(a => a.kind === 'contradicted' && a.nodeId === 'd2'), '被推翻应告警');
  ok(d.alerts.find(a => a.nodeId === 'd1' && a.kind === 'validating')!.label.includes('付费'), '告警应带上未知量');
});
t('全 VALIDATING 项目进度是 60% 而不是 0', () => {
  const d = buildDashboard([
    node({ id: 'a', title: 'A', status: NodeStatus.VALIDATING }),
    node({ id: 'b', title: 'B', status: NodeStatus.VALIDATING }),
  ], NOW);
  eq(d.progress, 60);
});
t('空项目仍然不炸', () => { const d = buildDashboard([], NOW); eq(d.progress, 0); eq(d.awaitingReality, 0); });

console.log('\n== buildAIHypothesis：不许模型自封证据等级 ==');
t('模型声称 market 层也会被压回 stated', () => {
  const h = buildAIHypothesis({
    hypothesis: '导航才是核心需求', belief: 'high',
    evidence: [{ stance: 'support', claim: '很多人这么说', layer: 'market', origin: 'human' }],
  })!;
  eq(h.evidence[0].layer, 'stated');
  eq(h.evidence[0].origin, 'ai');
});
t('stance 只认 refute/support，其它一律当 support', () => {
  const h = buildAIHypothesis({ hypothesis: 'x', evidence: [{ stance: '??', claim: 'a' }] })!;
  eq(h.evidence[0].stance, 'support');
});
t('belief 非法值回落到 medium', () => {
  eq(buildAIHypothesis({ hypothesis: 'x', belief: '很高' })!.belief, 'medium');
});
t('保留人工/探针证据，只换掉上一轮的 AI 证据', () => {
  const prev = hyp('medium', [ev('refute', 'behavior', 'human'), ev('support', 'stated', 'ai')]);
  const h = buildAIHypothesis({ hypothesis: '新判断', evidence: [{ stance: 'support', claim: '新推理' }] }, prev)!;
  eq(h.evidence.length, 2);
  eq(h.evidence.filter(e => e.origin === 'human').length, 1);
  eq(h.evidence.filter(e => e.origin === 'ai').length, 1);
  eq(h.evidence[1].claim, '新推理');
});
t('模型没给假设时保留原假设，不清空', () => {
  const prev = hyp('high', [ev('refute', 'market', 'human')]);
  eq(buildAIHypothesis({}, prev), prev);
  eq(buildAIHypothesis({ hypothesis: '   ' }, prev), prev);
});
t('evidence 不是数组也不炸', () => {
  eq(buildAIHypothesis({ hypothesis: 'x', evidence: '乱七八糟' })!.evidence.length, 0);
});
t('AI 证据最多取 6 条', () => {
  const h = buildAIHypothesis({ hypothesis: 'x', evidence: Array.from({ length: 20 }, (_, i) => ({ claim: 'c' + i })) })!;
  eq(h.evidence.length, 6);
});
t('AI 无论如何都推不翻自己', () => {
  const h = buildAIHypothesis({
    hypothesis: 'x', belief: 'high',
    evidence: Array.from({ length: 6 }, () => ({ stance: 'refute', claim: '反对', layer: 'market' })),
  })!;
  no(isContradictedByReality(h));
});

console.log('\n== vault 导出：赌注要进正文，不能藏 frontmatter ==');
t('导出的 .md 正文里能看到假设与证据', () => {
  const n = node({
    title: '眼镜需求', status: NodeStatus.VALIDATING, fullNote: '# 正文',
    validationReason: '缺外部证据：没有任何现实证据',
    hypothesis: hyp('high', [ev('refute', 'behavior', 'human')], '用户愿不愿意付费'),
  });
  const md = noteToMarkdown(n);
  const bodyStart = md.indexOf('---', 3) + 3;
  const body = md.slice(bodyStart);
  ok(body.includes('## 🎯 当前赌注'), '正文应有赌注小节');
  ok(body.includes('年轻用户最在意实时翻译'));
  ok(body.includes('最大未知量：用户愿不愿意付费'));
  ok(body.includes('行为'), '证据层级应标出来');
  ok(body.includes('人工'), '证据来源应标出来');
  ok(body.includes('缺外部证据'), '待验证原因应写出来');
});
t('没有假设的笔记导出内容不变', () => {
  eq(hypothesisSection(node({ title: 'A' })), '');
  ok(noteToMarkdown(node({ title: 'A', fullNote: '正文' })).endsWith('正文\n'));
});


console.log('\n== parseProbes：模型输出要能收得住 ==');
const probeRaw = (over: any = {}) => ({
  probes: [{ method: '找 20 个目标用户看菜单翻译原型', cost: 'low', effort: '半天', expectedSignal: '少于 8 人愿意留联系方式即为反对', ...over }],
});
t('正常解析，字段齐全', () => {
  const [p] = parseProbes(probeRaw(), 'n1', '导航才是核心需求', NOW);
  eq(p.nodeId, 'n1'); eq(p.cost, 'low'); eq(p.status, 'draft');
  eq(p.hypothesis, '导航才是核心需求'); eq(p.createdAt, NOW);
});
t('非法 cost 回落到 low', () => { eq(parseProbes(probeRaw({ cost: '超高' }), 'n', 'h', NOW)[0].cost, 'low'); });
t('没写判定标准会被明确标出来，而不是留空', () => {
  const [p] = parseProbes(probeRaw({ expectedSignal: '' }), 'n', 'h', NOW);
  ok(p.expectedSignal.includes('未写明判定标准'));
});
t('没有 method 的条目直接丢掉', () => {
  eq(parseProbes({ probes: [{ cost: 'low' }, { method: '  ' }] }, 'n', 'h', NOW).length, 0);
});
t('最多 3 个；乱七八糟的输入不炸', () => {
  eq(parseProbes({ probes: Array.from({ length: 9 }, () => ({ method: 'x' })) }, 'n', 'h', NOW).length, 3);
  eq(parseProbes(null, 'n', 'h', NOW).length, 0);
  eq(parseProbes({ probes: '???' }, 'n', 'h', NOW).length, 0);
});
t('顶层就是数组也认', () => { eq(parseProbes([{ method: 'x' }], 'n', 'h', NOW).length, 1); });

console.log('\n== applyProbeResult：结果回填后节点该变成什么样 ==');
const mkProbe = (): Probe => parseProbes(probeRaw(), 'n1', '导航才是核心需求', NOW)[0];
const res = (stance: ProbeResult['stance'], layer: EvidenceLayer = 'behavior'): ProbeResult =>
  ({ summary: '20 人里 17 人更想要导航', stance, layer, at: NOW });

t('反对结果 → 节点被推翻，证据来源是探针', () => {
  const n = node({ id: 'n1', status: NodeStatus.VALIDATING, hypothesis: hyp('high', [ev('support', 'stated', 'ai')]) });
  const r = applyProbeResult(n, mkProbe(), res('refute'));
  ok(r.contradicted);
  eq(r.updates.status, NodeStatus.CONTRADICTED);
  const added = r.updates.hypothesis!.evidence.slice(-1)[0];
  eq(added.origin, 'probe'); eq(added.layer, 'behavior'); eq(added.stance, 'refute');
  ok(!!added.probeId, '证据要挂上探针 id');
  eq(r.probe.status, 'done');
});
t('支持结果 → 触发器不再命中，节点算完成', () => {
  const n = node({ id: 'n1', status: NodeStatus.VALIDATING, hypothesis: hyp('high', [ev('support', 'stated', 'ai')]) });
  const r = applyProbeResult(n, mkProbe(), res('support'));
  no(r.contradicted);
  eq(r.updates.status, NodeStatus.SOLVED);
  eq(r.updates.validationReason, undefined);
});
t('没测出来 → 不产生证据，节点原样不动', () => {
  const n = node({ id: 'n1', status: NodeStatus.VALIDATING, hypothesis: hyp('high') });
  const r = applyProbeResult(n, mkProbe(), res('unclear'));
  eq(Object.keys(r.updates).length, 0);
  eq(r.probe.status, 'done');
  eq(r.probe.result!.stance, 'unclear');
});
t('节点原本没有假设时，用探针里的假设兜底', () => {
  const n = node({ id: 'n1', status: NodeStatus.VALIDATING });
  const r = applyProbeResult(n, mkProbe(), res('support'));
  eq(r.updates.hypothesis!.statement, '导航才是核心需求');
});
t('探针带回的证据能压过 AI 的一堆推理', () => {
  const many = Array.from({ length: 10 }, () => ev('support', 'stated', 'ai'));
  const n = node({ id: 'n1', status: NodeStatus.VALIDATING, hypothesis: hyp('high', many) });
  ok(applyProbeResult(n, mkProbe(), res('refute')).contradicted);
});
t('非法 layer 回落到 behavior', () => {
  const n = node({ id: 'n1', status: NodeStatus.VALIDATING, hypothesis: hyp('medium') });
  const r = applyProbeResult(n, mkProbe(), { summary: 'x', stance: 'support', layer: '宇宙' as any, at: NOW });
  eq(r.updates.hypothesis!.evidence.slice(-1)[0].layer, 'behavior');
});

console.log('\n== probesOf / pendingProbeCount ==');
t('按节点过滤且最近在前', () => {
  const ps = [
    { ...mkProbe(), id: 'p1', nodeId: 'a', createdAt: 1 },
    { ...mkProbe(), id: 'p2', nodeId: 'a', createdAt: 9 },
    { ...mkProbe(), id: 'p3', nodeId: 'b', createdAt: 5 },
  ];
  eq(probesOf(ps, 'a').map(p => p.id), ['p2', 'p1']);
  eq(probesOf(undefined, 'a').length, 0);
});
t('只数待执行的', () => {
  const ps: Probe[] = [
    { ...mkProbe(), status: 'draft' }, { ...mkProbe(), status: 'running' },
    { ...mkProbe(), status: 'done' }, { ...mkProbe(), status: 'skipped' },
  ];
  eq(pendingProbeCount(ps), 2);
  eq(pendingProbeCount(undefined), 0);
});

console.log('\n== 仪表盘顶部：主假设 / 最大未知量 / 证据构成 ==');
t('被推翻的假设优先当主角', () => {
  const d = buildDashboard([
    node({ id: 'a', title: '方向A', status: NodeStatus.SOLVED, hypothesis: hyp('high', [ev('support', 'market', 'human')]) }),
    node({ id: 'b', title: '方向B', status: NodeStatus.CONTRADICTED, hypothesis: hyp('low', [ev('refute', 'behavior', 'human')]) }),
  ], NOW);
  eq(d.mainHypothesis!.nodeId, 'b');
  eq(d.mainHypothesis!.status, NodeStatus.CONTRADICTED);
});
t('没有被推翻时，等现实的优先', () => {
  const d = buildDashboard([
    node({ id: 'a', title: 'A', status: NodeStatus.SOLVED, hypothesis: hyp('high') }),
    node({ id: 'b', title: 'B', status: NodeStatus.VALIDATING, hypothesis: hyp('low') }),
  ], NOW);
  eq(d.mainHypothesis!.nodeId, 'b');
});
t('都一样时按信念高低挑', () => {
  const d = buildDashboard([
    node({ id: 'a', title: 'A', status: NodeStatus.SOLVED, hypothesis: hyp('low') }),
    node({ id: 'b', title: 'B', status: NodeStatus.SOLVED, hypothesis: hyp('high') }),
  ], NOW);
  eq(d.mainHypothesis!.nodeId, 'b');
});
t('一个假设都没有时 mainHypothesis 为空，不编造', () => {
  const d = buildDashboard([node({ id: 'a', title: 'A' })], NOW);
  eq(d.mainHypothesis, undefined);
  eq(d.biggestUnknown, undefined);
});
t('最大未知量优先取主假设的', () => {
  const d = buildDashboard([
    node({ id: 'a', title: 'A', status: NodeStatus.VALIDATING, hypothesis: hyp('high', [], '愿不愿意付费') }),
    node({ id: 'b', title: 'B', hypothesis: hyp('low', [], '另一个未知') }),
  ], NOW);
  eq(d.biggestUnknown!.nodeId, 'a');
  eq(d.biggestUnknown!.text, '愿不愿意付费');
});
t('主假设没写未知量时退而求其次', () => {
  const d = buildDashboard([
    node({ id: 'a', title: 'A', status: NodeStatus.CONTRADICTED, hypothesis: hyp('high') }),
    node({ id: 'b', title: 'B', status: NodeStatus.VALIDATING, hypothesis: hyp('low', [], '备选未知') }),
  ], NOW);
  eq(d.mainHypothesis!.nodeId, 'a');
  eq(d.biggestUnknown!.nodeId, 'b');
});
t('证据构成只把非 AI 的算作现实证据', () => {
  const d = buildDashboard([
    node({ id: 'a', title: 'A', hypothesis: hyp('high', [ev('support', 'stated', 'ai'), ev('support', 'market', 'human'), ev('refute', 'outcome', 'probe')]) }),
  ], NOW);
  eq(d.evidenceTotal, 3);
  eq(d.evidenceReal, 2);
});
t('待执行探针数从 probes 传入', () => {
  const ps: Probe[] = [{ ...mkProbe(), status: 'draft' }, { ...mkProbe(), status: 'done' }];
  eq(buildDashboard([node({ id: 'a', title: 'A' })], NOW, ps).probesPending, 1);
  eq(buildDashboard([node({ id: 'a', title: 'A' })], NOW).probesPending, 0);
});


// ===================== 设备 / 实验 =====================
const act = (o: Partial<IoTAction> = {}): IoTAction =>
  ({ id: 'a1', name: '读取温度', method: 'GET', path: '/t', description: '', ...o } as IoTAction);
const dev = (o: Partial<IoTDevice> = {}): IoTDevice =>
  ({ id: 'd1', name: '培养箱', baseUrl: 'http://x', description: '', actions: [act()], enabled: true, createdAt: NOW, ...o } as IoTDevice);

console.log('\n== actionMode：不确定时按危险的那边算 ==');
t('GET 默认只读，POST/PUT/DELETE 默认写', () => {
  eq(actionMode(act({ method: 'GET' })), 'read');
  eq(actionMode(act({ method: 'POST' })), 'write');
  eq(actionMode(act({ method: 'PUT' })), 'write');
  eq(actionMode(act({ method: 'DELETE' })), 'write');
});
t('显式 mode 覆盖推断（GET 也可能是危险的触发接口）', () => {
  eq(actionMode(act({ method: 'GET', mode: 'write' })), 'write');
  eq(actionMode(act({ method: 'POST', mode: 'read' })), 'read');
});
t('写操作默认需要确认，显式关掉才不需要', () => {
  ok(needsConfirm(dev(), act({ method: 'POST' })));
  no(needsConfirm(dev({ requireConfirm: false }), act({ method: 'POST' })));
  no(needsConfirm(dev(), act({ method: 'GET' })), '只读永远不需要确认');
});

console.log('\n== validateParams：越界的参数根本不发出去 ==');
const heater = act({ method: 'POST', name: '设定温度', limits: [{ name: 'temp', min: 4, max: 60 }] });
t('区间内放行', () => { ok(validateParams(heater, { temp: '37' }).ok); });
t('超上限拒绝', () => {
  const r = validateParams(heater, { temp: '300' }) as any;
  no(r.ok); ok(r.error.includes('上限'));
});
t('低于下限拒绝', () => { no((validateParams(heater, { temp: '-5' }) as any).ok); });
t('非数值拒绝（防止模型塞进奇怪的字符串）', () => {
  no((validateParams(heater, { temp: '很热' }) as any).ok);
});
t('没传的参数不管；无限值配置一律放行', () => {
  ok(validateParams(heater, {}).ok);
  ok(validateParams(act({ method: 'POST' }), { anything: '9999' }).ok);
});
t('白名单只认列表里的值', () => {
  const a = act({ method: 'POST', limits: [{ name: 'mode', allowed: ['slow', 'fast'] }] });
  ok(validateParams(a, { mode: 'fast' }).ok);
  no((validateParams(a, { mode: 'turbo' }) as any).ok);
});
t('边界值算合法（闭区间）', () => {
  ok(validateParams(heater, { temp: '4' }).ok);
  ok(validateParams(heater, { temp: '60' }).ok);
});

console.log('\n== guardCall：AI 不能自己按下按钮 ==');
t('AI 调只读 → 放行', () => { ok(guardCall(dev(), act(), {}, 'ai').allow); });
t('AI 调写操作 → 拦下并排队', () => {
  const g = guardCall(dev(), heater, { temp: '37' }, 'ai') as any;
  no(g.allow); ok(g.queue, '应进待确认队列');
});
t('探针调写操作同样被拦（自动实验不能碰执行器）', () => {
  const g = guardCall(dev(), heater, { temp: '37' }, 'probe') as any;
  no(g.allow); ok(g.queue);
});
t('人手动点 → 放行；人确认过的 → 放行', () => {
  ok(guardCall(dev(), heater, { temp: '37' }, 'manual').allow);
  ok(guardCall(dev(), heater, { temp: '37' }, 'approved').allow);
});
t('参数越界优先于排队——错的参数连队都不排', () => {
  const g = guardCall(dev(), heater, { temp: '999' }, 'ai') as any;
  no(g.allow); no(g.queue); ok(g.reason.includes('参数越界'));
});
t('停用的设备谁都调不动', () => { no(guardCall(dev({ enabled: false }), act(), {}, 'manual').allow); });
t('免确认的设备，AI 可以直接写', () => {
  ok(guardCall(dev({ requireConfirm: false }), heater, { temp: '37' }, 'ai').allow);
});

console.log('\n== pickNumber：读不出来就作废，绝不猜 ==');
t('JSON 路径取值', () => { eq(pickNumber('{"data":{"temperature":36.7}}', 'data.temperature'), 36.7); });
t('数组下标路径', () => { eq(pickNumber('{"list":[{"v":5},{"v":9}]}', 'list[1].v'), 9); });
t('纯数值响应，无需路径', () => { eq(pickNumber('36.7'), 36.7); });
t('带单位的字符串也能抠出来', () => {
  eq(pickNumber('{"t":"36.7℃"}', 't'), 36.7);
  eq(pickNumber('temp=-12.5'), -12.5);
});
t('布尔当 1/0（开关类传感器）', () => {
  eq(pickNumber('{"on":true}', 'on'), 1);
  eq(pickNumber('{"on":false}', 'on'), 0);
});
t('路径不存在 → null，不退化成猜整个响应', () => {
  eq(pickNumber('{"data":{"t":1}}', 'data.nope'), null);
});
t('指定了路径但响应不是 JSON → null', () => { eq(pickNumber('OK', 'data.t'), null); });
t('空响应 / 取不出数 → null', () => {
  eq(pickNumber(''), null);
  eq(pickNumber('{"t":"很热"}', 't'), null);
  eq(pickNumber('{"a":{"b":1}}', 'a'), null);
});
t('getByPath 无路径时原样返回', () => { eq(getByPath({ a: 1 }), { a: 1 }); });

console.log('\n== aggregate / evalCondition ==');
t('四种聚合', () => {
  eq(aggregate([1, 2, 3], 'avg'), 2);
  eq(aggregate([1, 5, 3], 'max'), 5);
  eq(aggregate([4, 2, 3], 'min'), 2);
  eq(aggregate([1, 2, 7], 'last'), 7);
  eq(aggregate([], 'avg'), null);
});
t('比较运算', () => {
  ok(evalCondition(5, { op: '>', value: 4 }));
  no(evalCondition(4, { op: '>', value: 4 }));
  ok(evalCondition(4, { op: '>=', value: 4 }));
  ok(evalCondition(3, { op: '<', value: 4 }));
  ok(evalCondition(4, { op: '<=', value: 4 }));
});
t('between / outside，且上下界写反了也能work', () => {
  ok(evalCondition(5, { op: 'between', value: 1, value2: 10 }));
  ok(evalCondition(5, { op: 'between', value: 10, value2: 1 }));
  no(evalCondition(50, { op: 'between', value: 1, value2: 10 }));
  ok(evalCondition(50, { op: 'outside', value: 1, value2: 10 }));
});
t('没有条件 / 非数值 → false，不误判', () => {
  no(evalCondition(5, undefined));
  no(evalCondition(NaN, { op: '>', value: 1 }));
});

console.log('\n== judgeSamples：先判反对，宁可发现自己错 ==');
const spec = (o: Partial<any> = {}): any => ({
  deviceId: 'd1', deviceName: '培养箱', actionId: 'a1', actionName: '读取温度',
  samples: 3, intervalSec: 1, metric: 'avg', unit: '℃',
  supportIf: { op: '>', value: 37.2 }, refuteIf: { op: '<', value: 36.8 }, ...o,
});
const smp = (...vals: number[]) => vals.map(v => ({ at: NOW, value: v }));

t('落进支持区间 → support', () => {
  const r = judgeSamples(smp(37.5, 37.6, 37.4), spec());
  eq(r.stance, 'support'); eq(r.metricValue, 37.5);
});
t('落进反对区间 → refute', () => { eq(judgeSamples(smp(36.0, 36.2), spec()).stance, 'refute'); });
t('两边都不沾 → unclear，不硬凑结论', () => {
  eq(judgeSamples(smp(37.0), spec()).stance, 'unclear');
});
t('阈值重叠时反对优先', () => {
  const s = spec({ supportIf: { op: '>', value: 1 }, refuteIf: { op: '>', value: 1 } });
  eq(judgeSamples(smp(5), s).stance, 'refute');
});
t('一个读数都没有 → unclear 且不炸', () => {
  const r = judgeSamples([], spec());
  eq(r.stance, 'unclear'); eq(r.metricValue, null);
});
t('只设了反对线也能用（只想证伪的场景）', () => {
  const s = spec({ supportIf: undefined });
  eq(judgeSamples(smp(30), s).stance, 'refute');
  eq(judgeSamples(smp(40), s).stance, 'unclear');
});
t('metric 换成 max 时按最大值判', () => {
  const s = spec({ metric: 'max' });
  eq(judgeSamples(smp(36.9, 38.0), s).stance, 'support');
});
t('判定说明里带上实际数值与区间，便于事后复盘', () => {
  const r = judgeSamples(smp(36.0), spec());
  ok(r.reason.includes('36'));
  ok(r.reason.includes('反对区间'));
});

console.log('\n== describeSpec：阈值必须跑之前就写死 ==');
t('有阈值时写清楚支持/反对界线', () => {
  const d = describeSpec(spec());
  ok(d.includes('采样 3 次')); ok(d.includes('37.2℃')); ok(d.includes('36.8℃'));
});
t('没设阈值时明确警告，而不是假装配好了', () => {
  const d = describeSpec(spec({ supportIf: undefined, refuteIf: undefined }));
  ok(d.includes('还没设阈值'));
});
t('describeCondition 覆盖区间写法', () => {
  ok(describeCondition({ op: 'between', value: 1, value2: 9 }, '℃').includes('1℃ ~ 9℃'));
});

console.log('\n== resolveTarget：自动采样绝不碰执行器 ==');
t('正常找到设备与只读动作', () => {
  const r = resolveTarget(spec(), [dev()]) as any;
  ok(r.device); eq(r.action.id, 'a1');
});
t('设备被删 / 被停用 → 明确报错', () => {
  ok('error' in resolveTarget(spec(), []));
  ok('error' in resolveTarget(spec(), [dev({ enabled: false })]));
});
t('动作是写操作 → 拒绝当采样用', () => {
  const r = resolveTarget(spec(), [dev({ actions: [act({ mode: 'write' })] })]) as any;
  ok(r.error.includes('写操作'));
});

console.log('\n== parseDeviceSpec：模型编的设备一律丢掉 ==');
const rawDev = (o: any = {}) => ({
  device_id: 'd1', action_id: 'a1', read_path: 'data.t', unit: '℃',
  samples: 10, interval_sec: 30, metric: 'avg',
  support_if: { op: '>', value: 37.2 }, refute_if: { op: '<', value: 36.8 }, ...o,
});
t('正常解析并带上设备名快照', () => {
  const sp = parseDeviceSpec(rawDev(), [dev()])!;
  eq(sp.deviceName, '培养箱'); eq(sp.samples, 10); eq(sp.metric, 'avg');
  eq(sp.supportIf, { op: '>', value: 37.2, value2: undefined });
});
t('设备/动作不存在 → undefined（模型不能凭空造设备）', () => {
  eq(parseDeviceSpec(rawDev({ device_id: '不存在' }), [dev()]), undefined);
  eq(parseDeviceSpec(rawDev({ action_id: '不存在' }), [dev()]), undefined);
});
t('指向写操作 → undefined', () => {
  eq(parseDeviceSpec(rawDev(), [dev({ actions: [act({ mode: 'write' })] })]), undefined);
});
t('停用设备 → undefined', () => { eq(parseDeviceSpec(rawDev(), [dev({ enabled: false })]), undefined); });
t('采样次数与间隔被夹在安全区间，防止模型写出天文数字', () => {
  eq(parseDeviceSpec(rawDev({ samples: 99999, interval_sec: 999999 }), [dev()])!.samples, 60);
  eq(parseDeviceSpec(rawDev({ samples: 99999, interval_sec: 999999 }), [dev()])!.intervalSec, 3600);
  eq(parseDeviceSpec(rawDev({ samples: -5, interval_sec: -1 }), [dev()])!.samples, 1);
  eq(parseDeviceSpec(rawDev({ samples: -5, interval_sec: -1 }), [dev()])!.intervalSec, 0);
});
t('非法 metric 回落到 avg', () => {
  eq(parseDeviceSpec(rawDev({ metric: '中位数' }), [dev()])!.metric, 'avg');
});
t('阈值给不出数字就当没有，不编一个', () => {
  eq(parseCondition({ op: '>', value: '很高' }), undefined);
  eq(parseCondition({ op: '约等于', value: 1 }), undefined);
  eq(parseCondition(null), undefined);
  eq(parseCondition({ op: '>', value: '37.2' })!.value, 37.2);
});

console.log('\n== parseProbes 带设备时 ==');
t('有合法 device 就变成设备型，且判定标准由代码生成', () => {
  const [p] = parseProbes({ probes: [{ method: '测温', device: rawDev(), expectedSignal: '随便写的' }] }, 'n1', 'h', NOW, [dev()]);
  eq(p.kind, 'device');
  ok(p.expectedSignal.includes('37.2℃'), '判定标准要和真正会执行的阈值一致，不采信模型自由发挥');
  no(p.expectedSignal.includes('随便写的'));
});
t('device 非法时降级为人工探针，不丢掉整条方案', () => {
  const [p] = parseProbes({ probes: [{ method: '找用户聊', device: rawDev({ device_id: 'x' }), expectedSignal: '少于8人算反对' }] }, 'n1', 'h', NOW, [dev()]);
  eq(p.kind, 'manual'); eq(p.device, undefined);
  eq(p.expectedSignal, '少于8人算反对');
});
t('不传设备列表时一切照旧（纯软件用户不受影响）', () => {
  const [p] = parseProbes({ probes: [{ method: '找用户聊', device: rawDev() }] }, 'n1', 'h', NOW);
  eq(p.kind, 'manual');
});

console.log('\n== 设备实验结果进证据：层级必须是 environment ==');
t('设备反对结果 → 环境层证据 + 节点被推翻', () => {
  const n = node({ id: 'n1', status: NodeStatus.VALIDATING, hypothesis: hyp('high', [ev('support', 'stated', 'ai')]) });
  const p: Probe = { ...parseProbes({ probes: [{ method: '测温', device: rawDev() }] }, 'n1', 'h', NOW, [dev()])[0] };
  const r = applyProbeResult(n, p, {
    summary: '平均 36.0℃，落进反对区间', stance: 'refute', layer: 'environment', at: NOW,
    samples: smp(36.0, 36.1), metricValue: 36.05,
  });
  ok(r.contradicted);
  const added = r.updates.hypothesis!.evidence.slice(-1)[0];
  eq(added.layer, 'environment');
  eq(added.origin, 'probe');
  eq(r.probe.result!.samples!.length, 2, '原始采样序列要留档');
});
t('实验数据比 AI 推理重：一条环境层反证压过 10 条推理支持', () => {
  const many = Array.from({ length: 10 }, () => ev('support', 'stated', 'ai'));
  const h2 = hyp('high', [...many, ev('refute', 'environment', 'probe')]);
  ok(isContradictedByReality(h2));
});


// ===================== 探索路线与锚点 =====================
const anc = (o: any = {}): any => ({
  id: o.id || 'a' + (++seq), order: o.order ?? 1, title: o.title || '路标',
  question: 'q', needs: 'n', method: 'user', methodDetail: 'm',
  passIf: 'p', failIf: 'f', status: o.status || 'pending', ...o,
});
const route = (anchors: any[], o: any = {}): any =>
  ({ id: 'r1', goal: 'g', createdAt: NOW, version: 1, anchors, revisions: [], ...o });

console.log('\n== currentAnchor：第一个没结算的 ==');
t('按 order 取第一个未结算的', () => {
  const r = route([anc({ id: 'x', order: 2 }), anc({ id: 'y', order: 1, status: 'passed' })]);
  eq(currentAnchor(r)!.id, 'x');
});
t('passed/failed/skipped 都算结算完', () => {
  ok(isSettled(anc({ status: 'passed' })));
  ok(isSettled(anc({ status: 'failed' })));
  ok(isSettled(anc({ status: 'skipped' })));
  no(isSettled(anc({ status: 'pending' })));
  no(isSettled(anc({ status: 'waiting' })), 'waiting 还没结算，不能跳过去');
});
t('全部结算完 → undefined（路线走完）', () => {
  eq(currentAnchor(route([anc({ status: 'passed' })])), undefined);
  eq(currentAnchor(undefined), undefined);
});

console.log('\n== explorableNodes：这就是"到锚点自动暂停" ==');
const legNode = (anchorId: string | undefined, status = NodeStatus.UNEXPLORED, id?: string) =>
  node({ id: id || 'n' + (++seq), status, anchorId });

t('没有路线时照旧跑全部待探索节点', () => {
  eq(explorableNodes([legNode(undefined), legNode(undefined)], undefined).length, 2);
});
t('有路线时只跑当前段', () => {
  const r = route([anc({ id: 'A', order: 1 }), anc({ id: 'B', order: 2 })]);
  const ns = [legNode('A'), legNode('B'), legNode('B')];
  eq(explorableNodes(ns, r).map(n => n.anchorId), ['A']);
});
t('后面几段的节点一个都不许跑', () => {
  const r = route([anc({ id: 'A', order: 1 }), anc({ id: 'B', order: 2 })]);
  eq(explorableNodes([legNode('B'), legNode('B')], r).length, 0, '这就是暂停');
});
t('硬锚点等结果时整段停住', () => {
  const r = route([anc({ id: 'A', status: 'waiting' })]);
  eq(explorableNodes([legNode('A')], r).length, 0);
});
t('软锚点等结果时不阻塞', () => {
  const r = route([anc({ id: 'A', status: 'waiting', soft: true })]);
  eq(explorableNodes([legNode('A')], r).length, 1);
});
t('路线走完后不再自己往下跑（防止绕过路线乱探）', () => {
  const r = route([anc({ id: 'A', status: 'passed' })]);
  eq(explorableNodes([legNode('A'), legNode(undefined)], r).length, 0);
});
t('没挂到任何段上的游离节点，有路线时不会被跑', () => {
  const r = route([anc({ id: 'A' })]);
  eq(explorableNodes([legNode(undefined)], r).length, 0);
});

console.log('\n== legReady：这一段推理到头了没有 ==');
t('还有待探索/探索中 → 没到点', () => {
  const a = anc({ id: 'A' });
  no(legReady([legNode('A', NodeStatus.UNEXPLORED)], a));
  no(legReady([legNode('A', NodeStatus.EXPLORING)], a));
});
t('全部 solved/validating/contradicted → 到点', () => {
  const a = anc({ id: 'A' });
  ok(legReady([legNode('A', NodeStatus.SOLVED), legNode('A', NodeStatus.VALIDATING)], a));
  ok(legReady([legNode('A', NodeStatus.CONTRADICTED)], a));
});
t('这一段一个节点都没有 → 不算到点（还没规划，否则会瞬间空跑到点）', () => {
  no(legReady([legNode('B', NodeStatus.SOLVED)], anc({ id: 'A' })));
  no(legReady([], anc({ id: 'A' })));
});
t('别段的节点不影响本段判定', () => {
  ok(legReady([legNode('A', NodeStatus.SOLVED), legNode('B', NodeStatus.UNEXPLORED)], anc({ id: 'A' })));
});
t('nodesOfAnchor 不把 README/总览算进来', () => {
  const ns = [node({ id: 'o', anchorId: 'A', noteType: 'overview' }), legNode('A', NodeStatus.SOLVED, 'd')];
  eq(nodesOfAnchor(ns, 'A').map(n => n.id), ['d']);
});

console.log('\n== settleAnchor：已结算的冻结，unclear 不算结果 ==');
t('pass → passed 且记下结果', () => {
  const r = settleAnchor(route([anc({ id: 'A', status: 'waiting' })]), 'A',
    { verdict: 'pass', summary: '17/20 选了导航', origin: 'human' }, NOW);
  const a = r.anchors[0];
  eq(a.status, 'passed'); eq(a.settledAt, NOW); eq(a.result!.summary, '17/20 选了导航');
});
t('fail → failed', () => {
  const r = settleAnchor(route([anc({ id: 'A', status: 'waiting' })]), 'A',
    { verdict: 'fail', summary: '没人愿意付费', origin: 'probe' }, NOW);
  eq(r.anchors[0].status, 'failed');
});
t('unclear 留在 waiting，不硬凑一个通过', () => {
  const r = settleAnchor(route([anc({ id: 'A', status: 'waiting' })]), 'A',
    { verdict: 'unclear', summary: '样本太少', origin: 'human' }, NOW);
  eq(r.anchors[0].status, 'waiting');
  eq(r.anchors[0].settledAt, undefined);
  ok(r.anchors[0].result, '结果还是记下来了，只是不结算');
});
t('已结算的锚点重复结算是空操作（防重放/防误改历史）', () => {
  const base = route([anc({ id: 'A', status: 'passed', result: { verdict: 'pass', summary: '原始', origin: 'human', at: 1 } })]);
  const r = settleAnchor(base, 'A', { verdict: 'fail', summary: '想改历史', origin: 'human' }, NOW);
  eq(r.anchors[0].result!.summary, '原始');
  eq(r.anchors[0].status, 'passed');
});
t('锚点不存在时原样返回', () => {
  const base = route([anc({ id: 'A' })]);
  eq(settleAnchor(base, '不存在', { verdict: 'pass', summary: 'x', origin: 'human' }), base);
});
t('reachAnchor 只把 pending 转成 waiting', () => {
  eq(reachAnchor(route([anc({ id: 'A' })]), 'A', NOW).anchors[0].status, 'waiting');
  eq(reachAnchor(route([anc({ id: 'A', status: 'passed' })]), 'A', NOW).anchors[0].status, 'passed');
});
t('skipAnchor 留痕为 skipped，不伪装成通过', () => {
  const r = skipAnchor(route([anc({ id: 'A', status: 'waiting' })]), 'A', NOW);
  eq(r.anchors[0].status, 'skipped');
  eq(r.anchors[0].result, undefined, '跳过没有结果，别让它长得像通过了');
});

console.log('\n== mergeRevision：历史冻结，只改后面 ==');
t('保留触发点及之前，替换后面，并记下改线', () => {
  const base = route([
    anc({ id: 'A', order: 1, status: 'passed', title: '一' }),
    anc({ id: 'B', order: 2, status: 'failed', title: '二' }),
    anc({ id: 'C', order: 3, title: '三' }),
    anc({ id: 'D', order: 4, title: '四' }),
  ]);
  const r = mergeRevision(base, 'B',
    [{ title: '新三' } as any, { title: '新四' } as any].map((x, i) => normalizeAnchor(x, i + 1) as any),
    { anchorId: 'B', anchorTitle: '二', reason: '现实说不行', note: '换方向' }, NOW);
  eq(r.anchors.map(a => a.title), ['一', '二', '新三', '新四']);
  eq(r.anchors.map(a => a.order), [1, 2, 3, 4]);
  eq(r.version, 2);
  eq(r.revisions.length, 1);
  eq(r.revisions[0].before, ['三', '四']);
  eq(r.revisions[0].after, ['新三', '新四']);
});
t('改线后：紧接着那个是确定的，再往后都是暂定', () => {
  const base = route([anc({ id: 'A', order: 1, status: 'passed' })]);
  const r = mergeRevision(base, 'A',
    [{ title: 'x' }, { title: 'y' }, { title: 'z' }].map((v, i) => normalizeAnchor(v, i + 1) as any),
    { anchorId: 'A', anchorTitle: 'A', reason: 'r', note: 'n' }, NOW);
  eq(r.anchors.slice(1).map(a => !!a.tentative), [false, true, true]);
});
t('改线可以把后面全删光（现实说这问题不值得继续了）', () => {
  const base = route([anc({ id: 'A', order: 1, status: 'failed' }), anc({ id: 'B', order: 2 })]);
  const r = mergeRevision(base, 'A', [], { anchorId: 'A', anchorTitle: 'A', reason: 'r', note: '不值得继续' }, NOW);
  eq(r.anchors.length, 1);
  eq(currentAnchor(r), undefined);
});
t('新锚点最多 6 个，模型给再多也不塞', () => {
  const many = Array.from({ length: 20 }, (_, i) => normalizeAnchor({ title: 't' + i }, i + 1) as any);
  const r = mergeRevision(route([anc({ id: 'A', status: 'passed' })]), 'A', many,
    { anchorId: 'A', anchorTitle: 'A', reason: 'r', note: 'n' }, NOW);
  eq(r.anchors.length, 7);
});

console.log('\n== anchorEvidence：路标结果进证据体系 ==');
t('通过 → 支持；设备/实验类算环境层', () => {
  const a = anc({ method: 'device', status: 'passed', result: { verdict: 'pass', summary: 's', origin: 'probe', at: NOW } });
  const e = anchorEvidence(a, NOW)!;
  eq(e.stance, 'support'); eq(e.layer, 'environment'); eq(e.origin, 'probe');
});
t('未通过 → 反对；问用户类算行为层', () => {
  const a = anc({ method: 'user', status: 'failed', result: { verdict: 'fail', summary: 's', origin: 'human', at: NOW } });
  const e = anchorEvidence(a, NOW)!;
  eq(e.stance, 'refute'); eq(e.layer, 'behavior');
});
t('unclear / 无结果不产生证据', () => {
  eq(anchorEvidence(anc({ result: { verdict: 'unclear', summary: 's', origin: 'human', at: NOW } })), null);
  eq(anchorEvidence(anc()), null);
});
t('路标反证足以推翻一堆 AI 推理', () => {
  const a = anc({ method: 'user', result: { verdict: 'fail', summary: 's', origin: 'human', at: NOW } });
  const e = anchorEvidence(a, NOW)!;
  const many = Array.from({ length: 8 }, () => ev('support', 'stated', 'ai'));
  ok(isContradictedByReality({ statement: 'x', belief: 'high', evidence: [...many, e], updatedAt: NOW }));
});

console.log('\n== 其它 ==');
t('routeProgress 只数结算过的', () => {
  const r = route([anc({ status: 'passed' }), anc({ status: 'waiting' }), anc({ status: 'skipped' })]);
  eq(routeProgress(r), { done: 2, total: 3, percent: 67 });
  eq(routeProgress(undefined), { done: 0, total: 0, percent: 0 });
});
t('isWaitingAtAnchor 只对硬锚点报警', () => {
  ok(isWaitingAtAnchor(route([anc({ status: 'waiting' })])));
  eq(isWaitingAtAnchor(route([anc({ status: 'waiting', soft: true })])), undefined);
  eq(isWaitingAtAnchor(route([anc({ status: 'pending' })])), undefined);
});
t('normalizeAnchor：没标题的丢掉，缺判定标准会被明确标出来', () => {
  eq(normalizeAnchor({ question: 'q' }, 1), null);
  const a = normalizeAnchor({ title: '  验证付费意愿  ' }, 1)!;
  eq(a.title, '验证付费意愿');
  ok(a.passIf.includes('未写明通过标准'), '不能默默留空，否则等于没有判定标准');
  eq(a.method, 'user', '非法/缺失 method 回落到问用户');
});
t('normalizeAnchor：第一个是确定的，之后默认暂定', () => {
  no(normalizeAnchor({ title: 'a' }, 1)!.tentative);
  ok(normalizeAnchor({ title: 'b' }, 2)!.tentative);
});


// ===================== 笔记排版 =====================
const md = (src: string, large = true) => renderMarkdown(src, undefined, large);
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;

console.log('\n== 段落合并：连续多行是一段，不是一行一个 <p> ==');
t('三行中文合并成一个段落', () => {
  const html = md('这是第一行\n这是第二行\n这是第三行');
  eq(count(html, 'p'), 1);
  ok(html.includes('这是第一行这是第二行这是第三行'), '中文之间不该插空格');
});
t('空行分段：两段就是两个 <p>', () => {
  eq(count(md('第一段\n\n第二段'), 'p'), 2);
});
t('多个连续空行不会造出空段落', () => {
  eq(count(md('第一段\n\n\n\n第二段'), 'p'), 2);
});
t('不再产生占位 div（间距交给 margin，避免忽大忽小）', () => {
  no(md('甲\n\n乙').includes('h-3'));
  no(md('甲\n\n乙', false).includes('h-2'));
});

console.log('\n== joinSoftLines：中文不插空格，中英之间插 ==');
t('中文↔中文：不插空格', () => { eq(joinSoftLines(['探索路线', '锚点路标']), '探索路线锚点路标'); });
t('英文↔英文：插空格', () => { eq(joinSoftLines(['hello', 'world']), 'hello world'); });
t('中↔英 / 英↔中：插空格', () => {
  eq(joinSoftLines(['温度是', '37.2℃']), '温度是 37.2℃');
  eq(joinSoftLines(['HiExplore', '是一个工具']), 'HiExplore 是一个工具');
});
t('单行原样返回；空数组不炸', () => {
  eq(joinSoftLines(['只有一行']), '只有一行');
  eq(joinSoftLines([]), '');
});

console.log('\n== 表格：总览模板里就有，之前会被当成普通文字 ==');
const TABLE = '| 方向 | 负责 Agent | 状态 |\n| --- | --- | --- |\n| 用户需求 | 行业分析师 | 探索中 |\n| 电池续航 | 工程师 | 已完成 |';
t('渲染成真正的 table 而不是段落', () => {
  const html = md(TABLE);
  ok(html.includes('<table'));
  eq(count(html, 'th'), 3);
  eq(count(html, 'td'), 6);
  no(html.includes('<p class'), '表格行不该掉进段落');
});
t('单元格里的行内语法照常生效', () => {
  ok(md('| a | b |\n| - | - |\n| **粗** | `码` |').includes('<strong'));
});
t('缺列的行会补空单元格，不会串列', () => {
  const html = md('| a | b | c |\n| - | - | - |\n| 只有一个 |');
  eq(count(html, 'td'), 3);
});
t('只有一行竖线、没有分隔行 → 不当表格处理', () => {
  no(md('| 这其实是正文 |').includes('<table'));
});

console.log('\n== 列表 ==');
t('连续项在同一个 <ul> 里', () => {
  const html = md('- 甲\n- 乙\n- 丙');
  eq(count(html, 'ul'), 1);
  eq(count(html, 'li'), 3);
});
t('有序列表用 <ol>', () => {
  const html = md('1. 甲\n2. 乙');
  eq(count(html, 'ol'), 1); eq(count(html, 'li'), 2);
});
t('无序换有序时会另起一个列表', () => {
  const html = md('- 甲\n1. 乙');
  eq(count(html, 'ul'), 1); eq(count(html, 'ol'), 1);
});
t('缩进产生嵌套列表', () => {
  const html = md('- 甲\n  - 甲一\n  - 甲二\n- 乙');
  eq(count(html, 'ul'), 2, '应该有外层和内层两个 ul');
  eq(count(html, 'li'), 4);
});
t('嵌套结束后回到外层，标签成对', () => {
  const html = md('- 甲\n  - 子\n- 乙');
  eq((html.match(/<ul/g) || []).length, (html.match(/<\/ul>/g) || []).length);
});
t('任务列表渲染成勾选框', () => {
  const html = md('- [ ] 没做\n- [x] 做完了');
  eq(count(html, 'input'), 2);
  ok(html.includes('checked'));
  ok(html.includes('line-through'), '已完成项应有删除线');
});

console.log('\n== 引用 / 代码 / 分隔线 ==');
t('连续引用行合并成一个块，不是一行一个框', () => {
  const html = md('&gt; 第一行\n&gt; 第二行'.replace(/&gt;/g, '>'));
  eq((html.match(/border-l/g) || []).length, 1);
});
t('代码块内部不被当成 Markdown 解析', () => {
  const html = md('```\n- 这不是列表\n# 这不是标题\n```');
  eq(count(html, 'li'), 0);
  ok(html.includes('<pre'));
});
t('代码块没闭合时也能收尾，不吞掉后面的内容', () => {
  ok(md('```\nconst a = 1').includes('</pre>'));
});
t('三种分隔线写法都认', () => {
  ok(md('---').includes('<hr'));
  ok(md('***').includes('<hr'));
  ok(md('___').includes('<hr'));
});

console.log('\n== 标题与折叠 ==');
t('大号阅读区把标题做成可折叠区块', () => {
  const html = md('# 标题\n正文');
  ok(html.includes('<details'));
  ok(html.includes('<summary'));
});
t('小号（侧栏/聊天）不折叠，避免气泡里出现三角', () => {
  const html = md('# 标题\n正文', false);
  no(html.includes('<details'));
});
t('多个标题是平铺的，不会层层缩进', () => {
  const html = md('# 一\n正文\n## 二\n正文\n### 三\n正文');
  eq((html.match(/<details/g) || []).length, 3);
  eq((html.match(/<\/details>/g) || []).length, 3);
});
t('标题上间距大于下间距，层级立得住', () => {
  const html = md('## 标题');
  ok(/mt-8[^"]*mb-3/.test(html), `标题类名应为上大下小，实际：${html.slice(0, 200)}`);
});

console.log('\n== 行内语法与安全 ==');
t('HTML 被转义，笔记内容不能注入脚本', () => {
  const html = md('<img src=x onerror=alert(1)>');
  no(html.includes('<img'));
  ok(html.includes('&lt;img'));
});
t('粗体/行内码/删除线', () => {
  ok(md('**粗**').includes('<strong'));
  ok(md('`code`').includes('<code'));
  ok(md('~~删~~').includes('<del'));
});
t('粗体不会被斜体规则拆坏', () => {
  const html = md('**加粗**');
  ok(html.includes('<strong'));
  no(html.includes('<em'));
});
t('wiki 链接带上跳转属性', () => {
  ok(md('见 [[用户需求]]').includes('data-wikilink="用户需求"'));
});
t('外链渲染成 <a> 且带 noopener', () => {
  const html = md('[文档](https://example.com)');
  ok(html.includes('rel="noopener noreferrer"'));
});

console.log('\n== 真实笔记：整篇不该塌成一坨 ==');
t('总览模板渲染出标题/表格/列表，且段落分明', () => {
  const note = [
    '# 项目总览', '',
    '> 一句话说清这个项目在做什么。', '',
    '## 📌 这是什么',
    '这是一个很长的说明，',
    '在源文件里被折行写成了好几行，',
    '但它本来就是同一段话。', '',
    '## 🎯 成功标准',
    '- 算成功：拿到 20 个真实用户反馈',
    '- 不做：先做完整产品', '',
    '## 关键方向',
    '| 方向 | 负责 Agent | 状态 |',
    '| --- | --- | --- |',
    '| 用户需求 | 行业分析师 | 探索中 |', '',
    '## 🗺️ 下一步',
    '1. 近期：跑第一个路标',
    '2. 中期：接入设备实测',
  ].join('\n');
  const html = md(note);
  ok(html.includes('<table'), '表格要成表');
  eq(count(html, 'ul'), 1);
  eq(count(html, 'ol'), 1);
  eq((html.match(/<details/g) || []).length, 5, '五个标题五个区块');
  ok(html.includes('这是一个很长的说明，在源文件里被折行写成了好几行，但它本来就是同一段话。'),
    '折行的一段话要合成一个段落');
});
t('空输入 / 只有空白 不炸', () => {
  eq(md(''), '');
  eq(md('   \n\n  ').trim(), '');
  eq(renderMarkdown(undefined as any), '');
});


// ===================== 手机端现实反馈收件箱 =====================
const proj = (o: any = {}): any => ({
  id: 'p1', name: '眼镜项目', metaProblem: 'g', createdAt: NOW, nodes: [], ...o,
});
const pcall = (o: any = {}): any => ({
  id: 'c1', deviceId: 'd1', deviceName: '培养箱', actionId: 'a1', actionName: '设定温度',
  params: { temp: '37' }, source: 'ai', reason: '写操作需确认', createdAt: NOW, ...o,
});

console.log('\n== buildInbox：只推"离开电脑才能解决"的那几条 ==');
t('等现实的路标会进收件箱，且判定标准原样带上', () => {
  const p = proj({ route: route([anc({ id: 'A', status: 'waiting', title: '付费意愿', passIf: '≥8 人留资', failIf: '<3 人留资' })]) });
  const box = buildInbox([p], [], NOW);
  eq(box.length, 1);
  eq(box[0].kind, 'anchor');
  eq(box[0].id, 'anchor:A');
  ok(box[0].criteria.includes('≥8 人留资') && box[0].criteria.includes('<3 人留资'));
});
t('还没到点的路标不推——推了只会干扰', () => {
  eq(buildInbox([proj({ route: route([anc({ status: 'pending' })]) })], [], NOW).length, 0);
});
t('已结算的路标不推', () => {
  eq(buildInbox([proj({ route: route([anc({ status: 'passed' })]) })], [], NOW).length, 0);
});
t('待执行的人工探针会推', () => {
  const p = proj({
    nodes: [node({ id: 'n1', title: '用户需求' })],
    probes: [{ id: 'pr1', nodeId: 'n1', kind: 'manual', hypothesis: 'h', method: '找 20 个用户', cost: 'low', expectedSignal: '少于 8 人算反对', status: 'draft', createdAt: NOW }],
  });
  const box = buildInbox([p], [], NOW);
  eq(box.length, 1); eq(box[0].kind, 'probe'); eq(box[0].title, '用户需求');
});
t('设备型探针不推——电脑上自动跑，不该麻烦人', () => {
  const p = proj({
    nodes: [node({ id: 'n1' })],
    probes: [{ id: 'pr1', nodeId: 'n1', kind: 'device', hypothesis: 'h', method: 'm', cost: 'low', expectedSignal: 's', status: 'draft', createdAt: NOW }],
  });
  eq(buildInbox([p], [], NOW).length, 0);
});
t('已完成/已跳过的探针不推', () => {
  const mk = (status: string) => proj({
    nodes: [node({ id: 'n1' })],
    probes: [{ id: 'pr1', nodeId: 'n1', kind: 'manual', hypothesis: 'h', method: 'm', cost: 'low', expectedSignal: 's', status, createdAt: NOW }],
  });
  eq(buildInbox([mk('done')], [], NOW).length, 0);
  eq(buildInbox([mk('skipped')], [], NOW).length, 0);
});
t('被拦下的设备写操作会推，并带上具体参数', () => {
  const box = buildInbox([], [pcall()], NOW);
  eq(box.length, 1);
  eq(box[0].kind, 'device_call');
  ok(box[0].needs!.includes('temp=37'), '参数必须看得见，否则没法判断该不该确认');
});
t('最近的排最前面', () => {
  const box = buildInbox([], [pcall({ id: 'old', createdAt: 1 }), pcall({ id: 'new', createdAt: 9 })], NOW);
  eq(box.map(b => b.sourceId), ['new', 'old']);
});
t('空项目 / 空入参不炸', () => {
  eq(buildInbox([], [], NOW).length, 0);
  eq(buildInbox([proj()], [], NOW).length, 0);
});

console.log('\n== id 解析与判定校验 ==');
t('parseItemId 认得三种类型；带冒号的源 id 也不会截错', () => {
  eq(parseItemId('anchor:abc'), { kind: 'anchor', sourceId: 'abc' });
  eq(parseItemId('probe:a:b:c'), { kind: 'probe', sourceId: 'a:b:c' });
  eq(parseItemId('乱写'), null);
  eq(parseItemId('unknown:x'), null);
  eq(parseItemId('anchor:'), null);
});
t('判定值必须匹配类型——设备确认不能填"通过"', () => {
  ok(isValidVerdict('anchor', 'pass'));
  ok(isValidVerdict('device_call', 'approve'));
  no(isValidVerdict('device_call', 'pass'));
  no(isValidVerdict('anchor', 'approve'));
  no(isValidVerdict('probe', '随便'));
});

console.log('\n== normalizeReplies：后端是内存态，重复到达是常态 ==');
t('同一条重复提交只保留最新的', () => {
  const out = normalizeReplies([
    { id: 'anchor:A', verdict: 'pass', summary: '旧', at: 1 },
    { id: 'anchor:A', verdict: 'fail', summary: '新', at: 9 },
  ]);
  eq(out.length, 1); eq(out[0].summary, '新'); eq(out[0].verdict, 'fail');
});
t('判定非法 / id 认不出的一律丢掉，不猜', () => {
  eq(normalizeReplies([{ id: 'anchor:A', verdict: 'approve', summary: 'x', at: 1 }]).length, 0);
  eq(normalizeReplies([{ id: '???', verdict: 'pass', summary: 'x', at: 1 }]).length, 0);
  eq(normalizeReplies([null, undefined, 'x'] as any).length, 0);
});
t('路标/探针没写说明就不算数——没有正文等于没验证', () => {
  eq(normalizeReplies([{ id: 'anchor:A', verdict: 'pass', summary: '   ', at: 1 }]).length, 0);
});
t('设备拒绝可以不写理由', () => {
  eq(normalizeReplies([{ id: 'device_call:c1', verdict: 'reject', summary: '', at: 1 }]).length, 1);
});
t('按时间升序返回，先填的先落地', () => {
  const out = normalizeReplies([
    { id: 'anchor:B', verdict: 'pass', summary: 'b', at: 9 },
    { id: 'anchor:A', verdict: 'pass', summary: 'a', at: 1 },
  ]);
  eq(out.map(r => r.id), ['anchor:A', 'anchor:B']);
});
t('非数组输入返回空数组', () => { eq(normalizeReplies(null as any).length, 0); });

console.log('\n== 省 FC 调用：指纹去重 + 自适应轮询 ==');
t('待办没变化时指纹一致（不重复推送）', () => {
  const a = buildInbox([], [pcall()], NOW);
  const b = buildInbox([], [pcall()], NOW);
  eq(inboxDigest(a), inboxDigest(b));
});
t('待办变了指纹就变', () => {
  const a = buildInbox([], [pcall()], NOW);
  const b = buildInbox([], [pcall(), pcall({ id: 'c2' })], NOW);
  no(inboxDigest(a) === inboxDigest(b));
});
t('顺序不同但内容相同 → 指纹相同', () => {
  const a = buildInbox([], [pcall({ id: 'x', createdAt: 1 }), pcall({ id: 'y', createdAt: 2 })], NOW);
  const b = buildInbox([], [pcall({ id: 'y', createdAt: 2 }), pcall({ id: 'x', createdAt: 1 })], NOW);
  eq(inboxDigest(a), inboxDigest(b));
});
t('没待办时轮询退到 10 分钟——这是烧不烧钱的关键', () => {
  eq(nextPollDelay(0, 0), 600000);
  eq(nextPollDelay(0, 99), 600000);
});
t('有待办时 20 秒起，长时间没动静逐步退避到 5 分钟封顶', () => {
  eq(nextPollDelay(2, 0), 20000);
  eq(nextPollDelay(2, 1), 40000);
  ok(nextPollDelay(2, 99) <= 300000);
});


// ===================== 留存与漏斗埋点 =====================
// 本地时区的某一天上午 10 点，避开跨时区把"第二天"算错
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();

console.log('\n== 自然日计算：留存要按人的直觉，不是 24 小时 ==');
t('dayKey 用本地自然日', () => { eq(dayKey(at(2026, 8, 22)), '2026-08-22'); });
t('daysBetween 按日历天算', () => {
  eq(daysBetween('2026-08-22', '2026-08-23'), 1);
  eq(daysBetween('2026-08-22', '2026-08-29'), 7);
  eq(daysBetween('2026-08-22', '2026-08-22'), 0);
});
t('跨月跨年也对', () => {
  eq(daysBetween('2026-08-31', '2026-09-01'), 1);
  eq(daysBetween('2026-12-31', '2027-01-01'), 1);
});
t('晚上 23:50 和次日 00:10 算两天（这才符合"第二天回来"的直觉）', () => {
  eq(daysBetween(dayKey(at(2026, 8, 22, 23)), dayKey(at(2026, 8, 23, 0))), 1);
});

console.log('\n== computeVisitEvents：首访 / 同日重开 / 回访 ==');
t('第一次来只发 landed，不发留存事件', () => {
  const r = computeVisitEvents(null, at(2026, 8, 22));
  eq(r.events, ['funnel_landed']);
  eq(r.next.firstDay, '2026-08-22');
  eq(r.next.activeDays, 1);
});
t('同一天重复打开：不发任何事件、活跃天数不涨', () => {
  const a = computeVisitEvents(null, at(2026, 8, 22));
  const b = computeVisitEvents(a.next, at(2026, 8, 22, 20));
  eq(b.events, []);
  eq(b.next.activeDays, 1);
});
t('第二天回来 → return_d1', () => {
  const a = computeVisitEvents(null, at(2026, 8, 22));
  const b = computeVisitEvents(a.next, at(2026, 8, 23));
  ok(b.events.includes('return_d1'));
  eq(b.next.activeDays, 2);
});
t('return_d1 只发一次，第三天回来不会重复发', () => {
  let st = computeVisitEvents(null, at(2026, 8, 22)).next;
  st = computeVisitEvents(st, at(2026, 8, 23)).next;
  const c = computeVisitEvents(st, at(2026, 8, 24));
  no(c.events.includes('return_d1'));
});
t('第 7 天回来同时补发 d1 和 d7（中间没来过也算留下来了）', () => {
  const a = computeVisitEvents(null, at(2026, 8, 22));
  const b = computeVisitEvents(a.next, at(2026, 8, 29));
  ok(b.events.includes('return_d1'));
  ok(b.events.includes('return_d7'));
  no(b.events.includes('return_d30'));
});
t('第 30 天回来发 d30', () => {
  const a = computeVisitEvents(null, at(2026, 8, 1));
  const b = computeVisitEvents(a.next, at(2026, 8, 31));
  ok(b.events.includes('return_d30'));
});
t('累计活跃 3 天 / 7 天各发一次', () => {
  let st = computeVisitEvents(null, at(2026, 8, 1)).next;
  st = computeVisitEvents(st, at(2026, 8, 2)).next;
  const third = computeVisitEvents(st, at(2026, 8, 3));
  ok(third.events.includes('active_3_days'));
  st = third.next;
  for (const d of [4, 5, 6]) st = computeVisitEvents(st, at(2026, 8, d)).next;
  const seventh = computeVisitEvents(st, at(2026, 8, 7));
  ok(seventh.events.includes('active_7_days'));
  no(seventh.events.includes('active_3_days'), '已经发过就不再发');
});

console.log('\n== computeMilestone：一辈子只发一次（否则重度用户会把分子刷爆）==');
t('第一次标记会发，第二次不发', () => {
  const a = computeMilestone(null, 'funnel_project_created', at(2026, 8, 22));
  eq(a.event, 'funnel_project_created');
  const b = computeMilestone(a.next, 'funnel_project_created', at(2026, 8, 23));
  eq(b.event, null);
});
t('不同里程碑互不影响', () => {
  const a = computeMilestone(null, 'funnel_project_created');
  const b = computeMilestone(a.next, 'funnel_reality_evidence');
  eq(b.event, 'funnel_reality_evidence');
});
t('没有历史状态时也能标记（不会因为没访问过就丢事件）', () => {
  eq(computeMilestone(null, 'funnel_entered_app').event, 'funnel_entered_app');
});

console.log('\n== furthestStage：这台机器走到漏斗第几步 ==');
t('只打开过 = 第 0 步', () => {
  eq(furthestStage({ ...emptyState('2026-08-22'), fired: ['funnel_landed'] }), 0);
});
t('回填过现实证据 = 走到最后一步', () => {
  eq(furthestStage({ ...emptyState('2026-08-22'), fired: [...MILESTONES] }), MILESTONES.length - 1);
});
t('取最远的一步，不看填的顺序', () => {
  const st = { ...emptyState('2026-08-22'), fired: ['funnel_reality_evidence', 'funnel_landed'] };
  eq(furthestStage(st), MILESTONES.length - 1);
});
t('没有状态返回 -1，不会误报成第 0 步', () => { eq(furthestStage(null), -1); });
t('漏斗顺序就是用户实际走的路径，aha 在最后一步', () => {
  eq(MILESTONES[0], 'funnel_landed');
  eq(MILESTONES[MILESTONES.length - 1], 'funnel_reality_evidence');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
if (fail) process.exit(1);
