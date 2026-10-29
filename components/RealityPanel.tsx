import React, { useState } from 'react';
import type { RealityCheck } from '../services/realityActions';

/**
 * 现实验证：AI 发出去的问卷、预售页、查过的企业，以及回来的真实数字。
 * 链接要发到目标人群手里才有回答——这里一键复制。
 */
const ICON: Record<RealityCheck['kind'], string> = { survey: '📋', page: '🧪', company: '🔎', audio: '🎙', poi: '📍', stats: '📊' };

const RealityPanel: React.FC<{ checks?: RealityCheck[]; onSync: () => Promise<void>; onClose: (id: string) => void; onOpenNode: (id: string) => void; onUpload?: (f: File) => Promise<void> }> = ({ checks = [], onSync, onClose, onOpenNode, onUpload }) => {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [up, setUp] = useState('');
  const upload = onUpload && (
    <label className="text-[12px] px-2 py-1 rounded-lg bg-sky-800/70 hover:bg-sky-700 text-sky-100 cursor-pointer whitespace-nowrap">
      {up || '🎙 上传访谈录音'}
      <input type="file" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.amr,.aac" className="hidden" disabled={!!up} onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setUp('正在上传…'); try { await onUpload(f); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setUp(''); } }} />
    </label>
  );
  if (!checks.length) return upload ? <section className="rounded-xl border border-sky-700/40 bg-sky-950/15 p-3 flex items-center gap-2 flex-wrap" aria-label="现实验证"><span className="text-[14px] font-bold text-sky-200">🧪 现实验证</span><span className="text-[11px] text-slate-500">做过用户访谈、实验记录？把录音传上来，转成文字后 AI 提炼成证据</span><span className="ml-auto">{upload}</span></section> : null;
  const list = [...checks].reverse();
  const copy = async (c: RealityCheck) => { try { await navigator.clipboard.writeText(c.url || ''); setCopied(c.id); setTimeout(() => setCopied(''), 1500); } catch { /* 不支持就算了，链接也能直接点 */ } };
  return (
    <section className="rounded-xl border border-sky-700/40 bg-sky-950/15 p-3 space-y-2" aria-label="现实验证">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-bold text-sky-200">🧪 现实验证</span>
        <span className="text-[11px] text-slate-500">AI 发出去问真人的东西；数字够了会自动总结成证据、接着推进</span>
        <span className="ml-auto">{upload}</span>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await onSync(); } finally { setBusy(false); } }} className="whitespace-nowrap text-[12px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40">{busy ? '正在拿最新数字…' : '↻ 拿最新数字'}</button>
      </div>
      <ul className="divide-y divide-slate-800">
        {list.map(c => (
          <li key={c.id} className="py-2 text-[12px] space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span>{ICON[c.kind]}</span>
              <span className="text-slate-200 font-medium">{c.title}</span>
              {c.closed && !['company', 'poi', 'stats'].includes(c.kind) && <span className="text-[10px] text-slate-500">已关闭</span>}
              {c.nodeId && <button onClick={() => onOpenNode(c.nodeId!)} className="text-[11px] text-blue-300 hover:underline">看这一步</button>}
            </div>
            {c.kind === 'audio' && <div className="text-slate-400">{c.status === 'SUCCEEDED' ? `转好了 · ${Math.round((c.durationSec || 0) / 60)} 分钟` : c.status === 'FAILED' ? '没转成功（钱已退回）' : '正在转文字，一般几分钟…'}</div>}
            {c.kind === 'survey' && <div className="text-slate-400">已回收 <b className="text-slate-100">{c.count || 0}</b>{c.target ? ` / 目标 ${c.target}` : ''} 份</div>}
            {c.kind === 'page' && <div className="text-slate-400">访客 <b className="text-slate-100">{c.visitors || 0}</b> · 点按钮 <b className="text-slate-100">{c.clicks || 0}</b> · 留联系方式 <b className="text-emerald-300">{c.leads || 0}</b>{c.deposits ? <> · 付意向金 <b className="text-amber-300">{c.deposits}</b></> : null}</div>}
            {c.summary && <div className="text-emerald-300">结论：{c.summary}</div>}
            {c.url && !c.closed && <div className="flex items-center gap-2 flex-wrap">
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline truncate max-w-[60%]">{c.url}</a>
              <button onClick={() => void copy(c)} className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200">{copied === c.id ? '已复制' : '复制链接'}</button>
              {c.kind === 'page' && <button onClick={() => onClose(c.id)} className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400">关闭页面</button>}
              <span className="text-[11px] text-slate-500">发到目标人群（群聊、朋友圈、客户群）才有真实回答</span>
            </div>}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default RealityPanel;
