import type { InquiryFact, InquiryRole, InquiryWorkspace } from './inquiry';
import { AGENT_ROLES } from './agentProfiles';

export interface VerifiedMemoryEntry {
  factId: string;
  claim: string;
  source: string;
  excerpt: string;
  scope: string;
  verifiedAt: number;
}
export interface AgentMemoryChange {
  factId: string;
  kind: 'added' | 'revised' | 'withdrawn';
  before?: VerifiedMemoryEntry;
  after?: VerifiedMemoryEntry;
  reason: string;
}
export interface AgentMemoryEvent {
  id: string;
  role: InquiryRole;
  roundId?: string;
  roundNumber?: number;
  trigger: 'round-completed' | 'fact-review';
  at: number;
  version: number;
  changes: AgentMemoryChange[];
  total: number;
}
export interface AgentMemory { version: number; entries: VerifiedMemoryEntry[] }
const entryOf = (f: InquiryFact): VerifiedMemoryEntry => ({ factId: f.id, claim: f.claim, source: f.source, excerpt: f.excerpt, scope: f.scope, verifiedAt: f.reviews.filter(r => r.actor === 'human' && r.decision === 'confirmed').at(-1)?.at || 0 });
const contentKey = (e: VerifiedMemoryEntry) => JSON.stringify([e.factId, e.claim, e.source, e.excerpt, e.scope]);
const verified = (f: InquiryFact) => f.status === 'confirmed' && !!f.source.trim() && !!f.excerpt.trim() && !!f.scope.trim() && f.reviews.some(r => r.actor === 'human' && r.decision === 'confirmed');

/** Keep exact verified claims, never promote model-authored interpretations into memory. */
export function syncAgentMemories(w: InquiryWorkspace, trigger: AgentMemoryEvent['trigger'], roundId?: string): InquiryWorkspace {
  const entries = w.facts.filter(verified).map(entryOf);
  const memories = { ...w.agentMemories };
  const history = [...(w.memoryHistory || [])];
  const round = w.rounds.find(r => r.id === roundId);
  for (const role of AGENT_ROLES) {
    if (trigger === 'round-completed' && history.some(e => e.role === role && e.trigger === trigger && e.roundId === roundId)) continue;
    const previous = memories[role] || { version: 0, entries: [] };
    const changes: AgentMemoryChange[] = [];
    for (const next of entries) {
      const before = previous.entries.find(e => e.factId === next.factId);
      if (!before || contentKey(before) !== contentKey(next)) changes.push({ factId: next.factId, kind: before ? 'revised' : 'added', before, after: next, reason: '事实已人工核验；记忆保留原陈述和适用范围，不扩展为额外结论' });
    }
    for (const before of previous.entries) if (!entries.some(e => e.factId === before.factId)) {
      const f = w.facts.find(f => f.id === before.factId);
      changes.push({ factId: before.factId, kind: 'withdrawn', before, reason: f ? `依据已不再满足已核验条件（${f.status}）：${f.reviews.at(-1)?.reason || '需重新核验'}` : '依据已不存在，不再作为有效记忆' });
    }
    if (trigger === 'fact-review' && !changes.length) continue;
    const version = previous.version + (changes.length ? 1 : 0);
    memories[role] = { version, entries: entries.map(e => ({ ...e })) };
    history.push({ id: crypto.randomUUID(), role, roundId, roundNumber: round?.number, trigger, at: Date.now(), version, changes, total: entries.length });
  }
  return { ...w, agentMemories: memories, memoryHistory: history };
}

/** Re-check against live facts so revoked or edited sources are excluded immediately. */
export function activeAgentMemory(w: InquiryWorkspace, role: InquiryRole): VerifiedMemoryEntry[] {
  const current = w.facts.filter(verified).map(entryOf);
  return (w.agentMemories?.[role]?.entries || []).filter(e => current.some(f => contentKey(f) === contentKey(e)));
}
export function agentMemoryContext(w: InquiryWorkspace, role: InquiryRole): string {
  const entries = activeAgentMemory(w, role);
  let budget = 5000; let omitted = 0; const lines: string[] = [];
  for (const e of entries) { const line = JSON.stringify(e); if (line.length > budget) { omitted++; continue; } lines.push(line); budget -= line.length; }
  return `该 agent 的事实记忆 v${w.agentMemories?.[role]?.version || 0}：仅保留已核验事实原文，遵守适用范围。\n${lines.join('\n') || '暂无已核验事实记忆。'}${omitted ? `\n另有 ${omitted} 条未装入本次上下文，不得假定已读。` : ''}`;
}
