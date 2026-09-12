import type { ProblemHeartbeat } from './problemHeartbeat';
import type { AgentProfile } from './agentProfiles';
import type { InquiryRole } from './inquiry';

export type WakeStatus = 'sleeping' | 'checking' | 'researching' | 'needs_user' | 'blocked' | 'paused';
export interface WakeContext {
  projectId: string; branchId: string; scopeId: string; question: string; background: string;
  language?: 'zh-CN' | 'en';
  facts: { id: string; claim: string; source: string; excerpt: string; scope: string; status: string }[];
  agents: Partial<Record<InquiryRole, AgentProfile>>;
}
export interface WakeEvent {
  id: string; kind: 'input' | 'paper' | 'evidence' | 'manual' | 'review'; title: string; body: string; source: string;
  at: number; status: 'pending' | 'consumed'; runId?: string;
}
export interface WakePolicy {
  enabled: boolean; checkEveryHours: number; reviewEveryDays: number;
  maxCallsPerDay: number; maxCallsPerWake: number; maxOutputTokens: number; paperQuery: string;
}
export interface WakeStep { role: InquiryRole; purpose: string; result?: string; startedAt: number; completedAt?: number }
export interface WakeRun {
  id: string; eventIds: string[]; startedAt: number; completedAt?: number;
  contextSnapshot?: WakeContext;
  memoryChanges?: { added: string[]; withdrawn: string[]; updated: string[] };
  outcome: 'running' | 'progress' | 'waiting' | 'failed' | 'interrupted';
  reason: string; summary?: string; next?: string; steps: WakeStep[];
  /** Findings remain research records until separately verified. */
  findings?: { claim: string; evidenceIds: string[]; kind: 'hypothesis' | 'limitation' | 'plan' | 'observation' }[];
}
export interface Awakening {
  version: 1; problemHeartbeat?: ProblemHeartbeat; context: WakeContext; policy: WakePolicy; status: WakeStatus; reason: string;
  events: WakeEvent[]; runs: WakeRun[]; checks: number; quietChecks: number;
  nextCheckAt: number; nextReviewAt: number; updatedAt: number; heartbeatAt?: number;
  budget: { day: string; calls: number }; activeRunId?: string; contextVersion: number;
}
export const WAKE_DEFAULTS: WakePolicy = { enabled: false, checkEveryHours: 24, reviewEveryDays: 7, maxCallsPerDay: 12, maxCallsPerWake: 5, maxOutputTokens: 2048, paperQuery: '' };
export const WAKE_LABELS: Record<WakeStatus, string> = { sleeping: '睡眠中', checking: '检查线索', researching: '探索中', needs_user: '需要你', blocked: '运行受阻', paused: '已暂停' };
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
export function createAwakening(context: WakeContext, now = Date.now()): Awakening {
  return { version: 1, context, policy: { ...WAKE_DEFAULTS }, status: 'paused', reason: '尚未开启后台研究', events: [], runs: [], checks: 0, quietChecks: 0, nextCheckAt: now, nextReviewAt: now + 7 * 86400000, updatedAt: now, budget: { day: utcDay(now), calls: 0 }, contextVersion: 1 };
}
export function wakePolicy(input: Partial<WakePolicy>, old = WAKE_DEFAULTS): WakePolicy {
  const integer = (v: unknown, fallback: number, low: number, high: number) => { if (v === undefined) return fallback; if (!Number.isInteger(v) || Number(v) < low || Number(v) > high) throw new Error(`数值必须是 ${low}–${high} 之间的整数`); return Number(v); };
  return { enabled: input.enabled === undefined ? old.enabled : input.enabled === true,
    checkEveryHours: integer(input.checkEveryHours, old.checkEveryHours, 1, 168), reviewEveryDays: integer(input.reviewEveryDays, old.reviewEveryDays, 1, 30),
    maxCallsPerDay: integer(input.maxCallsPerDay, old.maxCallsPerDay, 4, 100), maxCallsPerWake: integer(input.maxCallsPerWake, old.maxCallsPerWake, 4, 8),
    maxOutputTokens: integer(input.maxOutputTokens, old.maxOutputTokens, 512, 4096), paperQuery: typeof input.paperQuery === 'string' ? input.paperQuery.trim().slice(0, 300) : old.paperQuery };
}
export function configureAwakening(state: Awakening, input: Partial<WakePolicy>, now: number): Awakening {
  const policy = wakePolicy(input, state.policy);
  return { ...state, policy, status: policy.enabled ? (state.activeRunId ? 'researching' : 'sleeping') : 'paused',
    reason: policy.enabled ? '等待线索或下一次检查' : '用户主动暂停，当前请求返回后停止', updatedAt: now,
    nextCheckAt: policy.paperQuery !== state.policy.paperQuery ? now : policy.checkEveryHours !== state.policy.checkEveryHours ? now + policy.checkEveryHours * 3600000 : state.nextCheckAt,
    nextReviewAt: policy.reviewEveryDays !== state.policy.reviewEveryDays ? now + policy.reviewEveryDays * 86400000 : state.nextReviewAt };
}
export function enqueueWake(state: Awakening, event: WakeEvent): Awakening {
  if (state.events.some(e => e.id === event.id)) return state;
  if (state.events.length >= 2000) throw new Error('线索收件箱已达 2000 条，请导出历史后归档，后台已停止继续收集');
  return { ...state, events: [...state.events, event], updatedAt: event.at };
}
export function availableCalls(state: Awakening, now: number) {
  return Math.max(0, state.policy.maxCallsPerDay - (state.budget.day === utcDay(now) ? state.budget.calls : 0));
}
export function reserveWakeCall(state: Awakening, runId: string, role: InquiryRole, purpose: string, now: number): Awakening {
  const run = state.runs.find(r => r.id === runId);
  if (!state.policy.enabled || state.activeRunId !== runId || !run || run.outcome !== 'running') throw new Error('研究已暂停或运行已结束');
  if (availableCalls(state, now) < 1 || run.steps.length >= state.policy.maxCallsPerWake) throw new Error('本次研究或今日模型调用预算已用完');
  return { ...state, budget: { day: utcDay(now), calls: (state.budget.day === utcDay(now) ? state.budget.calls : 0) + 1 }, heartbeatAt: now, updatedAt: now,
    runs: state.runs.map(r => r.id === runId ? { ...r, steps: [...r.steps, { role, purpose, startedAt: now }] } : r) };
}
export function recoverAwakening(state: Awakening, now: number): Awakening {
  if (!state.activeRunId) return state;
  return { ...state, policy: { ...state.policy, enabled: false }, status: 'blocked', reason: '执行器重启：上次请求可能已发送。检查记录后重新开启，避免重复调用。', activeRunId: undefined, updatedAt: now,
    runs: state.runs.map(r => r.id === state.activeRunId ? { ...r, outcome: 'interrupted', completedAt: now, next: '核对未返回的请求后手动恢复' } : r) };
}
export function visibleWakeStatus(state: Awakening | undefined, connected: boolean, now = Date.now()): { status: WakeStatus; label: string; active: boolean } {
  if (!connected && state?.policy.enabled) return { status: 'blocked', label: '云端连接中断，状态待确认', active: false };
  if (!state) return { status: 'sleeping', label: '睡眠中 · 尚未接入后台', active: false };
  const active = ['checking', 'researching'].includes(state.status) && !!state.heartbeatAt && now - state.heartbeatAt < 90000;
  if (['checking', 'researching'].includes(state.status) && !active) return { status: 'blocked', label: '执行器心跳过期', active: false };
  return { status: state.status, label: WAKE_LABELS[state.status], active };
}
