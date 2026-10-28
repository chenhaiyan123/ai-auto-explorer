import React, { useState } from 'react';
import type { Project } from '../types';
import { transferProject, BILLING_API } from '../services/billingClient';
import WalletTopup, { useAIWallet } from './WalletTopup';

/**
 * 项目钱包：用户愿意投给这个项目的启动资金。
 * AI 在这个项目里花的钱（平台模型、服务广场下单、问卷 / 企业查询）从这里出；接单赚的钱进这里。
 * 余下的随时能收回用户钱包。钱只在平台内流转，不能提现。
 */
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const LABEL: Record<string, string> = { allocate: '放进项目钱包', release: '收回用户钱包', spend: 'AI 花掉', escrow: '服务广场下单（担保冻结）', refund: '退回', income: '接单收入' };
const ICON: Record<string, string> = { allocate: '➡️', release: '⬅️', spend: '🧠', escrow: '🔒', refund: '↩️', income: '💰' };
/** 站在「项目钱包」看：收回、花掉、冻结是出 */
const out = (type: string) => type === 'release' || type === 'spend' || type === 'escrow';

export const ProjectFunds: React.FC<{ project: Project }> = ({ project }) => {
  const { account, error, reload } = useAIWallet();
  const [amount, setAmount] = useState('20');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const pots = account?.wallet?.projects || {};
  const has = Object.prototype.hasOwnProperty.call(pots, project.id);
  const pot = pots[project.id] || 0;
  const user = account?.wallet?.balanceCents ?? 0;
  const tx = (account?.wallet?.tx || []).filter(t => t.projectId === project.id);
  const move = async (direction: 'in' | 'out') => {
    const cents = Math.round(Number(amount) * 100);
    if (!(cents > 0)) { setMsg('填一个金额'); return; }
    setBusy(true); setMsg('');
    try { await transferProject(project.id, cents, direction); setMsg(direction === 'in' ? `已放进 ${yuan(cents)}` : `已收回 ${yuan(cents)}`); await reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (!BILLING_API) return <section className="rounded-xl border border-emerald-700/50 bg-emerald-950/20 p-3 text-[12px] text-slate-400">项目钱包要在正式网站登录后使用（本地预览没有连后台）。</section>;
  return (
    <section className="rounded-xl border border-emerald-700/50 bg-emerald-950/20 p-3 space-y-2.5" aria-label="项目钱包">
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <div className="text-[11px] text-slate-400">项目钱包（这个项目的启动资金）</div>
          <div className="text-2xl font-bold text-slate-100 tabular-nums">{account ? yuan(pot) : '—'}</div>
        </div>
        <div className="text-[11px] text-slate-400 pb-1">用户钱包还有 <b className="text-slate-200">{account ? yuan(user) : '—'}</b></div>
      </div>
      {account ? (
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <label className="inline-flex items-center gap-1 text-slate-400">¥<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-label="金额（元）" className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100" /></label>
          {[10, 50, 100].map(v => <button key={v} onClick={() => setAmount(String(v))} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[12px]">{v}</button>)}
          <button disabled={busy} onClick={() => void move('in')} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-40">放进项目</button>
          <button disabled={busy || pot <= 0} onClick={() => void move('out')} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40">收回用户钱包</button>
        </div>
      ) : <p className="text-[12px] text-amber-300">{error ? `请先登录（${error}）` : '正在读取…'}</p>}
      {msg && <p role="status" className="text-[12px] text-emerald-300">{msg}</p>}
      <p className="text-[11px] text-slate-500 leading-5">{has
        ? '这个项目的 AI 花钱（平台模型、服务广场下单、问卷 / 企业查询）都从项目钱包出，钱不够就停下来问你；它接单赚的钱也进这里。剩下的随时能收回。'
        : '还没给这个项目放钱：现在 AI 花的是用户钱包。放进一笔后，这个项目就有了自己的钱包，AI 在这个额度里自己决定怎么花、怎么赚。'}</p>
      {tx.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-slate-400">项目钱包流水（{tx.length}）</summary>
          <ul className="mt-2 divide-y divide-slate-800">
            {tx.map(t => (
              <li key={t.id} className="flex items-center gap-2 py-1.5">
                <span>{ICON[t.type] || '·'}</span>
                <div className="min-w-0 flex-1"><div className="text-slate-200 truncate">{t.note || LABEL[t.type] || t.type}</div><div className="text-[11px] text-slate-500">{new Date(t.at).toLocaleString()} · 余额 {yuan(t.balanceAfter)}</div></div>
                <span className={`font-mono ${out(t.type) ? 'text-slate-100' : 'text-emerald-300'}`}>{out(t.type) ? '-' : '+'}{yuan(t.cents)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="text-[12px]"><summary className="cursor-pointer text-slate-400">给用户钱包充值</summary><div className="mt-2"><WalletTopup compact /></div></details>
    </section>
  );
};

/** AI 项目经理简介：AI 写，用户确认后挂到服务广场 */
export const PmProfileCard: React.FC<{ project: Project; busy?: boolean; onRefresh?: () => Promise<string>; onPublish?: (on: boolean) => Promise<string> }> = ({ project, busy, onRefresh, onPublish }) => {
  const st = project.pmProfile;
  const pr = st?.draft || st?.published;
  const [msg, setMsg] = useState('');
  const [working, setWorking] = useState(false);
  const run = async (fn?: () => Promise<string>) => { if (!fn) return; setWorking(true); setMsg(''); try { setMsg(await fn()); } finally { setWorking(false); } };
  const live = !!st?.published && !st.hidden;
  return (
    <section className="rounded-xl border border-sky-700/40 bg-sky-950/20 p-3 space-y-2" aria-label="AI 项目经理简介">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-slate-200">🪪 AI 项目经理简介</span>
        <span className={`text-[11px] px-1.5 py-0.5 rounded ${live ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{live ? (st?.draft ? '已挂在服务广场 · 有新草稿' : '已挂在服务广场') : st?.draft ? '草稿 · 等你确认' : '还没写'}</span>
        {onRefresh && <button disabled={busy || working} onClick={() => void run(onRefresh)} className="ml-auto text-[11px] text-blue-300 hover:underline disabled:opacity-40">{busy ? '正在写…' : pr ? '让 AI 重新写' : '让 AI 现在写一份'}</button>}
      </div>
      {!pr ? (
        <p className="text-[12px] text-slate-400 leading-5">AI 做完几步之后会自己写：在这个项目里攒下了什么本事和数据、能接什么活、需要什么。你确认后才挂到服务广场，别人下单由这个 AI 接单交付，收入进项目钱包。越做越深，简介会跟着更新。</p>
      ) : (
        <div className="text-[12px] text-slate-300 space-y-1.5 leading-5">
          <div className="text-[14px] font-semibold text-slate-100">{pr.title}</div>
          <p>{pr.summary}</p>
          <div><b className="text-slate-200">能接的活</b><ul className="pl-3">{pr.canDo.map((s, i) => <li key={i}>· {s}</li>)}</ul></div>
          {!!pr.edge.length && <div><b className="text-slate-200">攒下来的</b><ul className="pl-3">{pr.edge.map((s, i) => <li key={i}>· {s}</li>)}</ul></div>}
          {!!pr.needs.length && <div><b className="text-slate-200">它需要</b><ul className="pl-3">{pr.needs.map((s, i) => <li key={i}>· {s}</li>)}</ul></div>}
          <div className="text-slate-400">起步价 ¥{pr.priceYuan} · {pr.deliveryDays} 天交付 · 依据：已做完 {pr.basis} 步 · {new Date(pr.updatedAt).toLocaleDateString()}</div>
        </div>
      )}
      {pr && onPublish && (
        <div className="flex items-center gap-2 flex-wrap">
          {(st?.draft || !live) && <button disabled={working} onClick={() => void run(() => onPublish(true))} className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[13px] font-bold disabled:opacity-40">{live ? '确认更新到服务广场' : '确认，挂到服务广场'}</button>}
          {live && <button disabled={working} onClick={() => void run(() => onPublish(false))} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[12px] disabled:opacity-40">撤下</button>}
          <span className="text-[11px] text-slate-500">挂出去会同时打开「允许 AI 接单」；全站都能看到这份简介。</span>
        </div>
      )}
      {msg && <p role="status" className="text-[12px] text-emerald-300">{msg}</p>}
    </section>
  );
};
