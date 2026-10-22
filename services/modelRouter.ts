import type { SharedModel, TokenBalance } from './sharedModelsClient';

/**
 * AI 自己换模型：难的活用强模型（Claude / GPT 这类），简单的活用便宜模型（DeepSeek / Kimi 这类）。
 *
 * - 只在「平台模型」之间换：用户自己的 API Key 只有一个模型，没得换；
 * - 每个项目一个「用模型的策略」：省钱 / 均衡（默认）/ 效果优先；
 * - 换不了（模型没开、额度没了、钱包没钱）就用默认模型，绝不因为换模型让活停下来。
 *
 * 这里全是纯函数 + 一个全局的「当前这件活有多难」，App 负责把项目策略接进来。
 */

export type TaskLevel = 'simple' | 'normal' | 'hard';
export type ModelPolicy = 'save' | 'balanced' | 'best';

export const POLICY_LABEL: Record<ModelPolicy, string> = { save: '省钱', balanced: '均衡', best: '效果优先' };
export const POLICY_HINT: Record<ModelPolicy, string> = {
  save: '基本都用最便宜的模型，只有特别难的活才稍微升级',
  balanced: '简单的活用便宜模型，难的活（拆阶段、岔路口、重做、给人交付）换最强的模型',
  best: '一般的活和难的活都用最强的模型，只有很简单的活用默认模型',
};
export const TASK_LABEL: Record<TaskLevel, string> = { simple: '简单的活', normal: '一般的活', hard: '难的活' };

// ===== 这件活有多难（像 meterFor 一样按调用范围设置） =====
let scopeTask: TaskLevel | null = null;
export async function asTask<T>(level: TaskLevel, fn: () => Promise<T>): Promise<T> {
  const prev = scopeTask;
  scopeTask = level;
  try { return await fn(); } finally { scopeTask = prev; }
}
export const currentTask = (): TaskLevel => scopeTask || 'normal';

// ===== 路由器（App 注册：读当前项目的策略和模型目录） =====
export type ModelRoute = { modelId: string; label: string; why: string };
type Router = (task: TaskLevel) => ModelRoute | undefined;
let router: Router | null = null;
export const setModelRouter = (r: Router | null) => { router = r; };
export const routeModel = (task: TaskLevel = currentTask()): ModelRoute | undefined => { try { return router?.(task); } catch { return undefined; } };

/** 模型强弱（1 便宜够用 / 2 较强 / 3 最强）：按名字认，认不出来算 1 */
export function modelStrength(m: Pick<SharedModel, 'id' | 'label' | 'provider' | 'model'>): 1 | 2 | 3 {
  const s = `${m.provider} ${m.id} ${m.label} ${m.model}`.toLowerCase();
  if (/anthropic|claude|opus|sonnet|\bgpt-?[5-9]|gpt-4\.1|\bo[134](-|\b)|gemini[\w.-]*pro|grok-?[3-9]/.test(s)) return 3;
  if (/kimi|moonshot|\bk2\b|reasoner|deepseek-r1|qwen[\w.-]*max|glm-4\.[5-9]|doubao[\w.-]*pro/.test(s)) return 2;
  return 1;
}

/** 现在能不能用：开着、有 Key、今天还有量，且账上有 Token 或者钱包能兑换 */
export function usableModel(m: SharedModel, balance: TokenBalance | undefined, walletCents: number): boolean {
  if (!m.enabled || !m.hasKey || !m.model?.trim() || m.dailyTokens - m.usedToday < 20000) return false;
  return (balance?.available || 0) > 20000 || ((m.priceCentsPerM || 0) > 0 && walletCents >= 100);
}

export interface RouteInput {
  models: SharedModel[];
  balances: Record<string, TokenBalance>;
  walletCents: number;
  /** 用户设的默认模型（设置里选的平台模型） */
  defaultId?: string;
  policy?: ModelPolicy;
}

export function pickModel(task: TaskLevel, i: RouteInput): ModelRoute | undefined {
  const ok = i.models.filter(m => usableModel(m, i.balances[m.id], i.walletCents));
  if (!ok.length) return undefined;
  const price = (m: SharedModel) => m.priceCentsPerM || 0;
  const cheapest = [...ok].sort((a, b) => modelStrength(a) - modelStrength(b) || price(a) - price(b))[0];
  const strongest = [...ok].sort((a, b) => modelStrength(b) - modelStrength(a) || price(a) - price(b))[0];
  const mid = [...ok].filter(m => modelStrength(m) <= 2).sort((a, b) => modelStrength(b) - modelStrength(a) || price(a) - price(b))[0] || cheapest;
  const def = ok.find(m => m.id === i.defaultId) || cheapest;
  const policy = i.policy || 'balanced';
  const r = (m: SharedModel, why: string): ModelRoute => ({ modelId: m.id, label: m.label, why });
  if (policy === 'save') return task === 'hard' ? r(mid, '难的活，稍微升级') : r(cheapest, '省钱模式，用最便宜的');
  if (policy === 'best') return task === 'simple' ? r(def, '简单的活，用默认模型') : r(strongest, '效果优先，用最强的');
  return task === 'simple' ? r(cheapest, '简单的活，用便宜模型') : task === 'hard' ? r(strongest, '难的活，换最强的模型') : r(def, '一般的活，用默认模型');
}

/** 给界面看：这个策略下三种活各用哪个模型 */
export const routePreview = (i: RouteInput) =>
  (['simple', 'normal', 'hard'] as TaskLevel[]).map(t => ({ task: t, route: pickModel(t, i) }));
