import { permissions, permitted, moneyLimit, commitBudget, demandView, publishDemand, respondDemand, demandAction } from './market-demands.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
const hash = v => createHash('sha256').update(v).digest('hex');
const KEY = hash('hiexplore-service-market-v1');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (v, max, required = true) => {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim())) throw fail('字段为空或超出长度限制');
  return v.trim();
};
const categories = ['printing', 'sensing', 'compute', 'lab', 'human', 'other'];
const context = v => v ? Object.fromEntries(['projectId', 'branchId', 'scopeId'].map(k => [k, text(v[k], 160)])) : null;
const publicService = (s, owner) => {
  const { owner: omitted, contact, tokenId, ...safe } = s;
  return { ...safe, mine: omitted === owner, ...(omitted === owner ? { contact } : {}) };
};
const publicOrder = (o, actor) => {
  const { buyer, seller, tokenId, sellerTokenId, requestKey, requestHash, ...safe } = o;
  return { ...safe, ...(actor.agent ? { buyerContact: '', sellerContact: '' } : {}), ...(seller === actor.owner ? { context: null } : {}), side: buyer === actor.owner ? 'buyer' : 'seller' };
};
const receipt = input => {
  const summary = text(input.summary, 5000), source = text(input.source, 1200);
  // 纯文字交付（比如 AI 写的调研报告）：内容就在摘要里，没有外部链接
  if (source === 'inline') return { summary, source: '', limitation: text(input.limitation, 1200), at: Date.now() };
  if (!/^https:\/\//.test(source)) throw fail('交付依据需要 HTTPS 链接');
  const url = new URL(source);
  if (url.username || url.password) throw fail('交付链接不能包含登录凭据');
  return { summary, source: url.href, limitation: text(input.limitation, 1200), at: Date.now() };
};
/** Single-process, encrypted, atomic marketplace ledger. No funds or device credentials are stored. */
export class ServiceMarket {
  constructor(storage) { this.storage = storage; this.queue = Promise.resolve(); }
  tx(fn, write = false) {
    const next = this.queue.catch(() => {}).then(async () => {
      const stored = await this.storage.credentials(KEY);
      const s = stored.market || { services: [], orders: [], tokens: [] };
      s.demands ||= [];
      const result = await fn(s);
      if (write) await this.storage.credentials(KEY, { market: s });
      return result;
    });
    this.queue = next; return next;
  }
  async authenticate(token) {
    if (!/^hxm_[a-f0-9]{64}$/.test(token)) throw fail('服务接口令牌无效', 401);
    return this.tx(s => {
      const t = s.tokens.find(t => t.hash === hash(token) && !t.revoked && t.expiresAt > Date.now());
      if (!t) throw fail('服务接口令牌已失效', 401);
      return { owner: t.owner, agent: true, tokenId: t.id, name: t.name, context: t.context };
    });
  }
  // Recheck under the write lock: revocation cannot race with creating a new request.
  checkActor(s, actor) {
    if (actor.agent && !s.tokens.some(t => t.id === actor.tokenId && t.owner === actor.owner && !t.revoked && t.expiresAt > Date.now())) throw fail('服务接口令牌已失效', 401);
  }
  /** 运营数据用：原始服务、需求、订单（只读） */
  raw() {
    return this.tx(s => ({ services: s.services.map(x => ({ owner: x.owner, published: x.published, createdAt: x.createdAt, updatedAt: x.updatedAt })),
      demands: s.demands.map(d => ({ owner: d.owner, createdAt: d.createdAt, status: d.status, bids: d.bids.map(b => ({ owner: b.owner })) })),
      orders: s.orders.map(o => ({ buyer: o.buyer, seller: o.seller, status: o.status, totalCents: o.totalCents, createdAt: o.createdAt, tokenId: o.tokenId, sellerTokenId: o.sellerTokenId, requestedBy: o.requestedBy, settlement: { method: o.settlement?.method }, quote: { title: o.quote?.title } })) }));
  }
  view(actor) {
    return this.tx(s => {
      this.checkActor(s, actor);
      const token = actor.agent ? s.tokens.find(t => t.id === actor.tokenId) : null;
      return { settlement: 'external', walletSettlement: true, deviceControl: false,
        agentAuthorization: token ? { permissions: token.permissions || [], maxOrderCents: token.maxOrderCents || 0, remainingQuoteCents: Math.max(0, (token.totalBudgetCents || 0) - (token.committedCents || 0)), expiresAt: token.expiresAt } : null,
        demands: s.demands.filter(d => (d.status === 'open' && d.deadline > Date.now()) || (!actor.anonymous && (d.owner === actor.owner || d.bids.some(b => b.owner === actor.owner)))).map(d => demandView(d, actor)),
        services: s.services.filter(x => x.published || (!actor.agent && !actor.anonymous && x.owner === actor.owner)).map(x => publicService(x, actor.agent || actor.anonymous ? null : actor.owner)),
        // 全站有多少人在挂服务 / 挂需求（不暴露是谁）
        stats: { providers: new Set(s.services.filter(x => x.published).map(x => x.owner)).size, requesters: new Set(s.demands.filter(d => d.status === 'open').map(d => d.owner)).size },
        anonymous: !!actor.anonymous,
        orders: actor.anonymous ? [] : s.orders.filter(o => actor.agent ? ((o.buyer === actor.owner && o.tokenId === actor.tokenId) || (o.seller === actor.owner && o.sellerTokenId === actor.tokenId && !!o.sharedAt)) : o.buyer === actor.owner || (o.seller === actor.owner && !!o.sharedAt)).map(o => publicOrder(o, actor)),
        tokens: actor.agent || actor.anonymous ? [] : s.tokens.filter(t => t.owner === actor.owner).map(({ hash: ignored, owner: ignoredOwner, ...t }) => t) };
    });
  }
  async saveService(actor, input) {
    return this.tx(s => {
      permitted(s, actor, 'service_publish');
      const old = input.id ? s.services.find(x => x.id === input.id && x.owner === actor.owner && (!actor.agent || x.tokenId === actor.tokenId)) : null;
      if (input.id && !old) throw fail('服务不存在', 404);
      if ((old?.revision || 0) !== input.revision) throw fail('服务已变化，请刷新', 409);
      if (!categories.includes(input.category)) throw fail('请选择服务类别');
      if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > 10000000) throw fail('单价必须为 0–100000 元，以分为单位');
      if (!Number.isInteger(input.deliveryDays) || input.deliveryDays < 1 || input.deliveryDays > 365) throw fail('交付时间为 1–365 天');
      if (input.published !== true && input.published !== false) throw fail('请选择上架状态');
      if (input.published && input.confirmed !== true) throw fail('请确认服务能力、报价和公开介绍');
      if (!old && (s.services.length >= 5000 || s.services.filter(x => x.owner === actor.owner).length >= 50)) throw fail('服务数量已达首版上限');
      const value = { id: old?.id || randomUUID(), owner: actor.owner, revision: (old?.revision || 0) + 1,
        tokenId: actor.tokenId || old?.tokenId || null,
        availability: ['always','scheduled','by_appointment'].includes(input.availability) ? input.availability : old?.availability || 'by_appointment',
        automation: ['automatic','assisted','human'].includes(input.automation) ? input.automation : old?.automation || 'human',
        title: text(input.title, 100), providerName: text(input.providerName, 80), category: input.category,
        description: text(input.description, 2500), inputs: text(input.inputs, 1500), deliverables: text(input.deliverables, 1500),
        limits: text(input.limits, 1500), location: text(input.location, 120), contact: text(input.contact || '', 300, !actor.agent),
        unit: text(input.unit, 30), priceCents: input.priceCents, currency: 'CNY', deliveryDays: input.deliveryDays,
        published: input.published, execution: 'provider_confirmed', createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() };
      if (old) s.services[s.services.indexOf(old)] = value; else s.services.push(value);
      return publicService(value, actor.owner);
    }, true);
  }
  async createToken(actor, input) {
    if (actor.agent) throw fail('Agent 令牌不能管理授权', 403);
    return this.tx(s => {
      if (s.tokens.filter(t => t.owner === actor.owner && !t.revoked && t.expiresAt > Date.now()).length >= 10 || s.tokens.length >= 20000) throw fail('请先撤销不用的授权');
      const token = 'hxm_' + randomBytes(32).toString('hex');
      const record = { id: randomUUID(), hash: hash(token), owner: actor.owner, name: text(input.name, 80), context: context(input.context), permissions: Array.isArray(input.permissions) ? [...new Set(input.permissions.filter(p => permissions.includes(p)))] : [], maxOrderCents: moneyLimit(input.maxOrderCents ?? 0), totalBudgetCents: moneyLimit(input.totalBudgetCents ?? 0), committedCents: 0, expiresAt: Date.now() + 30 * 86400000, createdAt: Date.now(), revoked: false };
      s.tokens.push(record);
      return { id: record.id, token, expiresAt: record.expiresAt };
    }, true);
  }
  async revokeToken(actor, id) {
    if (actor.agent) throw fail('Agent 令牌不能管理授权', 403);
    return this.tx(s => { const token = s.tokens.find(t => t.id === id && t.owner === actor.owner); if (!token) throw fail('授权不存在', 404); token.revoked = true; return { revoked: true }; }, true);
  }
  propose(actor, input) {
    return this.tx(s => {
      this.checkActor(s, actor);
      const requestKey = `${actor.owner}:${actor.tokenId || 'human'}:${text(input.requestId, 100)}`;
      const canonical = { serviceId: text(input.serviceId, 80), revision: input.revision, quantity: input.quantity, requirements: text(input.requirements, 5000), acceptance: text(input.acceptance, 1500), context: actor.agent ? actor.context : context(input.context) };
      const requestHash = hash(JSON.stringify(canonical));
      const prior = s.orders.find(o => o.requestKey === requestKey);
      if (prior) { if (prior.requestHash !== requestHash) throw fail('请求编号已用于不同内容', 409); return publicOrder(prior, actor); }
      const service = s.services.find(x => x.id === canonical.serviceId && x.published);
      if (!service) throw fail('服务已下架或不存在', 404);
      if (service.owner === actor.owner) throw fail('不能向自己的服务下单');
      if (canonical.revision !== service.revision) throw fail('报价已更新，请重新查看', 409);
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw fail('数量必须为 1–100');
      if (service.priceCents * input.quantity > 10000000) throw fail('订单总额超过首版上限');
      if (s.orders.length >= 10000 || s.orders.filter(o => o.buyer === actor.owner && !['completed', 'cancelled', 'rejected'].includes(o.status)).length >= 50) throw fail('请先处理已有服务申请');
      const quote = publicService(service, null); delete quote.mine;
      const o = { id: randomUUID(), buyer: actor.owner, seller: service.owner, tokenId: actor.tokenId || null, requestedBy: actor.agent ? actor.name : 'user',
        requestKey, requestHash, serviceId: service.id, quote, sellerContact: '', buyerContact: '', quantity: canonical.quantity, totalCents: service.priceCents * canonical.quantity,
        requirements: canonical.requirements, acceptance: canonical.acceptance, context: canonical.context, status: 'proposed', revision: 1, delivery: null, deliveryVersion: 0,
        settlement: { method: 'external', buyerReportedPaid: false, sellerReportedReceived: false }, history: [{ action: 'propose', by: actor.agent ? 'agent' : 'buyer', at: Date.now() }], createdAt: Date.now(), updatedAt: Date.now(), eventSynced: false };
      s.orders.push(o); return publicOrder(o, actor);
    }, true);
  }
  /** 下单确认前看一眼订单金额（给钱包担保用）。只有买方能看。 */
  peekOrder(actor, id) {
    return this.tx(s => {
      const o = s.orders.find(o => o.id === id && o.buyer === actor.owner);
      return o ? { id: o.id, totalCents: o.totalCents, status: o.status, title: o.quote.title, projectId: o.context?.projectId || (o.tokenId ? s.tokens.find(t => t.id === o.tokenId)?.context?.projectId : null) || null } : null;
    });
  }
  peekBid(actor, demandId, bidId) {
    return this.tx(s => {
      const d = s.demands.find(d => d.id === demandId && d.owner === actor.owner);
      const b = d?.bids.find(b => b.id === bidId);
      return d && b ? { priceCents: b.priceCents, title: d.title, status: d.status, projectId: d.context?.projectId || null } : null;
    });
  }
  /**
   * 钱包担保订单的结算待办：已完成的要放款给卖方、取消/拒绝的要退款给买方。
   * 交付后买方 7 天不验收，自动算验收完成（卖方的钱不会被一直卡住）。
   */
  escrowDue(now = Date.now()) {
    return this.tx(s => {
      let changed = false;
      for (const o of s.orders) {
        if (o.settlement?.method !== 'wallet' || o.settlement.escrowSettled) continue;
        if (o.status === 'delivered' && now - o.updatedAt > 7 * 86400000) {
          o.status = 'completed'; o.revision++; o.updatedAt = now; changed = true;
          o.history.push({ action: 'complete', by: 'system', at: now, note: '交付后 7 天买方未验收，自动完成' });
        }
      }
      return { changed, due: s.orders.filter(o => o.settlement?.method === 'wallet' && !o.settlement.escrowSettled && ['completed', 'cancelled', 'rejected'].includes(o.status))
        .map(o => ({ id: o.id, ref: o.settlement.escrowRef, outcome: o.status === 'completed' ? 'release' : 'refund', seller: o.seller,
          sellerProjectId: (o.sellerTokenId ? s.tokens.find(t => t.id === o.sellerTokenId)?.context?.projectId : null) || null })) };
    }, true);
  }
  /** 这笔担保款有没有挂到某个订单上（下单失败要退款前先确认，防止并发重试把成功订单的钱退掉） */
  hasEscrow(ref) { return this.tx(s => s.orders.some(o => o.settlement?.escrowRef === ref)); }
  markEscrowSettled(id) {
    return this.tx(s => { const o = s.orders.find(o => o.id === id); if (o?.settlement) { o.settlement.escrowSettled = true; o.settlement.settledAt = Date.now(); } }, true);
  }
  async action(actor, id, input, opts = {}) {
    return this.tx(s => {
      this.checkActor(s, actor);
      const o = s.orders.find(o => o.id === id && (o.buyer === actor.owner || (o.seller === actor.owner && !!o.sharedAt)));
      if (!o) throw fail('订单不存在', 404);
      if (actor.agent) {
        const buyerAgent = o.buyer === actor.owner && o.tokenId === actor.tokenId;
        const sellerAgent = o.seller === actor.owner && o.sellerTokenId === actor.tokenId;
        if (!buyerAgent && !sellerAgent) throw fail('Agent 无权操作此订单', 403);
        if (['report_paid', 'confirm_received'].includes(input.action)) throw fail('结算声明需由用户记录', 403);
        permitted(s, actor, buyerAgent ? 'order_commit' : 'order_execute');
      }
      if (o.revision !== input.revision) throw fail('订单已变化，请刷新', 409);
      const buyer = o.buyer === actor.owner, a = input.action;
      const requireState = (side, states) => { if ((side === 'buyer') !== buyer || !states.includes(o.status)) throw fail('当前身份或订单状态不允许此操作', 409); };
      let note = '';
      if (a === 'confirm') {
        requireState('buyer', ['proposed']);
        if (input.confirmed !== true) throw fail('请确认报价及要共享给服务方的需求');
        const service = s.services.find(x => x.id === o.serviceId && x.published);
        if (!service || service.revision !== o.quote.revision) throw fail('服务或报价已变化，请取消后重新申请', 409);
        commitBudget(s, actor, o.totalCents);
        // 用 AI 钱包付款：钱已经由后端从买方钱包扣出并冻结（opts.escrowRef），客户端不能自己声称已付
        if (opts.escrowRef) o.settlement = { method: 'wallet', escrowRef: opts.escrowRef, escrowSettled: false };
        o.sellerTokenId = service.tokenId || null;
        o.buyerContact = text(input.contact || '', 300, !actor.agent); o.sharedAt = Date.now(); o.sellerContact = service.contact; o.status = 'requested';
      } else if (a === 'accept') { requireState('seller', ['requested']); o.status = 'accepted'; }
      else if (a === 'reject') { requireState('seller', ['requested']); note = text(input.note, 1200); o.status = 'rejected'; }
      else if (a === 'cancel') {
        if (!['proposed', 'requested', 'accepted', 'delivered'].includes(o.status)) throw fail('订单不能取消', 409);
        // 钱包担保的订单：卖方接单后，买方不能单方面取消把钱拿回去；有争议走验收 / 返工或联系平台
        if (o.settlement?.method === 'wallet' && buyer && !['proposed', 'requested'].includes(o.status)) throw fail('服务方已接单，钱包担保订单不能由买方取消；请验收或要求返工，有争议联系平台', 409);
        note = text(input.note, 1200); o.status = 'cancelled'; // Cancellation is never a refund claim.
      } else if (a === 'deliver') { requireState('seller', ['accepted']); o.delivery = receipt(input); o.deliveryVersion++; o.eventSynced = false; o.status = 'delivered'; }
      else if (a === 'rework') { requireState('buyer', ['delivered']); note = text(input.note, 1200); o.status = 'accepted'; }
      else if (a === 'complete') { requireState('buyer', ['delivered']); note = text(input.note, 1200); o.status = 'completed'; }
      else if ((a === 'report_paid' || a === 'confirm_received') && o.settlement?.method === 'wallet') throw fail('这单用 AI 钱包担保付款，验收后自动结算，不需要线下确认', 409);
      else if (a === 'report_paid') { requireState('buyer', ['accepted', 'delivered', 'completed']); o.settlement.buyerReportedPaid = true; }
      else if (a === 'confirm_received') { requireState('seller', ['accepted', 'delivered', 'completed']); o.settlement.sellerReportedReceived = true; }
      else throw fail('未知订单操作');
      if (o.history.length >= 100) throw fail('订单记录过多，请联系管理员');
      o.revision++; o.updatedAt = Date.now();
      o.history.push({ action: a, by: buyer ? 'buyer' : 'seller', at: o.updatedAt, ...(note ? { note } : {}), ...(a === 'deliver' ? { delivery: o.delivery } : {}) });
      return publicOrder(o, actor);
    }, true);
  }
  publishDemand(actor, input) { return this.tx(s => { this.checkActor(s, actor); return publishDemand(s, actor, input); }, true); }
  respondDemand(actor, id, input) { return this.tx(s => { this.checkActor(s, actor); return respondDemand(s, actor, id, input); }, true); }
  demandAction(actor, id, input, opts = {}) { return this.tx(s => { this.checkActor(s, actor); return demandAction(s, actor, id, input, opts); }, true); }
  async flushDeliveries(enqueue) {
    const pending = await this.tx(s => s.orders.filter(o => ['delivered', 'completed'].includes(o.status) && o.context && !o.eventSynced).map(o => ({ ...o })));
    for (const o of pending) {
      // Idempotent event identity survives a crash between enqueue and acknowledgment.
      if (!await enqueue(o)) continue;
      await this.tx(s => { const current = s.orders.find(x => x.id === o.id); if (current && current.deliveryVersion === o.deliveryVersion) current.eventSynced = true; }, true);
    }
  }
}
