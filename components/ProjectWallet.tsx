import React, { useEffect, useMemo, useState } from 'react';
import type { Project } from '../types';
import { marketRequest, money, orderLabel, type MarketRequest, type MarketState } from '../services/serviceMarket';
import { walletSummary, serviceSpentThisMonth, fmtCNY, fmtTokens, charterRoom } from '../services/projectWallet';
import { charterLabel } from '../services/projectBrief';
import WalletTopup from './WalletTopup';
import WalletModels from './WalletModels';
import { readPmToken } from '../services/pmAgent';
import { sharedRequest, SHARED_API, type SharedCatalog } from '../services/sharedModelsClient';

/**
 * 项目钱包：这个项目花了多少、花在哪、还能花多少。
 * - 上面三格：本月模型花费（估算）、本月服务支出、花钱权限还剩多少；
 * - 下面是交易记录：服务订单 / 发布的需求（从服务广场读）+ 每天的模型调用（本机记账）。
 */
type Tx = { at: number; icon: string; title: string; sub?: string; amount: string; tone?: 'out' | 'quota' | 'pending' };

const day = (at: number) => new Date(at).toLocaleDateString();

const ProjectWallet: React.FC<{
  project: Project;
  onEditCharter: () => void;
  onOpenMarket: () => void;
  /** 允许 / 不允许 AI 项目经理接单 */
  onToggleJobs?: (on: boolean) => void;
  /** 现在让 AI 项目经理去服务广场接一轮单 */
  onWorkJobs?: () => Promise<string>;
  request?: MarketRequest;
}> = ({ project, onEditCharter, onOpenMarket, onToggleJobs, onWorkJobs, request = marketRequest }) => {
  const [jobMsg, setJobMsg] = useState('');
  const [jobBusy, setJobBusy] = useState(false);
  const pm = readPmToken(project.id);
  const [market, setMarket] = useState<MarketState | null>(null);
  const [marketError, setMarketError] = useState('');
  const [limit, setLimit] = useState(20);

  useEffect(() => {
    let alive = true;
    request<MarketState>('/state')
      .then(s => { if (alive) { setMarket(s); setMarketError(''); } })
      .catch(e => { if (alive) setMarketError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [project.id, request]);

  const orders = useMemo(() => (market?.orders || []).filter(o => o.side === 'buyer' && o.context?.projectId === project.id), [market, project.id]);
  const demands = useMemo(() => (market?.demands || []).filter(d => d.mine && d.context?.projectId === project.id), [market, project.id]);
  // 平台共享模型按「钱包价」从 AI 钱包扣钱：用模型价把这部分也折成钱
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => { if (SHARED_API) sharedRequest<SharedCatalog>('/shared/catalog').then(c => setPrices(Object.fromEntries(c.models.map(m => [m.id, m.priceCentsPerM || 0])))).catch(() => {}); }, [project.id]);
  const platformCNY = (r: { model: string; input: number; output: number }) => (r.input + r.output) * (prices[r.model] || 0) / 1e6 / 100;
  const base = walletSummary(project.wallet);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const rows = project.wallet?.model || [];
  const sum = { ...base,
    monthCNY: base.monthCNY + rows.filter(r => r.quota && r.day.startsWith(thisMonth)).reduce((n, r) => n + platformCNY(r), 0),
    totalCNY: base.totalCNY + rows.filter(r => r.quota).reduce((n, r) => n + platformCNY(r), 0) };
  const serviceMonth = serviceSpentThisMonth(orders);
  const room = charterRoom(project.charter, serviceMonth);

  const txs: Tx[] = useMemo(() => {
    const list: Tx[] = [];
    for (const o of orders) list.push({ at: o.createdAt, icon: '🤝', title: `服务：${o.quote.title}`, sub: `${o.quote.providerName || ''}${o.quote.providerName ? ' · ' : ''}${orderLabel(o.status)}`, amount: `-${money(o.totalCents)}`, tone: ['proposed', 'requested'].includes(o.status) ? 'pending' : 'out' });
    for (const d of demands) list.push({ at: d.deadline - 1, icon: '📢', title: `发布需求：${d.title}`, sub: `${d.bidCount} 个方案 · ${d.status === 'open' ? '征集中' : d.status}`, amount: `预算 ${money(d.budgetCents)}`, tone: 'pending' });
    for (const r of project.wallet?.model || []) {
      list.push({ at: r.lastAt, icon: '🧠', title: `模型调用 · ${r.model}`, sub: `${day(r.lastAt)} · ${r.calls} 次 · ${fmtTokens(r.input + r.output)} tokens`, amount: r.quota ? (prices[r.model] ? `-${fmtCNY(platformCNY(r))}` : `额度 ${fmtTokens(r.input + r.output)}`) : `-${fmtCNY(r.cny)}`, tone: r.quota && !prices[r.model] ? 'quota' : 'out' });
    }
    return list.sort((a, b) => b.at - a.at);
  }, [orders, demands, project.wallet]);

  const cell = 'rounded-xl border border-slate-700 bg-slate-900 p-3';
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[15px] font-bold text-slate-100">💰 {project.name} · 钱包</h2>
        <span className="text-[11px] text-slate-500">这个项目花了多少、花在哪、还能花多少</span>
      </div>

      <WalletTopup compact />

      <section className="rounded-xl border border-violet-700/40 bg-violet-950/20 p-3 space-y-2" aria-label="AI 项目经理在服务广场">
        <div className="text-[13px] font-semibold text-slate-200">🤖 AI 项目经理在服务广场</div>
        <ul className="text-[12px] text-slate-300 space-y-1 leading-5">
          <li>· <b>买服务 / 发需求</b>：卡在 AI 做不了的事时，单笔不超过「花钱权限」就自己用钱包担保下单；没有现成服务就发布需求。超过的先问你。
            <span className="text-slate-500"> 现在：{project.charter?.autoBuyCNY ? `单笔 ≤ ¥${project.charter.autoBuyCNY}${project.charter.monthlyCNY ? `，每月 ≤ ¥${project.charter.monthlyCNY}` : ''}` : '花钱都先问你'}</span>
            <button onClick={onEditCharter} className="ml-1 text-blue-300 hover:underline">改</button></li>
          <li>· <b>接单赚钱</b>：挑 AI 自己能做完的需求（调研、整理、写作），报价、交付，买方验收后钱进 AI 钱包（只能在平台内花，暂不能提现）。
            <div className="flex items-center gap-2 flex-wrap mt-1 pl-3">
            {onToggleJobs && <label className="inline-flex items-center gap-1.5 text-slate-200"><input type="checkbox" checked={!!project.charter?.allowJobs} onChange={e => onToggleJobs(e.target.checked)} />允许 AI 接单</label>}
            {project.charter?.allowJobs && onWorkJobs && <button disabled={jobBusy} onClick={async () => { setJobBusy(true); setJobMsg(''); try { setJobMsg(await onWorkJobs()); } catch (e) { setJobMsg(e instanceof Error ? e.message : String(e)); } finally { setJobBusy(false); } }} className="px-2 py-0.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40">{jobBusy ? '正在看…' : '现在去接单看看'}</button>}
            </div>
          </li>
        </ul>
        <p className="text-[11px] text-slate-500">{pm ? `AI 的服务广场授权：${pm.permissions.includes('order_commit') ? `单笔 ≤ ¥${pm.maxOrderCents / 100}，总额 ≤ ¥${pm.totalBudgetCents / 100}` : '不能花钱'}${pm.permissions.includes('demand_respond') ? '，可以接单' : ''}（后端按授权卡死，改花钱权限会自动换授权）` : 'AI 还没有服务广场授权：设了花钱权限或允许接单后自动生成。'}</p>
        {jobMsg && <p role="status" className="text-[12px] text-emerald-300">{jobMsg}</p>}
      </section>

      <WalletModels />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className={cell}>
          <div className="text-[11px] text-slate-400">本月 AI 干活（模型）</div>
          <div className="text-xl font-bold text-slate-100 mt-1">{fmtCNY(sum.monthCNY)}<span className="text-[11px] font-normal text-slate-500 ml-1">估算</span></div>
          <div className="text-[11px] text-slate-500 mt-0.5">{sum.monthCalls} 次调用 · {fmtTokens(sum.monthTokens)} tokens{sum.quotaTokens ? ` · 其中 ${fmtTokens(sum.quotaTokens)} 走平台模型（实际扣费见钱包流水）` : ''}</div>
        </div>
        <div className={cell}>
          <div className="text-[11px] text-slate-400">本月找人做事（服务）</div>
          <div className="text-xl font-bold text-slate-100 mt-1">{fmtCNY(serviceMonth)}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{orders.length} 笔订单 · {demands.length} 个需求</div>
        </div>
        <div className={cell}>
          <div className="text-[11px] text-slate-400 flex items-center gap-1">花钱权限 <button onClick={onEditCharter} className="text-blue-300 hover:underline ml-auto">改</button></div>
          <div className="text-[13px] font-semibold text-slate-100 mt-1 leading-5">{project.charter ? charterLabel(project.charter) : '还没谈过：花钱都会先问你'}</div>
          {room !== undefined && <div className="text-[11px] text-emerald-300 mt-0.5">本月还能花 {fmtCNY(room)}</div>}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
          <span className="text-[13px] font-semibold text-slate-200">交易记录</span>
          <span className="text-[11px] text-slate-500">累计模型 {fmtCNY(sum.totalCNY)}（估算）</span>
          <button onClick={onOpenMarket} className="ml-auto text-[11px] text-blue-300 hover:underline">去服务广场 →</button>
        </div>
        {txs.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-slate-500">还没有交易。AI 每次干活的模型花费、去服务广场找人做事的订单，都会记在这里。</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {txs.slice(0, limit).map((t, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                <span>{t.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-200 truncate">{t.title}</div>
                  {t.sub && <div className="text-[11px] text-slate-500 truncate">{t.sub}</div>}
                </div>
                <span className={`font-mono flex-shrink-0 ${t.tone === 'quota' ? 'text-slate-400' : t.tone === 'pending' ? 'text-amber-300' : 'text-slate-100'}`}>{t.amount}</span>
              </li>
            ))}
          </ul>
        )}
        {txs.length > limit && <button onClick={() => setLimit(n => n + 20)} className="w-full py-2 text-[11px] text-slate-400 hover:text-slate-200 border-t border-slate-800">查看更早的 {txs.length - limit} 笔</button>}
        {marketError && <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-800" title={marketError}>服务订单暂时读不到（登录正式网站后可见），先只显示模型花费。</p>}
      </div>
      <p className="text-[11px] text-slate-500 leading-5">模型花费按各家公开价估算，用平台额度的只记 token；AI 钱包的充值和兑换以服务器记录为准（见上面的钱包流水）。服务款目前由双方自行结算，这里只记账。</p>
    </section>
  );
};

export default ProjectWallet;
