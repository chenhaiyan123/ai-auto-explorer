import React, { useState } from 'react';
import type { Digest } from '../services/digest';
import { digestSections } from '../services/digest';

/**
 * 项目总览最上面：最近一次成果播报 + 以前的播报。
 * 用户不看过程，只看「做成了什么、学到了什么、闭了哪些环、自己有没有成长」。
 */
const day = (at: number) => new Date(at).toLocaleDateString();

const Card: React.FC<{ d: Digest }> = ({ d }) => (
  <div className="space-y-2">
    <div className="text-[14px] font-bold text-slate-100 leading-6">{d.headline || '这段时间的成果'}</div>
    {digestSections(d).map(s => (
      <div key={s.label}>
        <div className="text-[12px] font-semibold text-slate-400">{s.label}</div>
        <ul className="space-y-0.5 text-[13px] leading-6 text-slate-200">{s.items.map((x, i) => <li key={i} className="flex gap-1.5"><span className="text-slate-500">·</span><span className="min-w-0">{x}</span></li>)}</ul>
      </div>
    ))}
  </div>
);

const DigestPanel: React.FC<{ digests?: Digest[]; busy?: boolean; onNow: () => void }> = ({ digests = [], busy, onNow }) => {
  const [showOld, setShowOld] = useState(false);
  const latest = digests[0];
  return (
    <section className="rounded-xl border border-amber-600/40 bg-amber-950/15 p-3 space-y-3" aria-label="成果播报">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[14px] font-bold text-amber-200">📣 成果播报</span>
        {latest && <span className="text-[11px] text-slate-500">{day(latest.since)} – {day(latest.at)}</span>}
        <button onClick={onNow} disabled={busy} className="ml-auto text-[12px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40">{busy ? '正在整理…' : '现在播报一次'}</button>
      </div>
      {latest ? <Card d={latest} /> : <p className="text-[12px] text-slate-400 leading-5">还没有播报。有了新进展后，我会定期（至少隔一天）告诉你：做了什么、有什么心得、哪些事被现实验证了，以及你自己往前走了哪一步。</p>}
      {digests.length > 1 && (
        <div>
          <button onClick={() => setShowOld(v => !v)} className="text-[12px] text-slate-400 hover:text-slate-200">{showOld ? '收起以前的播报' : `以前的播报（${digests.length - 1}）`}</button>
          {showOld && <div className="mt-2 space-y-3 divide-y divide-slate-800">{digests.slice(1).map(d => <div key={d.id} className="pt-3"><div className="text-[11px] text-slate-500 mb-1">{day(d.since)} – {day(d.at)}</div><Card d={d} /></div>)}</div>}
        </div>
      )}
    </section>
  );
};

export default DigestPanel;
