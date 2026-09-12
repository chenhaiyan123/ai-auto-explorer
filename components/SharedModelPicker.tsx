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
  return <div className="space-y-2 text-xs">
    <label className="block">{ui("平台共享模型")}<select required aria-label={ui("平台共享模型")} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-slate-200" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{ui("选择管理员提供的模型")}</option>
      {value && !catalog?.models.some(m => m.id === value) && <option value={value}>{value}（等待核对是否可用）</option>}
      {catalog?.models.map(m => { const s = sharedModelStatus(m); return <option key={m.id} value={m.id} disabled={!s.available}>{s.available ? '🟢' : '⚪'} {m.label} · {s.label} · 剩余 {(catalog.balances[m.id]?.available || 0).toLocaleString()} Token</option>; })}
      {missingSharedPresets(catalog?.models || []).map(p => <option key={`preset-${p.id}`} disabled value={`unconfigured-${p.id}`}>⚪ {p.label} · {!catalog ? '状态待确认' : p.deferred ? '预留接口，未开放' : '待配置 Key'}</option>)}
    </select></label>
    <button type="button" className="text-violet-300 underline" onClick={() => setRevision(n => n + 1)}>{ui("刷新可用模型与余额")}</button>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    {catalog && !catalog.models.some(m => sharedModelStatus(m).available) && <p className="text-slate-400">{ui("管理员尚未提供可用的共享模型。")}</p>}
    <p className="text-slate-400">绿点表示已配置 Key 且已开放，灰点表示暂不可用；不代表实时连接检测。个人额度另行计算。</p>
    <p className="text-slate-400">不需要填写共享 Key。各模型额度分别计算；测试连接也会使用额度。额度不足时，可联系管理员或切换自己的 API。</p>
  </div>;
}
