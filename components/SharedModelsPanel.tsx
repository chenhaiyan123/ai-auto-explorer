import { t as ui } from '../services/language';
import React, { useEffect, useRef, useState } from 'react';
import { SHARED_MODEL_PRESETS, sharedModelStatus, missingSharedPresets } from '../services/sharedModelCatalog';
import { sharedRequest, type SharedCatalog, type SharedModel } from '../services/sharedModelsClient';

const field = 'w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100';
const button = 'rounded-lg bg-slate-700 px-3 py-2 text-sm disabled:opacity-40 hover:bg-slate-600';
const blankModel = { id: '', label: '', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: '', apiKey: '', enabled: false, dailyTokens: 100000, maxOutputTokens: 4096 };
function ModelStatus({ model }: { model: SharedModel }) {
  const s = sharedModelStatus(model);
  return <p className={`flex items-center gap-2 text-xs ${s.available ? 'text-emerald-300' : 'text-slate-400'}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${s.available ? 'bg-emerald-400' : 'bg-slate-500'}`} />{s.label}</p>;
}
const status: Record<string, string> = { reserved: '执行中·已预留', settled: '已结算', uncertain: '用量待核对', reconciled: '管理员已核对', cancelled: '未发送·已退回' };

export default function SharedModelsPanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const [session, setSession] = useState<{ owner: string; isAdmin: boolean }>();
  const [data, setData] = useState<SharedCatalog>(); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const formRef = useRef<HTMLDetailsElement>(null);
  const revealForm = () => requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  const [model, setModel] = useState(blankModel); const [editing, setEditing] = useState(false);
  const [grant, setGrant] = useState({ owner: '', modelId: '', tokens: 100000, note: '' });
  const grantId = useRef(crypto.randomUUID());
  const [reconcile, setReconcile] = useState({ callId: '', tokens: 0, note: '' });
  const refresh = async () => { const s = await sharedRequest<{ owner: string; isAdmin: boolean }>('/shared/session'); setSession(s); setData(await sharedRequest(s.isAdmin ? '/admin/shared' : '/shared/catalog')); };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } };
  const edit = (m: SharedModel) => { setModel({ ...m, apiKey: '' }); setEditing(true); setMessage(''); revealForm(); };
  return <div className={embedded ? '' : 'fixed inset-0 z-[70] bg-black/70 p-3 sm:p-8 flex items-center justify-center'} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-label={ui("模型与额度")}>
    <div className={embedded ? 'space-y-5 text-slate-200' : 'w-full max-w-5xl max-h-[92vh] overflow-auto rounded-2xl bg-slate-900 border border-slate-700 p-4 sm:p-6 text-slate-200 space-y-5'}>
      <div className="flex justify-between items-center gap-3"><h2 className="text-xl font-semibold">{session?.isAdmin ? ui("模型管理与额度分配") : ui("模型与额度")}</h2>{!embedded && <button className={button} onClick={onClose}>{ui("关闭")}</button>}</div>
      <p className="text-sm text-slate-400">共享模型按供应商返回的输入、输出 Token 合计使用额度，各模型分别记账。自己的 API Key 由供应商直接计费。</p>
      <p className="text-xs text-amber-200">当前支持管理员手动分配 Token，尚未开通在线充值或人民币余额。请求先预留额度、返回后结算；用量不明时保留预留额度，待管理员核对。</p>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}{message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
      <button className={button} disabled={busy} onClick={() => act(async () => {})}>{ui("刷新额度与记录")}</button>
      <div className="grid sm:grid-cols-2 gap-3">{data?.models.map(m => <article key={m.id} className="rounded-xl border border-slate-700 p-3 space-y-2">
        <h3 className="font-semibold">{m.label}</h3><ModelStatus model={m} /><p className="text-xs text-slate-400 break-all">{m.model} · {m.provider}</p>
        <p className="text-sm">可用 {(data.balances[m.id]?.available || 0).toLocaleString()} · 已用 {(data.balances[m.id]?.spent || 0).toLocaleString()} · 预留 {(data.balances[m.id]?.held || 0).toLocaleString()} Token</p>
        {session?.isAdmin && <><p className="text-xs text-slate-400">全站今日 {m.usedToday.toLocaleString()} / {m.dailyTokens.toLocaleString()} Token（含预留）</p><button className={button} disabled={busy} onClick={() => edit(m)}>{ui("编辑模型")}</button></>}
      </article>)}</div>
      <p className="text-xs text-slate-400">绿点：已配置 Key 且已开放；灰点：未配置、已暂停或日额度受限。状态不代表实时连接检测，个人余额另行计算。</p>
      {(!embedded || session?.isAdmin) && <div className="grid sm:grid-cols-2 gap-3">{missingSharedPresets(data?.models || []).map(p => <article key={p.id} className="rounded-xl border border-slate-800 p-3 space-y-2">
        <h3 className="font-semibold">{p.label}</h3><p className="flex items-center gap-2 text-xs text-slate-400"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-500" />{!data ? '状态待确认' : p.deferred ? '未开放 · 预留接口' : '待配置 Key'}</p>
        <p className="text-xs text-slate-500">{p.hint}</p>{session?.isAdmin && <button className={button} disabled={busy} onClick={() => { setModel({ ...blankModel, id: data?.models.some(m => m.id === p.id) ? `${p.id}-${crypto.randomUUID().slice(0, 8)}` : p.id, label: p.label, provider: p.provider, baseUrl: p.baseUrl }); setEditing(false); setAdding(true); revealForm(); }}>配置 {p.label}</button>}
      </article>)}</div>}
      {embedded && session && !session.isAdmin && <p role="alert" className="text-amber-300">当前登录邮箱没有管理员权限，请使用已在后台授权的邮箱登录。</p>}
      {session?.isAdmin && <>
        <details ref={formRef} open={editing || adding} className="rounded-xl border border-violet-700 p-3"><summary className="cursor-pointer font-semibold">{editing ? ui("编辑共享模型") : ui("添加共享模型")}</summary>
          <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => { await sharedRequest('/admin/shared/models', 'PUT', model); setModel(blankModel); setEditing(false); setAdding(false); setMessage('模型配置已保存，Key 不会返回页面'); }); }}><fieldset disabled={busy} className="space-y-3">
            <div className="flex flex-wrap gap-2">{SHARED_MODEL_PRESETS.map(p => <button type="button" key={p.id} className={button} onClick={() => setModel(m => ({ ...m, provider: p.provider, baseUrl: p.baseUrl, model: '', apiKey: '', enabled: false }))}>{p.label}{p.deferred ? '（预留）' : ''}</button>)}</div>
            <p className="text-xs text-slate-400">{SHARED_MODEL_PRESETS.find(p => p.baseUrl === model.baseUrl)?.hint}</p>
            <div className="grid sm:grid-cols-2 gap-3"><label>{ui("平台模型标识")}<input className={field} required disabled={editing} pattern="[a-zA-Z0-9_-]{1,100}" value={model.id} onChange={e => setModel({ ...model, id: e.target.value })} placeholder="例如 deepseek-economy" /></label><label>{ui("显示名称")}<input className={field} required maxLength={80} value={model.label} onChange={e => setModel({ ...model, label: e.target.value })} placeholder="例如 DeepSeek 日常研究" /></label></div>
            <label className="block">{ui("接口协议")}<select className={field} value={model.provider} onChange={e => setModel({ ...model, provider: e.target.value, apiKey: '' })}><option value="openai-compatible">{ui("OpenAI 兼容")}</option><option value="openai">OpenAI</option><option value="anthropic">Claude Messages</option></select></label>
            <label className="block">{ui("API 地址")}<input className={field} type="url" required value={model.baseUrl} onChange={e => setModel({ ...model, baseUrl: e.target.value, apiKey: '' })} /></label>
            <label className="block">{ui("供应商模型 ID")}<input className={field} required maxLength={160} value={model.model} onChange={e => setModel({ ...model, model: e.target.value })} placeholder="填写当前账户支持的模型 ID" /></label>
            <label className="block">API Key<input className={field} type="password" autoComplete="new-password" value={model.apiKey} onChange={e => setModel({ ...model, apiKey: e.target.value })} placeholder={editing ? '留空保留原 Key；更改接口后需重新填写' : '仅发送到平台后台，加密保存'} /></label>
            <div className="grid sm:grid-cols-2 gap-3"><label>{ui("全站每日 Token 上限")}<input className={field} type="number" required min={0} max={1000000000} value={model.dailyTokens} onChange={e => setModel({ ...model, dailyTokens: Number(e.target.value) })} /></label><label>{ui("单次最大输出 Token")}<input className={field} type="number" required min={64} max={16384} value={model.maxOutputTokens} onChange={e => setModel({ ...model, maxOutputTokens: Number(e.target.value) })} /></label></div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={model.enabled} onChange={e => setModel({ ...model, enabled: e.target.checked })} />{ui("向用户开放此模型")}</label>
            <p className="text-xs text-slate-400">模型日上限按 UTC 日期重置。Token 额度不是金额，不同模型的单位成本不同。保存不会自动发起付费测试。</p>
            <div className="flex gap-2"><button className={button} type="submit">{ui("保存共享模型")}</button>{editing && <button className={button} type="button" onClick={() => { setEditing(false); setModel(blankModel); }}>{ui("取消编辑")}</button>}</div>
          </fieldset></form>
        </details>
        <form className="rounded-xl border border-slate-700 p-3 space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => { await sharedRequest('/admin/shared/grants', 'POST', { ...grant, requestId: grantId.current }); grantId.current = crypto.randomUUID(); setGrant(g => ({ ...g, note: '' })); setMessage('Token 额度已增加；这是人工分配记录，不代表收款成功'); }); }}><h3 className="font-semibold">{ui("给用户增加额度")}</h3><fieldset disabled={busy} className="space-y-3">
          <label className="block">{ui("用户登录邮箱")}<input className={field} required type="email" value={grant.owner} onChange={e => { grantId.current = crypto.randomUUID(); setGrant({ ...grant, owner: e.target.value }); }} /></label>
          <label className="block">{ui("共享模型")}<select className={field} required value={grant.modelId} onChange={e => { grantId.current = crypto.randomUUID(); setGrant({ ...grant, modelId: e.target.value }); }}><option value="">{ui("选择模型")}</option>{data?.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
          <label className="block">{ui("增加 Token")}<input className={field} type="number" required min={1} max={1000000000} value={grant.tokens} onChange={e => { grantId.current = crypto.randomUUID(); setGrant({ ...grant, tokens: Number(e.target.value) }); }} /></label>
          <label className="block">{ui("分配依据或订单备注")}<input className={field} required maxLength={500} value={grant.note} onChange={e => { grantId.current = crypto.randomUUID(); setGrant({ ...grant, note: e.target.value }); }} placeholder="例如：首批测试赠送 / 已核对订单编号" /></label><button className={button} type="submit">{ui("确认增加额度")}</button>
        </fieldset></form>
        <details className="text-sm"><summary className="cursor-pointer">用户余额与最近分配记录</summary><div className="mt-3 space-y-2">{data?.accounts?.map(a => <div key={a.owner}><p>{a.owner}</p>{Object.entries(a.balances).map(([id, b]) => <p key={id} className="text-xs text-slate-400">{id}：可用 {b.available} / 已用 {b.spent} / 预留 {b.held}</p>)}</div>)}{data?.grants?.map(g => <p key={g.id} className="text-xs text-slate-400">{new Date(g.at).toLocaleString()} · {g.owner} · {g.modelId} +{g.tokens} · {g.note}</p>)}</div></details>
      </>}
      <div className="space-y-3"><h3 className="font-semibold">最近使用记录（最多 100 条）</h3>{!data?.calls.length && <p className="text-sm text-slate-500">暂无调用记录。</p>}{data?.calls.map(c => <article key={c.id} className="rounded-lg border border-slate-700 p-3 text-xs space-y-1">
        <p>{new Date(c.at).toLocaleString()} · {c.modelId} · {status[c.status] || c.status}</p>{session?.isAdmin && <p>{c.owner}</p>}<p>预留 {c.reserved} · {c.charged === undefined ? '等待实际用量' : `实际扣除 ${c.charged}`} Token</p><p className="break-all text-slate-500">编号 {c.id}</p>{c.error && <p className="text-amber-300">{c.error}</p>}{c.note && <p>{c.note}</p>}{c.overrun && <p className="text-rose-300">供应商用量超过预留，模型已暂停，请核对接口限额。</p>}
        {session?.isAdmin && c.status === 'uncertain' && <button className={button} disabled={busy} onClick={() => setReconcile({ callId: c.id, tokens: 0, note: '' })}>核对这条用量</button>}
      </article>)}</div>
      {session?.isAdmin && reconcile.callId && <form className="rounded-xl border border-amber-700 p-3 space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => { await sharedRequest('/admin/shared/reconcile', 'POST', reconcile); setReconcile({ callId: '', tokens: 0, note: '' }); setMessage('已按核对结果结算'); }); }}><p className="text-xs break-all">核对调用 {reconcile.callId}。先查供应商记录，再填写实际 Token；只有确认未计费才填 0。</p><label className="block">实际总 Token<input className={field} type="number" min={0} max={1000000000} required value={reconcile.tokens} onChange={e => setReconcile({ ...reconcile, tokens: Number(e.target.value) })} /></label><label className="block">核对依据<input className={field} required maxLength={500} value={reconcile.note} onChange={e => setReconcile({ ...reconcile, note: e.target.value })} /></label><button className={button} disabled={busy} type="submit">确认核对并结算</button></form>}
    </div>
  </div>;
}
