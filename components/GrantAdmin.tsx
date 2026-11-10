import React, { useEffect, useState } from 'react';
import { billingRequest } from '../services/billingClient';

/**
 * 管理员发体验金：填邮箱（可多个）、金额、原因 → 直接加到对方的用户钱包。
 * 对方用这个邮箱登录就能看到；体验金只能在平台里花（AI 用模型、平台服务、服务广场下单），不能提现。
 * 发错了可以收回（只能收回对方还没花掉的部分）。
 */
type Item = { txId: string; email: string; cents: number; note: string; at: number; admin: string; revokedCents: number; balanceCents: number };
type View = { limits: { maxCents: number; dailyCents: number; todayCents: number }; totalCents: number; revokedCents: number; people: number; items: Item[] };
const yuan = (c: number) => `¥${(c / 100).toFixed(2)}`;
const field = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm';

export default function GrantAdmin() {
  const [v, setV] = useState<View | null>(null);
  const [emails, setEmails] = useState('');
  const [amount, setAmount] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  const load = () => billingRequest<View>('/admin/billing/grants').then(setV).catch(e => setMsg(e.message));
  useEffect(() => { void load(); }, []);

  const list = [...new Set(emails.split(/[\s,，;；]+/).map(e => e.trim().toLowerCase()).filter(Boolean))];
  const cents = Math.round(Number(amount) * 100);
  const total = list.length * (cents > 0 ? cents : 0);
  const ready = list.length > 0 && cents >= 100 && note.trim().length > 0;

  const send = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await billingRequest<{ granted: { email: string }[]; totalCents: number }>('/admin/billing/grants', 'POST', { emails: list, cents, note: note.trim(), requestId: crypto.randomUUID() });
      setMsg(`已发给 ${r.granted.length} 人，共 ${yuan(r.totalCents)}。对方用这个邮箱登录后，在「个人中心 → 我的钱包」能看到。`);
      setEmails(''); setNote(''); setConfirm(false); await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const revoke = async (it: Item) => {
    if (!window.confirm(`收回发给 ${it.email} 的 ${yuan(it.cents)} 体验金？只能收回对方还没花掉的部分。`)) return;
    setBusy(true); setMsg('');
    try { const r = await billingRequest<{ revokedCents: number }>('/admin/billing/grants/revoke', 'POST', { txId: it.txId }); setMsg(`收回了 ${yuan(r.revokedCents)}`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return <div className="space-y-4 text-sm">
    <p className="text-slate-400 leading-6">给种子用户、内测用户、合作方发体验金：钱直接进对方的用户钱包，可以用来让 AI 调模型、用平台服务、在服务广场下单。和充值的钱一样只能在平台里花、不能提现。运营数据里单独统计，不算收入。对方还没注册也可以发，用这个邮箱登录后就能看到。</p>
    {v && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[['累计发出', yuan(v.totalCents - v.revokedCents)], ['发给了', `${v.people} 人`], ['今天已发', `${yuan(v.limits.todayCents)} / ${yuan(v.limits.dailyCents)}`], ['每人单笔上限', yuan(v.limits.maxCents)]].map(([k, val]) =>
        <div key={k} className="rounded-xl border border-slate-700 p-3"><div className="text-[11px] text-slate-400">{k}</div><div className="text-lg font-bold text-slate-100 tabular-nums">{val}</div></div>)}
    </div>}

    <section className="rounded-xl border border-slate-700 p-3 space-y-3" aria-label="发体验金">
      <label className="block space-y-1"><div>发给谁（登录邮箱，多个用空格、逗号或换行隔开，一次最多 50 个）</div>
        <textarea value={emails} onChange={e => { setEmails(e.target.value); setConfirm(false); }} rows={3} placeholder="a@qq.com, b@163.com" className={field} /></label>
      <div className="grid sm:grid-cols-[160px_1fr] gap-3">
        <label className="block space-y-1"><div>每人金额（元）</div>
          <input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setConfirm(false); }} className={field} />
          <div className="flex gap-1">{[5, 10, 30, 50].map(n => <button key={n} onClick={() => { setAmount(String(n)); setConfirm(false); }} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[12px] text-slate-300">{n}</button>)}</div></label>
        <label className="block space-y-1"><div>发放原因（对方在钱包流水里能看到）</div>
          <input value={note} maxLength={100} onChange={e => setNote(e.target.value)} placeholder="例如：内测体验 / 种子用户回馈" className={field} /></label>
      </div>
      {!confirm
        ? <button disabled={!ready || busy} onClick={() => setConfirm(true)} className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold disabled:opacity-40">发体验金{ready ? `（${list.length} 人 × ${yuan(cents)} = ${yuan(total)}）` : ''}</button>
        : <div className="flex items-center gap-2 flex-wrap rounded-lg bg-amber-950/40 border border-amber-700/50 p-2">
            <span className="text-amber-200">确认给 {list.length} 人各发 {yuan(cents)}，共 {yuan(total)}？</span>
            <button disabled={busy} onClick={() => void send()} className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold disabled:opacity-40">{busy ? '正在发…' : '确认发放'}</button>
            <button disabled={busy} onClick={() => setConfirm(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300">再改改</button>
          </div>}
      {msg && <p role="status" className="text-emerald-300">{msg}</p>}
    </section>

    <section aria-label="发放记录">
      <div className="flex justify-between items-center mb-2"><h3 className="font-semibold">发放记录</h3><button onClick={() => void load()} className="text-blue-300 text-[12px]">刷新</button></div>
      {!v ? <p className="text-slate-500">正在读取…</p> : !v.items.length ? <p className="text-slate-500">还没发过体验金。</p> :
        <div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr className="text-slate-400">{['时间', '邮箱', '金额', '原因', '对方钱包余额', '经办', ''].map(h => <th key={h} className="p-2 text-left font-normal">{h}</th>)}</tr></thead>
          <tbody>{v.items.map(it => <tr key={it.txId} className="border-t border-slate-800">
            <td className="p-2 whitespace-nowrap">{new Date(it.at).toLocaleString()}</td>
            <td className="p-2 break-all">{it.email}</td>
            <td className="p-2 tabular-nums">{yuan(it.cents)}{it.revokedCents > 0 && <span className="block text-amber-300">已收回 {yuan(it.revokedCents)}</span>}</td>
            <td className="p-2">{it.note}</td>
            <td className="p-2 tabular-nums">{yuan(it.balanceCents)}</td>
            <td className="p-2 break-all text-slate-500">{it.admin}</td>
            <td className="p-2">{!it.revokedCents && <button disabled={busy} onClick={() => void revoke(it)} className="text-amber-300 hover:underline disabled:opacity-40">收回</button>}</td>
          </tr>)}</tbody></table></div>}
    </section>
  </div>;
}
