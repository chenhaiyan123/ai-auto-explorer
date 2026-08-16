import React, { useState } from 'react';
import { ExplorationRoute, RouteAnchor, ANCHOR_METHOD_LABEL, ProblemNode } from '../types';
import { currentAnchor, isSettled, routeProgress, nodesOfAnchor } from '../services/routeService';

/**
 * 探索路线图（挂在总览笔记顶部）。
 *
 * 它要回答的是一个很具体的问题：**这次长期探索现在走到哪了，下一个必须问现实的点是什么。**
 * 所以每个路标上永远显示三样东西：要什么数据、怎么拿、什么算通过。
 *
 * 显示上刻意区分：
 * - 当前路标 = 确定的，高亮；
 * - 后面的路标 = 「暂定」，灰着并明说会被真实数据改掉——不让用户把 AI 的猜测当计划。
 */

const ST: Record<RouteAnchor['status'], { label: string; dot: string; cls: string }> = {
  pending: { label: '未到', dot: 'bg-slate-600', cls: 'border-slate-700 bg-slate-900/50' },
  waiting: { label: '等现实', dot: 'bg-purple-400 animate-pulse', cls: 'border-purple-500/50 bg-purple-950/25' },
  passed: { label: '已通过', dot: 'bg-emerald-400', cls: 'border-emerald-600/30 bg-emerald-950/15' },
  failed: { label: '未通过', dot: 'bg-pink-500', cls: 'border-pink-500/40 bg-pink-950/20' },
  skipped: { label: '已跳过', dot: 'bg-slate-700', cls: 'border-slate-800 bg-slate-900/30 opacity-60' },
};

const RouteMap: React.FC<{
  route?: ExplorationRoute;
  nodes: ProblemNode[];
  busy?: string;
  onPlan: () => void;
  onSettle: (anchorId: string, verdict: 'pass' | 'fail' | 'unclear', summary: string) => void;
  onSkip: (anchorId: string) => void;
  /** 让 AI 为这个路标设计验证方案（探针出结果后会自动结算路标） */
  onDesignProbes?: (anchorId: string) => void;
  onNavigate?: (nodeId: string) => void;
}> = ({ route, nodes, busy, onPlan, onSettle, onSkip, onDesignProbes, onNavigate }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<'pass' | 'fail' | 'unclear'>('pass');
  const [summary, setSummary] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  if (!route) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-slate-300">还没有探索路线</div>
          <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            让 AI 先画一条路，路上放几个必须拿到真实数据才能跨过去的路标。到点自动停下来等你或设备给结果，再决定后面怎么走。
          </div>
        </div>
        <button onClick={onPlan} disabled={!!busy}
          className="flex-shrink-0 px-3 py-2 rounded-xl text-[11px] font-bold bg-blue-600/25 text-blue-200 border border-blue-500/40 hover:bg-blue-600/40 disabled:opacity-50 transition-colors">
          {busy || '🗺️ 规划探索路线'}
        </button>
      </section>
    );
  }

  const cur = currentAnchor(route);
  const prog = routeProgress(route);
  const sorted = [...route.anchors].sort((a, b) => a.order - b.order);

  const submit = (a: RouteAnchor) => {
    if (!summary.trim()) return;
    onSettle(a.id, verdict, summary.trim());
    setSummary(''); setOpen(null); setVerdict('pass');
  };

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900/60 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-800">
        <span className="text-[12px] font-bold text-slate-300">🗺️ 探索路线</span>
        <span className="text-[11px] text-slate-500 tabular-nums">{prog.done}/{prog.total} 个路标</span>
        {cur && (
          <span className="text-[11px] text-purple-300 truncate">
            · 当前：{cur.title}{cur.status === 'waiting' ? '（等现实）' : ''}
          </span>
        )}
        {busy && <span className="text-[10px] text-blue-300 animate-pulse ml-auto">{busy}</span>}
        {!busy && route.revisions.length > 0 && (
          <button onClick={() => setShowHistory(v => !v)}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300">
            改线 {route.revisions.length} 次 {showHistory ? '▾' : '▸'}
          </button>
        )}
      </div>

      {showHistory && route.revisions.length > 0 && (
        <div className="px-4 py-2.5 border-b border-slate-800 space-y-1.5 bg-slate-950/40">
          {[...route.revisions].reverse().map((r, i) => (
            <div key={i} className="text-[10px] text-slate-400 leading-relaxed">
              <span className="text-slate-600">{new Date(r.at).toLocaleDateString()} · 在「{r.anchorTitle}」</span>
              <div className="text-slate-300">{r.note}</div>
              <div className="text-slate-600">因为：{r.reason}</div>
              {(r.before.length > 0 || r.after.length > 0) && (
                <div className="text-slate-600">
                  {r.before.join('、') || '（无）'} → <span className="text-slate-400">{r.after.join('、') || '（无）'}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="p-3 space-y-2">
        {sorted.map(a => {
          const st = ST[a.status];
          const isCur = cur?.id === a.id;
          const legNodes = nodesOfAnchor(nodes, a.id);
          return (
            <div key={a.id} className={`rounded-xl border p-3 transition-colors ${st.cls} ${isCur ? 'ring-1 ring-purple-500/40' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
                <span className="text-[10px] text-slate-600 tabular-nums">{a.order}</span>
                <span className="text-[13px] font-bold text-slate-100">{a.title}</span>
                <span className="text-[9px] px-1 py-0.5 rounded border border-slate-700 text-slate-400">{ANCHOR_METHOD_LABEL[a.method]}</span>
                {a.tentative && !isSettled(a) && (
                  <span className="text-[9px] px-1 py-0.5 rounded border border-amber-600/40 text-amber-400/90"
                    title="AI 在没有真实数据时先占的位，等前面的路标拿到结果后会重新规划">暂定</span>
                )}
                {a.soft && <span className="text-[9px] text-slate-600">软路标·不阻塞</span>}
                <span className="text-[10px] text-slate-500 ml-auto">{st.label}</span>
              </div>

              <div className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">{a.question}</div>

              <div className="mt-1.5 space-y-0.5 text-[10px]">
                <div className="text-slate-400"><span className="text-slate-600">需要：</span>{a.needs}</div>
                <div className="text-slate-400"><span className="text-slate-600">怎么拿：</span>{a.methodDetail}</div>
                <div className="text-emerald-400/80"><span className="text-slate-600">通过：</span>{a.passIf}</div>
                <div className="text-pink-400/80"><span className="text-slate-600">不通过：</span>{a.failIf}</div>
              </div>

              {legNodes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {legNodes.map(n => (
                    <button key={n.id} onClick={() => onNavigate?.(n.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500/60 hover:text-blue-300 transition-colors max-w-[150px] truncate">
                      {n.title}
                    </button>
                  ))}
                </div>
              )}

              {a.result && (
                <div className={`mt-2 text-[10px] rounded px-2 py-1 border ${
                  a.result.verdict === 'fail' ? 'text-pink-200 bg-pink-950/30 border-pink-600/30'
                  : a.result.verdict === 'pass' ? 'text-emerald-200 bg-emerald-950/30 border-emerald-600/30'
                  : 'text-slate-300 bg-slate-800 border-slate-600'}`}>
                  {a.result.verdict === 'fail' ? '✗ 未通过' : a.result.verdict === 'pass' ? '✓ 通过' : '· 还不明确'}
                  <span className="opacity-70"> · {a.result.origin === 'probe' ? '设备/探针' : '人工回填'}</span>
                  {' · '}{a.result.summary}
                </div>
              )}

              {a.status === 'waiting' && open !== a.id && (
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => { setOpen(a.id); setSummary(''); setVerdict('pass'); }}
                    className="text-[10px] px-2.5 py-1 rounded bg-purple-600/40 text-purple-100 hover:bg-purple-500/60 font-bold">
                    ✍️ 回填现实结果
                  </button>
                  {onDesignProbes && (
                    <button onClick={() => onDesignProbes(a.id)} disabled={!!busy}
                      className="text-[10px] px-2 py-1 rounded bg-slate-700/60 text-slate-200 hover:bg-slate-600 disabled:opacity-40"
                      title="AI 设计验证方案；能接设备的会自动跑，出结果后这个路标自动结算">
                      🔬 设计验证方案
                    </button>
                  )}
                  {(a.probeIds || []).length > 0 && (
                    <span className="text-[9px] text-purple-400 self-center">已挂 {(a.probeIds || []).length} 个方案</span>
                  )}
                  <button onClick={() => onSkip(a.id)}
                    className="text-[10px] px-2 py-1 rounded text-slate-500 hover:text-slate-300 ml-auto"
                    title="不等数据了，直接往下走（会留痕，不算通过）">跳过这个路标</button>
                </div>
              )}

              {open === a.id && (
                <div className="mt-2 pt-2 border-t border-slate-700/60 space-y-1.5">
                  <div className="text-[9px] text-amber-400/80">
                    按上面写死的通过/不通过标准判，别临时改标准。
                  </div>
                  <select value={verdict} onChange={e => setVerdict(e.target.value as any)}
                    className="bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200">
                    <option value="pass">通过</option>
                    <option value="fail">未通过</option>
                    <option value="unclear">数据不足，还判不了</option>
                  </select>
                  <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2}
                    placeholder="现实给出的结果是什么？例：20 个用户里 17 个选了导航，只有 3 个选翻译"
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[11px] text-slate-200 resize-none" />
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => setOpen(null)} className="text-[10px] px-2 py-1 text-slate-400 hover:text-white">取消</button>
                    <button onClick={() => submit(a)} disabled={!summary.trim() || !!busy}
                      className="text-[10px] px-2.5 py-1 rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-500">
                      提交并继续探索
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default RouteMap;
