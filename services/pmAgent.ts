import type { Project, ProjectCharter, ProblemNode } from '../types';
import { marketRequest, marketRequestAs, type MarketRequest, type MarketState, type ServiceListing } from './serviceMarket';
import { matchServices, demandDraftFromSeek, type HelpSeek } from './factHelp';

/**
 * AI 项目经理在服务广场里做事：
 * - 买：卡在现实那一步 → 找能做的服务，价格在「花钱权限」内就用 AI 钱包担保下单；找不到就发布需求。
 * - 卖：项目打开「允许 AI 接单」→ 挑 AI 自己能完成的需求（调研、整理、写作），报价接单；
 *   被选中后自己做完交付，买方验收后钱进 AI 钱包（只能在平台内花）。
 *
 * 权限不靠前端自觉：AI 用的是一个**项目专属的 Agent 令牌**，单笔上限、总额度、能做哪些事都写在令牌里，
 * 由后端在每次下单时卡死。花钱权限一改，令牌就换一个。
 */

export interface PmToken { id: string; token: string; maxOrderCents: number; totalBudgetCents: number; permissions: string[]; expiresAt: number; projectId: string }
const KEY = (projectId: string) => `hx-pm-agent:${projectId}`;

export const readPmToken = (projectId: string): PmToken | null => {
  try { const t = JSON.parse(localStorage.getItem(KEY(projectId)) || 'null'); return t && t.expiresAt > Date.now() + 3600_000 ? t : null; } catch { return null; }
};
const writePmToken = (t: PmToken | null, projectId: string) => {
  try { if (t) localStorage.setItem(KEY(projectId), JSON.stringify(t)); else localStorage.removeItem(KEY(projectId)); } catch { /* 隐私模式等：下次再建 */ }
};

/** 花钱权限 → 令牌应有的权限和额度 */
export function pmGrant(c: ProjectCharter | undefined) {
  const maxOrderCents = Math.max(0, Math.round((c?.autoBuyCNY || 0) * 100));
  const totalBudgetCents = maxOrderCents ? Math.round((c?.monthlyCNY || (c?.autoBuyCNY || 0) * 10) * 100) : 0;
  const permissions = [
    ...(maxOrderCents > 0 ? ['order_commit', 'demand_publish'] : []),
    ...(c?.allowJobs ? ['demand_respond', 'order_execute'] : []),
  ];
  return { maxOrderCents, totalBudgetCents, permissions };
}
const same = (a: PmToken, g: ReturnType<typeof pmGrant>) => a.maxOrderCents === g.maxOrderCents && a.totalBudgetCents === g.totalBudgetCents && [...a.permissions].sort().join() === [...g.permissions].sort().join();

/**
 * 确保这个项目有一个和花钱权限一致的 AI 令牌；权限是 0 就收回令牌。
 * 只能由登录用户本人（浏览器里）创建，令牌只存在这台电脑上。
 */
export async function ensurePmToken(project: Project, request: MarketRequest = marketRequest): Promise<PmToken | null> {
  const g = pmGrant(project.charter);
  const old = readPmToken(project.id);
  if (old && same(old, g)) return old;
  if (old) { await request(`/tokens/${old.id}/revoke`, 'POST', {}).catch(() => {}); writePmToken(null, project.id); }
  if (!g.permissions.length) return null;
  const context = { projectId: project.id, branchId: project.worktree?.activeBranchId || 'main', scopeId: 'root' };
  const r = await request<{ id: string; token: string; expiresAt: number }>('/tokens', 'POST', { name: `AI 项目经理 · ${project.name}`.slice(0, 80), context, permissions: g.permissions, maxOrderCents: g.maxOrderCents, totalBudgetCents: g.totalBudgetCents });
  const t: PmToken = { id: r.id, token: r.token, expiresAt: r.expiresAt, projectId: project.id, ...g };
  writePmToken(t, project.id);
  return t;
}

export type BuyResult =
  | { kind: 'order'; title: string; priceCents: number; provider: string; orderId: string }
  | { kind: 'demand'; title: string; budgetCents: number; demandId: string }
  | { kind: 'none'; reason: string };

/** 把卡住的那一步变成一件要在现实里做的事 */
export const seekFromNode = (project: Project, node: ProblemNode): HelpSeek => ({
  factId: node.id, claim: node.hypothesis?.unknown || node.hypothesis?.statement || node.title, scope: '', source: '', question: node.title, projectId: project.id, task: true,
});

/**
 * 买：先找现成的服务（价格不超过单笔权限，选最便宜的），用钱包担保下单；
 * 没有就发布需求，预算 = 单笔权限。全部通过 AI 自己的令牌，后端卡额度。
 */
export async function pmBuyOrPost(project: Project, node: ProblemNode, pm: PmToken, as: MarketRequest = marketRequestAs(pm.token)): Promise<BuyResult> {
  if (!pm.permissions.includes('order_commit')) return { kind: 'none', reason: '花钱权限是 0：先问你' };
  const seek = seekFromNode(project, node);
  const draft = demandDraftFromSeek(seek);
  const state = await as<MarketState>('/state');
  const already = (state.demands || []).find(d => d.mine && d.title === draft.title && d.status === 'open');
  if (already) return { kind: 'demand', title: already.title, budgetCents: already.budgetCents, demandId: already.id };
  const affordable = matchServices(state.services, seek, 10).filter((s: ServiceListing) => s.priceCents > 0 && s.priceCents <= pm.maxOrderCents).sort((a, b) => a.priceCents - b.priceCents);
  const pick = affordable[0];
  if (pick) {
    const o = await as<{ id: string; revision: number }>('/requests', 'POST', { requestId: crypto.randomUUID(), serviceId: pick.id, revision: pick.revision, quantity: 1, requirements: draft.requirements, acceptance: draft.acceptance });
    try { await as(`/orders/${o.id}/action`, 'POST', { revision: o.revision, action: 'confirm', confirmed: true, pay: 'wallet' }); }
    catch (e) {
      // 没付成（多半是钱包余额不够）：把刚建的申请撤掉，不留一个挂着的单
      await as(`/orders/${o.id}/action`, 'POST', { revision: o.revision, action: 'cancel', note: 'AI 钱包余额不足，未下单' }).catch(() => {});
      throw e;
    }
    return { kind: 'order', title: pick.title, priceCents: pick.priceCents, provider: pick.providerName, orderId: o.id };
  }
  if (!pm.permissions.includes('demand_publish')) return { kind: 'none', reason: '没有合适的服务，也没有发布需求的权限' };
  const d = await as<{ id: string }>('/demands', 'POST', { requestId: `pm-${node.id}`.slice(0, 100).padEnd(16, '0'), title: draft.title, requirements: draft.requirements, acceptance: draft.acceptance, budgetCents: pm.maxOrderCents, deadline: Date.now() + 7 * 86400000, confirmed: true });
  return { kind: 'demand', title: draft.title, budgetCents: pm.maxOrderCents, demandId: d.id };
}

// ===== 卖：接单赚钱 =====

type LLM = (messages: { role: string; content: string }[], json?: boolean) => Promise<string>;

export interface Bid { demandId: string; proposal: string; priceCents: number; deliveryDays: number }

/** 让 AI 挑它能独立完成的需求（只做调研 / 整理 / 写作 / 分析，不碰需要真人、设备、线下的），最多 2 个 */
export async function pmPickJobs(state: MarketState, llm: LLM, skills: string): Promise<Bid[]> {
  const open = (state.demands || []).filter(d => !d.mine && d.status === 'open' && d.deadline > Date.now() + 86400000 && d.budgetCents > 0 && !d.bids.some(b => b.mine)).slice(0, 12);
  if (!open.length) return [];
  const prompt = `你是一个 AI 项目经理，可以在服务广场接单赚钱。你只能完成**纯 AI 能做的**任务：资料调研、信息整理、写作、方案、分析。
不能接：需要真人到场、打电话、做实验、用设备、提供真实数据或签字盖章的任务。宁可不接，也不要接了做不好。
你擅长的领域：${skills || '通用调研与写作'}

开放的需求：
${open.map((d, i) => `${i + 1}. [${d.id}] ${d.title}（预算 ¥${(d.budgetCents / 100).toFixed(0)}）\n要求：${d.requirements.slice(0, 300)}\n验收：${d.acceptance.slice(0, 200)}`).join('\n\n')}

只返回 JSON：{"bids":[{"demandId":"","proposal":"怎么做、交付什么、做不到什么（100-300字）","priceYuan":数字,"deliveryDays":1-7}]}
最多 2 个；报价不超过预算，按工作量实事求是；不能做就返回空数组。`;
  let parsed: any;
  try { const raw = await llm([{ role: 'user', content: prompt }], true); parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return []; }
  const byId = new Map(open.map(d => [d.id, d]));
  return (Array.isArray(parsed?.bids) ? parsed.bids : []).flatMap((b: any) => {
    const d = byId.get(String(b?.demandId || ''));
    const price = Math.round(Number(b?.priceYuan) * 100);
    const days = Math.round(Number(b?.deliveryDays));
    const proposal = String(b?.proposal || '').trim().slice(0, 2400);
    if (!d || !proposal || !Number.isFinite(price) || price <= 0 || price > d.budgetCents || !(days >= 1 && days <= 30)) return [];
    return [{ demandId: d.id, proposal: `【AI 项目经理接单 · 纯 AI 完成】${proposal}`, priceCents: price, deliveryDays: days }];
  }).slice(0, 2);
}

/** 被选中的单：AI 自己做完，交付（摘要里就是交付内容），等买方验收 */
export async function pmDeliver(state: MarketState, llm: LLM, as: MarketRequest): Promise<{ title: string; priceCents: number }[]> {
  const todo = state.orders.filter(o => o.side === 'seller' && o.status === 'accepted');
  const done: { title: string; priceCents: number }[] = [];
  for (const o of todo.slice(0, 2)) {
    const prompt = `你接了一个服务广场的单，现在把它做完。
任务：${o.quote.title}
要求：${o.requirements}
验收标准：${o.acceptance}
你的接单方案：${o.quote.description}

直接给出交付内容（Markdown，不超过 4000 字），要具体、能直接用；资料来源写清楚，不确定的标明「待核实」。最后一段写「局限」：哪些没做到、为什么。`;
    const text = (await llm([{ role: 'user', content: prompt }])).trim();
    if (!text) continue;
    const limIdx = text.lastIndexOf('局限');
    const limitation = (limIdx > 0 ? text.slice(limIdx).replace(/^局限[：:\s]*/, '') : '由 AI 完成，资料需买方核实').slice(0, 1100) || '由 AI 完成，资料需买方核实';
    await as(`/orders/${o.id}/action`, 'POST', { revision: o.revision, action: 'deliver', summary: text.slice(0, 4900), source: 'inline', limitation });
    done.push({ title: o.quote.title, priceCents: o.totalCents });
  }
  return done;
}

/** 一轮接单：先交付已中标的，再去投新的 */
export async function pmWorkJobs(pm: PmToken, llm: LLM, skills: string, as: MarketRequest = marketRequestAs(pm.token)) {
  if (!pm.permissions.includes('demand_respond')) return { delivered: [], bids: [] as Bid[] };
  const state = await as<MarketState>('/state');
  const delivered = pm.permissions.includes('order_execute') ? await pmDeliver(state, llm, as) : [];
  const bids = await pmPickJobs(state, llm, skills);
  const placed: Bid[] = [];
  for (const b of bids) {
    try { await as(`/demands/${b.demandId}/respond`, 'POST', { proposal: b.proposal, priceCents: b.priceCents, deliveryDays: b.deliveryDays, confirmed: true }); placed.push(b); } catch { /* 被别人抢先 / 已关闭：跳过 */ }
  }
  return { delivered, bids: placed };
}
