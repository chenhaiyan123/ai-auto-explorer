import { createHash } from 'node:crypto';

/**
 * 运营数据（给自己和投资人看的真实数字）。
 *
 * 只读、只统计已经发生的事，不估算、不补数：
 * - 用户：登录服务不存用户表，所以「用户」= 用邮箱登录后真正访问过后台的人（从这一版开始逐日记录），
 *   再用钱包、模型调用、服务广场里出现过的账号把以前的补上（补上的只有「首次出现」，没有逐日活跃）。
 * - 钱：只算真实支付成功的充值订单（status=paid）、真实发生的钱包流水、服务广场里真实创建的订单。
 * - 内部账号（管理员、METRICS_EXCLUDE 里列的、测试域名）默认剔除，可以切换成「包含内部账号」看全量。
 */

const REGISTRY = createHash('sha256').update('hiexplore-user-registry-v1').digest('hex');
const DAY = 86400000;
/** 按北京时间算「哪一天」 */
export const cnDay = at => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
const KEEP_DAYS = 120;

export class UserRegistry {
  constructor(storage) { this.storage = storage; this.pending = new Map(); this.queue = Promise.resolve(); }
  /** 记一次「这个人今天来过」（只进内存，定期落盘） */
  seen(owner, kind = 'visit', at = Date.now()) {
    if (typeof owner !== 'string' || !owner || owner.startsWith('anonymous:')) return;
    const p = this.pending.get(owner) || { first: at, last: at, days: new Set(), kinds: new Set() };
    p.last = Math.max(p.last, at); p.first = Math.min(p.first, at); p.days.add(cnDay(at)); p.kinds.add(kind);
    this.pending.set(owner, p);
  }
  async flush() {
    if (!this.pending.size) return;
    const batch = this.pending; this.pending = new Map();
    this.queue = this.queue.catch(() => {}).then(async () => {
      const s = (await this.storage.credentials(REGISTRY)) || {};
      const users = s.users || {};
      for (const [owner, p] of batch) {
        const u = users[owner] || { first: p.first, last: p.last, days: [], kinds: [] };
        u.first = Math.min(u.first, p.first); u.last = Math.max(u.last, p.last);
        u.days = [...new Set([...u.days, ...p.days])].sort().slice(-KEEP_DAYS);
        u.kinds = [...new Set([...(u.kinds || []), ...p.kinds])];
        users[owner] = u;
      }
      await this.storage.credentials(REGISTRY, { version: 1, users });
    });
    return this.queue;
  }
  async read() { await this.flush(); await this.queue.catch(() => {}); return ((await this.storage.credentials(REGISTRY)) || {}).users || {}; }
}

const internalTest = (owner, internal) => internal.has(owner) || /@(example\.(test|com)|test\.local)$/i.test(owner) || owner === 'development';

/**
 * 算数（纯函数，方便单测）。
 * raw: { users, billing, shared, market }，都是各模块的原始状态。
 */
export function computeMetrics(raw, { internal = new Set(), includeInternal = false, now = Date.now(), days = 30 } = {}) {
  const keep = owner => !!owner && (includeInternal || !internalTest(owner, internal));
  const billing = raw.billing || { orders: [], walletTx: [] };
  const shared = raw.shared || { calls: [] };
  const market = raw.market || { services: [], orders: [], demands: [] };

  // ===== 用户 =====
  const people = new Map(); // owner -> { first, last, days:Set, tracked }
  const touch = (owner, at, tracked = false, dayList) => {
    if (!keep(owner) || !Number.isFinite(at)) return;
    const p = people.get(owner) || { first: at, last: at, days: new Set(), tracked: false };
    p.first = Math.min(p.first, at); p.last = Math.max(p.last, at); p.tracked ||= tracked;
    for (const d of dayList || [cnDay(at)]) p.days.add(d);
    people.set(owner, p);
  };
  for (const [owner, u] of Object.entries(raw.users || {})) touch(owner, u.first, true, u.days), touch(owner, u.last, true, []);
  for (const o of billing.orders || []) touch(o.owner, o.createdAt);
  for (const t of billing.walletTx || []) touch(t.owner, t.at);
  for (const c of shared.calls || []) touch(c.owner, c.at);
  for (const s of market.services || []) touch(s.owner, s.createdAt || s.updatedAt);
  for (const d of market.demands || []) touch(d.owner, d.createdAt);
  for (const o of market.orders || []) { touch(o.buyer, o.createdAt); touch(o.seller, o.createdAt); }

  const since = d => now - d * DAY;
  const activeIn = d => [...people.values()].filter(p => [...p.days].some(x => x >= cnDay(since(d)))).length;
  const usedAI = new Set((shared.calls || []).filter(c => keep(c.owner) && c.status !== 'failed').map(c => c.owner));
  const paidOrders = (billing.orders || []).filter(o => o.status === 'paid' && keep(o.owner));
  const payers = new Map();
  for (const o of paidOrders) payers.set(o.owner, (payers.get(o.owner) || 0) + 1);
  const marketUsers = new Set([...(market.services || []).map(s => s.owner), ...(market.demands || []).map(d => d.owner), ...(market.orders || []).flatMap(o => [o.buyer, o.seller])].filter(keep));
  // 次日 / 7 日留存：只看有逐日记录的人（从这一版开始才有）
  const tracked = [...people.values()].filter(p => p.tracked);
  const cohort = (gap) => {
    const eligible = tracked.filter(p => p.first <= now - gap * DAY);
    if (!eligible.length) return null;
    const back = eligible.filter(p => [...p.days].some(d => d > cnDay(p.first) && d <= cnDay(p.first + gap * DAY + DAY)));
    return { base: eligible.length, back: back.length };
  };

  const series = (fn) => {
    const out = [];
    for (let i = days - 1; i >= 0; i--) { const d = cnDay(now - i * DAY); out.push({ day: d, ...fn(d) }); }
    return out;
  };
  const users = {
    total: people.size,
    new7: [...people.values()].filter(p => p.first >= since(7)).length,
    new30: [...people.values()].filter(p => p.first >= since(30)).length,
    dau: activeIn(1), wau: activeIn(7), mau: activeIn(30),
    usedAI: usedAI.size,
    market: marketUsers.size,
    payers: payers.size,
    repeatPayers: [...payers.values()].filter(n => n >= 2).length,
    retentionD1: cohort(1), retentionD7: cohort(7),
    trackedSince: tracked.length ? Math.min(...tracked.map(p => p.first)) : null,
    daily: series(d => ({ newUsers: [...people.values()].filter(p => cnDay(p.first) === d).length, active: [...people.values()].filter(p => p.days.has(d)).length })),
  };

  // ===== 钱 =====
  const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);
  const topups = paidOrders.filter(o => o.sku === 'topup');
  const subs = paidOrders.filter(o => o.sku !== 'topup');
  const tx = (billing.walletTx || []).filter(t => keep(t.owner));
  const mOrders = (market.orders || []).filter(o => keep(o.buyer) || keep(o.seller));
  const live = mOrders.filter(o => ['requested', 'accepted', 'delivered', 'completed'].includes(o.status));
  const done = mOrders.filter(o => o.status === 'completed');
  const byAI = o => !!o.tokenId || (o.requestedBy && o.requestedBy !== 'user');
  const sellerAI = o => !!o.sellerTokenId;
  const demands = (market.demands || []).filter(d => keep(d.owner));
  const money = {
    paidOrders: paidOrders.length,
    paidCents: sum(paidOrders, o => o.amount),
    topupCount: topups.length, topupCents: sum(topups, o => o.amount),
    subscriptionCount: subs.length, subscriptionCents: sum(subs, o => o.amount),
    arppuCents: payers.size ? Math.round(sum(paidOrders, o => o.amount) / payers.size) : 0,
    walletSpendCents: sum(tx.filter(t => t.type === 'spend'), t => t.cents) - sum(tx.filter(t => t.type === 'refund' && String(t.id).startsWith('refund:')), t => t.cents),
    walletBalanceCents: raw.walletBalanceCents ?? null,
    market: {
      services: (market.services || []).filter(s => s.published && keep(s.owner)).length,
      demands: demands.length,
      bids: sum(demands, d => (d.bids || []).length),
      orders: live.length,
      ordersAll: mOrders.length,
      completed: done.length,
      gmvCents: sum(live, o => o.totalCents),
      completedCents: sum(done, o => o.totalCents),
      walletPaidOrders: live.filter(o => o.settlement?.method === 'wallet').length,
      byAIBuyer: live.filter(byAI).length,
      byAISeller: live.filter(sellerAI).length,
      feeCents: sum(tx.filter(t => t.type === 'income'), t => Math.max(0, ((billing.walletTx || []).find(e => e.id === `escrow:${t.ref}`)?.cents || t.cents) - t.cents)),
    },
    daily: series(d => ({
      paidCents: sum(paidOrders.filter(o => cnDay(o.paidAt || o.createdAt) === d), o => o.amount),
      gmvCents: sum(live.filter(o => cnDay(o.createdAt) === d), o => o.totalCents),
      orders: live.filter(o => cnDay(o.createdAt) === d).length,
    })),
    recent: [
      ...paidOrders.map(o => ({ at: o.paidAt || o.createdAt, kind: o.sku === 'topup' ? '充值' : '会员', cents: o.amount, who: mask(o.owner), via: o.provider })),
      ...live.map(o => ({ at: o.createdAt, kind: `服务广场 · ${o.status === 'completed' ? '已完成' : '进行中'}`, cents: o.totalCents, who: `${mask(o.buyer)} → ${mask(o.seller)}`, via: `${byAI(o) ? 'AI 下单' : '人下单'}${sellerAI(o) ? ' / AI 接单' : ''}`, title: o.quote?.title })),
    ].sort((a, b) => b.at - a.at).slice(0, 30),
  };
  return { generatedAt: now, includeInternal, users, money };
}

/** 邮箱打码：a***@qq.com（投资人看也不泄露用户信息） */
export const mask = owner => {
  if (typeof owner !== 'string') return '—';
  const [name, host] = owner.split('@');
  return host ? `${name.slice(0, 1)}***@${host}` : `${owner.slice(0, 2)}***`;
};
