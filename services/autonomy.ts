import type { Project, AutoLogEntry, Autonomy, KeyInfo } from '../types';

/**
 * 自主运行 —— 用户点了「允许自主运行」之后，AI 项目经理把自己当成一个独立的人：
 * - 不重要的事自己判断、自己做，不来打扰；
 * - 只有很重要的事才停下来（启动资金花完、要花超过权限的钱、模型连不上、必须由现实给答案的路标）；
 * - 用户回来时，用一份汇报说清楚：这段时间做了什么、怎么想的、卡在哪、需要你什么支持。
 *
 * 这里全是纯函数。
 */

const DAY = 86400_000;
export const LOG_LIMIT = 300;
/** 自主拆新阶段的节奏：至少隔 12 小时，总共最多 6 轮（之后等用户回来看） */
export const STAGE_GAP = 12 * 3600_000;
export const MAX_STAGE_ROUNDS = 6;

export const grantAutonomy = (budgetCNY: number, checkInDays: number, now = Date.now()): Autonomy =>
  ({ on: true, grantedAt: now, budgetCNY: Math.max(1, Math.round(budgetCNY)), checkInDays: checkInDays === 14 ? 14 : 7, lastReportAt: now, stageRounds: 0, marketCents: 0 });

export const isAutonomous = (p?: Pick<Project, 'autonomy'> | null) => !!p?.autonomy?.on;
export const isRunningAutonomously = (p?: Pick<Project, 'autonomy'> | null) => !!p?.autonomy?.on && !p.autonomy.pausedFor;

export function logAuto(list: AutoLogEntry[] | undefined, kind: AutoLogEntry['kind'], text: string, nodeId?: string, now = Date.now()): AutoLogEntry[] {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!t) return list || [];
  const cur = (list || []).slice();
  // 同一件事一分钟内不重复记
  if (cur.some(e => e.kind === kind && e.text === t && now - e.at < 60_000)) return cur;
  cur.push({ at: now, kind, text: t, ...(nodeId ? { nodeId } : {}) });
  return cur.length > LOG_LIMIT ? cur.slice(cur.length - LOG_LIMIT) : cur;
}

/**
 * 自主运行以来花了多少钱（元，估算）：模型调用 + AI 在服务广场下的单。
 * 平台模型用传进来的价格表（分 / 百万 Token）折算；自有 API 用钱包页的估算。
 */
export function autoSpentCNY(p: Project, prices: Record<string, number> = {}): number {
  const a = p.autonomy; if (!a) return 0;
  const since = new Date(a.grantedAt).toISOString().slice(0, 10);
  const model = (p.wallet?.model || []).filter(r => r.day >= since && r.lastAt >= a.grantedAt)
    .reduce((n, r) => n + (r.quota ? (r.input + r.output) * (prices[r.model] || 0) / 1e6 / 100 : r.cny), 0);
  return model + (a.marketCents || 0) / 100;
}
export const budgetLeftCNY = (p: Project, prices: Record<string, number> = {}) =>
  Math.max(0, (p.autonomy?.budgetCNY || 0) - autoSpentCNY(p, prices));

export const nextCheckIn = (a: Autonomy, now = Date.now()) => {
  const base = a.lastReportAt || a.grantedAt;
  return Math.max(now, base + a.checkInDays * DAY);
};

/** 自主拆下一阶段是否允许（防止无限往下拆） */
export const canPlanNextStage = (a: Autonomy, now = Date.now()) =>
  (a.stageRounds || 0) < MAX_STAGE_ROUNDS && (!a.lastStageAt || now - a.lastStageAt >= STAGE_GAP);

export const entriesSince = (p: Project, since?: number) =>
  (p.autolog || []).filter(e => e.at > (since ?? p.autonomy?.lastReportAt ?? 0));

/** 离开多久回来算「回来了」 */
export const REPORT_GAP = 3 * 3600_000;
/** 用户回来了，是否该给一份汇报：自主运行中、上次汇报后有足够的新动静、且离上次汇报至少 3 小时 */
export function reportDue(p: Project, now = Date.now()): boolean {
  const a = p.autonomy; if (!a?.on) return false;
  const fresh = entriesSince(p);
  return fresh.length >= 3 && now - (a.lastReportAt || a.grantedAt) >= REPORT_GAP;
}

export interface AutoReport { did: string[]; thinking: string[]; difficulties: string[]; needs: string[]; headline: string }

const pick = (xs: AutoLogEntry[], kind: AutoLogEntry['kind'], n: number) => xs.filter(e => e.kind === kind).slice(-n).map(e => e.text);

/** 不调模型也能出的汇报：直接按日志分四栏 */
export function fallbackReport(entries: AutoLogEntry[], pending: KeyInfo[] = [], extraNeeds: string[] = []): AutoReport {
  const did = pick(entries, 'did', 6);
  return {
    headline: did.length ? `这段时间做了 ${entries.filter(e => e.kind === 'did').length} 件事` : '这段时间没做成什么',
    did: did.length ? did : ['还没有完成的事'],
    thinking: pick(entries, 'think', 4),
    difficulties: pick(entries, 'stuck', 4),
    needs: [...new Set([...pick(entries, 'need', 4), ...pending.slice(0, 3).map(k => `想问你：${k.question}`), ...extraNeeds])].slice(0, 6),
  };
}

/** 让模型把日志整理成一份像人写的汇报（一次调用，失败就用 fallbackReport） */
export function buildReportMessages(p: Project, entries: AutoLogEntry[], pending: KeyInfo[], status: string) {
  const lines = entries.slice(-80).map(e => `[${new Date(e.at).toLocaleString()}][${{ did: '做了', think: '想法', stuck: '困难', need: '需要用户' }[e.kind]}] ${e.text}`).join('\n');
  return [
    { role: 'system', content: '你是这个项目的 AI 项目经理，用户授权你自主运行了一段时间，现在他回来了。像一个靠谱的同事那样跟他汇报：具体、诚实、不夸大，没做成的就说没做成。只返回 JSON。' },
    { role: 'user', content: `项目：${p.name}\n目标：${(p.metaProblem || '').slice(0, 300)}\n现状：${status}\n\n这段时间的工作日志：\n${lines || '（没有记录）'}\n\n${pending.length ? `还没问出答案的问题：\n${pending.map(k => '- ' + k.question).join('\n')}\n\n` : ''}返回 JSON：{"headline":"一句话总结这段时间（≤30字）","did":["做了什么（每条≤40字，最多5条，按重要性）"],"thinking":["我的判断和思考（每条≤50字，最多3条）"],"difficulties":["遇到的困难（每条≤40字，最多3条，没有就空数组）"],"needs":["需要用户怎样支持（具体到一个动作，每条≤40字，最多3条，没有就空数组）"]}` },
  ];
}

export function parseReport(text: string): AutoReport | null {
  try {
    const raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const arr = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, len)).filter(Boolean).slice(0, n);
    const r: AutoReport = { headline: String(raw.headline || '').trim().slice(0, 40), did: arr(raw.did, 5, 60), thinking: arr(raw.thinking, 3, 80), difficulties: arr(raw.difficulties, 3, 60), needs: arr(raw.needs, 3, 60) };
    return r.did.length || r.thinking.length ? r : null;
  } catch { return null; }
}

export const reportSections = (r: AutoReport) => [
  { label: '这段时间我做了什么', items: r.did.length ? r.did : ['没做成什么'] },
  ...(r.thinking.length ? [{ label: '我的思考', items: r.thinking }] : []),
  { label: '遇到的困难', items: r.difficulties.length ? r.difficulties : ['没有卡住的地方'] },
  { label: '需要你的支持', items: r.needs.length ? r.needs : ['暂时不需要，我继续'] },
];

/** 自主运行时遇到这些问题卡，AI 自己拿主意（返回选哪个选项；null = 很重要，必须留给用户） */
export function autoChoice(type: string, optionIds: string[]): { option: string; why: string } | null {
  const has = (id: string) => optionIds.includes(id);
  switch (type) {
    case 'step': return has('auto') ? { option: 'auto', why: '接着往下做' } : has('next') ? { option: 'next', why: '接着做下一步' } : has('stop') ? { option: 'stop', why: '这些步骤做完了，看看下一步做什么' } : null;
    case 'branch': return has('continue') ? { option: 'continue', why: '这一步算完成，继续往下' } : has('terminate') ? { option: 'terminate', why: '几次都没做成，先跳过，记进困难' } : null;
    case 'contradicted': return has('pivot') ? { option: 'pivot', why: '现实推翻了原判断，换个假设继续' } : null;
    case 'reality': return has('later') ? { option: 'later', why: '这几步要在现实里做，已经去找人 / 发需求，先做别的' } : null;
    case 'unattended': return has('go') ? { option: 'go', why: '有启动资金兜底，继续' } : null;
    case 'outline': return has('confirm') ? { option: 'confirm', why: '上一阶段做完了，按新拆的步骤接着做' } : null;
    case 'batch': return has('more') ? { option: 'more', why: '接着做下一轮' } : null;
    default: return null; // anchor（要现实结果的路标）、halted（模型连不上）、charter、outline 等：留给用户
  }
}
