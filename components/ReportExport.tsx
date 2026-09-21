import React, { useRef, useState } from 'react';
import { billingRequest, BillingAccount, BillingCatalog, BillingOrder, ReportSnapshot } from '../services/billingClient';
import { downloadResearchExport } from '../services/researchExport';
import { useLanguage } from '../services/language';
import { Checkout } from './BillingPanel';

export default function ReportExport({ report }: { report: ReportSnapshot }) {
  const { t } = useLanguage(); const [open, setOpen] = useState(false); const [artifact, setArtifact] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [status, setStatus] = useState('');
  const [order, setOrder] = useState<BillingOrder | null>(null); const [canPay, setCanPay] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const requestId = useRef(crypto.randomUUID());
  const download = async (id: string) => {
    await downloadResearchExport(id); setStatus(t('成果包已下载。同一版本以后可重复下载。', 'Export downloaded. You can download this version again.')); setCanPay(false);
  };
  const prepare = async () => {
    setBusy(true); setError('');
    try {
      const item = await billingRequest<{ id: string; title: string }>('/billing/artifacts', 'POST', { report }); setArtifact(item);
      try { await download(item.id); }
      catch (e) {
        if ((e as { status?: number }).status !== 402) throw e;
        const [catalog, account] = await Promise.all([
          billingRequest<BillingCatalog>('/billing/catalog', 'GET', undefined, true),
          billingRequest<BillingAccount>('/billing/account'),
        ]);
        const ready = catalog.providers.filter(p => p.ready).map(p => p.id); setProviders(ready);
        const available = catalog.salesEnabled && account.purchaseAllowed && ready.length > 0;
        setCanPay(available); setStatus(available
          ? catalog.salesRestricted ? t('支付验收中：此账号可按正式价格购买测试成果包。', 'Payment verification: this account can buy an export at its listed price.') : t('成果已准备好，可按份购买。', 'Your export is ready to purchase.')
          : catalog.salesEnabled && catalog.salesRestricted ? t('支付正在进行小额验收，当前账号暂不能购买。在线查看与基础文本复制仍可使用。', 'Payments are being verified with selected accounts. Purchases are not available for this account. Online reading and text copying remain available.') : t('成果已保存，支付尚未开放。在线查看与基础文本复制仍可使用。', 'Export saved. Payments are not open yet. Online reading and basic text copying remain available.'));
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const buy = async (provider: string) => {
    if (!artifact || busy) return; setBusy(true); setError('');
    try { setOrder(await billingRequest<BillingOrder>('/billing/orders', 'POST', { sku: 'export', provider, artifactId: artifact.id, requestId: requestId.current })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <button onClick={() => setOpen(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg">{t('导出成果包', 'Export package')}</button>
    {open && <div className="fixed inset-0 z-[130] bg-black/85 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={t('导出成果包', 'Export package')}><div className="max-w-xl w-full max-h-[90vh] overflow-auto bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4 text-slate-200">
      <div className="flex justify-between"><h2 className="font-bold text-lg">{t('导出成果包', 'Export package')}</h2><button onClick={() => setOpen(false)} className="text-sm text-slate-400">{t('关闭', 'Close')}</button></div>
      <h3>{report.title}</h3><p className="text-sm text-slate-400">{t('包含排版报告（可打印为 PDF）、Markdown 和含引用的 JSON 研究记录。固定当前版本，不重新生成研究结论。', 'Includes a formatted report (printable as PDF), Markdown, and a JSON record with references. Exports the current version without generating new findings.')}</p>
      <p className="text-sm">{t('Free：¥3.99／份；Pro 有效期内不另收费。已解锁的同一版本可重复下载。', 'Free: ¥3.99 per package. Included with active Pro. Unlocked versions remain downloadable.')}</p>
      <p className="text-xs text-amber-200">{t('准备成果包会将此报告及引用上传到你的账户，用于保存版本与后续下载。', 'Preparing an export uploads this report and its references to your account for version storage and future downloads.')}</p>
      <button onClick={() => void prepare()} disabled={busy || !!order} className="px-4 py-2 bg-slate-800 rounded-lg text-sm disabled:opacity-40">{busy ? t('处理中…', 'Working…') : artifact ? t('检查权限并下载', 'Check access & download') : t('保存版本，准备成果包', 'Save version & prepare export')}</button>
      {canPay && !order && providers.map(provider => <button key={provider} onClick={() => void buy(provider)} disabled={busy} className="ml-2 px-4 py-2 bg-blue-600 rounded-lg text-sm disabled:opacity-40">{provider === 'wechat' ? t('微信购买 · ¥3.99', 'Buy with WeChat · ¥3.99') : t('支付宝购买 · ¥3.99', 'Buy with Alipay · ¥3.99')}</button>)}
      {status && <p role="status" className="text-sm text-blue-200">{status}</p>}{error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      {order && <Checkout key={order.id} order={order} onPaid={() => { if (artifact) void download(artifact.id).catch(e => setError(e.message)); }} onClose={() => { setOrder(null); requestId.current = crypto.randomUUID(); }} />}
    </div></div>}
  </>;
}
