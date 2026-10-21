import React, { useEffect, useRef, useState } from 'react';
import { platform } from '../services/native';
import { billingRequest, BILLING_API, BILLING_CHANGED, plans, type BillingAccount, type BillingCatalog, type BillingOrder } from '../services/billingClient';
import { Checkout } from './BillingPanel';

/**
 * AI 钱包：人民币余额 + 充值。
 * 钱怎么花：AI 在平台模型上干活时，这个模型的 Token 额度不够了，就按模型定价从余额里自动兑换一笔（每次至少 ¥1）；
 * 用自己 API Key 的调用不碰钱包。金额、到账都以服务器为准，前端只负责选档位、拉起支付、刷新状态。
 */
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const TX_LABEL: Record<string, string> = { topup: '充值', spend: '兑换模型额度', refund: '退回', escrow: '服务广场下单（担保冻结）', income: '接单收入' };
const TX_ICON: Record<string, string> = { topup: '💳', spend: '🧠', refund: '↩️', escrow: '🔒', income: '💰' };
const isOut = (type: string) => type === 'spend' || type === 'escrow';

export function useAIWallet() {
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    if (!BILLING_API) return;
    const [c, a] = await Promise.allSettled([billingRequest<BillingCatalog>('/billing/catalog', 'GET', undefined, true), billingRequest<BillingAccount>('/billing/account')]);
    setCatalog(c.status === 'fulfilled' ? c.value : null);
    if (a.status === 'fulfilled') { setAccount(a.value); setError(''); } else { setAccount(null); setError(a.reason?.message || '读取钱包失败'); }
  };
  useEffect(() => { void load(); window.addEventListener(BILLING_CHANGED, load); return () => window.removeEventListener(BILLING_CHANGED, load); }, []);
  return { catalog, account, error, reload: load };
}

const WalletTopup: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { catalog, account, error, reload } = useAIWallet();
  const amounts = catalog?.topupAmounts?.length ? catalog.topupAmounts : (plans as any).topup?.amounts || [1000, 3000, 10000, 30000];
  const [amount, setAmount] = useState<number>(amounts[1] || amounts[0]);
  const [provider, setProvider] = useState('wechat');
  const [order, setOrder] = useState<BillingOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(!compact);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => { if (catalog && !catalog.providers.find(p => p.id === provider)?.ready) setProvider(catalog.providers.find(p => p.ready)?.id || 'wechat'); }, [catalog]);

  const balance = account?.wallet?.balanceCents ?? 0;
  const ready = catalog?.providers.find(p => p.id === provider)?.ready;
  const blocked = platform() === 'ios' ? 'iOS 版暂不支持充值，请在网页版 www.hiexplore.com 充值'
    : !BILLING_API ? '当前是本地预览，充值请到正式网站登录后进行'
    : error && !account ? `请先登录后再充值（${error}）`
    : !catalog?.salesEnabled || !catalog?.topupEnabled ? 'AI 钱包充值暂未开放（支付在验收中），现在不会扣款'
    : catalog.salesRestricted && !account?.purchaseAllowed ? '支付正在小额验收，当前账号暂不能充值'
    : !ready ? '所选支付方式暂未开放，换一种试试' : '';

  const start = async () => {
    if (busy || blocked) return;
    setBusy(true); setMsg('');
    try { setOrder(await billingRequest<BillingOrder>('/billing/orders', 'POST', { sku: 'topup', amount, provider, requestId: requestId.current })); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  const pick = (v: number) => { setAmount(v); requestId.current = crypto.randomUUID(); };

  return (
    <section className="rounded-xl border border-emerald-700/50 bg-emerald-950/20 p-3 space-y-3" aria-label="AI 钱包">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-[11px] text-slate-400">AI 钱包余额（所有项目共用）</div>
          <div className="text-2xl font-bold text-slate-100">{account ? yuan(balance) : '—'}</div>
        </div>
        {compact && <button onClick={() => setOpen(v => !v)} className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-bold">{open ? '收起' : '💳 充值'}</button>}
      </div>
      {open && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="充值金额">
            {amounts.map((v: number) => (
              <button key={v} role="radio" aria-checked={amount === v} onClick={() => pick(v)} disabled={!!order}
                className={`px-4 py-2 rounded-lg text-[14px] font-bold border transition-colors ${amount === v ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-emerald-500'}`}>¥{v / 100}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <label className="flex items-center gap-2 text-slate-400">支付方式
              <select value={provider} disabled={busy || !!order} onChange={e => { setProvider(e.target.value); requestId.current = crypto.randomUUID(); }} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200">
                <option value="wechat" disabled={!catalog?.providers.find(p => p.id === 'wechat')?.ready}>微信支付</option>
                <option value="alipay" disabled={!catalog?.providers.find(p => p.id === 'alipay')?.ready}>支付宝</option>
              </select>
            </label>
            <button onClick={() => void start()} disabled={!!blocked || busy || !!order} className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:bg-slate-700 disabled:text-slate-400">{busy ? '正在创建订单…' : `充值 ¥${amount / 100}`}</button>
          </div>
          {blocked && <p className="text-[12px] text-amber-300">{blocked}</p>}
          {msg && <p role="alert" className="text-[12px] text-amber-300">{msg}</p>}
          {order && <Checkout key={order.id} order={order} onPaid={() => { void reload(); requestId.current = crypto.randomUUID(); }} onClose={() => { setOrder(null); requestId.current = crypto.randomUUID(); void reload(); }} />}
          <p className="text-[11px] text-slate-500 leading-5">钱怎么花：AI 在平台模型上干活，额度不够时按该模型的价格自动从余额兑换（每次至少 ¥1，用不完留着下次用）；在服务广场下单时，钱先由平台暂存，你验收后才付给对方。AI 接单赚的钱也进这里，只能在平台内花，暂不能提现。用自己 API Key 的调用不扣钱包。到账以服务器核验为准；需要退款请联系客服。</p>
        </div>
      )}
      {!!account?.wallet?.tx.length && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-slate-400">钱包流水（{account.wallet.tx.length}）</summary>
          <ul className="mt-2 divide-y divide-slate-800">
            {account.wallet.tx.map(t => (
              <li key={t.id} className="flex items-center gap-2 py-1.5">
                <span>{TX_ICON[t.type] || '·'}</span>
                <div className="min-w-0 flex-1"><div className="text-slate-200 truncate">{t.note || TX_LABEL[t.type] || t.type}</div><div className="text-[11px] text-slate-500">{new Date(t.at).toLocaleString()} · 余额 {yuan(t.balanceAfter)}</div></div>
                <span className={`font-mono ${isOut(t.type) ? 'text-slate-100' : 'text-emerald-300'}`}>{isOut(t.type) ? '-' : '+'}{yuan(t.cents)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

export default WalletTopup;
