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
const account = (s, owner) => { const a = s.accounts[digest(owner)] ||= { proUntil: 0, unlocked: [] }; a.walletCents ||= 0; return a; };
const TOPUP_AMOUNTS = PLANS.topup?.amounts || [];
const titleOf = (sku, amount) => sku === 'pro_month' ? 'HiExplore Pro 月度会员' : sku === 'topup' ? `AI 钱包充值 ¥${amount / 100}` : 'HiExplore 研究成果包';
const amountOf = (sku, amount) => sku === 'pro_month' ? PLANS.pro.amount : sku === 'topup' ? amount : PLANS.export.amount;
/** AI 钱包流水：充值 / 兑换模型额度（支出）/ 兑换失败退回 */
const sumTx = (s, f) => (s.walletTx || []).filter(f).reduce((n, t) => n + t.cents, 0);
const walletTxView = t => ({ id: t.id, type: t.type, cents: t.cents, balanceAfter: t.balanceAfter, note: t.note, at: t.at, ...(t.projectId ? { projectId: t.projectId } : {}) });
/**
 * 项目钱包：用户把一部分钱放进某个项目，AI 在这个项目里花的钱从这里出、赚的钱进这里。
 * 只有「建过项目钱包」的项目才走项目钱包；没建过的项目照旧用用户钱包。
 */
const projectIdOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id);
const hasPot = (a, projectId) => !!projectId && a.projects && Object.prototype.hasOwnProperty.call(a.projects, projectId);
const balanceOf = (a, projectId) => (hasPot(a, projectId) ? a.projects[projectId] : a.walletCents);
const pushWalletTx = (s, owner, type, cents, ref, note, now, projectId) => {
  const a = account(s, owner);
  // 某个项目的 AI 接单赚的钱：这个项目还没有钱包就顺手建一个，钱记在它名下
  if (type === 'income' && projectIdOk(projectId) && !hasPot(a, projectId)) (a.projects ||= {})[projectId] = 0;
  const pot = hasPot(a, projectId) ? projectId : null;
  const delta = type === 'spend' || type === 'escrow' ? -cents : cents;
  if (pot) a.projects[pot] += delta; else a.walletCents += delta;
  const tx = { id: `${type}:${ref}`, owner, type, cents, ref, note, balanceAfter: pot ? a.projects[pot] : a.walletCents, at: now, ...(pot ? { projectId: pot } : {}) };
  (s.walletTx ||= []).push(tx);
  if (s.walletTx.length > 50000) s.walletTx = s.walletTx.slice(-50000);
  return tx;
};
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
    return { ...PLANS, salesEnabled: this.env.BILLING_SALES_ENABLED === 'true', proSalesEnabled: this.env.BILLING_PRO_ENABLED === 'true' && this.env.BILLING_PRO_RETIRED === 'false',
      salesRestricted: this.allowedIdentities().size > 0,
      providers: [{ id: 'alipay', ready: !!this.providers.alipay }, { id: 'wechat', ready: !!this.providers.wechat }],
      topupEnabled: this.env.BILLING_TOPUP_ENABLED === 'true', topupAmounts: TOPUP_AMOUNTS,
      // Do not sell these draft benefits before the scheduler/export integrations are accepted.
      researchBenefitsReady: false };
  }
  async view(owner) {
    return this.transaction(s => ({ ...entitlement(s, owner, this.now()), purchaseAllowed: this.canPurchase(owner), orders: s.orders.filter(o => o.owner === owner).slice(-30).reverse().map(orderView),
      wallet: { balanceCents: account(s, owner).walletCents, projects: { ...(account(s, owner).projects || {}) }, tx: (s.walletTx || []).filter(t => t.owner === owner).slice(-80).reverse().map(walletTxView) },
      artifacts: s.artifacts.filter(a => a.owner === owner).map(a => ({ id: a.id, title: a.report.title, createdAt: a.createdAt, unlocked: account(s, owner).unlocked.includes(a.id) })) }));
  }
  async adminView() {
    return this.transaction(s => ({ catalog: this.catalog(), orders: s.orders.slice(-100).reverse().map(o => ({ ...orderView(o), owner: o.owner, transactionId: o.transactionId })),
      totals: { orders: s.orders.length, paid: s.orders.filter(o => o.status === 'paid').length, paidAmount: s.orders.filter(o => o.status === 'paid').reduce((n, o) => n + o.amount, 0),
        walletBalance: Object.values(s.accounts).reduce((n, a) => n + (a.walletCents || 0) + Object.values(a.projects || {}).reduce((m, v) => m + v, 0), 0), walletSpent: sumTx(s, t => t.type === 'spend') - sumTx(s, t => t.id.startsWith('refund:')),
        walletEscrow: sumTx(s, t => t.type === 'escrow') - sumTx(s, t => t.id.startsWith('escrowback:')) - (s.walletTx || []).filter(t => t.id.startsWith('income:')).reduce((n, t) => n + ((s.walletTx || []).find(e => e.id === `escrow:${t.ref}`)?.cents || 0), 0) } }));
  }
  /** 运营数据用：原始订单和钱包流水（只读） */
  async raw() {
    return this.transaction(s => ({ orders: s.orders.map(o => ({ owner: o.owner, sku: o.sku, amount: o.amount, status: o.status, provider: o.provider, createdAt: o.createdAt, paidAt: o.paidAt })),
      walletTx: (s.walletTx || []).map(t => ({ id: t.id, owner: t.owner, type: t.type, cents: t.cents, ref: t.ref, at: t.at })),
      walletBalanceCents: Object.values(s.accounts).reduce((n, a) => n + (a.walletCents || 0) + Object.values(a.projects || {}).reduce((m, v) => m + v, 0), 0) }));
  }
  /** 当前 AI 钱包余额（分） */
  async walletBalance(owner, projectId) {
    return this.transaction(s => balanceOf(account(s, owner), projectId));
  }
  /**
   * 用户钱包 ⇄ 项目钱包划转（幂等，requestId 防重）。direction: 'in' 放进项目，'out' 收回用户钱包。
   * 第一次放钱就等于给这个项目建了钱包；之后这个项目的花销都从项目钱包出。
   */
  async transferProject(owner, projectId, cents, direction, requestId, note = '') {
    if (!projectIdOk(projectId)) throw fail('项目编号无效');
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e8) throw fail('金额无效');
    if (!['in', 'out'].includes(direction) || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '')) throw fail('划转参数无效');
    return this.transaction(s => {
      const id = `${direction === 'in' ? 'allocate' : 'release'}:${requestId}`;
      const done = (s.walletTx || []).find(t => t.id === id);
      if (done) { if (done.owner !== owner || done.cents !== cents || done.projectId !== projectId) throw fail('划转编号已用于其他划转', 409); return walletTxView(done); }
      const a = account(s, owner); a.projects ||= {};
      if (direction === 'in') {
        if (a.walletCents < cents) throw Object.assign(fail(`用户钱包余额不足：还剩 ¥${(a.walletCents / 100).toFixed(2)}，请先充值`, 402), { code: 'WALLET_EMPTY' });
        a.walletCents -= cents; a.projects[projectId] = (a.projects[projectId] || 0) + cents;
      } else {
        if ((a.projects[projectId] || 0) < cents) throw fail(`项目钱包只剩 ¥${((a.projects[projectId] || 0) / 100).toFixed(2)}`, 402);
        a.projects[projectId] -= cents; a.walletCents += cents;
      }
      const tx = { id, owner, type: direction === 'in' ? 'allocate' : 'release', cents, ref: requestId, note: String(note || (direction === 'in' ? '放进项目钱包' : '从项目钱包收回')).slice(0, 200), balanceAfter: a.projects[projectId], at: this.now(), projectId };
      (s.walletTx ||= []).push(tx);
      return walletTxView(tx);
    });
  }
  /**
   * 从 AI 钱包扣钱（兑换模型额度时用）。ref 幂等：同一个 ref 只扣一次。
   * 余额不够直接拒绝，绝不透支。
   */
  async spendWallet(owner, cents, ref, note, projectId) {
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e8 || !/^[a-zA-Z0-9:_-]{8,120}$/.test(ref || '')) throw fail('钱包扣款参数无效');
    return this.transaction(s => {
      const done = (s.walletTx || []).find(t => t.id === `spend:${ref}`);
      if (done) { if (done.owner !== owner || done.cents !== cents) throw fail('扣款标识已用于其他扣款', 409); return walletTxView(done); }
      const a = account(s, owner), bal = balanceOf(a, projectId), inPot = hasPot(a, projectId);
      if (bal < cents) throw Object.assign(fail(`${inPot ? '项目钱包' : 'AI 钱包'}余额不足：还剩 ¥${(bal / 100).toFixed(2)}，这次需要 ¥${(cents / 100).toFixed(2)}。${inPot ? '往项目钱包里放点钱' : '请先充值'}`, 402), { code: 'WALLET_EMPTY' });
      return walletTxView(pushWalletTx(s, owner, 'spend', cents, ref, String(note || '').slice(0, 200), this.now(), projectId));
    });
  }
  /**
   * 服务广场用钱包付款：下单时先从买方钱包扣出、冻结在平台（escrow）。ref = 订单号，幂等。
   * 余额不够直接拒绝。
   */
  async holdEscrow(owner, cents, ref, note, projectId) {
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e8 || !/^[a-zA-Z0-9:_-]{8,120}$/.test(ref || '')) throw fail('担保付款参数无效');
    return this.transaction(s => {
      const done = (s.walletTx || []).find(t => t.id === `escrow:${ref}`);
      if (done) { if (done.owner !== owner || done.cents !== cents) throw fail('订单担保金额不一致', 409); return walletTxView(done); }
      const a = account(s, owner), bal = balanceOf(a, projectId), inPot = hasPot(a, projectId);
      if (bal < cents) throw Object.assign(fail(`${inPot ? '项目钱包' : 'AI 钱包'}余额不足：还剩 ¥${(bal / 100).toFixed(2)}，这单需要 ¥${(cents / 100).toFixed(2)}。${inPot ? '往项目钱包里放点钱' : '请先充值'}`, 402), { code: 'WALLET_EMPTY' });
      return walletTxView(pushWalletTx(s, owner, 'escrow', cents, ref, String(note || '').slice(0, 200), this.now(), projectId));
    });
  }
  /**
   * 担保款结算（幂等）：验收完成 → 打给卖方钱包（收入只能在平台内花，不能提现）；取消 / 拒绝 → 退回买方。
   * 没有担保过的订单什么都不做。平台抽成 MARKET_FEE_BPS（万分比，默认 0）。
   */
  async settleEscrow(ref, outcome, seller, sellerProjectId) {
    return this.transaction(s => {
      const held = (s.walletTx || []).find(t => t.id === `escrow:${ref}`);
      if (!held) return null;
      if ((s.walletTx || []).some(t => t.id === `income:${ref}` || t.id === `escrowback:${ref}`)) return null;
      if (outcome === 'release') {
        if (!seller) throw fail('缺少收款方');
        const bps = Math.min(5000, Math.max(0, Number(this.env.MARKET_FEE_BPS || 0) | 0));
        const fee = Math.floor(held.cents * bps / 10000);
        // 卖方是某个项目的 AI 接的单：收入进那个项目的钱包（项目没建钱包就进用户钱包）
        const tx = pushWalletTx(s, seller, 'income', held.cents - fee, ref, `接单收入${fee ? `（平台服务费 ¥${(fee / 100).toFixed(2)}）` : ''}`, this.now(), sellerProjectId);
        tx.id = `income:${ref}`;
        return walletTxView(tx);
      }
      const tx = pushWalletTx(s, held.owner, 'refund', held.cents, ref, '订单取消 / 被拒，担保款退回', this.now(), held.projectId);
      tx.id = `escrowback:${ref}`;
      return walletTxView(tx);
    });
  }
  /** 兑换没成功：把这笔扣款退回钱包（幂等，没扣过就什么都不做） */
  async refundWallet(owner, ref, note = '兑换失败，退回钱包') {
    return this.transaction(s => {
      const spent = (s.walletTx || []).find(t => t.id === `spend:${ref}` && t.owner === owner);
      if (!spent || (s.walletTx || []).some(t => t.id === `refund:${ref}`)) return null;
      return walletTxView(pushWalletTx(s, owner, 'refund', spent.cents, ref, note, this.now(), spent.projectId));
    });
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
      return { id, title: report.title, unlocked: true, amount: 0 };
    });
  }
  async download(owner, id) {
    return this.transaction(s => {
      const artifact = s.artifacts.find(a => a.id === id && a.owner === owner); if (!artifact) throw fail('成果不存在', 404);
      const a = account(s, owner);
      // 成果包导出免费（以前每份 ¥3.99 / Pro 内免费）
      if (!a.unlocked.includes(id)) a.unlocked.push(id);
      return { version: 1, title: artifact.report.title, report: artifact.report, contentHash: artifact.contentHash, createdAt: artifact.createdAt,
        notice: 'AI 研究记录，不代表已完成独立专家核验；请结合原始证据判断。' };
    });
  }
  async createOrder(owner, body) {
    if (this.env.BILLING_SALES_ENABLED !== 'true') throw fail('支付尚未开放，当前不会扣款', 503);
    if (!this.canPurchase(owner)) throw fail('支付正在进行小额验收，当前账号暂不能购买', 403);
    if (!['pro_month', 'export', 'topup'].includes(body.sku) || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId || '')) throw fail('订单参数无效');
    if (body.sku === 'topup') {
      if (this.env.BILLING_TOPUP_ENABLED !== 'true') throw fail('AI 钱包充值暂未开放，当前不会扣款', 503);
      if (!TOPUP_AMOUNTS.includes(body.amount)) throw fail('充值金额无效，请选择页面上的档位');
      if (body.artifactId) throw fail('充值订单不能绑定成果');
    }
    const amount = body.sku === 'topup' ? body.amount : undefined;
    const provider = ['alipay', 'wechat'].includes(body.provider) ? this.providers[body.provider] : null; if (!provider) throw fail('该支付方式尚未开放', 503);
    const order = await this.transaction(async s => {
      const previous = s.orders.find(o => o.owner === owner && o.requestId === body.requestId);
      if (previous) {
        if (previous.sku !== body.sku || previous.provider !== body.provider || previous.artifactId !== (body.artifactId || null) || (body.sku === 'topup' && previous.amount !== amount)) throw fail('订单请求标识已用于其他商品', 409);
        return orderView(previous);
      }
      // 不再卖会员套餐：充值进钱包、给项目拨预算，AI 自己接单养活自己（已买的 Pro 到期前照常有效）。
      // 要重新开卖得同时设 BILLING_PRO_ENABLED=true 和 BILLING_PRO_RETIRED=false
      if (body.sku === 'pro_month' && this.env.BILLING_PRO_RETIRED !== 'false') throw fail('会员套餐已停止售卖：现在只需给钱包充值，按用量付费', 410);
      if (body.sku === 'pro_month' && this.env.BILLING_PRO_ENABLED !== 'true') throw fail('Pro 权益仍在接入，暂不收取会员费用', 503);
      if (body.sku === 'export') {
        throw fail('成果包已经免费，直接下载就行，不用付款', 410);
        const a = account(s, owner);
        if (a.proUntil > this.now() || a.unlocked.includes(body.artifactId)) throw fail('此成果已可直接下载，无需重复付款', 409);
      } else if (body.sku === 'pro_month' && body.artifactId) throw fail('会员订单不能绑定成果');
      // Repeated clicks/tabs reuse one payable order for the same product.
      const pending = s.orders.find(o => o.owner === owner && o.sku === body.sku && o.artifactId === (body.artifactId || null) && (body.sku !== 'topup' || o.amount === amount) && o.status === 'pending' && o.expiresAt > this.now());
      if (pending) return orderView(pending);
      if (s.orders.length >= 10000 || s.orders.filter(o => o.owner === owner && o.createdAt > this.now() - 86400000).length >= 20) throw fail('订单数量达到上限，请稍后再试', 429);
      const o = { id: `HE${randomBytes(15).toString('hex')}`, owner, requestId: body.requestId, sku: body.sku, artifactId: body.artifactId || null,
        title: titleOf(body.sku, amount), amount: amountOf(body.sku, amount),
        currency: 'CNY', provider: body.provider, status: 'pending', createdAt: this.now(), expiresAt: this.now() + 15 * 60000 };
      // Persist the immutable order ID before a remote provider can accept it.
      s.orders.push(o); return orderView(o);
    });
    return this.prepareCheckout(order);
  }
  /**
   * 预售页「意向金」：访客用微信付 ¥1–9.9 表示「我真的想要」，到期后全额原路退回。
   * 钱不进任何用户的钱包、也不转给页面作者（避免替人代收款），只用来验证付费意愿。
   */
  async createDeposit({ pageId, amount, title, visitor, provider = 'wechat', days = 7 }) {
    if (this.env.BILLING_SALES_ENABLED !== 'true') throw fail('支付尚未开放', 503);
    if (!/^[A-Za-z0-9_-]{8,20}$/.test(pageId || '') || !Number.isSafeInteger(amount) || amount < 100 || amount > 990) throw fail('意向金参数无效');
    if (!this.providers[provider]) throw fail('微信支付暂不可用', 503);
    const owner = `page:${pageId}`;
    const order = await this.transaction(s => {
      const pending = s.orders.find(o => o.owner === owner && o.sku === 'deposit' && o.visitor === visitor && o.status === 'pending' && o.expiresAt > this.now());
      if (pending) return orderView(pending);
      if (s.orders.filter(o => o.sku === 'deposit' && o.visitor === visitor && o.createdAt > this.now() - 86400000).length >= 5) throw fail('今天已经付过几次了，谢谢', 429);
      if (s.orders.length >= 20000) throw fail('订单数量达到上限，请稍后再试', 429);
      const o = { id: `HE${randomBytes(15).toString('hex')}`, owner, visitor, requestId: `dep-${randomBytes(8).toString('hex')}`, sku: 'deposit', artifactId: null,
        title: String(`意向金（${days} 天后全额退回）· ${title || ''}`).slice(0, 120), amount, currency: 'CNY', provider, status: 'pending',
        refundDays: Math.min(30, Math.max(1, days | 0)), createdAt: this.now(), expiresAt: this.now() + 15 * 60000 };
      s.orders.push(o); return orderView(o);
    });
    return this.prepareCheckout(order);
  }
  /** 访客页面轮询：付了没有（顺手去微信查一下） */
  async depositStatus(pageId, id) {
    const o = await this.transaction(s => s.orders.find(x => x.id === id && x.owner === `page:${pageId}` && x.sku === 'deposit'), false);
    if (!o) throw fail('订单不存在', 404);
    if (o.status !== 'paid' && o.expiresAt > this.now() - 60000 && this.providers[o.provider]) { try { await this.settle(o.provider, await this.providers[o.provider].query(o), o.id); } catch { /* 下次再查 */ } }
    const now = await this.transaction(s => s.orders.find(x => x.id === id), false);
    return { paid: now.status === 'paid', refundAt: now.refundAt || null };
  }
  /** 页面作者看：多少人付了意向金、退了多少 */
  async depositStats(pageId) {
    return this.transaction(s => {
      const list = s.orders.filter(o => o.owner === `page:${pageId}` && o.sku === 'deposit' && o.status === 'paid');
      return { count: list.length, cents: list.reduce((n, o) => n + o.amount, 0), refunded: list.filter(o => o.refundStatus === 'SUCCESS' || o.refundStatus === 'PROCESSING').length };
    }, false);
  }
  /** 到期的意向金原路退回（定时跑） */
  async refundDueDeposits() {
    const due = await this.transaction(s => s.orders.filter(o => o.sku === 'deposit' && o.status === 'paid' && !o.refundStatus && o.refundAt <= this.now()).slice(0, 20).map(o => ({ ...o })), false);
    for (const o of due) {
      const p = this.providers[o.provider];
      if (!p?.refund) continue;
      let status;
      try { status = (await p.refund(o, '意向验证结束，全额退回')).status; }
      catch (e) { status = null; console.error('deposit refund failed', o.id, e.message); }
      await this.transaction(s => { const x = s.orders.find(y => y.id === o.id); if (x) { x.refundTries = (x.refundTries || 0) + 1; if (status) { x.refundStatus = status; x.refundedAt = this.now(); } } });
    }
    return due.length;
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
      if (o.sku === 'deposit') { o.status = 'paid'; o.transactionId = result.transactionId; o.paidAt = this.now(); o.refundAt = this.now() + (o.refundDays || 7) * 86400000; delete o.codeUrl; return; }
      const a = account(s, o.owner);
      if (o.sku === 'pro_month') a.proUntil = addCalendarMonth(Math.max(a.proUntil, this.now()));
      else if (o.sku === 'topup') pushWalletTx(s, o.owner, 'topup', o.amount, o.id, `充值 ¥${o.amount / 100}（${o.provider === 'wechat' ? '微信支付' : '支付宝'}）`, this.now());
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
