import React, { useEffect, useState } from 'react';
import { sharedRequest, type SharedCatalog } from '../services/sharedModelsClient';
import { useLanguage } from '../services/language';

export default function ResearchActivation({ busy, starterTokens, mailReady, recipient, onStart, onAdvanced }: {
  busy: boolean; starterTokens: number; mailReady: boolean; recipient: string;
  onStart: (modelId: string, paperQuery: string, emailEnabled: boolean) => Promise<boolean>; onAdvanced: () => void;
}) {
  const { t } = useLanguage(); const [open, setOpen] = useState(false); const [catalog, setCatalog] = useState<SharedCatalog>();
  const [error, setError] = useState(''); const [modelId, setModel] = useState(''); const [source, setSource] = useState('input');
  const [query, setQuery] = useState(''); const [email, setEmail] = useState(false);
  useEffect(() => {
    if (!open) return; let active = true;
    sharedRequest('/shared/catalog').then(c => { if (active) { setCatalog(c); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open]);
  return <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/20 p-4 space-y-3">
    <h4 className="font-semibold">{t('让它替我持续关注', 'Keep watching this for me')}</h4>
    <p className="text-sm text-slate-300">{t('开启后，即使关闭电脑，项目经理也会按计划检查线索。有新依据才继续探索，缺少材料时明确等待。', 'Once enabled, your manager checks for clues even when your computer is off. New evidence drives research; missing evidence becomes an explicit wait.')}</p>
    {!open ? <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm" onClick={() => setOpen(true)}>{t('设置并开启长期关注', 'Set up ongoing research')}</button> : <div className="space-y-3">
      <p className="text-xs text-slate-400">{t('本次为团队统一选择云端模型；已有的分角色后台模型配置将被替换。自定义角色模型可使用高级设置。', 'Choose one cloud model for this team. This replaces existing per-role cloud model bindings; use advanced settings to keep custom bindings.')}</p>
      <fieldset className="space-y-2"><legend className="text-sm">{t('选择模型', 'Choose a model')}</legend>
        {catalog?.models.map(m => { const hasBalance = (catalog.balances[m.id]?.available || 0) >= 4096; const canClaim = starterTokens >= 4096 && !Object.values(catalog.balances).some(b => b.granted > 0); const ready = m.enabled && m.hasKey && m.dailyTokens - m.usedToday >= 4096 && (hasBalance || canClaim);
          return <label key={m.id} className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${ready ? 'border-slate-600' : 'border-slate-800 text-slate-500'}`}>
            <input type="radio" name="activation-model" disabled={!ready || busy} checked={modelId === m.id} onChange={() => setModel(m.id)} />
            <span aria-hidden className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-400' : 'bg-slate-500'}`} />{m.label}
            <span className="ml-auto text-xs">{ready ? `${t('余额', 'Balance')} ${(catalog?.balances[m.id]?.available || 0).toLocaleString()} Token` : t('暂不可用', 'Unavailable')}</span>
          </label>; })}
      </fieldset>
      {error && <p role="alert" className="text-amber-300 text-xs">{error}</p>}
      <p className="text-xs text-slate-400">{starterTokens ? t(`符合条件的账号可在首次开启时领取 ${starterTokens.toLocaleString()} Token，一次性、全站有总额上限；用完后停止，不自动扣款。`, `Eligible accounts can claim ${starterTokens.toLocaleString()} tokens once, subject to a shared pool limit. No automatic charges when exhausted.`) : t('使用已分配的模型额度；额度不足时请联系管理员或接入自有 API。', 'Uses your assigned credits. Contact the administrator or use your own API if credits are insufficient.')}</p>
      <label className="block text-sm">{t('关注什么来源', 'Evidence source')}<select value={source} onChange={e => setSource(e.target.value)} className="mt-1 w-full rounded-lg bg-slate-950 p-2"><option value="input">{t('我的资料 / 实验结果（由我提交）', 'My materials / experiment results (I submit them)')}</option><option value="paper">{t('相关论文线索 + 我的资料', 'Paper metadata + my materials')}</option></select></label>
      {source === 'paper' && <label className="block text-xs">{t('论文关键词（建议英文短词）', 'Paper keywords (short English terms recommended)')}<input maxLength={300} value={query} onChange={e => setQuery(e.target.value)} className="mt-1 w-full rounded-lg bg-slate-950 p-2" placeholder="passive cooling ventilation" /><span className="text-slate-400">{t('通过 Crossref 检查标题、摘要和 DOI，未核验全文；目前不自动监测任意网页或设备。', 'Checks Crossref titles, abstracts and DOIs, not verified full texts. Arbitrary websites and devices are not monitored automatically.')}</span></label>}
      <p className="text-xs text-slate-400">{t('每天检查一次，安静期逐步降低频率；每周复盘。每日最多 8 次模型调用，每次唤醒最多 4 次。没有新依据不会反复提高结论置信度。', 'Checks daily, less often when quiet; reviews weekly. Up to 8 model calls/day and 4 per wake. No confidence gains without new evidence.')}</p>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={email} disabled={!mailReady || !recipient || busy} onChange={e => setEmail(e.target.checked)} /><span>{t('有重要变化时发邮件给我', 'Email me when something important changes')}{mailReady && recipient ? ` · ${recipient}` : ` · ${t('邮件服务待配置，站内提醒可用', 'Email not configured; in-app updates available')}`}<br />{t('默认关闭；每个账号至少间隔 12 小时，每 24 小时最多 2 封，可随时退订。', 'Off by default; at least 12 hours apart and at most 2 emails per account per 24 hours. Unsubscribe anytime.')}</span></label>
      <div className="flex flex-wrap gap-2"><button disabled={busy || !modelId || (source === 'paper' && !query.trim())} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm disabled:opacity-40" onClick={async () => { if (await onStart(modelId, source === 'paper' ? query.trim() : '', email)) setOpen(false); }}>{busy ? t('正在开启…', 'Starting…') : t('确认开启长期关注', 'Start ongoing research')}</button><button disabled={busy} className="text-xs text-blue-300" onClick={onAdvanced}>{t('自有 API / 高级设置', 'Own API / advanced settings')}</button></div>
    </div>}
  </div>;
}
