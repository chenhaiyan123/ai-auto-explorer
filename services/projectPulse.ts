import type { Project, ProjectLife, PulseNote, PulseKind } from '../types';

/**
 * 项目「活着」（Project Pulse）。
 *
 * 用户原话：所有项目默认都是活着的，但活着不等于无时无刻都在生成；
 * 应该像人一样——这个项目我长期关注、AI 项目经理也在长期关注，
 * 隔一段时间醒来看一眼有没有新的灵感、线索、证据；醒来的频次不能高，不然烧 token。
 *
 * 落到规则上：
 * 1. 新老项目都默认 watching，第一次醒来错开（不会一打开应用所有项目一起醒）。
 * 2. 一次醒来 = 一次小的模型调用（输入截断、输出 ≤ 700 token），不写正文、不拆子问题。
 * 3. 节奏自适应：连着几次没发现新东西就慢下来；用户很久没来看这个项目，也跟着慢下来（注意力会淡）。
 *    用户一回来看，节奏恢复。
 * 4. 全局闸门：所有项目加起来一天最多醒 MAX_WAKES_PER_DAY 次，两次之间至少隔 MIN_GAP_MIN 分钟。
 * 5. 醒来看到的东西记进项目自己的「关注日志」，**不进对话框**；
 *    只有模型标了 notable 的，才在对话流里出一行，而且每个项目一天最多一行。
 *
 * 全是纯函数，方便单测；App 只负责定时调用和写回状态。
 */

export const CADENCE_OPTIONS = [6, 12, 24, 72, 168] as const;
export const DEFAULT_CADENCE = 24;
export const MAX_WAKES_PER_DAY = 6;
export const MIN_GAP_MIN = 20;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** 节奏最慢拉到一周一次 */
const MAX_INTERVAL = 7 * DAY;
/** 用户多少天没来看，就当这个项目「淡出视线」 */
const FADE_AFTER = 14 * DAY;
const JOURNAL_LIMIT = 60;

export const cadenceLabel = (h: number) =>
  h < 24 ? `每 ${h} 小时` : h === 24 ? '每天' : h % 168 === 0 ? (h === 168 ? '每周' : `每 ${h / 168} 周`) : `每 ${Math.round(h / 24)} 天`;

export const defaultLife = (now: number, index = 0): ProjectLife => ({
  state: 'watching',
  cadenceHours: DEFAULT_CADENCE,
  // 第一次醒来错开：第 1 个项目 1 小时后，之后每个再晚 2 小时
  nextWakeAt: now + (1 + index * 2) * HOUR,
  quietStreak: 0,
  journal: [],
});

export const lifeOf = (p: Project, now: number, index = 0): ProjectLife => p.life || defaultLife(now, index);

/** 这一轮醒来之后，隔多久再醒 */
export const nextInterval = (life: ProjectLife, now: number): number => {
  let ms = life.cadenceHours * HOUR;
  // 连着没新东西：每多一次慢一倍，最多 ×8
  ms *= 2 ** Math.min(life.quietStreak, 3);
  // 用户很久没来看：至少一周一次
  if (life.lastViewedAt && now - life.lastViewedAt > FADE_AFTER) ms = Math.max(ms, MAX_INTERVAL);
  return Math.min(ms, Math.max(MAX_INTERVAL, life.cadenceHours * HOUR));
};

export interface PulseBudget { day: string; count: number; lastAt: number }
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
export const emptyBudget = (now: number): PulseBudget => ({ day: utcDay(now), count: 0, lastAt: 0 });

/** 全局闸门：今天还能不能再醒一次 */
export const budgetAllows = (b: PulseBudget | null | undefined, now: number): boolean => {
  const cur = b && b.day === utcDay(now) ? b : emptyBudget(now);
  if (cur.count >= MAX_WAKES_PER_DAY) return false;
  return !b || now - b.lastAt >= MIN_GAP_MIN * 60_000;
};
export const spendBudget = (b: PulseBudget | null | undefined, now: number): PulseBudget => {
  const cur = b && b.day === utcDay(now) ? b : emptyBudget(now);
  return { day: cur.day, count: cur.count + 1, lastAt: now };
};

/** 挑一个该醒的项目（一次只醒一个；正在写/正在跑的项目跳过） */
export const pickDue = (projects: Project[], now: number, busy: (id: string) => boolean): Project | undefined =>
  projects
    .map((p, i) => ({ p, life: lifeOf(p, now, i) }))
    .filter(x => x.life.state === 'watching' && x.life.nextWakeAt <= now && !busy(x.p.id))
    .sort((a, b) => a.life.nextWakeAt - b.life.nextWakeAt)[0]?.p;

// ===== 醒来看一眼：提示词 =====

const clip = (s: string | undefined, n: number) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export const buildPulseMessages = (p: Project, now = Date.now(), opts: { web?: boolean } = {}) => {
  const life = p.life;
  const notes = (p.nodes || [])
    .filter(n => n.noteType !== 'readme' && n.noteType !== 'simulation')
    .slice(-15)
    .map(n => `- ${n.title}${n.notes ? `：${clip(n.notes, 60)}` : ''}`)
    .join('\n');
  const facts = Object.values(p.inquiries || {})
    .flatMap(w => w.facts || [])
    .filter(f => f.status === 'pending' || f.status === 'disputed')
    .slice(-6)
    .map(f => `- ${clip(f.claim, 80)}`)
    .join('\n');
  const seen = (life?.journal || []).slice(-8).map(j => `- ${j.title}`).join('\n');
  const since = life?.lastWakeAt ? `上次醒来：${Math.max(1, Math.round((now - life.lastWakeAt) / HOUR))} 小时前` : '这是第一次醒来';
  const system = [
    '你是这个项目的 AI 项目经理，在长期关注它。现在是一次例行的「醒来看一眼」，不是写报告。',
    '任务：想想有没有值得记下的新灵感、新线索、可以找来的证据，或者一个该问用户的关键问题。',
    '规则：',
    '1. 没有真正新的东西就返回空的 observations——这很正常，不要硬凑。',
    '2. 最多 3 条，每条标题 ≤ 20 字、说明 ≤ 80 字。不要重复「已经记过的」。',
    opts.web
      ? '3. 你可以联网搜索。优先找与项目直接相关、近一年的新进展、数据、报道；每条来自网上的观察都要把 source 填成对应的搜索结果编号；对不上编号的不要写成事实，只能写成 question。'
      : '3. 你不能上网。不要编造具体的论文、数据、链接；需要去现实里核实的，用 clue 或 question 写清楚「去哪查、查什么」。',
    '4. notable 只给真正需要用户知道的（会改变方向、或需要他做决定），大多数应为 false。',
    `只返回 JSON：{"summary":"一句话，≤30字","observations":[{"kind":"inspiration|clue|evidence|question","title":"","detail":"","relatedTitle":"相关笔记标题或空","notable":false${opts.web ? ',"source":搜索结果编号或null' : ''}}]}`,
  ].join('\n');
  const user = [
    `项目：${p.name}`,
    `目标：${clip(p.metaProblem || p.name, 200)}`,
    (p as any).overviewBrief ? `用户写的目标与范围：${clip((p as any).overviewBrief, 300)}` : '',
    since,
    notes ? `现有笔记：\n${notes}` : '还没有笔记。',
    facts ? `还在等验证的事实：\n${facts}` : '',
    seen ? `已经记过的（不要重复）：\n${seen}` : '',
  ].filter(Boolean).join('\n\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user.slice(0, 4000) }];
};

// ===== 解析与回写 =====

const KINDS: PulseKind[] = ['inspiration', 'clue', 'evidence', 'question'];
export interface PulseResult { summary: string; observations: Omit<PulseNote, 'id' | 'at'>[] }

export const parsePulse = (text: string, sources: { index: number; title: string; url: string; site?: string }[] = []): PulseResult => {
  const byIndex = new Map(sources.map(s => [Number(s.index), s]));
  let raw: any;
  try { raw = JSON.parse(text); }
  catch {
    const m = (text || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('模型没有返回 JSON');
    raw = JSON.parse(m[0]);
  }
  const obs = Array.isArray(raw?.observations) ? raw.observations : [];
  return {
    summary: clip(typeof raw?.summary === 'string' ? raw.summary : '', 40),
    observations: obs
      .filter((o: any) => o && KINDS.includes(o.kind) && typeof o.title === 'string' && o.title.trim())
      .slice(0, 3)
      .map((o: any) => ({
        kind: o.kind as PulseKind,
        title: clip(o.title, 24),
        detail: clip(typeof o.detail === 'string' ? o.detail : '', 120),
        relatedTitle: typeof o.relatedTitle === 'string' && o.relatedTitle.trim() ? clip(o.relatedTitle, 40) : undefined,
        notable: o.notable === true,
        ...(byIndex.has(Number(o.source)) ? { url: byIndex.get(Number(o.source))!.url, site: byIndex.get(Number(o.source))!.site || hostOf(byIndex.get(Number(o.source))!.url) } : {}),
      })),
  };
};

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

let seq = 0;
const noteId = () => `pn${Date.now().toString(36)}${(seq++).toString(36)}`;
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 把一次醒来的结果写回 life，返回新 life 和这次真正新增的条目 */
export const applyPulse = (life: ProjectLife, result: PulseResult, now: number): { life: ProjectLife; added: PulseNote[] } => {
  const known = new Set(life.journal.map(j => norm(j.title)));
  const added: PulseNote[] = [];
  for (const o of result.observations) {
    if (known.has(norm(o.title))) continue;
    known.add(norm(o.title));
    added.push({ ...o, id: noteId(), at: now });
  }
  const next: ProjectLife = {
    ...life,
    lastWakeAt: now,
    lastSummary: result.summary || (added.length ? `记下 ${added.length} 条` : '没有新东西'),
    quietStreak: added.length ? 0 : life.quietStreak + 1,
    journal: [...life.journal, ...added].slice(-JOURNAL_LIMIT),
  };
  return { life: { ...next, nextWakeAt: now + nextInterval(next, now) }, added };
};

/** 醒来失败（模型连不上等）：不算安静，也不连着重试——过一个基础节奏再说 */
export const failPulse = (life: ProjectLife, now: number, reason: string): ProjectLife => ({
  ...life, lastWakeAt: now, lastSummary: `没醒成：${clip(reason, 30)}`, nextWakeAt: now + Math.max(6 * HOUR, life.cadenceHours * HOUR),
});

/** 这次要不要在对话流里出一行（每个项目一天最多一次，只说 notable 的） */
export const notableToShow = (life: ProjectLife, added: PulseNote[], now: number): PulseNote | undefined => {
  const hit = added.find(a => a.notable);
  if (!hit) return undefined;
  if (life.lastNotifiedAt && now - life.lastNotifiedAt < 20 * HOUR) return undefined;
  return hit;
};

/** 用户打开了项目：记下来；如果因为「很久没来看」被拉长了节奏，拉回来 */
export const touchViewed = (life: ProjectLife, now: number): ProjectLife => {
  const faded = !!life.lastViewedAt && now - life.lastViewedAt > FADE_AFTER;
  const base = now + life.cadenceHours * HOUR;
  return { ...life, lastViewedAt: now, ...(faded && life.nextWakeAt > base ? { nextWakeAt: base } : {}) };
};

export const setCadence = (life: ProjectLife, hours: number, now: number): ProjectLife => {
  const cadenceHours = CADENCE_OPTIONS.includes(hours as any) ? hours : DEFAULT_CADENCE;
  const next = { ...life, cadenceHours, quietStreak: 0 };
  return { ...next, nextWakeAt: (life.lastWakeAt || now) + nextInterval(next, now) };
};

export const setWatching = (life: ProjectLife, on: boolean, now: number): ProjectLife =>
  on ? { ...life, state: 'watching', quietStreak: 0, nextWakeAt: now + life.cadenceHours * HOUR } : { ...life, state: 'paused' };

export const KIND_LABEL: Record<PulseKind, { icon: string; label: string }> = {
  inspiration: { icon: '💡', label: '灵感' },
  clue: { icon: '🔎', label: '线索' },
  evidence: { icon: '📎', label: '可找的证据' },
  question: { icon: '❓', label: '想问你' },
};
