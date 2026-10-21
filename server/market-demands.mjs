import { createHash, randomUUID } from 'node:crypto';
const fail = (s, status = 400) => Object.assign(new Error(s), { status });
const text = (s, max) => { if (typeof s !== 'string' || !s.trim() || s.length > max) throw fail('需求字段为空或过长'); return s.trim(); };
export const permissions = ['demand_publish', 'demand_respond', 'service_publish', 'order_execute', 'order_commit'];
export function permitted(s, actor, permission) {
  if (!actor.agent) return;
  const t = s.tokens.find(t => t.id === actor.tokenId && t.owner === actor.owner && !t.revoked && t.expiresAt > Date.now());
  if (!t) throw fail('Agent 授权已失效', 401);
  if (!t.permissions?.includes(permission)) throw fail('该 Agent 未获此项市场权限', 403);
}
export function moneyLimit(n) { if (!Number.isSafeInteger(n) || n < 0 || n > 10000000) throw fail('金额须为 0–10000000 整数分'); return n; }
export function commitBudget(s, actor, cents) {
  permitted(s, actor, 'order_commit');
  if (!actor.agent) return;
  const t = s.tokens.find(t => t.id === actor.tokenId);
  if (cents > t.maxOrderCents || (t.committedCents || 0) + cents > t.totalBudgetCents) throw fail('超出 Agent 授权的订单报价额度', 409);
  t.committedCents = (t.committedCents || 0) + cents;
}
export function demandView(d, actor) {
  const mine = d.owner === actor.owner && (!actor.agent || d.tokenId === actor.tokenId);
  const { owner, tokenId, context, requestKey, requestHash, bids, ...safe } = d;
  return { ...safe, mine, context: mine ? context : null, bidCount: bids.length,
    bids: bids.filter(b => mine || (b.owner === actor.owner && (!actor.agent || b.tokenId === actor.tokenId))).map(({ owner, tokenId, contact, ...b }) => ({ ...b, mine: owner === actor.owner && (!actor.agent || tokenId === actor.tokenId) })) };
}
export function publishDemand(s, actor, input) {
  permitted(s, actor, 'demand_publish');
  if (input.confirmed !== true) throw fail('请确认需求内容可公开，不包含项目私密资料');
  const value = { title: text(input.title, 100), requirements: text(input.requirements, 5000), acceptance: text(input.acceptance, 1500), budgetCents: moneyLimit(input.budgetCents), deadline: Number(input.deadline), context: actor.agent ? actor.context : input.context || null };
  if (value.context && !['projectId','branchId','scopeId'].every(k => typeof value.context[k] === 'string' && value.context[k].trim() && value.context[k].length <= 160)) throw fail('项目范围无效');
  if (!Number.isFinite(value.deadline) || value.deadline <= Date.now() || value.deadline > Date.now() + 365 * 86400000) throw fail('截止时间应在未来一年内');
  const requestKey = `${actor.owner}:${actor.tokenId || 'human'}:${text(input.requestId, 100)}`, requestHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const old = s.demands.find(d => d.requestKey === requestKey);
  if (old) { if (old.requestHash !== requestHash) throw fail('请求编号内容冲突', 409); return demandView(old, actor); }
  if (s.demands.length >= 5000 || s.demands.filter(d => d.owner === actor.owner && d.status === 'open').length >= 30) throw fail('请先处理已有需求');
  const d = { ...value, id: randomUUID(), owner: actor.owner, tokenId: actor.tokenId || null, requestedBy: actor.agent ? actor.name : 'user', requestKey, requestHash, status: 'open', revision: 1, bids: [], createdAt: Date.now() };
  s.demands.push(d); return demandView(d, actor);
}
export function respondDemand(s, actor, id, input) {
  permitted(s, actor, 'demand_respond');
  const d = s.demands.find(d => d.id === id);
  if (!d || d.status !== 'open' || d.deadline <= Date.now()) throw fail('需求已关闭或过期', 409);
  if (d.owner === actor.owner) throw fail('不能响应自己的需求');
  const prior = d.bids.find(b => b.owner === actor.owner && b.tokenId === (actor.tokenId || null));
  const proposal = text(input.proposal, 2500), priceCents = moneyLimit(input.priceCents), deliveryDays = Number(input.deliveryDays);
  const contact = input.contact === undefined || input.contact === '' ? '' : text(input.contact, 300);
  if (prior) { if (prior.proposal === proposal && prior.priceCents === priceCents && prior.deliveryDays === deliveryDays && (prior.contact || '') === contact) return demandView(d, actor); throw fail('已提交方案，首版不支持修改报价', 409); }
  if (d.bids.length >= 50 || priceCents > d.budgetCents || !Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 365) throw fail('报价、交期无效或方案数量已满');
  if (input.confirmed !== true) throw fail('请确认具备履约能力且此方案可被委托方选中');
  d.bids.push({ id: randomUUID(), owner: actor.owner, tokenId: actor.tokenId || null, providerName: actor.agent ? actor.name : text(input.providerName, 80), contact, proposal, priceCents, deliveryDays, createdAt: Date.now() });
  d.revision++; return demandView(d, actor);
}
export function demandAction(s, actor, id, input, opts = {}) {
  const d = s.demands.find(d => d.id === id && d.owner === actor.owner && (!actor.agent || d.tokenId === actor.tokenId));
  if (!d) throw fail('需求不存在', 404);
  if (input.revision !== d.revision || d.status !== 'open') throw fail('需求已变化，请刷新', 409);
  if (input.action === 'close') { permitted(s, actor, 'demand_publish'); d.status = 'closed'; d.revision++; return demandView(d, actor); }
  if (input.action !== 'award' || input.confirmed !== true) throw fail('请确认选择接单方案');
  if (d.deadline <= Date.now()) throw fail('需求已过期', 409);
  const b = d.bids.find(b => b.id === input.bidId);
  if (!b) throw fail('方案不存在', 404);
  const buyerContact = input.contact === undefined || input.contact === '' ? '' : text(input.contact, 300);
  if (s.orders.length >= 10000 || s.orders.filter(o => o.buyer === actor.owner && !['completed','cancelled','rejected'].includes(o.status)).length >= 50) throw fail('请先处理已有订单');
  commitBudget(s, actor, b.priceCents);
  const at = Date.now();
  const o = { id: randomUUID(), revision: 1, buyer: d.owner, seller: b.owner, tokenId: d.tokenId, sellerTokenId: b.tokenId, requestedBy: d.requestedBy, demandId: d.id, serviceId: null,
    quote: { title: d.title, providerName: b.providerName, description: b.proposal, deliverables: d.acceptance, limits: '以接单方案及验收标准为准', deliveryDays: b.deliveryDays, priceCents: b.priceCents, unit: '任务', currency: 'CNY' },
    buyerContact, sellerContact: b.contact || '', quantity: 1, totalCents: b.priceCents, requirements: d.requirements, acceptance: d.acceptance, context: d.context, status: 'accepted', sharedAt: at,
    delivery: null, deliveryVersion: 0, eventSynced: false, settlement: opts.escrowRef ? { method: 'wallet', escrowRef: opts.escrowRef, escrowSettled: false } : { method: 'external', buyerReportedPaid: false, sellerReportedReceived: false },
    history: [{ action: 'award', by: actor.agent ? 'agent' : 'buyer', at }], createdAt: at, updatedAt: at };
  s.orders.push(o); d.status = 'awarded'; d.orderId = o.id; d.revision++; return demandView(d, actor);
}
