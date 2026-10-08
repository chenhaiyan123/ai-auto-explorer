import type { Project } from '../types';
import { visibleWakeStatus, type Awakening } from './awakening';
import type { InquiryRole } from './inquiry';
import { scopeNodes } from './projectWorktree';
import { judgmentSupported } from './problemHeartbeat';
import { t } from './language';

export const LOOP_STAGES = ['question', 'judgment', 'action', 'execution', 'feedback', 'verification', 'learning', 'next'] as const;
export type LoopStage = typeof LOOP_STAGES[number];
export type LoopStatus = 'active' | 'waiting' | 'needs_user' | 'paused' | 'blocked' | 'unknown' | 'dormant' | 'resolved' | 'idle';
export const roleStage = (role?: InquiryRole): LoopStage => role === 'thinker' ? 'judgment' : role === 'executor' ? 'execution' : role === 'verifier' || role === 'auditor' ? 'verification' : 'action';
export interface SmallLoop {
  id: string; scopeId: string; kind: 'hypothesis' | 'experiment'; title: string;
  status: LoopStatus; stage: LoopStage; action: string; feedback: string; condition: string;
}

/** A projection of existing records, never a second scheduler or a completion score. */
export function explorationLoop(project: Project, scopeId: string, cloud: Awakening | undefined, connected: boolean, runningScopes: string[] = [], now = Date.now()) {
  const nodes = scopeNodes(project, scopeId);
  const ids = new Set(nodes.map(n => n.id));
  const spaces = Object.values(project.inquiries || {}).filter(w => w.questionId === scopeId || ids.has(w.questionId));
  const workspace = project.inquiries?.[scopeId];
  const round = workspace?.rounds.at(-1);
  const browserActive = round?.status === 'running' && runningScopes.includes(scopeId);
  // Never project another project's, branch's or idea's cloud run into this loop.
  const state = !browserActive && cloud?.context.projectId === project.id && cloud.context.branchId === (project.worktree?.activeBranchId || 'main') && cloud.context.scopeId === scopeId ? cloud : undefined;
  const run = state?.runs.find(r => r.id === state.activeRunId) || state?.runs.at(-1);
  const step = run?.steps.at(-1);
  const task = round?.tasks.find(task => task.status === 'running') || round?.tasks.find(task => task.status !== 'completed') || round?.tasks.at(-1);
  const facts = workspace?.facts || [];
  const confirmed = facts.filter(f => f.status === 'confirmed' && f.reviews.some(r => r.actor === 'human' && r.decision === 'confirmed'));
  const candidates = facts.filter(f => f.status === 'pending');
  const disputes = facts.filter(f => f.status === 'disputed');
  // Validate against the current local board too: a context PUT may still be in flight.
  const currentContext = state && { ...state, context: { ...state.context, facts: confirmed.map(({ id, claim, source, excerpt, scope, status }) => ({ id, claim, source, excerpt, scope, status })) } };
  const judgments = state?.problemHeartbeat?.judgments.filter(j => j.evidenceIds.length > 0 && currentContext && judgmentSupported(currentContext, j)) || [];
  const accepted = judgments.filter(j => j.status === 'accepted').at(-1);
  const proposed = judgments.filter(j => j.status === 'proposed').at(-1);
  const waits = state?.problemHeartbeat?.waits.filter(w => w.status === 'waiting') || [];
  const probes = (project.probes || []).filter(p => ids.has(p.nodeId));
  const scopedProbes = scopeId === 'root' ? [] : probes.filter(p => p.nodeId === scopeId);
  const visible = visibleWakeStatus(state, connected, now);
  let status: LoopStatus = 'idle';
  let stage: LoopStage = 'question';
  let reason = t('尚未开始；先明确问题和可验证的假设。', 'Not started. Define the question and a testable hypothesis.');
  let role: InquiryRole | undefined;
  if (state) {
    stage = run?.outcome === 'progress' ? 'verification' : run?.plan ? 'feedback' : 'action';
    reason = state.reason;
    if (!connected || visible.label === '执行器心跳过期') {
      status = 'unknown'; reason = t('云端状态待确认；保留上次记录，不表示仍在执行。', 'Cloud status is unconfirmed. Saved records do not imply live execution.');
    } else if (visible.active) {
      status = 'active'; stage = state.status === 'checking' ? 'feedback' : roleStage(step?.role); role = state.status === 'checking' ? 'manager' : step?.role || 'manager';
    } else if (state.status === 'blocked') { status = 'blocked'; stage = roleStage(step?.role); }
    else if (state.problemHeartbeat?.lifecycle === 'resolved') { status = 'resolved'; stage = 'next'; }
    else if (!state.policy.enabled || state.status === 'paused') { status = 'paused'; }
    else if (state.problemHeartbeat?.lifecycle === 'dormant') { status = 'dormant'; stage = 'feedback'; }
    else { status = state.status === 'needs_user' || waits.some(w => w.kind !== 'observation') ? 'needs_user' : 'waiting'; stage = waits.some(w => w.kind === 'decision' || w.kind === 'permission') ? 'action' : run?.outcome === 'progress' ? 'verification' : 'feedback'; }
  } else if (round) {
    stage = roleStage(task?.role);
    if (round.status === 'running' && runningScopes.includes(scopeId)) { status = 'active'; role = task?.role; reason = task?.result?.summary || t('浏览器团队正在处理当前环节。', 'The browser team is processing this stage.'); }
    else if (round.status === 'failed') { status = 'blocked'; reason = round.error || task?.error || t('执行失败，查看团队记录后决定是否重试。', 'Execution failed. Review the team record before retrying.'); }
    else if (round.status !== 'completed') { status = 'paused'; reason = t('团队轮次已暂停，等待你继续。', 'The team round is paused, awaiting your decision to continue.'); }
    else { status = 'waiting'; stage = 'verification'; reason = t('本轮团队已返回，仍需核验候选结论和现实反馈。', 'The team round returned; candidate conclusions and real-world feedback still need verification.'); }
  } else if (scopedProbes.some(p => p.status === 'running' || p.result)) {
    status = 'waiting'; stage = scopedProbes.some(p => p.result) ? 'verification' : 'feedback'; reason = t('查看实验记录，等待结果或核对已回填数据。', 'Review the experiment record; await results or verify submitted data.');
  }
  const missing = t('尚无记录', 'No record yet');
  const event = state?.events.at(-1);
  const feedback = scopedProbes.filter(p => p.result).at(-1)?.result?.summary || event?.body;
  const details: Record<LoopStage, string> = {
    question: scopeId === 'root' ? project.metaProblem || project.name : nodes.find(n => n.id === scopeId)?.title || workspace?.question || missing,
    judgment: accepted ? `${t('已采纳判断：', 'Accepted judgment: ')}${accepted.after}` : run?.plan?.hypothesis || round?.hypotheses.map(h => h.statement).join('\n') || t('尚未形成判断；假设不等于事实。', 'No judgment yet. A hypothesis is not a fact.'),
    action: run?.plan?.task || task?.result?.summary || t('由项目经理确定可执行任务与停止条件。', 'The manager needs to define an actionable task and stop condition.'),
    execution: step ? `${step.purpose}\n${step.result || t('尚无返回记录', 'No returned result')}` : round?.tasks.filter(t => t.role === 'executor' && t.result).map(t => t.result!.summary).join('\n') || t('尚无执行结果。实验计划不代表实验已经发生。', 'No execution result. A planned experiment has not necessarily taken place.'),
    feedback: feedback || t('等待用户、外部来源或实验提供新反馈。AI 推演不是现实反馈。', 'Awaiting feedback from people, external sources or experiments. AI reasoning is not real-world feedback.'),
    verification: `${confirmed.length} ${t('条人工确认事实', 'human-confirmed facts')} · ${candidates.length} ${t('条待核验', 'pending verification')} · ${disputes.length} ${t('条争议', 'disputed')}\n${t('仅统计当前问题的事实板；模型一致同意不等于证据。', 'This question’s fact board only. Model agreement is not evidence.')}`,
    learning: proposed ? `${t('待审核的认知变化：', 'Proposed judgment change: ')}${proposed.before || missing} → ${proposed.after}` : accepted ? `${accepted.before || missing} → ${accepted.after}\n${accepted.reason}` : t('尚无依据仍有效的已采纳认知变化；更多文字不等于知识增加。', 'No accepted judgment change with currently valid evidence. More text does not mean more knowledge.'),
    next: waits.map(w => `${w.owner} · ${w.title}\n${w.condition}`).join('\n\n') || run?.next || run?.plan?.missingEvidence || t('明确所缺证据，再决定下一轮；没有增量时可以等待。', 'Identify missing evidence before the next round. Waiting is valid when nothing has changed.'),
  };
  const smallLoops: SmallLoop[] = spaces.flatMap(w => {
    const r = w.rounds.at(-1);
    return (r?.hypotheses || []).map(h => {
      const tasks = r!.tasks.filter(task => task.hypothesisId === h.id);
      const active = tasks.find(t => t.status === 'running');
      const pending = tasks.find(t => t.status === 'failed' || t.status === 'pending');
      const result = (role: InquiryRole) => tasks.find(t => t.role === role)?.result?.summary;
      return { id: `hypothesis:${w.questionId}:${h.id}`, scopeId: w.questionId, kind: 'hypothesis' as const, title: h.statement,
        status: tasks.some(t => t.status === 'failed') ? 'blocked' as const : active && runningScopes.includes(w.questionId) ? 'active' as const : r!.status !== 'completed' && !runningScopes.includes(w.questionId) ? 'paused' as const : 'waiting' as const,
        stage: roleStage((active || pending || tasks.at(-1))?.role), action: result('executor') || t('执行者尚无返回结果', 'No executor result yet'),
        feedback: result('verifier') || result('auditor') || t('尚无交叉核验记录', 'No cross-verification record yet'), condition: h.falsification };
    });
  });
  if (run?.plan?.hypothesis) smallLoops.unshift({ id: `cloud:${run.id}`, scopeId, kind: 'hypothesis', title: run.plan.hypothesis,
    status, stage, action: run.plan.task, feedback: run.steps.find(s => s.role === 'verifier')?.result || run.summary || missing,
    condition: `${t('本轮停止条件：', 'Run stop condition: ')}${run.plan.stopCondition || missing}` });
  for (const p of probes) smallLoops.push({ id: `probe:${p.id}`, scopeId: p.nodeId, kind: 'experiment', title: p.hypothesis,
    status: p.status === 'skipped' ? 'paused' : p.result ? 'waiting' : p.status === 'draft' ? 'idle' : 'waiting', stage: p.result ? 'verification' : p.status === 'draft' ? 'action' : 'feedback',
    action: p.method, feedback: p.result?.summary || t('等待回填实验结果；未自动核验。', 'Awaiting experiment results; not automatically verified.'), condition: p.expectedSignal });
  return { status, stage, reason, role, details, smallLoops, waits, state, run, confirmed, candidates, accepted, source: state ? 'cloud' : round ? 'browser' : 'records',
    nextCheckAt: state?.policy.enabled && connected && status !== 'unknown' && status !== 'resolved' ? state.nextCheckAt : undefined };
}
