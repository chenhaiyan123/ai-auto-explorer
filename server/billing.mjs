import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createAlipayProvider } from './alipay-provider.mjs';
import { createWechatProvider } from './wechat-provider.mjs';

export const PLANS = JSON.parse(await fs.readFile(new URL('../shared/billing-plans.json', import.meta.url), 'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
const STORE = digest('hiexplore-billing-v1');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const orderView = o => ({ id: o.id, sku: o.sku, artifactId: o.artifactId, title: o.title, amount: o.amount, currency: o.currency, provider: o.provider,
  status: o.status, createdAt: o.createdAt, expiresAt: o.expiresAt, paidAt: o.paidAt, checkoutUrl: o.checkoutUrl, codeUrl: o.codeUrl });
export function addCalendarMonth(at) {
  const d = new Date(at); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, end)); return d.getTime();
}
const account = (s, owner) => s.accounts[digest(owner)] ||= { proUntil: 0, unlocked: [] };
const entitlement = (s, owner, now) => {
  const a = account(s, owner); const plan = a.proUntil > now ? 'pro' : 'free';
  return { plan, proUntil: a.proUntil, limits: PLANS[plan], unlocked: [...a.unlocked] };
};
export class Billing {
  constructor(storage, providers, env = {}, now = Date.now) {
    this.storage = storage; this.providers = providers; this.env = env; this.now = now; this.queue = Promise.resolve(); this.checkouts = new Map();
  }
  transaction(fn) {
    const next = this.queue.catch(() => {}).then(async () => {
      const saved = await this.storage.credentials(STORE);
      const s = saved.version ? saved : { version: 1, accounts: {}, orders: [], artifacts: [] };
      const result = await fn(s); await this.storage.credentials(STORE, s); return result;
    }); this.queue = next; return next;
  }
  allowedIdentities() {
    return new Set((this.env.BILLING_ALLOWED_IDENTITIES || '').split(',').map(value => value.trim()).filter(Boolean));
  }
  canPurchase(owner) {
    const allowed = this.allowedIdentities();
    return this.env.BILLING_SALES_ENABLED === 'true' && (!allowed.size || allowed.has(owner));
  }
  catalog() {
    return { ...PLANS, salesEnabled: this.env.BILLING_SALES_ENABLED === 'true', proSalesEnabled: this.env.BILLING_PRO_ENABLED === 'true',
      salesRestricted: this.allowedIdentities().size > 0,
      providers: [{ id: 'alipay', ready: !!this.providers.alipay }, { id: 'wechat', ready: !!this.providers.wechat }],
      // Do not sell these draft benefits before the scheduler/export integrations are accepted.
      researchBenefitsReady: false };
  }
  async view(owner) {
    return this.transaction(s => ({ ...entitlement(s, owner, this.now()), purchaseAllowed: this.canPurchase(owner), orders: s.orders.filter(o => o.owner === owner).slice(-30).reverse().map(orderView),
      artifacts: s.artifacts.filter(a => a.owner === owner).map(a => ({ id: a.id, title: a.report.title, createdAt: a.createdAt, unlocked: account(s, owner).unlocked.includes(a.id) })) }));
  }
  async adminView() {
    return this.transaction(s => ({ catalog: this.catalog(), orders: s.orders.slice(-100).reverse().map(o => ({ ...orderView(o), owner: o.owner, transactionId: o.transactionId })),
      totals: { orders: s.orders.length, paid: s.orders.filter(o => o.status === 'paid').length, paidAmount: s.orders.filter(o => o.status === 'paid').reduce((n, o) => n + o.amount, 0) } }));
  }
  async saveArtifact(owner, body) {
    const text = (v, max) => { if (typeof v !== 'string' || v.length > max) throw fail('成果内容格式错误或超过大小限制'); return v; };
    const list = (v, max, fn) => { if (!Array.isArray(v) || v.length > max) throw fail('成果列表格式错误'); return v.map(fn); };
    const r = body.report;
    if (!r || !r.title?.trim()) throw fail('请先生成研究成果');
    const report = { title: text(r.title, 200), abstract: text(r.abstract, 10000), sections: list(r.sections, 30, v => ({ title: text(v.title, 200), content: text(v.content, 20000) })),
      conclusions: list(r.conclusions, 100, v => text(v, 2000)), openQuestions: list(r.openQuestions, 100, v => text(v, 2000)), references: list(r.references, 200, v => text(v, 2000)) };
    const serialized = JSON.stringify(report); if (Buffer.byteLength(serialized) > 100000) throw fail('首版成果包最多 100 KB');
    const id = digest(JSON.stringify([owner, report]));
    return this.transaction(s => {
      if (!s.artifacts.some(a => a.id === id)) {
        if (s.artifacts.length >= 500 || s.artifacts.filter(a => a.owner === owner).length >= 100) throw fail('成果存储额度已满，请联系管理员');
        s.artifacts.push({ id, owner, report, createdAt: this.now(), contentHash: digest(serialized) });
      }
      return { id, title: report.title, unlocked: account(s, owner).unlocked.includes(id), amount: PLANS.export.amount };
    });
  }
  async download(owner, id) {
    return this.transaction(s => {
      const artifact = s.artifacts.find(a => a.id === id && a.owner === owner); if (!artifact) throw fail('成果不存在', 404);
      const a = account(s, owner);
      if (!a.unlocked.includes(id)) {
        if (a.proUntil <= this.now()) throw fail('请购买此成果包或开通 Pro', 402);
        a.unlocked.push(id);
      }
      return { version: 1, title: artifact.report.title, report: artifact.report, contentHash: artifact.contentHash, createdAt: artifact.createdAt,
        notice: 'AI 研究记录，不代表已完成独立专家核验；请结合原始证据判断。' };
    });
  }
  async createOrder(owner, body) {
    if (this.env.BILLING_SALES_ENABLED !== 'true') throw fail('支付尚未开放，当前不会扣款', 503);
    if (!this.canPurchase(owner)) throw fail('支付正在进行小额验收，当前账号暂不能购买', 403);
    if (!['pro_month', 'export'].includes(body.sku) || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId || '')) throw fail('订单参数无效');
    const provider = ['alipay', 'wechat'].includes(body.provider) ? this.providers[body.provider] : null; if (!provider) throw fail('该支付方式尚未开放', 503);
    const order = await this.transaction(async s => {
      const previous = s.orders.find(o => o.owner === owner && o.requestId === body.requestId);
      if (previous) {
        if (previous.sku !== body.sku || previous.provider !== body.provider || previous.artifactId !== (body.artifactId || null)) throw fail('订单请求标识已用于其他商品', 409);
        return orderView(previous);
      }
      if (body.sku === 'pro_month' && this.env.BILLING_PRO_ENABLED !== 'true') throw fail('Pro 权益仍在接入，暂不收取会员费用', 503);
      if (body.sku === 'export') {
        if (!s.artifacts.some(a => a.id === body.artifactId && a.owner === owner)) throw fail('成果不存在', 404);
        const a = account(s, owner);
        if (a.proUntil > this.now() || a.unlocked.includes(body.artifactId)) throw fail('此成果已可直接下载，无需重复付款', 409);
      } else if (body.artifactId) throw fail('会员订单不能绑定成果');
      // Repeated clicks/tabs reuse one payable order for the same product.
      const pending = s.orders.find(o => o.owner === owner && o.sku === body.sku && o.artifactId === (body.artifactId || null) && o.status === 'pending' && o.expiresAt > this.now());
      if (pending) return orderView(pending);
      if (s.orders.length >= 10000 || s.orders.filter(o => o.owner === owner && o.createdAt > this.now() - 86400000).length >= 20) throw fail('订单数量达到上限，请稍后再试', 429);
      const o = { id: `HE${randomBytes(15).toString('hex')}`, owner, requestId: body.requestId, sku: body.sku, artifactId: body.artifactId || null,
        title: body.sku === 'pro_month' ? 'HiExplore Pro 月度会员' : 'HiExplore 研究成果包', amount: body.sku === 'pro_month' ? PLANS.pro.amount : PLANS.export.amount,
        currency: 'CNY', provider: body.provider, status: 'pending', createdAt: this.now(), expiresAt: this.now() + 15 * 60000 };
      // Persist the immutable order ID before a remote provider can accept it.
      s.orders.push(o); return orderView(o);
    });
    return this.prepareCheckout(order);
  }
  async prepareCheckout(order) {
    if (order.status === 'paid' || order.checkoutUrl || order.codeUrl || order.expiresAt <= this.now()) return order;
    if (this.checkouts.has(order.id)) return this.checkouts.get(order.id);
    const pending = (async () => {
      const provider = this.providers[order.provider]; if (!provider) throw fail('该订单支付渠道暂不可用', 503);
      const checkout = await provider.create(order);
      return this.transaction(s => {
        const saved = s.orders.find(o => o.id === order.id);
        if (saved.status !== 'paid') Object.assign(saved, checkout);
        return orderView(saved);
      });
    })();
    this.checkouts.set(order.id, pending);
    try { return await pending; } finally { this.checkouts.delete(order.id); }
  }
  async settle(provider, result, expectedOrderId) {
    if (!result) return;
    return this.transaction(s => {
      const o = s.orders.find(o => o.id === result.orderId && o.provider === provider);
      if (!o || (expectedOrderId && o.id !== expectedOrderId)) throw fail('付款订单不匹配');
      if (result.currency !== o.currency || result.amount !== o.amount) throw fail('付款金额或币种不匹配');
      if (s.orders.some(other => other.id !== o.id && other.provider === provider && other.transactionId === result.transactionId)) throw fail('交易号已用于另一订单');
      if (o.status === 'paid') { if (o.transactionId !== result.transactionId) throw fail('交易号不匹配'); return; }
      const a = account(s, o.owner);
      if (o.sku === 'pro_month') a.proUntil = addCalendarMonth(Math.max(a.proUntil, this.now()));
      else if (!a.unlocked.includes(o.artifactId)) a.unlocked.push(o.artifactId);
      o.status = 'paid'; o.transactionId = result.transactionId; o.paidAt = this.now(); delete o.checkoutUrl; delete o.codeUrl;
    });
  }
  async getOrder(owner, id, refresh = false) {
    const o = await this.transaction(s => {
      const order = s.orders.find(o => o.id === id && o.owner === owner); if (!order) throw fail('订单不存在', 404);
      const shouldQuery = refresh && order.status !== 'paid' && (!order.lastQueriedAt || this.now() - order.lastQueriedAt >= 10000);
      if (shouldQuery) order.lastQueriedAt = this.now();
      return { ...order, shouldQuery };
    });
    if (o.shouldQuery && this.providers[o.provider]) {
      try { await this.settle(o.provider, await this.providers[o.provider].query(o), o.id); }
      catch { return { ...orderView(o), queryWarning: '支付状态暂未确认，请稍后刷新；不要重复付款' }; }
    }
    return this.transaction(s => orderView(s.orders.find(v => v.id === id && v.owner === owner)));
  }
  async notify(provider, raw, headers) {
    if (!this.providers[provider]) throw fail('支付方式未配置');
    await this.settle(provider, await this.providers[provider].verifyNotification(raw, headers));
  }
}
export async function createBilling(storage, env, fetcher, providers) {
  const alipay = providers ? null : await createAlipayProvider(env, fetcher);
  const wechat = providers ? null : await createWechatProvider(env, fetcher);
  return new Billing(storage, providers || { ...(alipay ? { alipay } : {}), ...(wechat ? { wechat } : {}) }, env);
}
