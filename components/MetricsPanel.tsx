import React, { useEffect, useState } from 'react';
import { sharedRequest, SHARED_API } from '../services/sharedModelsClient';

/**
 * 运营数据（管理员）：用户数据 / 成交数据。
 * 全是服务器里真实发生的记录，不估算；默认剔除管理员和测试账号，可以切换看全量。
 */
type Daily = { day: string } & Record<string, number | string>;
export interface Metrics {
  generatedAt: number; includeInternal: boolean;
  users: { total: number; new7: number; new30: number; dau: number; wau: number; mau: number; usedAI: number; market: number; payers: number; repeatPayers: number;
    retentionD1: { base: number; back: number } | null; retentionD7: { base: number; back: number } | null; trackedSince: number | null; daily: Daily[] };
  money: { paidOrders: number; paidCents: number; topupCount: number; topupCents: number; subscriptionCount: number; subscriptionCents: number; arppuCents: number; walletSpendCents: number; walletBalanceCents: number | null; grantCents?: number; grantPeople?: number;
    market: { services: number; demands: number; bids: number; orders: number; ordersAll: number; completed: number; gmvCents: number; completedCents: number; walletPaidOrders: number; byAIBuyer: number; byAISeller: number; feeCents: number };
    daily: Daily[]; recent: { at: number; kind: string; cents: number; who: string; via?: string; title?: string }[] };
}

const yuan = (c: number) => `¥${(c / 100).toLocaleString('zh-CN', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const pct = (r: { base: number; back: number } | null) => (r && r.base ? `${Math.round((r.back / r.base) * 100)}%` : '—');

const Tile: React.FC<{ label: string; value: React.ReactNode; sub?: string; big?: boolean }> = ({ label, value, sub, big }) => (
  <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
    <div className="text-[12px] text-slate-400">{label}</div>
    <div className={`${big ? 'text-3xl' : 'text-2xl'} font-bold text-white mt-1 tabular-nums`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

/** 单序列柱状图：每天一根，悬停看当天数字；下面附表格 */
const Bars: React.FC<{ title: string; data: Daily[]; field: string; fmt?: (n: number) => string }> = ({ title, data, field, fmt = n => String(n) }) => {
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.map(d => Number(d[field]) || 0);
  const max = Math.max(1, ...vals);
  const W = 600, H = 140, gap = 2, bw = W / data.length - gap;
  const h = hover ?? vals.length - 1;
  return (
    <figure className="rounded-xl border border-slate-700 bg-slate-800/30 p-3">
      <figcaption className="flex items-baseline gap-2 text-[13px] text-slate-300"><span className="font-semibold">{title}</span>
        <span className="ml-auto text-[12px] text-slate-400 tabular-nums">{data[h]?.day.slice(5)}：<b className="text-slate-100">{fmt(vals[h] || 0)}</b></span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full mt-2" role="img" aria-label={`${title}，近 ${data.length} 天`} onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="currentColor" className="text-slate-700" strokeWidth="1" />
        {vals.map((v, i) => {
          const bh = v ? Math.max(3, (v / max) * (H - 8)) : 0;
          const x = i * (W / data.length) + gap / 2;
          return <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={x - gap / 2} y={0} width={W / data.length} height={H} fill="transparent" />
            {bh > 0 && <path d={`M${x},${H} V${H - bh + 3} q0,-3 3,-3 h${Math.max(0, bw - 6)} q3,0 3,3 V${H} Z`} className={i === h ? 'fill-emerald-300' : 'fill-emerald-500'} />}
          </g>;
        })}
        <text x="0" y={H + 13} className="fill-slate-500" fontSize="10">{data[0]?.day.slice(5)}</text>
        <text x={W} y={H + 13} textAnchor="end" className="fill-slate-500" fontSize="10">{data.at(-1)?.day.slice(5)}</text>
      </svg>
      <details className="mt-1 text-[11px] text-slate-400"><summary className="cursor-pointer">看表格</summary>
        <table className="mt-1 w-full tabular-nums"><tbody>{data.filter((_, i) => vals[i]).reverse().map((d, i) => <tr key={i} className="border-t border-slate-800"><td className="py-0.5">{d.day}</td><td className="text-right">{fmt(Number(d[field]) || 0)}</td></tr>)}</tbody></table>
        {!vals.some(Boolean) && <p>这段时间都是 0</p>}
      </details>
    </figure>
  );
};

/** 网站访客（Umami）：来过网站的人，不等于注册用户 */
type Umami = { configured: boolean; snapshot?: boolean; asOf?: number; devices?: { name: string; visitors: number }[]; referrers?: { name: string; visitors: number }[]; since?: number; total?: { visitors: number; visits: number; pageviews: number; bounces: number; totaltime: number }; recent?: { days: number; visitors: number; visits?: number; pageviews?: number; activeDays?: number; summed?: boolean }; months?: { month: string; visitors: number; visits: number }[]; daily?: { day: string; visitors: number }[]; events?: { name: string; count: number }[]; countries?: { code: string; visitors: number }[] };
const EVENT_CN: Record<string, string> = { funnel_landed: '到达首页', trial_start: '开始免注册体验', funnel_tried_sim: '试了仿真示例', funnel_entered_app: '进入工作台', login: '登录', funnel_project_created: '建了项目', funnel_exploration_started: '开始探索', validation_triggered: 'AI 验证步骤', batch_start: 'AI 开工一轮', feed_answer: '回答 AI 的提问', trial_quota_exhausted: '体验额度用完', unattended_resume: '无人值守续跑', pm_market: '去服务广场', autonomy_granted: '授权 AI 自主运行', return_d1: '次日回访', return_d7: '7 天回访', return_d30: '30 天回访', signup: '注册', checkout_start: '点了充值' };
const DEV_CN: Record<string, string> = { laptop: '笔记本', mobile: '手机', desktop: '台式机', tablet: '平板' };
const Visitors: React.FC<{ days: number }> = ({ days }) => {
  const [d, setD] = useState<Umami | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { sharedRequest<Umami>(`/admin/umami?days=${days}`).then(x => { setD(x); setErr(''); }).catch(e => setErr(e instanceof Error ? e.message : String(e))); }, [days]);
  const head = <div className="px-3 py-2 border-b border-slate-800 flex items-baseline gap-2 flex-wrap"><span className="text-[13px] font-semibold text-slate-300">网站访客（Umami）</span><span className="text-[11px] text-slate-500">来过网站的独立访客，含没注册的人；和上面的「用户」是两个口径{d?.snapshot && d.asOf ? ` · Umami 导出快照，截至 ${new Date(d.asOf).toLocaleString()}，不自动更新` : ''}</span></div>;
  if (err) return <section className="rounded-xl border border-slate-700">{head}<p className="px-3 py-3 text-[12px] text-amber-300">读不到：{err}</p></section>;
  if (!d) return <section className="rounded-xl border border-slate-700">{head}<p className="px-3 py-3 text-[12px] text-slate-500">正在读取…</p></section>;
  if (!d.configured) return <section className="rounded-xl border border-slate-700">{head}<p className="px-3 py-3 text-[12px] text-slate-400 leading-5">还没接上：Umami 付费版可以到「平台服务」填 API Key 自动同步（cloud.umami.is → 右上角头像 → Settings → API keys → Create key），保存后这里显示 2026-07-27 以来的全部访客。</p></section>;
  const t = d.total!, r = d.recent!, months = d.months || [], max = Math.max(1, ...months.map(x => x.visitors));
  const ev = (d.events || []).filter(e => EVENT_CN[e.name]).sort((a, b) => b.count - a.count).slice(0, 14);
  return (
    <section className="rounded-xl border border-slate-700">
      {head}
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile big label="累计访客" value={t.visitors} sub={`从 ${new Date(d.since!).toLocaleDateString()} 开始统计`} />
          <Tile label={r.summed ? `近 ${r.days} 天访客（按天累加）` : `近 ${r.days} 天访客`} value={r.visitors} sub={r.summed ? `${r.activeDays} 天有人来；同一人隔天再来算两次` : `访问 ${r.visits} 次 · 浏览 ${r.pageviews} 页`} />
          <Tile label="累计访问" value={t.visits} sub={`浏览 ${t.pageviews} 页`} />
          <Tile label="跳出率" value={t.visits ? `${Math.round(t.bounces / t.visits * 100)}%` : '—'} sub={t.visits ? `平均停留 ${Math.round(t.totaltime / t.visits / 60 * 10) / 10} 分钟` : ''} />
        </div>
        {!!d.daily?.length && (() => { const dm = Math.max(1, ...d.daily!.map(x => x.visitors)); return <div><div className="text-[12px] text-slate-400 mb-1">每天访客</div><div className="flex items-end gap-px h-16" role="img" aria-label="每天访客柱状图">{d.daily!.map(x => <div key={x.day} title={`${x.day}：${x.visitors} 人`} className="flex-1 bg-sky-500/60 hover:bg-sky-400 rounded-t-sm" style={{ height: `${Math.max(4, x.visitors / dm * 100)}%` }} />)}</div><div className="flex justify-between text-[10px] text-slate-500 mt-0.5"><span>{d.daily![0].day}</span><span>{d.daily![d.daily!.length - 1].day}</span></div></div>; })()}
        <div className="grid sm:grid-cols-3 gap-3 text-[12px]">
          <div><div className="text-slate-400 mb-1">每月访客</div>{months.map(x => <div key={x.month} className="flex items-center gap-2 py-0.5"><span className="w-16 text-slate-500 tabular-nums">{x.month}</span><span className="h-2 rounded bg-sky-500/70" style={{ width: `${x.visitors / max * 60}%` }} /><span className="text-slate-300 tabular-nums">{x.visitors}</span></div>)}</div>
          <div><div className="text-slate-400 mb-1">来自哪里</div>{(d.countries || []).map(c => <div key={c.code} className="flex justify-between py-0.5"><span className="text-slate-300">{c.code || '未知'}</span><span className="text-slate-400 tabular-nums">{c.visitors}</span></div>)}{!!d.devices?.length && <><div className="text-slate-400 mt-2 mb-1">设备</div>{d.devices.map(x => <div key={x.name} className="flex justify-between py-0.5"><span className="text-slate-300">{DEV_CN[x.name] || x.name}</span><span className="text-slate-400 tabular-nums">{x.visitors}</span></div>)}</>}</div>
          <div><div className="text-slate-400 mb-1">关键动作（次数）</div>{ev.length ? ev.map(e => <div key={e.name} className="flex justify-between py-0.5"><span className="text-slate-300">{EVENT_CN[e.name]}</span><span className="text-slate-400 tabular-nums">{e.count}</span></div>) : <span className="text-slate-500">还没有</span>}</div>
        </div>
      </div>
    </section>
  );
};

/** 用户列表：每个人一行（邮箱 / 微信 / 手机号），点开看他问过的问题。只有管理员能看到；给别人看时可以打码 */
type UserRow = { owner: string; kind: 'email' | 'wechat' | 'phone' | 'guest'; name: string; first: number | null; last: number | null; activeDays?: number; aiCalls?: number; paidCents?: number; paidOrders?: number; grantCents?: number; walletCents?: number | null; market?: number; questions: { q: string; at: number }[] };
const KIND: Record<string, string> = { email: '邮箱', wechat: '微信', phone: '手机', guest: '免注册' };
const maskEmail = (e: string) => { const [n, h] = e.split('@'); return h ? `${n.slice(0, 1)}***@${h}` : e; };
const UserList: React.FC<{ internal: boolean }> = ({ internal }) => {
  const [d, setD] = useState<{ total: number; guests: number; people: UserRow[]; guestRows: UserRow[] } | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [masked, setMasked] = useState(false);
  const [showGuests, setShowGuests] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [n, setN] = useState(50);
  useEffect(() => { sharedRequest<any>(`/admin/users${internal ? '?internal=1' : ''}`).then(x => { setD(x); setErr(''); }).catch(e => setErr(e instanceof Error ? e.message : String(e))); }, [internal]);
  const day = (t: number | null) => (t ? new Date(t).toLocaleDateString() : '—');
  const label = (r: UserRow) => r.kind === 'email' ? (masked ? maskEmail(r.owner) : r.owner) : r.kind === 'guest' ? r.name : `${r.name || (r.kind === 'wechat' ? '微信用户' : '手机用户')}${masked ? '' : ` · ${r.owner}`}`;
  const list = (d ? [...d.people, ...(showGuests ? d.guestRows : [])] : []).filter(r => !q.trim() || `${r.owner} ${r.name} ${r.questions.map(x => x.q).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  const csv = () => {
    const rows = [['用户', '方式', '首次', '最近', '活跃天数', 'AI 调用', '付费(元)', '体验金(元)', '钱包(元)', '问题']].concat(list.map(r => [label(r), KIND[r.kind], day(r.first), day(r.last), String(r.activeDays ?? ''), String(r.aiCalls ?? ''), r.paidCents != null ? (r.paidCents / 100).toFixed(2) : '', r.grantCents ? (r.grantCents / 100).toFixed(2) : '', r.walletCents != null ? (r.walletCents / 100).toFixed(2) : '', r.questions.map(x => x.q).join(' | ')]));
    const blob = new Blob(['﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `hiexplore-users-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section className="rounded-xl border border-slate-700" aria-label="用户列表">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-slate-300">用户列表</span>
        {d && <span className="text-[11px] text-slate-500">{d.total} 个账号 · {d.guests} 个免注册体验设备</span>}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜邮箱 / 昵称 / 问题" aria-label="搜索用户" className="ml-auto w-44 bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-[12px]" />
        <label className="inline-flex items-center gap-1 text-[11px] text-slate-400"><input type="checkbox" checked={showGuests} onChange={e => setShowGuests(e.target.checked)} />含免注册</label>
        <label className="inline-flex items-center gap-1 text-[11px] text-slate-400"><input type="checkbox" checked={masked} onChange={e => setMasked(e.target.checked)} />打码（给别人看时）</label>
        <button onClick={csv} disabled={!list.length} className="text-[11px] px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40">导出 CSV</button>
      </div>
      {err ? <p className="px-3 py-3 text-[12px] text-amber-300">读不到：{err}</p> : !d ? <p className="px-3 py-3 text-[12px] text-slate-500">正在读取…</p> : !list.length ? <p className="px-3 py-3 text-[12px] text-slate-500">没有符合的用户。</p> :
        <div className="overflow-x-auto"><table className="w-full text-[12px]">
          <thead><tr className="text-slate-500 text-left">{['用户', '方式', '首次 / 最近', '活跃', 'AI 调用', '付费', '钱包', '问题'].map(h => <th key={h} className="px-3 py-1.5 font-normal whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{list.slice(0, n).map(r => <React.Fragment key={r.owner}>
            <tr className="border-t border-slate-800/70 hover:bg-slate-800/40 cursor-pointer" onClick={() => setOpen(o => (o === r.owner ? null : r.owner))}>
              <td className="px-3 py-1.5 text-slate-200 break-all">{label(r)}</td>
              <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{KIND[r.kind]}</td>
              <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap tabular-nums">{day(r.first)} / {day(r.last)}</td>
              <td className="px-3 py-1.5 text-slate-400 tabular-nums">{r.activeDays != null ? `${r.activeDays} 天` : '—'}</td>
              <td className="px-3 py-1.5 text-slate-400 tabular-nums">{r.aiCalls ?? '—'}</td>
              <td className="px-3 py-1.5 tabular-nums">{r.paidCents ? <span className="text-emerald-300">{yuan(r.paidCents)}</span> : <span className="text-slate-600">—</span>}</td>
              <td className="px-3 py-1.5 text-slate-400 tabular-nums whitespace-nowrap">{r.walletCents != null ? yuan(r.walletCents) : '—'}{r.grantCents ? <span className="block text-[10px] text-purple-300">含体验金 {yuan(r.grantCents)}</span> : null}</td>
              <td className="px-3 py-1.5 text-slate-300">{r.questions.length ? <span>{r.questions.length} 个 <span className="text-slate-500">▸ {r.questions[0].q.slice(0, 18)}{r.questions[0].q.length > 18 ? '…' : ''}</span></span> : <span className="text-slate-600">—</span>}</td>
            </tr>
            {open === r.owner && <tr className="bg-slate-900/60"><td colSpan={8} className="px-4 py-2">
              {r.questions.length ? <ul className="space-y-1">{r.questions.map((x, i) => <li key={i} className="flex gap-3"><span className="text-slate-500 tabular-nums shrink-0">{new Date(x.at).toLocaleDateString()}</span><span className="text-slate-200">{x.q}</span></li>)}</ul> : <p className="text-slate-500">这个人还没留下问题记录（问题从 11 月初开始记录）。</p>}
            </td></tr>}
          </React.Fragment>)}</tbody>
        </table>
        {list.length > n && <button onClick={() => setN(v => v + 100)} className="w-full py-2 text-[11px] text-slate-400 hover:text-slate-200 border-t border-slate-800">再看 {Math.min(100, list.length - n)} 个</button>}
        </div>}
    </section>
  );
};

/** 大家在研究什么：每个项目的问题（含免注册体验用户），最新的在前 */
const Questions: React.FC<{ internal: boolean }> = ({ internal }) => {
  const [d, setD] = useState<{ total: number; people: number; guests: number; firstAt: number | null; items: { q: string; at: number; who: string; guest: boolean }[] } | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(30);
  useEffect(() => { sharedRequest<any>(`/admin/questions?limit=500${internal ? '&internal=1' : ''}`).then(x => { setD(x); setErr(''); }).catch(e => setErr(e instanceof Error ? e.message : String(e))); }, [internal]);
  return (
    <section className="rounded-xl border border-slate-700">
      <div className="px-3 py-2 border-b border-slate-800 flex items-baseline gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-slate-300">大家在研究什么</span>
        {d && <span className="text-[11px] text-slate-500">{d.total} 个问题 · {d.people} 个人（其中免注册体验的问题 {d.guests} 个）{d.firstAt ? ` · 从 ${new Date(d.firstAt).toLocaleDateString()} 开始记录` : ''}</span>}
      </div>
      {err ? <p className="px-3 py-3 text-[12px] text-amber-300">读不到：{err}</p>
        : !d ? <p className="px-3 py-3 text-[12px] text-slate-500">正在读取…</p>
        : !d.items.length ? <p className="px-3 py-3 text-[12px] text-slate-500">还没有记录。用户新建项目（包括免注册体验）后，问题会出现在这里；老用户下次打开网站时，浏览器里已有的项目也会补报上来。</p>
        : <ul className="divide-y divide-slate-800/70 text-[12px]">{d.items.slice(0, n).map((x, i) => (
            <li key={i} className="px-3 py-1.5 flex gap-2"><span className="text-slate-200 flex-1 min-w-0">{x.q}</span><span className={`shrink-0 ${x.guest ? 'text-emerald-400' : 'text-slate-500'}`}>{x.who}</span><span className="shrink-0 text-slate-500 tabular-nums">{new Date(x.at).toLocaleDateString()}</span></li>))}</ul>}
      {d && d.items.length > n && <button onClick={() => setN(v => v + 50)} className="w-full py-2 text-[11px] text-slate-400 hover:text-slate-200 border-t border-slate-800">再看 {Math.min(50, d.items.length - n)} 个</button>}
    </section>
  );
};

export default function MetricsPanel({ mode }: { mode: 'users' | 'money' }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState('');
  const [days, setDays] = useState(30);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setM(await sharedRequest<Metrics>(`/admin/metrics?days=${days}${internal ? '&internal=1' : ''}`)); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (SHARED_API) void load(); }, [days, internal]);
  if (!SHARED_API) return <p className="text-sm text-slate-400">本地预览没有连后台，到正式网站用管理员账号登录后查看。</p>;

  const bar = (
    <div className="flex items-center gap-2 flex-wrap text-[12px] text-slate-400 mb-3">
      <span>统计范围</span>
      {[7, 30, 90].map(d => <button key={d} onClick={() => setDays(d)} className={`px-2 py-1 rounded-md ${days === d ? 'bg-purple-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}>近 {d} 天</button>)}
      <label className="inline-flex items-center gap-1.5 ml-2"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />包含内部 / 测试账号</label>
      <button onClick={() => void load()} disabled={busy} className="ml-auto px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40">{busy ? '读取中…' : '↻ 刷新'}</button>
      {m && <span className="w-full text-[11px] text-slate-500">数据时间 {new Date(m.generatedAt).toLocaleString()} · {m.includeInternal ? '含内部账号（全量）' : '已剔除管理员和测试账号'}</span>}
    </div>
  );
  if (err) return <div>{bar}<p className="text-sm text-amber-300">读不到运营数据：{err}</p></div>;
  if (!m) return <div>{bar}<p className="text-sm text-slate-400">正在读取…</p></div>;

  if (mode === 'users') {
    const u = m.users;
    return <div className="space-y-4">
      {bar}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile big label="累计用户" value={u.total} sub="用邮箱登录并真正用过的人" />
        <Tile label="近 7 天新增" value={u.new7} sub={`近 30 天新增 ${u.new30}`} />
        <Tile label="周活跃" value={u.wau} sub={`日活 ${u.dau} · 月活 ${u.mau}`} />
        <Tile label="付费用户" value={u.payers} sub={`复购（付过 2 次以上）${u.repeatPayers} 人`} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="用过 AI 干活" value={u.usedAI} sub="调用过平台模型的人" />
        <Tile label="用过服务广场" value={u.market} sub="挂服务 / 发求助 / 下单 / 接单" />
        <Tile label="次日留存" value={pct(u.retentionD1)} sub={u.retentionD1 ? `${u.retentionD1.back} / ${u.retentionD1.base} 人第二天又来了` : '还没有够一天的新用户'} />
        <Tile label="7 日留存" value={pct(u.retentionD7)} sub={u.retentionD7 ? `${u.retentionD7.back} / ${u.retentionD7.base} 人一周内又来了` : '还没有够 7 天的新用户'} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Bars title="每天新增用户" data={u.daily} field="newUsers" />
        <Bars title="每天活跃用户" data={u.daily} field="active" />
      </div>
      <UserList internal={internal} />
      <Visitors days={days} />
      <Questions internal={internal} />
      <p className="text-[11px] text-slate-500 leading-5">口径：登录服务不存用户表，「用户」是用邮箱验证码登录后访问过后台的人。逐日活跃从 {u.trackedSince ? new Date(u.trackedSince).toLocaleDateString() : '这一版上线'} 开始记录；更早的用户由充值、模型调用、服务广场记录补上（只知道他们哪天用过，留存只按逐日记录的人算）。网站访客（含没注册的）看上面 Umami 那一块。</p>
    </div>;
  }

  const x = m.money, mk = x.market;
  return <div className="space-y-4">
    {bar}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Tile big label="用户实付" value={yuan(x.paidCents)} sub={`${x.paidOrders} 笔支付成功的订单`} />
      <Tile label="AI 钱包充值" value={yuan(x.topupCents)} sub={`${x.topupCount} 笔 · 人均 ${yuan(x.arppuCents)}`} />
      <Tile label="AI 已消耗" value={yuan(x.walletSpendCents)} sub={`${x.walletBalanceCents != null ? `钱包里还剩 ${yuan(x.walletBalanceCents)}（全站）` : '模型调用实际扣的钱'}${x.grantCents ? `；其中发出体验金 ${yuan(x.grantCents)}（${x.grantPeople} 人，不算收入）` : ''}`} />
      <Tile label="会员 / 导出" value={yuan(x.subscriptionCents)} sub={`${x.subscriptionCount} 笔`} />
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Tile big label="服务广场成交额" value={yuan(mk.gmvCents)} sub={`${mk.orders} 单（已确认，不含取消 / 待确认）`} />
      <Tile label="已完成验收" value={yuan(mk.completedCents)} sub={`${mk.completed} 单 · 平台服务费 ${yuan(mk.feeCents)}`} />
      <Tile label="AI 参与的成交" value={`${mk.byAIBuyer} 买 / ${mk.byAISeller} 卖`} sub={`钱包担保付款 ${mk.walletPaidOrders} 单`} />
      <Tile label="供需" value={`${mk.services} / ${mk.demands}`} sub={`在架服务 / 求助需求 · 方案 ${mk.bids} 个`} />
    </div>
    <div className="grid sm:grid-cols-2 gap-3">
      <Bars title="每天用户实付" data={x.daily} field="paidCents" fmt={yuan} />
      <Bars title="每天服务广场成交额" data={x.daily} field="gmvCents" fmt={yuan} />
    </div>
    <section className="rounded-xl border border-slate-700">
      <div className="px-3 py-2 text-[13px] font-semibold text-slate-300 border-b border-slate-800">最近的成交（用户已打码）</div>
      {x.recent.length ? <table className="w-full text-[12px] tabular-nums"><tbody>{x.recent.map((r, i) => <tr key={i} className="border-t border-slate-800/70">
        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td><td className="px-2 text-slate-300">{r.kind}{r.title ? ` · ${r.title}` : ''}</td><td className="px-2 text-slate-400">{r.who}</td><td className="px-2 text-slate-500">{r.via || ''}</td><td className="px-3 text-right text-slate-100">{yuan(r.cents)}</td></tr>)}</tbody></table>
        : <p className="px-3 py-3 text-[12px] text-slate-500">还没有真实成交。</p>}
    </section>
    <p className="text-[11px] text-slate-500 leading-5">口径：「用户实付」只算第三方支付回调确认到账的订单；服务广场成交额 = 双方已确认的订单金额（含进行中），「已完成验收」是买方验收后的部分；钱包担保的钱验收后才付给卖方，收入只能在平台内花。全部来自服务器记录，不含估算。</p>
  </div>;
}
