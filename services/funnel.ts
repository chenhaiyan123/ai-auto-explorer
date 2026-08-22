import { trackEvent } from './analytics';

/**
 * 留存与漏斗埋点。
 *
 * Umami 只告诉你「有多少人来过」。要判断这个产品有没有被人真的用起来，
 * 只需要三个数——这个文件就是为了算出这三个数：
 *
 *   ① 来的人里，有多少真正进到了产品里、建了项目、跑到第一个路标（漏斗）
 *   ② 第二天 / 第七天还回来的比例（留存）
 *   ③ **有多少人真的回填过一条现实证据**（aha 时刻）
 *
 * 第三个是这个产品的成败线。整套东西的主张是「让 AI 被现实反驳」，
 * 如果一百个人来了没有一个人回填过现实证据，说明这个主张根本没被接受，
 * 后面所有商业化动作都是空的。
 *
 * 两个刻意的设计：
 *
 * 1. **里程碑事件一辈子只发一次**（存在 localStorage）。
 *    否则少数重度用户会把事件数刷爆，看到的是"总动作数"而不是"多少人走到了这一步"。
 *    在 Umami 里 `funnel_xxx` 的事件数 ≈ 走到该步的人数，可以直接相除算转化率。
 *
 * 2. **留存按本地自然日算，不按 24 小时**。"第二天还回来"是人的直觉，不是 24 小时整。
 *
 * 纯函数在前（可单测），带存储/网络的薄壳在后。
 */

// ---------- 状态 ----------

export interface FunnelState {
  /** 首次访问日（YYYY-MM-DD，本地时区） */
  firstDay: string;
  /** 最近一次访问日 */
  lastDay: string;
  /** 累计活跃天数（去重） */
  activeDays: number;
  /** 已经发过的一次性事件 */
  fired: string[];
}

export const emptyState = (day: string): FunnelState =>
  ({ firstDay: day, lastDay: day, activeDays: 1, fired: [] });

/** 本地自然日，YYYY-MM-DD */
export function dayKey(t: number | Date = Date.now()): string {
  const d = t instanceof Date ? t : new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 两个日期串相差几天（按自然日） */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  if (!ay || !by) return 0;
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000);
}

// ---------- 漏斗里程碑 ----------

/**
 * 漏斗的每一级。顺序即用户实际走过的路径。
 * 在 Umami 里把相邻两级的事件数相除，就是那一步的转化率。
 */
export const MILESTONES = [
  'funnel_landed',              // 打开了页面（几乎等于访客数，作分母）
  'funnel_entered_app',         // 真的进到产品界面（不是停在登录页）
  'funnel_project_created',     // 建了第一个项目
  'funnel_exploration_started', // 点了开始探索
  'funnel_route_planned',       // 规划了探索路线
  'funnel_anchor_reached',      // 跑到了第一个路标（推理阶段走完一段）
  'funnel_reality_evidence',    // ★ aha：回填了第一条现实证据
] as const;

export type Milestone = typeof MILESTONES[number];

/** 留存事件：首次在「距首访 N 天」的日子回来时各发一次 */
export const RETENTION_TIERS: { event: string; minDays: number }[] = [
  { event: 'return_d1', minDays: 1 },
  { event: 'return_d7', minDays: 7 },
  { event: 'return_d30', minDays: 30 },
];

/** 活跃深度：累计活跃天数达标时各发一次 */
export const ACTIVE_TIERS: { event: string; days: number }[] = [
  { event: 'active_3_days', days: 3 },
  { event: 'active_7_days', days: 7 },
];

// ---------- 纯计算 ----------

/**
 * 一次访问该发哪些事件。纯函数——同一个 state + 同一天重复调用不会重复产出。
 */
export function computeVisitEvents(
  prev: FunnelState | null,
  now: number = Date.now(),
): { events: string[]; next: FunnelState } {
  const today = dayKey(now);

  if (!prev) {
    // 第一次来：只发 landed，留存事件要等以后回来才算数
    const next = emptyState(today);
    next.fired = ['funnel_landed'];
    return { events: ['funnel_landed'], next };
  }

  const isNewDay = prev.lastDay !== today;
  const next: FunnelState = {
    ...prev,
    lastDay: today,
    activeDays: isNewDay ? prev.activeDays + 1 : prev.activeDays,
    fired: [...prev.fired],
  };

  // 同一天内重复打开不算一次新的回访，不发任何事件
  if (!isNewDay) return { events: [], next };

  const events: string[] = [];
  const gap = daysBetween(prev.firstDay, today);

  for (const t of RETENTION_TIERS) {
    if (gap >= t.minDays && !next.fired.includes(t.event)) {
      events.push(t.event);
      next.fired.push(t.event);
    }
  }
  for (const t of ACTIVE_TIERS) {
    if (next.activeDays >= t.days && !next.fired.includes(t.event)) {
      events.push(t.event);
      next.fired.push(t.event);
    }
  }
  return { events, next };
}

/** 里程碑该不该发。已经发过就返回 null——一辈子只发一次。 */
export function computeMilestone(
  prev: FunnelState | null,
  milestone: string,
  now: number = Date.now(),
): { event: string | null; next: FunnelState } {
  const base = prev || emptyState(dayKey(now));
  if (base.fired.includes(milestone)) return { event: null, next: base };
  return { event: milestone, next: { ...base, fired: [...base.fired, milestone] } };
}

/** 走到了漏斗的第几级（0 = 只是打开过） */
export function furthestStage(state: FunnelState | null): number {
  if (!state) return -1;
  let i = -1;
  MILESTONES.forEach((m, idx) => { if (state.fired.includes(m)) i = idx; });
  return i;
}

// ---------- 存储 + 发送 ----------

const KEY = 'hiexplore_funnel';
const OPTOUT_KEY = 'hiexplore_no_track';

/**
 * 不统计自己。
 * 开发机（localhost）自动排除；线上想排除自己，访问一次 `?notrack=1` 即可。
 * 否则你自己每天开十次页面，会把本来就只有几十的分母冲得没法看。
 */
export function isTrackingDisabled(): boolean {
  try {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return true;
    if (new URLSearchParams(location.search).get('notrack') === '1') {
      localStorage.setItem(OPTOUT_KEY, '1');
    }
    return localStorage.getItem(OPTOUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTrackingDisabled(off: boolean): void {
  try {
    if (off) localStorage.setItem(OPTOUT_KEY, '1');
    else localStorage.removeItem(OPTOUT_KEY);
  } catch { /* 忽略 */ }
}

const load = (): FunnelState | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.firstDay || !Array.isArray(s?.fired)) return null;
    return s as FunnelState;
  } catch {
    return null;
  }
};

const save = (s: FunnelState) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 忽略 */ }
};

const emit = (events: string[]) => {
  for (const e of events) {
    try { trackEvent(e); } catch { /* 统计失败不能影响功能 */ }
  }
};

/** 每次打开应用调一次：算留存、发漏斗第一级 */
export function recordVisit(now: number = Date.now()): void {
  if (isTrackingDisabled()) return;
  const { events, next } = computeVisitEvents(load(), now);
  save(next);
  emit(events);
}

/**
 * 记一个漏斗里程碑。重复调用是安全的（一辈子只发一次），
 * 所以在所有可能的入口都调一遍即可，不用担心重复。
 */
export function markMilestone(milestone: Milestone | string, now: number = Date.now()): void {
  if (isTrackingDisabled()) return;
  const { event, next } = computeMilestone(load(), milestone, now);
  save(next);
  if (event) emit([event]);
}

/** 本机当前走到哪一步（调试/设置页展示用） */
export const funnelState = (): FunnelState | null => load();
