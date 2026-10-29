import React, { useEffect, useState } from 'react';
import { sharedRequest } from '../services/sharedModelsClient';

/** 管理员：平台直连服务的密钥和价格（密钥只写不读，服务器加密保存） */
type Cfg = { wjx: boolean; tyc: boolean; asr?: boolean; asrOwn?: boolean; prices: Record<string, number> };
const LABEL: Record<string, string> = { company_search: '企业搜索 / 次', company_info: '企业详情 / 次', survey_create: '发一份问卷', page_create: '做一个预售页', asr_file: '录音转文字 / 个' };

export default function PlatformAdmin() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [wjx, setWjx] = useState(''), [tyc, setTyc] = useState(''), [asr, setAsr] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const load = () => sharedRequest<Cfg>('/admin/platform').then(c => { setCfg(c); setPrices(Object.fromEntries(Object.entries(c.prices).map(([k, v]) => [k, (v / 100).toFixed(2)]))); }).catch(e => setMsg(e.message));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    setMsg('');
    const body: Record<string, unknown> = { prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Math.round(Number(v) * 100)])) };
    if (wjx.trim()) body.wjxKey = wjx.trim();
    if (tyc.trim()) body.tycKey = tyc.trim();
    if (asr.trim()) body.asrKey = asr.trim();
    try { setCfg(await sharedRequest<Cfg>('/admin/platform', 'PUT', body)); setWjx(''); setTyc(''); setAsr(''); setMsg('已保存'); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const field = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm';
  return <div className="space-y-4 text-sm">
    <p className="text-slate-400 leading-6">平台用自己的账号去调第三方，用户和 AI 按次从 AI 钱包付费（失败自动退回；每人每天最多 ¥50）。密钥只写不读，服务器加密保存；没填的服务对用户显示「待开通」。</p>
    <div className="grid sm:grid-cols-2 gap-4">
      <label className="space-y-1"><div>问卷星 API Key {cfg && <span className={cfg.wjx ? 'text-emerald-400' : 'text-amber-300'}>{cfg.wjx ? '· 已配置' : '· 未配置'}</span>}</div><input type="password" value={wjx} onChange={e => setWjx(e.target.value)} placeholder={cfg?.wjx ? '已配置，填新的会覆盖' : '问卷星后台 → 开放平台 → API Key'} className={field} autoComplete="off" /></label>
      <label className="space-y-1"><div>天眼查授权 {cfg && <span className={cfg.tyc ? 'text-emerald-400' : 'text-amber-300'}>{cfg.tyc ? '· 已配置' : '· 未配置'}</span>}</div><input type="password" value={tyc} onChange={e => setTyc(e.target.value)} placeholder={cfg?.tyc ? '已配置，填新的会覆盖' : '天眼查 AI 开放平台的 API Key'} className={field} autoComplete="off" /></label>
      <label className="space-y-1 sm:col-span-2"><div>录音转文字（阿里云百炼 Key，选填） {cfg && <span className={cfg.asr ? 'text-emerald-400' : 'text-amber-300'}>{cfg.asr ? (cfg.asrOwn ? '· 已配置' : '· 已开通（借用通义千问的百炼 Key）') : '· 未配置'}</span>}</div><input type="password" value={asr} onChange={e => setAsr(e.target.value)} placeholder="留空就借用「共享模型」里通义千问的百炼 Key；想单独计费再填" className={field} autoComplete="off" /></label>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Object.keys(LABEL).map(k => <label key={k} className="space-y-1"><div className="text-slate-400 text-xs">{LABEL[k]}（元）</div><input type="number" min="0" step="0.01" value={prices[k] ?? ''} onChange={e => setPrices(p => ({ ...p, [k]: e.target.value }))} className={field} /></label>)}</div>
    <div className="flex items-center gap-3"><button onClick={() => void save()} className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold">保存</button>{msg && <span className="text-slate-300">{msg}</span>}</div>
    <p className="text-xs text-slate-500 leading-5">价格建议：成本价上浮一点。问卷星样本（付费找人答）暂不自动下单，需要时人工代下。预售页由平台自建，公开在 pay.hiexplore.com/p/…，页脚会写明是用户创建、不收费。</p>
  </div>;
}
