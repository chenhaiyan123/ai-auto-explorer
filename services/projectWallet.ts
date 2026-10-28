import type { ProjectCharter, ProjectWalletLedger, ModelSpendDay } from '../types';

/**
 * 项目钱包 —— 这个项目花了多少、花在哪。
 *
 * 两类支出：
 * - 模型调用：每次 AI 干活都会调模型。按「天 × 模型」汇总记账（不然一天几十条刷屏）。
 *   用自己的 API Key 的，按公开价估一个人民币数；用平台共享额度 / 体验额度的，只记 token，不算钱。
 * - 服务订单 / 需求：去服务广场找人做事（这部分从服务广场读，订单本身在服务端）。
 *
 * 记账在浏览器里按项目归集，数字是估算，用来让人心里有数，不是对账单。
 */

// ===== 模型用量上报（llmProvider 每次调用完都会报一次） =====
export interface ModelUsage { model: string; provider: string; input: number; output: number }
type Listener = (u: ModelUsage, projectId: string | null) => void;
const listeners = new Set<Listener>();
let meterProject: string | null = null;

/** 现在的模型调用记在哪个项目上（平台模型扣钱时，有项目钱包就从项目钱包扣） */
let fallbackProject: () => string | null = () => null;
/** 不在 meterFor 里的调用算到哪个项目（App 告诉它「当前打开的项目」） */
export const setDefaultMeterProject = (fn: () => string | null) => { fallbackProject = fn; };
export const currentMeterProject = () => meterProject || fallbackProject();
export const onModelUsage = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const reportModelUsage = (u: ModelUsage) => { listeners.forEach(fn => { try { fn(u, meterProject); } catch { /* 记账失败不能影响干活 */ } }); };
/**
 * 这段时间里的模型调用记到某个项目上（比如后台醒来看一眼的是别的项目）。
 * 不在 meterFor 里的调用记到当前打开的项目。
 */
export async function meterFor<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = meterProject;
  meterProject = projectId;
  try { return await fn(); } finally { meterProject = prev; }
}

// ===== 估价（元 / 百万 token；公开价的大致量级，只用来估） =====
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /deepseek/i, input: 2, output: 3 },
  { match: /qwen.*(flash|turbo)/i, input: 0.15, output: 1.5 },
  { match: /qwen/i, input: 0.8, output: 2 },
  { match: /kimi|moonshot/i, input: 4, output: 16 },
  { match: /doubao/i, input: 0.8, output: 2 },
  { match: /glm/i, input: 1, output: 4 },
];
const DEFAULT_PRICE = { input: 2, output: 8 };
/** 平台共享额度 / 体验额度：用的是额度，不是用户自己的钱 */
export const isQuota = (provider: string) => provider === 'platform' || provider === 'trial';
export function estimateCNY(model: string, provider: string, input: number, output: number): number {
  if (isQuota(provider)) return 0;
  const p = PRICES.find(x => x.match.test(model)) || DEFAULT_PRICE;
  return (input * p.input + output * p.output) / 1e6;
}

export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const MAX_DAYS = 400;

/** 记一笔模型调用（按天 × 模型合并） */
export function addModelSpend(w: ProjectWalletLedger | undefined, u: ModelUsage, at = Date.now()): ProjectWalletLedger {
  const day = dayOf(at);
  const model = u.model || '未命名模型';
  const rows = (w?.model || []).slice();
  const i = rows.findIndex(r => r.day === day && r.model === model && r.quota === isQuota(u.provider));
  const add = { calls: 1, input: Math.max(0, u.input || 0), output: Math.max(0, u.output || 0), cny: estimateCNY(model, u.provider, u.input || 0, u.output || 0) };
  if (i >= 0) {
    const r = rows[i];
    rows[i] = { ...r, calls: r.calls + add.calls, input: r.input + add.input, output: r.output + add.output, cny: r.cny + add.cny, lastAt: at };
  } else {
    rows.push({ day, model, quota: isQuota(u.provider), ...add, lastAt: at });
  }
  return { ...(w || {}), model: rows.slice(-MAX_DAYS) };
}

export interface WalletSummary {
  monthCNY: number; monthTokens: number; monthCalls: number;
  totalCNY: number; totalTokens: number;
  quotaTokens: number;
}
export function walletSummary(w: ProjectWalletLedger | undefined, now = Date.now()): WalletSummary {
  const month = dayOf(now).slice(0, 7);
  const rows: ModelSpendDay[] = w?.model || [];
  const m = rows.filter(r => r.day.startsWith(month));
  const sum = (xs: ModelSpendDay[], f: (r: ModelSpendDay) => number) => xs.reduce((n, r) => n + f(r), 0);
  return {
    monthCNY: sum(m, r => r.cny), monthTokens: sum(m, r => r.input + r.output), monthCalls: sum(m, r => r.calls),
    totalCNY: sum(rows, r => r.cny), totalTokens: sum(rows, r => r.input + r.output),
    quotaTokens: sum(m.filter(r => r.quota), r => r.input + r.output),
  };
}

/** 这个月在服务上花了多少（已确认的订单），用来跟花钱权限里的月上限比 */
export const serviceSpentThisMonth = (orders: { totalCents: number; status: string; createdAt: number }[], now = Date.now()) => {
  const month = dayOf(now).slice(0, 7);
  return orders.filter(o => ['accepted', 'delivered', 'completed', 'requested'].includes(o.status) && dayOf(o.createdAt).startsWith(month))
    .reduce((n, o) => n + o.totalCents, 0) / 100;
};

export const fmtCNY = (n: number) => (n === 0 ? '¥0' : n < 0.01 ? '<¥0.01' : `¥${n < 10 ? n.toFixed(2) : n.toFixed(0)}`);
export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);

export const charterRoom = (c: ProjectCharter | undefined, spent: number) =>
  c?.monthlyCNY ? Math.max(0, c.monthlyCNY - spent) : undefined;
