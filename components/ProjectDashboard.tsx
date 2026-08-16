import React, { useMemo, useState } from 'react';
import { NodeStatus } from '../types';
import { DashboardData, DirectionCard, avatarForAgent, shortAgo } from '../services/dashboardService';

/**
 * 项目仪表盘（挂在「总览」笔记顶部）。
 * 用户要的是「一张全局图」：简介 → 团队分工 → 主攻方向 → 异常与成果，四块，看完就懂。
 * 原则：大而简洁 —— 只放关键点，笔记明细收在方向卡片里，不在总览上铺开。
 */

interface Props {
  data: DashboardData;
  /** 跳到某篇笔记 */
  onNavigate?: (nodeId: string) => void;
  /** 在团队群聊里 @ 某个 Agent */
  onMentionAgent?: (agent: string) => void;
}

const ST: Record<string, { label: string; dot: string; text: string }> = {
  unexplored: { label: '待探索', dot: 'bg-slate-500', text: 'text-slate-400' },
  exploring: { label: '探索中', dot: 'bg-amber-400', text: 'text-amber-400' },
  solved: { label: '已完成', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  invalid: { label: '已失效', dot: 'bg-red-500', text: 'text-red-400' },
  needs_review: { label: '待复核', dot: 'bg-red-500', text: 'text-red-400' },
  validating: { label: '等现实', dot: 'bg-purple-400', text: 'text-purple-300' },
  contradicted: { label: '被推翻', dot: 'bg-pink-500', text: 'text-pink-400' },
};
const st = (s: NodeStatus) => ST[s] || ST.unexplored;

const BELIEF_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高' };
const BELIEF_CLS: Record<string, string> = {
  low: 'text-slate-300 bg-slate-700/50 border-slate-600',
  medium: 'text-amber-300 bg-amber-900/30 border-amber-500/40',
  high: 'text-emerald-300 bg-emerald-900/30 border-emerald-500/40',
};

const ALERT_STYLE: Record<string, string> = {
  review: 'text-red-200 bg-red-900/30 border-red-500/50 hover:bg-red-900/60',
  stalled: 'text-amber-200 bg-amber-900/30 border-amber-500/50 hover:bg-amber-900/60',
  no_agent: 'text-sky-200 bg-sky-900/30 border-sky-500/50 hover:bg-sky-900/60',
  empty: 'text-slate-300 bg-slate-800 border-slate-600 hover:bg-slate-700',
  validating: 'text-purple-200 bg-purple-900/30 border-purple-500/50 hover:bg-purple-900/60',
  contradicted: 'text-pink-200 bg-pink-900/30 border-pink-500/50 hover:bg-pink-900/60',
};
const ALERT_ICON: Record<string, string> = { review: '⚠', stalled: '⏳', no_agent: '🙋', empty: '○', validating: '🟡', contradicted: '🔴' };

const barColor = (p: number) => (p >= 80 ? 'bg-emerald-500' : p >= 30 ? 'bg-blue-500' : 'bg-slate-500');

/** 区块标题：统一样式，字号比正文大一点 */
const Block: React.FC<{ title: string; count?: number | string; right?: React.ReactNode; children: React.ReactNode }> =
  ({ title, count, right, children }) => (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-bold text-slate-300">{title}</span>
          {count !== undefined && <span className="text-[11px] text-slate-600 tabular-nums">{count}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );

// ===== 方向卡片 =====
const Card: React.FC<{
  d: DirectionCard;
  onNavigate?: (id: string) => void;
  onMentionAgent?: (a: string) => void;
}> = ({ d, onNavigate, onMentionAgent }) => {
  const [open, setOpen] = useState(false);
  const s = st(d.status);

  return (
    <div className={`bg-slate-900/70 border rounded-xl p-3 transition-colors flex flex-col gap-2 ${d.alerts.length ? 'border-amber-600/40 hover:border-amber-500' : 'border-slate-700 hover:border-slate-500'}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} title={s.label} />
        <button onClick={() => onNavigate?.(d.id)}
          className="text-[14px] font-bold text-slate-100 hover:text-blue-300 truncate text-left flex-1 transition-colors">
          {d.title}
        </button>
        <span className="text-[13px] font-bold text-slate-300 tabular-nums flex-shrink-0">{d.progress}%</span>
      </div>

      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor(d.progress)}`} style={{ width: `${d.progress}%` }} />
      </div>

      <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
        {d.agent ? (
          <button onClick={() => onMentionAgent?.(d.agent!)} title={`在群聊里 @${d.agent}`}
            className="flex items-center gap-1 text-blue-300 hover:text-white hover:bg-blue-600 rounded px-1 -mx-1 transition-colors">
            {avatarForAgent(d.agent)}<span className="truncate max-w-[110px]">{d.agent}</span>
          </button>
        ) : (
          <span className="text-sky-400">🙋 待指派</span>
        )}
        {d.results > 0 && <span className="text-emerald-500">📊 {d.results}</span>}
        {d.notes.length > 0 && (
          <button onClick={() => setOpen(v => !v)} className="hover:text-slate-200 transition-colors">
            📄 {d.notes.length} 篇 <span className={`inline-block text-[9px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          </button>
        )}
        <span className="ml-auto">{shortAgo(d.updatedAt)}</span>
      </div>

      {open && d.notes.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-2 border-t border-slate-800">
          {d.notes.map(n => (
            <button key={n.id} onClick={() => onNavigate?.(n.id)} title={n.title}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500/60 hover:text-blue-300 transition-colors max-w-[150px]">
              <span className={`w-1 h-1 rounded-full flex-shrink-0 ${st(n.status).dot}`} />
              <span className="truncate">{n.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ProjectDashboard: React.FC<Props> = ({ data, onNavigate, onMentionAgent }) => {
  const [onlyActive, setOnlyActive] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);

  const dirs = useMemo(
    () => (onlyActive ? data.directions.filter(d => d.status !== NodeStatus.SOLVED && d.status !== NodeStatus.INVALID) : data.directions),
    [data.directions, onlyActive]);

  if (data.total === 0) {
    return (
      <section className="bg-slate-900/60 border border-dashed border-slate-700 rounded-xl p-8 text-center">
        <div className="text-[13px] text-slate-300 font-bold">这个项目还没有方向</div>
        <div className="text-[11px] text-slate-600 mt-1.5">左侧项目行点 🤝 让 AI 组建团队并拆解方向，或 ＋ 手动添加</div>
      </section>
    );
  }

  const results = showAllResults ? data.achievements : data.achievements.slice(0, 5);

  return (
    <section className="bg-slate-900/60 border border-slate-700 rounded-2xl divide-y divide-slate-800 overflow-hidden">
      {/* ① 现在在赌什么 —— 顶部不再是单纯的进度条。
           进度只说明"做了多少"，主假设和最大未知量才说明"离真相多近"。 */}
      <div className="p-4 space-y-3">
        {data.intro && <p className="text-[13px] text-slate-300 leading-relaxed line-clamp-2">{data.intro}</p>}

        {data.mainHypothesis ? (
          <button onClick={() => onNavigate?.(data.mainHypothesis!.nodeId)}
            className={`w-full text-left rounded-xl border p-3 transition-colors ${
              data.mainHypothesis.status === NodeStatus.CONTRADICTED
                ? 'border-pink-500/40 bg-pink-950/20 hover:border-pink-400'
                : data.mainHypothesis.status === NodeStatus.VALIDATING
                  ? 'border-purple-500/40 bg-purple-950/20 hover:border-purple-400'
                  : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'}`}>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-[10px] font-bold text-slate-400">
                {data.mainHypothesis.status === NodeStatus.CONTRADICTED ? '🔴 主假设已被现实推翻'
                  : data.mainHypothesis.status === NodeStatus.VALIDATING ? '🟡 现在在赌 · 等现实验证'
                  : '🎯 现在在赌'}
              </span>
              <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${BELIEF_CLS[data.mainHypothesis.belief]}`}>
                信念 {BELIEF_LABEL[data.mainHypothesis.belief]}
              </span>
              <span className="text-[10px] text-slate-500 tabular-nums">
                支持 {data.mainHypothesis.support} · 反对 {data.mainHypothesis.refute} · 现实证据{' '}
                <span className={data.mainHypothesis.real ? 'text-emerald-400' : 'text-red-400'}>{data.mainHypothesis.real}</span>
              </span>
              <span className="text-[10px] text-slate-600 ml-auto truncate max-w-[140px]">{data.mainHypothesis.nodeTitle}</span>
            </div>
            <div className="text-[13px] text-slate-100 leading-relaxed">{data.mainHypothesis.statement}</div>
          </button>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-700 p-3 text-[11px] text-slate-600">
            还没有任何可证伪的假设 —— 跑一轮探索，AI 会给每个方向写下它在赌什么。
          </div>
        )}

        {data.biggestUnknown && (
          <button onClick={() => onNavigate?.(data.biggestUnknown!.nodeId)}
            className="w-full text-left text-[11px] text-slate-300 hover:text-white transition-colors">
            <span className="text-slate-500">❓ 最大未知量：</span>{data.biggestUnknown.text}
          </button>
        )}

        <div className="flex items-center gap-4">
          <div className="flex-shrink-0 text-center">
            <div className="text-[28px] font-bold text-slate-100 tabular-nums leading-none">{data.progress}<span className="text-[14px] text-slate-500">%</span></div>
            <div className="text-[9px] text-slate-600 mt-0.5">推理进度</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div className={`h-full ${barColor(data.progress)} transition-all`} style={{ width: `${data.progress}%` }} />
            </div>
            <div className="flex items-center gap-3 text-[11px] flex-wrap tabular-nums">
              <span className="text-emerald-400">完成 {data.solved}</span>
              <span className="text-amber-400">进行 {data.exploring}</span>
              <span className="text-slate-500">待探 {data.unexplored}</span>
              {data.awaitingReality > 0 && <span className="text-purple-300">🟡 等现实 {data.awaitingReality}</span>}
              {data.contradicted > 0 && <span className="text-pink-400">🔴 被推翻 {data.contradicted}</span>}
              {data.review > 0 && <span className="text-red-400">待复核 {data.review}</span>}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-600 mt-1 tabular-nums">
              <span title="现实证据 / 全部证据。全靠推理撑着的话这个数会是 0">
                证据 <span className={data.evidenceReal ? 'text-emerald-500' : 'text-red-400'}>{data.evidenceReal}</span>/{data.evidenceTotal} 来自现实
              </span>
              {data.probesPending > 0 && <span className="text-purple-400">🔬 待执行探针 {data.probesPending}</span>}
              <span className="ml-auto">🤖 {data.agentCount} 位 · 📄 {data.noteCount} 篇 · 📊 {data.resultCount} 项</span>
            </div>
          </div>
        </div>
      </div>

      {/* ② 异常点（有才显示，放在最显眼的第二位） */}
      {data.alerts.length > 0 && (
        <Block title="⚠ 异常点" count={data.alerts.length}>
          <div className="flex flex-wrap gap-1.5">
            {data.alerts.slice(0, 12).map((a, i) => (
              <button key={a.nodeId + i} onClick={() => onNavigate?.(a.nodeId)} title={`${a.label} · 点击查看`}
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border transition-colors max-w-[240px] ${ALERT_STYLE[a.kind]}`}>
                <span>{ALERT_ICON[a.kind]}</span>
                <span className="truncate font-bold">{a.title}</span>
                <span className="opacity-70 flex-shrink-0 text-[10px]">{a.label}</span>
              </button>
            ))}
            {data.alerts.length > 12 && <span className="text-[10px] text-slate-600 self-center">+{data.alerts.length - 12}</span>}
          </div>
        </Block>
      )}

      {/* ③ 主攻方向 */}
      <Block title="🧭 主攻方向" count={data.directions.length}
        right={data.directions.length > 6 ? (
          <button onClick={() => setOnlyActive(v => !v)}
            className="text-[10px] px-2.5 py-1 rounded-full border border-slate-700 text-slate-400 hover:text-white hover:border-blue-500/60 transition-colors">
            {onlyActive ? '看全部' : '只看进行中'}
          </button>
        ) : undefined}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {dirs.map(d => <Card key={d.id} d={d} onNavigate={onNavigate} onMentionAgent={onMentionAgent} />)}
        </div>
      </Block>

      {/* ④ 团队分工：按工作板块分组 */}
      {data.teamAreas.length > 0 && (
        <Block title="🤝 团队分工" count={`${data.agentCount} 位 · ${data.teamAreas.length} 个板块`}>
          <div className="space-y-2">
            {data.teamAreas.map(g => (
              <div key={g.area} className="flex items-start gap-2.5">
                <div className="flex-shrink-0 w-[84px] pt-1">
                  <div className="text-[11px] font-bold text-slate-400 truncate" title={g.area}>{g.area}</div>
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden mt-1">
                    <div className={`h-full ${barColor(g.progress)}`} style={{ width: `${g.progress}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                  {g.members.map(m => (
                    <button key={m.agent + g.area} onClick={() => onMentionAgent?.(m.agent)}
                      title={m.titles.length ? `负责：${m.titles.join('、')}（点击在群聊里 @ta）` : `点击在群聊里 @${m.agent}`}
                      className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${m.lead ? 'border-blue-500/50 bg-blue-900/25 text-blue-200' : 'border-slate-700 bg-slate-800 text-slate-300'} hover:border-blue-400 hover:text-white`}>
                      <span>{avatarForAgent(m.agent)}</span>
                      <span className="truncate max-w-[110px] font-bold">{m.agent}</span>
                      {m.lead && <span className="text-[10px] opacity-60">总协调</span>}
                      {m.count > 0 && <span className="text-[10px] opacity-60 tabular-nums">{m.count}向 {m.progress}%</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Block>
      )}

      {/* ⑤ 关键成果 */}
      {data.achievements.length > 0 && (
        <Block title="🏆 关键成果" count={data.achievements.length}
          right={data.achievements.length > 5 ? (
            <button onClick={() => setShowAllResults(v => !v)}
              className="text-[10px] px-2.5 py-1 rounded-full border border-slate-700 text-slate-400 hover:text-white hover:border-emerald-500/60 transition-colors">
              {showAllResults ? '收起' : `看全部 ${data.achievements.length}`}
            </button>
          ) : undefined}>
          <div className="space-y-1">
            {results.map((r, i) => (
              <button key={r.nodeId + i} onClick={() => onNavigate?.(r.nodeId)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/70 transition-colors group">
                <span className="text-[11px] flex-shrink-0">{r.agent ? avatarForAgent(r.agent) : '📄'}</span>
                <span className="text-[11px] text-slate-500 flex-shrink-0 max-w-[100px] truncate group-hover:text-blue-300">{r.nodeTitle}</span>
                <span className="text-[12px] text-slate-300 truncate flex-1">{r.summary || '（成果记录）'}</span>
                <span className="text-[10px] text-slate-600 flex-shrink-0">{shortAgo(r.at)}</span>
              </button>
            ))}
          </div>
        </Block>
      )}
    </section>
  );
};

export default ProjectDashboard;
