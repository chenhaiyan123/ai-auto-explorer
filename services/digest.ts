import type { Project, NodeStatus as NS } from '../types';
import { NodeStatus } from '../types';

/**
 * 成果播报：用户不关心过程细节，关心的是「这段时间做成了什么、自己有没有在成长」。
 * 定期（有新进展、离上次播报够久）给一张卡：
 *   做了哪些事 · 有什么心得 · 闭了哪些环（现实给了答案）· 你的成长 · 接下来
 * 原料全来自项目里已有的记录，不编；模型只负责把它说成人话。
 */

const DAY = 86400_000;
/** 两次播报至少隔多久 */
export const DIGEST_GAP = DAY;
/** 至少有几件新进展才播报 */
export const DIGEST_MIN_EVENTS = 2;
export const DIGEST_KEEP = 20;

export interface Digest {
  id: string;
  at: number;
  since: number;
  headline: string;
  tasks: string[];
  insights: string[];
  loops: string[];
  growth: string[];
  next: string[];
}

export interface DigestFacts {
  tasks: { title: string; flag: string; gist: string }[];
  loops: string[];
  growth: string[];
  aiNotes: string[];
}

const clean = (s: string | undefined, n: number) =>
  (s || '').replace(/^#{1,6}.*$/gm, '').replace(/\*\*|`|^\s*[-*]\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, n);

const FLAG: Partial<Record<NS, string>> = {
  [NodeStatus.SOLVED]: '✅',
  [NodeStatus.VALIDATING]: '🟡',
  [NodeStatus.CONTRADICTED]: '🔴',
};
const FLAG_NOTE: Record<string, string> = { '🟡': '（要到现实里做）', '🔴': '（原判断被现实推翻）' };

/** 从项目里捞出这段时间发生的事（纯数据，不调模型） */
export function collectDigest(p: Project, since: number): DigestFacts {
  const nodes = (p.nodes || []).filter(n => n.noteType !== 'overview' && n.noteType !== 'readme' && n.noteType !== 'simulation');
  const tasks = nodes
    .filter(n => (n.noteUpdatedAt || 0) > since && FLAG[n.status])
    .sort((a, b) => (b.noteUpdatedAt || 0) - (a.noteUpdatedAt || 0))
    .slice(0, 12)
    .map(n => ({ title: n.title, flag: FLAG[n.status]!, gist: clean(n.notes || n.fullNote, 160) }));

  const loops: string[] = [];
  for (const a of p.route?.anchors || []) {
    if (a.result && a.result.at > since) loops.push(`路标「${a.title}」拿到真实结果：${a.result.verdict === 'pass' ? '通过' : a.result.verdict === 'fail' ? '没通过，改了路线' : '还说不清'}——${clean(a.result.summary, 80)}`);
  }
  for (const n of nodes) if (n.status === NodeStatus.CONTRADICTED && (n.noteUpdatedAt || 0) > since) loops.push(`「${n.title}」原来的判断被现实推翻，换了方向`);
  for (const w of Object.values(p.inquiries || {})) {
    for (const f of w.facts || []) if (f.createdAt > since && (f.origin === 'human' || /现实|真实|访谈|实测|交付/.test(f.source))) loops.push(`拿到一条现实证据：${clean(f.claim, 80)}`);
  }
  for (const e of p.autolog || []) if (e.at > since && /下单|交付|发布了需求|接的单|收入/.test(e.text)) loops.push(clean(e.text, 90));

  const growth: string[] = [];
  for (const k of p.keyInfo || []) if (k.status === 'answered' && (k.answeredAt || 0) > since) growth.push(`你想清楚了：${k.question.replace(/[？?]$/, '')} → ${clean(k.answer, 50)}`);
  for (const d of p.decisions || []) if (d.createdAt > since) {
    const chosen = d.options.find(o => o.chosen);
    growth.push(`你做了决定：${clean(d.question, 50)}${chosen ? ` → ${clean(chosen.label, 30)}` : ''}`);
  }

  const aiNotes = (p.autolog || []).filter(e => e.at > since && (e.kind === 'think' || e.kind === 'stuck')).slice(-8).map(e => clean(e.text, 90));
  return { tasks, loops: [...new Set(loops)].slice(0, 8), growth: growth.slice(0, 6), aiNotes };
}

export const digestEvents = (f: DigestFacts) => f.tasks.length + f.loops.length + f.growth.length;

export const lastDigestAt = (p: Project) => p.digests?.[0]?.at || p.createdAt || 0;

/** 该不该播报：离上次够久，并且确实有新进展 */
export function digestDue(p: Project, now = Date.now()): boolean {
  const since = lastDigestAt(p);
  if (now - since < DIGEST_GAP) return false;
  return digestEvents(collectDigest(p, since)) >= DIGEST_MIN_EVENTS;
}

/** 不调模型的播报：直接按记录排 */
export function fallbackDigest(f: DigestFacts, since: number, now = Date.now()): Digest {
  const done = f.tasks.filter(t => t.flag === '✅').length;
  return {
    id: `d${now.toString(36)}`, at: now, since,
    headline: f.loops.length ? `做了 ${f.tasks.length} 件事，闭了 ${f.loops.length} 个环` : `做了 ${f.tasks.length} 件事${done ? `，${done} 件做成` : ''}`,
    tasks: f.tasks.slice(0, 5).map(t => `${t.flag} ${t.title}${FLAG_NOTE[t.flag] || ''}`),
    insights: f.tasks.filter(t => t.gist).slice(0, 3).map(t => `「${t.title}」：${t.gist.slice(0, 60)}`),
    loops: f.loops.slice(0, 4),
    growth: f.growth.slice(0, 4),
    next: [],
  };
}

export function buildDigestMessages(p: Project, f: DigestFacts, since: number) {
  const days = Math.max(1, Math.round((Date.now() - since) / DAY));
  return [
    { role: 'system', content: '你是这个项目的 AI 项目经理，给用户做一次定期的成果播报。用户不关心过程细节，只关心：做成了什么、学到了什么、哪些事已经被现实验证（闭环）、他自己有没有在成长。说人话、具体、不夸大；没有的就不写，不要编。只返回 JSON。' },
    { role: 'user', content: `项目：${p.name}\n目标：${clean(p.metaProblem, 300)}\n时间：最近 ${days} 天\n\n做过的事：\n${f.tasks.map(t => `- ${t.flag} ${t.title}${FLAG_NOTE[t.flag] || ''}：${t.gist}`).join('\n') || '（无）'}\n\n现实给出的答案（闭环）：\n${f.loops.map(x => '- ' + x).join('\n') || '（无）'}\n\n用户自己的输入和决定：\n${f.growth.map(x => '- ' + x).join('\n') || '（无）'}\n\nAI 的想法和卡点：\n${f.aiNotes.map(x => '- ' + x).join('\n') || '（无）'}\n\n返回 JSON：{"headline":"一句话说这段时间最重要的成果（≤30字）","tasks":["做成了什么（结果导向，每条≤40字，最多5条）"],"insights":["心得：这段时间弄明白的事（每条≤50字，最多3条）"],"loops":["闭环：哪个判断被现实验证 / 推翻、真实拿到了什么（每条≤50字，最多3条，没有就空数组）"],"growth":["你的成长：用户这段时间想清楚了什么、认知上往前走了哪一步（每条≤50字，最多3条，没有就空数组）"],"next":["接下来最值得做的一件事（≤40字，1-2条）"]}` },
  ];
}

export function parseDigest(text: string, since: number, now = Date.now()): Digest | null {
  try {
    const raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map(x => clean(String(x ?? ''), 80)).filter(Boolean).slice(0, n);
    const d: Digest = { id: `d${now.toString(36)}`, at: now, since, headline: clean(String(raw.headline || ''), 40), tasks: arr(raw.tasks, 5), insights: arr(raw.insights, 3), loops: arr(raw.loops, 3), growth: arr(raw.growth, 3), next: arr(raw.next, 2) };
    return d.tasks.length || d.insights.length ? d : null;
  } catch { return null; }
}

export const digestSections = (d: Digest) => [
  { label: '最近做了什么', items: d.tasks },
  ...(d.insights.length ? [{ label: '心得', items: d.insights }] : []),
  ...(d.loops.length ? [{ label: '闭环：现实给的答案', items: d.loops }] : []),
  ...(d.growth.length ? [{ label: '你的成长', items: d.growth }] : []),
  ...(d.next.length ? [{ label: '接下来', items: d.next }] : []),
].filter(s => s.items.length);

export const addDigest = (list: Digest[] | undefined, d: Digest) => [d, ...(list || [])].slice(0, DIGEST_KEEP);
