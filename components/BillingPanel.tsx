import { platform } from '../services/native';
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage, displayDate } from '../services/language';
import { billingRequest, BILLING_API, BILLING_CHANGED, BillingAccount, BillingCatalog, BillingOrder, plans, safeCheckoutUrl, safeWechatCodeUrl } from '../services/billingClient';
import QRCode from 'qrcode';
import { downloadResearchExport } from '../services/researchExport';
import WalletTopup from './WalletTopup';

export function Checkout({ order: initial, onPaid, onClose }: { order: BillingOrder; onPaid: () => void; onClose: () => void }) {
  const { t } = useLanguage(); const [order, setOrder] = useState(initial); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); const done = useRef(false); const alive = useRef(true);
  const [qr, setQr] = useState('');
  useEffect(() => {
    let active = true; setQr('');
    const code = order.provider === 'wechat' ? safeWechatCodeUrl(order.codeUrl) : undefined;
    if (code && order.status !== 'paid') void QRCode.toDataURL(code, { width: 256, margin: 4, errorCorrectionLevel: 'M' }).then(url => { if (active) setQr(url); }).catch(() => { if (active) setError(t('二维码生成失败，请重新打开订单', 'Could not render QR code. Reopen this order.')); });
    return () => { active = false; };
  }, [order.codeUrl, order.status, order.provider]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = async () => {
    if (inFlight.current || done.current) return; inFlight.current = true; setBusy(true);
    try {
      const next = await billingRequest<BillingOrder>(`/billing/orders/${initial.id}`, 'POST'); if (!alive.current) return;
      setOrder(next); setError(next.queryWarning || '');
      if (next.status === 'paid') { done.current = true; window.dispatchEvent(new Event(BILLING_CHANGED)); onPaid(); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => { const id = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000); return () => clearInterval(id); }, []);
  const link = safeCheckoutUrl(order.checkoutUrl); const expired = order.expiresAt <= Date.now();
  return <div className="rounded-2xl border border-blue-500/40 bg-slate-950 p-5 space-y-3" aria-label={t('收银台', 'Checkout')}>
    <div className="flex justify-between gap-3"><h3 className="font-bold">{order.sku === 'pro_month' ? 'Pro' : order.sku === 'topup' ? t('AI 钱包充值', 'AI wallet top-up') : t('成果包', 'Research export')} · ¥{(order.amount / 100).toFixed(2)}</h3><button onClick={onClose} className="text-sm text-slate-400">{t('收起', 'Dismiss')}</button></div>
    <p className="text-xs text-slate-400 break-all">{t('订单号', 'Order')}：{order.id}</p>
    <p className="text-sm">{order.status === 'paid' ? (order.sku === 'topup' ? t('支付已确认，钱已到 AI 钱包', 'Payment verified. Funds added to your AI wallet.') : t('支付已确认，权益已到账', 'Payment verified. Access granted.')) : expired ? t('支付链接已到期。如已付款，请刷新状态，勿重复支付。', 'Payment link expired. If you paid, check status before paying again.') : order.provider === 'wechat' ? t('请用手机微信扫描二维码付款，到账后自动解锁。', 'Scan with WeChat to pay. Access unlocks after verification.') : t('请在支付宝官方收银台完成付款，再回到这里查看结果。', 'Pay at the official Alipay checkout, then return here to check the result.')}</p>
    {qr && order.status !== 'paid' && !expired && <img src={qr} width={256} height={256} alt={t('微信支付订单二维码', 'WeChat Pay order QR code')} className="rounded-xl mx-auto" />}
    {order.status !== 'paid' && <div className="flex flex-wrap gap-3">
      {link && !expired && <a href={link} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">{t('打开支付宝收银台', 'Open Alipay checkout')}</a>}
      <button onClick={() => void refresh()} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-800 text-sm disabled:opacity-40">{busy ? t('核对中…', 'Checking…') : t('我已支付，刷新状态', 'Check payment status')}</button>
    </div>}
    {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    <p className="text-xs text-slate-500">{t('关闭窗口不代表取消订单。是否到账以服务器核验结果为准。', 'Closing this panel does not cancel the order. Access is granted only after server verification.')}</p>
  </div>;
}

function WebBillingPanel() {
  const { t } = useLanguage(); const [catalog, setCatalog] = useState<BillingCatalog | null>(null); const [account, setAccount] = useState<BillingAccount | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [order, setOrder] = useState<BillingOrder | null>(null);
  const requestId = useRef(crypto.randomUUID()); const [provider, setProvider] = useState('wechat');
  const load = async () => {
    const results = await Promise.allSettled([billingRequest<BillingCatalog>('/billing/catalog', 'GET', undefined, true), billingRequest<BillingAccount>('/billing/account')]);
    if (results[0].status === 'fulfilled') setCatalog(results[0].value); else setCatalog(null);
    if (results[1].status === 'fulfilled') { setAccount(results[1].value); setError(''); } else { setAccount(null); setError(results[1].reason.message); }
  };
  useEffect(() => { void load(); window.addEventListener(BILLING_CHANGED, load); return () => window.removeEventListener(BILLING_CHANGED, load); }, []);
  useEffect(() => { if (catalog && !catalog.providers.find(p => p.id === provider)?.ready) setProvider(catalog.providers.find(p => p.ready)?.id || 'wechat'); }, [catalog]);
  const purchasesAvailable = !!catalog?.salesEnabled && (!catalog.salesRestricted || !!account?.purchaseAllowed);
  return <section className="text-slate-200 space-y-5" aria-label={t('充值与订单', 'Top-ups & orders')}>
    <div><h2 className="text-2xl font-bold">{t('不用买套餐，按用量付费', 'No plans — pay for what you use')}</h2><p className="text-sm text-slate-400 mt-2 leading-6">{t('给钱包充值，再给想推进的项目拨一笔预算。AI 在项目里花钱（模型、服务广场、问卷）从项目钱包出，它接单赚的钱也进项目钱包——让它自己养活自己。', 'Top up your wallet and give each project a budget. The AI spends from the project wallet and earns into it by taking jobs in the marketplace.')}</p></div>
    <WalletTopup />
    {account?.plan === 'pro' && <p className="text-sm text-emerald-300">{t('你之前买的 Pro 有效期至', 'Your earlier Pro stays active until')} {displayDate(account.proUntil)}</p>}
    <div className="flex flex-wrap gap-4 text-xs">{['alipay', 'wechat'].map(id => <span key={id} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${purchasesAvailable && catalog?.providers.find(p => p.id === id)?.ready ? 'bg-emerald-400' : 'bg-slate-600'}`} />{id === 'alipay' ? t('支付宝', 'Alipay') : t('微信支付', 'WeChat Pay')} · {purchasesAvailable && catalog?.providers.find(p => p.id === id)?.ready ? catalog.salesRestricted ? t('仅供验收', 'Verification only') : t('已开放', 'Available') : t('暂未开放', 'Not available yet')}</span>)}</div>
    {catalog?.salesRestricted && <p className="text-xs text-amber-200">{account?.purchaseAllowed ? t('支付正在进行小额验收，此账号可以充值。', 'Payments are being verified. This account can top up.') : t('支付正在进行小额验收，当前账号暂不能充值。已有订单查询不受影响。', 'Payments are being verified with selected accounts. This account cannot top up yet. Existing orders remain available.')}</p>}
    <p className="text-xs text-slate-400 leading-relaxed">{t('Pro 当前包含会员有效期内的成果包导出，已解锁的同一版本到期后仍可下载。模型调用按实际额度或自有 API 计费，会员不额外赠送 Token；研究次数、问题数量和观察频率暂无套餐差异。', 'Pro includes research exports while active. Versions already unlocked remain downloadable after expiry. Model usage uses your allocated credits or your own API; membership does not add tokens. Research runs, question counts and observation schedules currently have no plan-specific differences.')}</p>
    {error && <p role="status" className="text-sm text-amber-200">{error}</p>}
    {order && <Checkout key={order.id} order={order} onPaid={() => { void load(); requestId.current = crypto.randomUUID(); }} onClose={() => { setOrder(null); requestId.current = crypto.randomUUID(); }} />}
    {!!account?.orders.length && <div><h3 className="font-bold mb-2">{t('我的订单', 'My orders')}</h3><div className="space-y-2">{account.orders.map(o => <div key={o.id} className="rounded-lg bg-slate-800/60 p-3 flex flex-wrap items-center justify-between gap-2 text-xs"><div><p>{o.sku === 'pro_month' ? 'Pro' : o.sku === 'topup' ? t('AI 钱包充值', 'AI wallet top-up') : t('成果包', 'Research export')} · ¥{(o.amount / 100).toFixed(2)}</p><p className="text-slate-500 break-all">{o.id}</p></div><button className="text-blue-300" onClick={() => setOrder(o)}>{o.status === 'paid' ? t('已支付', 'Paid') : t('查看／核对支付', 'View / check payment')}</button></div>)}</div></div>}
    {!!account?.artifacts.length && <div><h3 className="font-bold mb-2">{t('我的成果版本', 'My export versions')}</h3><div className="space-y-2">{account.artifacts.map(a => <div key={a.id} className="rounded-lg bg-slate-800/60 p-3 flex justify-between gap-3 text-xs"><span>{a.title}<br /><span className="text-slate-500">{displayDate(a.createdAt)} · {a.id.slice(0, 8)}</span></span><button className="text-blue-300" onClick={() => void downloadResearchExport(a.id).then(load).catch(e => setError(e.message))}>{t('下载', 'Download')}</button></div>)}</div></div>}
    {!BILLING_API && <p className="text-xs text-slate-500">{t('当前为套餐预览，支付服务尚未接入。', 'Plan preview. The billing service is not connected.')}</p>}
  </section>;
}

export function BillingModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur p-3 sm:p-6 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={t('收费与套餐', 'Plans & billing')}><div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col"><div className="p-4 flex justify-between border-b border-slate-800"><h2 className="font-bold">{t('收费与套餐', 'Plans & billing')}</h2><button onClick={onClose} className="text-slate-400 px-3">{t('关闭', 'Close')}</button></div><div className="overflow-y-auto p-4 sm:p-6"><BillingPanel /></div></div></div>;
}

// The first iOS build has no external digital-goods checkout or purchase links.
export default function BillingPanel() {
  const { t } = useLanguage();
  if (platform() === 'ios') return <section className="space-y-3"><h2 className="text-xl font-bold">{t('套餐与权益', 'Plan & access')}</h2><p>{t('iOS 首版暂未开放应用内购买。你可以继续使用项目总览、事实看板和 AI 团队。', 'In-app purchases are not available in this first iOS release. Continue using the overview, fact board and AI team.')}</p></section>;
  return <WebBillingPanel />;
}
