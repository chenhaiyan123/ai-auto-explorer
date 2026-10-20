import type { Awakening } from './awakening';
import { heartbeatOf } from './problemHeartbeat';

/** Only recorded human decisions set the baseline. Reading a notification never does. */
export function decisionDelta(state: Awakening) {
  const h = heartbeatOf(state);
  const decisions = [
    ...h.waits.filter(w => ['decision', 'permission'].includes(w.kind) && ['received', 'declined'].includes(w.status) && w.resolvedAt).map(w => ({ at: w.resolvedAt!, title: w.title, outcome: w.status === 'declined' ? 'rejected' : 'accepted', answer: w.answer || '' })),
    ...h.judgments.filter(j => j.status !== 'proposed' && j.reviewedAt).map(j => ({ at: j.reviewedAt!, title: j.subject, outcome: j.status, answer: '' })),
  ].sort((a,b) => b.at-a.at);
  const baseline = decisions[0];
  const since = baseline?.at ?? 0;
  const changes = [
    ...state.events.filter(e => e.at > since).map(e => ({ id:`event:${e.id}`, at:e.at, title:e.title, detail:e.body, source:e.source, kind:'signal' as const })),
    ...state.runs.filter(r => r.completedAt && r.completedAt > since).map(r => ({ id:`run:${r.id}`, at:r.completedAt!, title:r.outcome, detail:r.summary || r.reason, source:'', kind:'analysis' as const })),
  ].sort((a,b)=>b.at-a.at);
  return { baseline, changes };
}
