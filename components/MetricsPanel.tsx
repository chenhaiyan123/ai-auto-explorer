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
  money: { paidOrders: number; paidCents: number; topupCount: number; topupCents: number; subscriptionCount: number; subscriptionCents: number; arppuCents: number; walletSpendCents: number; walletBalanceCents: number | null;
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
type Umami = { configured: boolean; since?: number; total?: { visitors: number; visits: number; pageviews: number; bounces: number; totaltime: number }; recent?: { days: number; visitors: number; visits: number; pageviews: number }; months?: { month: string; visitors: number; visits: number }[]; daily?: { day: string; visitors: number }[]; events?: { name: string; count: number }[]; countries?: { code: string; visitors: number }[] };
const EVENT_CN: Record<string, string> = { trial_start: '开始免注册体验', login: '登录', funnel_project_created: '建了项目', validation_triggered: '跑了一次验证', signup: '注册', checkout_start: '点了充值' };
const Visitors: React.FC<{ days: number }> = ({ days }) => {
  const [d, setD] = useState<Umami | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { sharedRequest<Umami>(`/admin/umami?days=${days}`).then(x => { setD(x); setErr(''); }).catch(e => setErr(e instanceof Error ? e.message : String(e))); }, [days]);
  const head = <div className="px-3 py-2 border-b border-slate-800 flex items-baseline gap-2 flex-wrap"><span className="text-[13px] font-semibold text-slate-300">网站访客（Umami）</span><span className="text-[11px] text-slate-500">来过网站的独立访客，含没注册的人；和上面的「用户」是两个口径</span></div>;
  if (err) return <section className="rounded-xl border border-slate-700">{head}<p className="px-3 py-3 text-[12px] text-amber-300">读不到：{err}</p></section>;
  if (!d) return <section className="rounded-xl border border-slate-700">{head}<p className="px-3 py-3 text-[12px] text-slate-500">正在读取…</p></section>;
  if (!d.configured) return <section className="rounded-xl border border-slate-700">{head}<p className="px-3 py-3 text-[12px] text-slate-400 leading-5">还没接上：到「平台服务」填 Umami API Key（cloud.umami.is → 右上角头像 → Settings → API keys → Create key），保存后这里显示 2026-07-27 以来的全部访客。</p></section>;
  const t = d.total!, r = d.recent!, months = d.months || [], max = Math.max(1, ...months.map(x => x.visitors));
  const ev = (d.events || []).filter(e => EVENT_CN[e.name]).sort((a, b) => b.count - a.count);
  return (
    <section className="rounded-xl border border-slate-700">
      {head}
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile big label="累计访客" value={t.visitors} sub={`从 ${new Date(d.since!).toLocaleDateString()} 开始统计`} />
          <Tile label={`近 ${r.days} 天访客`} value={r.visitors} sub={`访问 ${r.visits} 次 · 浏览 ${r.pageviews} 页`} />
          <Tile label="累计访问" value={t.visits} sub={`浏览 ${t.pageviews} 页`} />
          <Tile label="跳出率" value={t.visits ? `${Math.round(t.bounces / t.visits * 100)}%` : '—'} sub={t.visits ? `平均停留 ${Math.round(t.totaltime / t.visits / 60 * 10) / 10} 分钟` : ''} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3 text-[12px]">
          <div><div className="text-slate-400 mb-1">每月访客</div>{months.map(x => <div key={x.month} className="flex items-center gap-2 py-0.5"><span className="w-16 text-slate-500 tabular-nums">{x.month}</span><span className="h-2 rounded bg-sky-500/70" style={{ width: `${x.visitors / max * 60}%` }} /><span className="text-slate-300 tabular-nums">{x.visitors}</span></div>)}</div>
          <div><div className="text-slate-400 mb-1">来自哪里</div>{(d.countries || []).map(c => <div key={c.code} className="flex justify-between py-0.5"><span className="text-slate-300">{c.code || '未知'}</span><span className="text-slate-400 tabular-nums">{c.visitors}</span></div>)}</div>
          <div><div className="text-slate-400 mb-1">关键动作（次数）</div>{ev.length ? ev.map(e => <div key={e.name} className="flex justify-between py-0.5"><span className="text-slate-300">{EVENT_CN[e.name]}</span><span className="text-slate-400 tabular-nums">{e.count}</span></div>) : <span className="text-slate-500">还没有</span>}</div>
        </div>
      </div>
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
      <Tile label="AI 已消耗" value={yuan(x.walletSpendCents)} sub={x.walletBalanceCents != null ? `钱包里还剩 ${yuan(x.walletBalanceCents)}（全站）` : '模型调用实际扣的钱'} />
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
