import { t as ui } from '../services/language';
import React, { useEffect, useState } from 'react';
import { sharedRequest, SHARED_MODELS_CHANGED, type SharedCatalog } from '../services/sharedModelsClient';
import { missingSharedPresets, sharedModelStatus } from '../services/sharedModelCatalog';

export default function SharedModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [catalog, setCatalog] = useState<SharedCatalog>(); const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; let request = 0;
    const refresh = () => {
      const current = ++request;
      sharedRequest('/shared/catalog').then(c => { if (active && current === request) { setCatalog(c); setError(''); } }).catch(e => { if (active && current === request) setError(e.message); });
    };
    refresh();
    window.addEventListener(SHARED_MODELS_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener(SHARED_MODELS_CHANGED, refresh); window.removeEventListener('focus', refresh); };
  }, [revision]);
  const status = (m: SharedCatalog['models'][number]) => catalog?.calls.some(c => c.modelId === m.id && c.status === 'uncertain')
    ? { available: false, label: ui('用量待核对', 'Usage reconciliation needed') }
    : error
    ? { available: false, label: ui('状态待确认，请刷新', 'Refresh to verify availability') }
    : sharedModelStatus(m, catalog?.balances[m.id] || { available: 0, granted: 0, spent: 0, held: 0 });
  return <div className="space-y-2 text-xs">
    <p className="font-medium text-slate-300">{ui('平台共享模型', 'Platform models')}</p>
    <div role="group" aria-label={ui('平台共享模型', 'Platform models')} className="max-h-72 overflow-y-auto space-y-2 pr-1">
      {catalog?.models.map(m => { const s = status(m); return <button type="button" key={m.id} disabled={!s.available} aria-pressed={value === m.id} onClick={() => onChange(m.id)} className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left disabled:cursor-not-allowed ${value === m.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/40'} ${s.available ? 'text-slate-100 hover:bg-slate-800' : 'text-slate-500'}`}>
        <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.available ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        <span className="min-w-0 flex-1"><span className="block font-medium">{m.label}</span><span className="mt-1 block break-all text-[11px]">{m.model} · {ui(s.label)}</span><span className="mt-1 block text-[11px]">{ui('剩余额度', 'Available credits')} {(catalog?.balances[m.id]?.available || 0).toLocaleString()} Token</span></span>
        {value === m.id && <span className="text-blue-300">✓ {ui('已选', 'Selected')}</span>}
      </button>; })}
      {value && !catalog?.models.some(m => m.id === value) && <p className="p-2 text-slate-400">{value} · {ui('当前选择尚未确认可用', 'Current selection is not verified')}</p>}
      {missingSharedPresets(catalog?.models || []).map(p => <div key={p.id} className="flex items-center gap-3 rounded-lg border border-slate-800 p-3 text-slate-500"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-500" /><span>{p.label} · {!catalog ? ui('状态待确认', 'Not verified') : ui('暂未提供', 'Not available')}</span></div>)}
    </div>
    <button type="button" className="text-violet-300 underline" onClick={() => setRevision(n => n + 1)}>{ui('刷新可用模型与余额', 'Refresh models & credits')}</button>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    <p className="text-slate-400">{ui('绿点：已配置、开放且有个人额度；灰点：暂不可选。连接结果以实际调用为准，勾选表示当前选择。', 'Green: configured, enabled and personal credits available. Gray: unavailable. Connectivity is verified on use; a checkmark indicates your selection.')}</p>
    <p className="text-slate-400">{ui('各模型额度分别计算；测试连接也使用额度。额度不足时，可联系管理员或使用自己的 API。', 'Credits are tracked per model. Connection tests also use credits. Contact the administrator or use your own API when credits run out.')}</p>
  </div>;
}
