import { platform } from '../services/native';
import React, { useState } from 'react';
import { billingRequest, ReportSnapshot } from '../services/billingClient';
import { downloadResearchExport } from '../services/researchExport';
import { useLanguage } from '../services/language';

/** 导出成果包：免费。保存当前版本到账户，然后直接下载（排版报告 + Markdown + JSON） */
export default function ReportExport({ report }: { report: ReportSnapshot }) {
  const { t } = useLanguage(); const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [status, setStatus] = useState('');
  const exportNow = async () => {
    setBusy(true); setError(''); setStatus('');
    try {
      const item = await billingRequest<{ id: string; title: string }>('/billing/artifacts', 'POST', { report });
      await downloadResearchExport(item.id);
      setStatus(t('成果包已下载。同一版本以后可在「个人中心 → 充值与订单」里重复下载。', 'Export downloaded. You can download it again from Personal center.'));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (platform() === 'ios') return <p className="text-xs text-slate-400">{t('本版可在线查看研究成果；成果包下载暂未在 iOS 开放。', 'Read research in the app. Export downloads are not available in this iOS version yet.')}</p>;
  return <>
    <button onClick={() => setOpen(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg">{t('导出成果包', 'Export package')}</button>
    {open && <div className="fixed inset-0 z-[130] bg-black/85 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={t('导出成果包', 'Export package')}><div className="max-w-xl w-full max-h-[90vh] overflow-auto bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4 text-slate-200">
      <div className="flex justify-between"><h2 className="font-bold text-lg">{t('导出成果包', 'Export package')}</h2><button onClick={() => setOpen(false)} className="text-sm text-slate-400">{t('关闭', 'Close')}</button></div>
      <h3>{report.title}</h3><p className="text-sm text-slate-400">{t('包含排版报告（可打印为 PDF）、Markdown 和含引用的 JSON 研究记录。固定当前版本，不重新生成研究结论。免费导出。', 'Includes a formatted report (printable as PDF), Markdown, and a JSON record with references. Exports the current version without generating new findings. Free.')}</p>
      <p className="text-xs text-amber-200">{t('导出会将此报告及引用保存到你的账户，方便以后重复下载。', 'Exporting saves this report and its references to your account so you can download it again later.')}</p>
      <button onClick={() => void exportNow()} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold disabled:opacity-40">{busy ? t('处理中…', 'Working…') : t('下载成果包', 'Download export')}</button>
      {status && <p role="status" className="text-sm text-blue-200">{status}</p>}{error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    </div></div>}
  </>;
}
