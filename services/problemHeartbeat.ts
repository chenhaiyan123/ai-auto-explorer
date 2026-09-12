import type { Awakening, WakeEvent } from './awakening';

export type ProblemLife = 'watching' | 'waiting' | 'dormant' | 'resolved';
export interface WaitItem {
  id: string; key: string; kind: 'data' | 'observation' | 'decision' | 'permission'; title: string; detail: string;
  source: string; owner: string; condition: string; trigger: { type: 'user_reply' } | { type: 'source_match'; sourceHost: string; keywords: string[] }; nextCheckAt?: number; contextVersion: number;
  status: 'waiting' | 'received' | 'declined' | 'cancelled'; createdAt: number; resolvedAt?: number; answer?: string;
}
export interface JudgmentChange {
  id: string; subject: string; before: string; after: string; reason: string; evidenceIds: string[];
  evidenceBasis: string; runId: string; createdAt: number; status: 'proposed' | 'accepted' | 'rejected'; reviewedAt?: number;
}
export interface ProblemUpdate {
  id: string; key: string; category: 'world' | 'knowledge' | 'action' | 'problem' | 'human';
  level: 'digest' | 'now'; title: string; body: string; reason: string; evidenceIds: string[];
  createdAt: number; readAt?: number; targetId?: string;
}
export interface ProblemHeartbeat {
  version: 1; lifecycle: ProblemLife; createdAt: number; lastMeaningfulAt: number; lastViewedAt: number;
  waits: WaitItem[]; judgments: JudgmentChange[]; updates: ProblemUpdate[];
  preference: 'important' | 'all' | 'quiet'; priority: 'normal' | 'low';
}
export const heartbeatOf = (s: Awakening, now = Date.now()): ProblemHeartbeat => s.problemHeartbeat || {
  version: 1, lifecycle: 'watching', createdAt: s.runs[0]?.startedAt || now, lastMeaningfulAt: s.runs[0]?.startedAt || now,
  lastViewedAt: 0, waits: [], judgments: [], updates: [], preference: 'important', priority: 'normal',
};
const clean = (v: unknown, limit = 1500) => typeof v === 'string' ? v.trim().slice(0, limit) : '';
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, '');
export const needsHuman = (h: ProblemHeartbeat) => h.waits.some(w => w.status === 'waiting' && w.kind !== 'observation');
export const judgmentSupported = (s: Awakening, j: JudgmentChange) => j.evidenceIds.every(e => s.context.facts.some(f => f.id === e && f.status === 'confirmed')) && j.evidenceBasis === JSON.stringify(j.evidenceIds.map(e => s.context.facts.find(f => f.id === e)));
export function attentionLevel(input: { importance: number; novelty: number; confidence: number; actionNeeded?: boolean; verifiedRisk?: boolean }, h: ProblemHeartbeat): 'silent' | 'digest' | 'now' {
  // Mandatory decisions are visible even in quiet mode. Low actionability must not erase important knowledge.
  if (input.actionNeeded || input.verifiedRisk) return 'now';
  if (h.preference === 'quiet') return 'silent';
  const score = .4 * input.importance + .3 * input.novelty + .3 * input.confidence;
  return score >= (h.preference === 'all' ? .35 : h.priority === 'low' ? .8 : .65) ? 'digest' : 'silent';
}
export function addProblemUpdate(h: ProblemHeartbeat, update: ProblemUpdate): ProblemHeartbeat {
  if (h.updates.some(u => u.key === update.key)) return h;
  if (h.updates.length >= 2000) throw new Error('Problem update archive is full; export before continuing.');
  return { ...h, updates: [...h.updates, update] };
}
export function collectWaits(s: Awakening, proposals: unknown, now: number, id: () => string): Awakening {
  if (proposals === undefined) return s;
  if (!Array.isArray(proposals) || proposals.length > 4) throw new Error('Invalid waiting list');
  let h = heartbeatOf(s, now);
  for (const raw of proposals) {
    if (!raw || !['data', 'observation', 'decision', 'permission'].includes(raw.kind)) throw new Error('Invalid waiting type');
    const title = clean(raw.title, 200), detail = clean(raw.detail), condition = clean(raw.condition), source = clean(raw.source, 500), owner = clean(raw.owner, 200);
    if (!title || !detail || !condition) throw new Error('A waiting item needs a title, detail and resume condition');
    const key = norm(`${raw.kind}:${title}:${condition}`);
    if (h.waits.some(w => w.key === key && w.status === 'waiting')) continue;
    if (h.waits.length >= 500) throw new Error('Waiting list archive is full');
    let trigger: WaitItem['trigger'] = { type: 'user_reply' };
    if (raw.kind === 'observation' && raw.trigger?.type === 'source_match') {
      const sourceHost = clean(raw.trigger.sourceHost, 250).toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(sourceHost) || !Array.isArray(raw.trigger.keywords) || raw.trigger.keywords.length < 1 || raw.trigger.keywords.length > 5 || !raw.trigger.keywords.every((k: unknown) => typeof k === 'string' && k.trim() && k.length <= 100)) throw new Error('Invalid source matching condition');
      trigger = { type: 'source_match', sourceHost, keywords: raw.trigger.keywords.map((k: string) => k.trim().toLowerCase()) };
    }
    const wait: WaitItem = { id: id(), key, kind: raw.kind, title, detail, condition, trigger, source, owner: owner || (raw.kind === 'observation' ? 'Project manager' : 'You'), contextVersion: s.contextVersion, createdAt: now, status: 'waiting', nextCheckAt: s.nextCheckAt };
    h = { ...h, waits: [...h.waits, wait], lifecycle: 'waiting' };
    if (wait.kind !== 'observation') h = addProblemUpdate(h, { id: id(), key: `wait:${wait.id}`, category: 'action', level: 'now', title, body: detail, reason: condition, evidenceIds: [], createdAt: now, targetId: wait.id });
  }
  return { ...s, problemHeartbeat: h };
}
export function recordJudgments(s: Awakening, proposals: unknown, runId: string, now: number, id: () => string): Awakening {
  if (proposals === undefined) return s;
  if (!Array.isArray(proposals) || proposals.length > 3) throw new Error('Invalid judgment changes');
  let h = heartbeatOf(s, now);
  for (const raw of proposals) {
    const subject = clean(raw?.subject, 200), after = clean(raw?.after), reason = clean(raw?.reason);
    if (!subject || !after || !reason || !Array.isArray(raw.evidenceIds) || !raw.evidenceIds.length || raw.evidenceIds.length > 10) throw new Error('A judgment change must reference verified facts');
    const evidenceIds = [...new Set<string>(raw.evidenceIds)];
    if (!evidenceIds.every(e => s.context.facts.some(f => f.id === e && f.status === 'confirmed'))) throw new Error('Judgment refers to an unverified or withdrawn fact');
    if (h.judgments.some(j => norm(j.subject) === norm(subject) && norm(j.after) === norm(after) && j.status !== 'rejected')) continue;
    if (h.judgments.length >= 500) throw new Error('Judgment archive is full');
    const before = [...h.judgments].reverse().find(j => norm(j.subject) === norm(subject) && j.status === 'accepted')?.after || '';
    const change: JudgmentChange = { id: id(), subject, before, after, reason, evidenceIds, evidenceBasis: JSON.stringify(evidenceIds.map(e => s.context.facts.find(f => f.id === e))), runId, createdAt: now, status: 'proposed' };
    h = { ...h, judgments: [...h.judgments, change] };
    if (attentionLevel({ importance: .7, novelty: 1, confidence: .6 }, h) !== 'silent') h = addProblemUpdate(h, { id: id(), key: `judgment:${change.id}`, category: 'knowledge', level: 'digest', title: subject, body: after, reason: 'Proposed interpretation of verified facts. Review before adopting.', evidenceIds, createdAt: now, targetId: change.id });
  }
  return { ...s, problemHeartbeat: h };
}
export function maintainHeartbeat(s: Awakening, now: number, id: () => string): Awakening {
  let h = heartbeatOf(s, now);
  if (h.lifecycle === 'resolved') return { ...s, problemHeartbeat: h };
  const days = (now - h.lastMeaningfulAt) / 86400000;
  if (days >= 30 && !needsHuman(h)) {
    h = { ...h, lifecycle: 'dormant' };
    if (h.preference !== 'quiet') h = addProblemUpdate(h, { id: id(), key: `stagnation:${h.lastMeaningfulAt}`, category: 'problem', level: 'digest', title: s.context.language === 'en' ? 'No new accepted evidence-based judgment for 30 days' : '连续 30 天没有新的已采纳判断', body: s.context.language === 'en' ? 'Resting while watching configured sources. Add evidence, change the route, or keep waiting.' : '保持低频观察。可以补充证据、更换路线，或继续等待。', reason: 'stagnation', evidenceIds: [], createdAt: now });
  } else if (h.lifecycle !== 'dormant') h = { ...h, lifecycle: h.waits.some(w => w.status === 'waiting') ? 'waiting' : 'watching' };
  return { ...s, problemHeartbeat: h };
}
export function heartbeatAction(s: Awakening, body: any, now: number, id: () => string): Awakening {
  let h = heartbeatOf(s, now); let event: WakeEvent | undefined;
  if (body.action === 'read') {
    if (!Array.isArray(body.ids) || body.ids.length > 200 || !body.ids.every((x: unknown) => typeof x === 'string')) throw new Error('Invalid read receipt');
    h = { ...h, lastViewedAt: now, updates: h.updates.map(u => body.ids.includes(u.id) && !u.readAt ? { ...u, readAt: now } : u) };
  } else if (body.action === 'preferences') {
    if (!['important', 'all', 'quiet'].includes(body.preference) || !['normal', 'low'].includes(body.priority)) throw new Error('Invalid attention preferences');
    h = { ...h, preference: body.preference, priority: body.priority };
  } else if (body.action === 'reply') {
    const wait = h.waits.find(w => w.id === body.id && w.status === 'waiting');
    const answer = clean(body.answer, 6000); if (!wait || !answer) throw new Error('Waiting item is closed or answer is empty');
    if (['permission', 'decision'].includes(wait.kind) && wait.contextVersion !== s.contextVersion) throw new Error('Context changed. Ask the manager for a fresh decision request.');
    if (!['provide', 'approve', 'decline'].includes(body.decision) || (['permission', 'decision'].includes(wait.kind) && body.decision === 'provide')) throw new Error('Choose approve or decline for this request');
    h = { ...h, lifecycle: 'watching', updates: h.updates.map(u => u.targetId === wait.id && !u.readAt ? { ...u, readAt: now } : u), waits: h.waits.map(w => w.id === wait.id ? { ...w, status: body.decision === 'decline' ? 'declined' : 'received', answer, resolvedAt: now } : w) };
    event = { id: `wait-reply:${wait.id}`, kind: 'input', title: wait.title, body: `Waiting item: ${wait.id}\nDecision: ${body.decision}\n${answer}\nThis is a user response, not an automatically verified fact. Any permission is limited to this request; no external experiment has been executed.`, source: clean(body.source, 1200) || 'User response', at: now, status: 'pending' };
  } else if (body.action === 'judgment') {
    const change = h.judgments.find(j => j.id === body.id && j.status === 'proposed');
    if (!change || !['accepted', 'rejected'].includes(body.status)) throw new Error('Judgment is no longer pending');
    if (body.status === 'accepted' && !judgmentSupported(s, change)) throw new Error('Supporting evidence has changed or been withdrawn');
    const current = [...h.judgments].reverse().find(j => j.status === 'accepted' && norm(j.subject) === norm(change.subject))?.after || '';
    if (body.status === 'accepted' && current !== change.before) throw new Error('A newer judgment was accepted. Request a new comparison.');
    h = { ...h, updates: h.updates.map(u => u.targetId === change.id && !u.readAt ? { ...u, readAt: now } : u), judgments: h.judgments.map(j => j.id === change.id ? { ...j, status: body.status, reviewedAt: now } : j), lastMeaningfulAt: body.status === 'accepted' ? now : h.lastMeaningfulAt };
    if (body.status === 'accepted') {
      h.lifecycle = h.waits.some(w => w.status === 'waiting') ? 'waiting' : 'watching';
      if (h.preference !== 'quiet') h = addProblemUpdate(h, { id: id(), key: `accepted:${change.id}`, category: 'knowledge', level: 'digest', title: change.subject, body: change.after, reason: change.reason, evidenceIds: change.evidenceIds, createdAt: now, targetId: change.id });
    }
  } else if (body.action === 'lifecycle') {
    if (!['watching', 'dormant', 'resolved'].includes(body.lifecycle)) throw new Error('Invalid problem lifecycle');
    h = { ...h, lifecycle: body.lifecycle };
    if (body.lifecycle === 'resolved') s = { ...s, policy: { ...s.policy, enabled: false }, status: 'paused', reason: 'Problem resolved; automatic research stopped' };
    // Resuming a lifecycle never overrides the user's explicit research pause.
  } else throw new Error('Unknown heartbeat action');
  let result = { ...s, problemHeartbeat: h, updatedAt: now };
  if (event && !result.events.some(e => e.id === event!.id)) {
    if (result.events.length >= 2000) throw new Error('Event archive is full');
    result = { ...result, events: [...result.events, event] };
  }
  if (!result.activeRunId && result.policy.enabled && h.lifecycle !== 'resolved') result.status = needsHuman(h) ? 'needs_user' : 'sleeping';
  return result;
}

export function matchWaitingSources(s: Awakening, events: WakeEvent[], now: number): Awakening {
  const h = heartbeatOf(s, now);
  const waits = h.waits.map(w => {
    if (w.status !== 'waiting' || w.kind !== 'observation' || w.trigger?.type !== 'source_match') return w;
    const rule = w.trigger;
    const event = events.find(e => {
      try { return new URL(e.source).hostname === rule.sourceHost && rule.keywords.every(k => `${e.title} ${e.body}`.toLowerCase().includes(k)); } catch { return false; }
    });
    return event ? { ...w, status: 'received' as const, resolvedAt: now, answer: `Source condition matched by ${event.id}; material still requires verification.` } : w;
  });
  return { ...s, problemHeartbeat: { ...h, waits, lifecycle: h.lifecycle === 'dormant' && events.some(e => e.kind !== 'review') ? 'watching' : h.lifecycle } };
}
