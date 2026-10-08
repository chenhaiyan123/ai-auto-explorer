import React, { useState } from 'react';
import type { Project } from '../types';
import type { Awakening } from '../services/awakening';
import { explorationLoop, LOOP_STAGES, type LoopStage, type LoopStatus } from '../services/explorationLoop';
import type { ProjectPage } from '../services/projectWorktree';
import { INQUIRY_ROLES } from '../services/inquiry';
import { useLanguage, displayDate } from '../services/language';

const labels: Record<LoopStage, [string, string]> = {
  question: ['目标与问题', 'Question'], judgment: ['当前判断', 'Judgment'], action: ['选择行动', 'Choose action'],
  execution: ['执行与实验', 'Execute / test'], feedback: ['获得反馈', 'Receive feedback'], verification: ['核验证据', 'Verify evidence'],
  learning: ['更新认知', 'Update understanding'], next: ['决定下一步', 'Next step'],
};
const statuses: Record<LoopStatus, [string, string]> = { active: ['正在推进', 'In progress'], waiting: ['等待反馈 / 核验', 'Awaiting feedback / review'], needs_user: ['需要你', 'Needs you'], paused: ['已暂停', 'Paused'], blocked: ['需要处理', 'Blocked'], unknown: ['状态待确认', 'Status unconfirmed'], dormant: ['休眠观察', 'Dormant'], resolved: ['已结束', 'Resolved'], idle: ['待开始', 'Not started'] };
const positions = [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1]];
const button = 'rounded-lg border border-slate-600 px-3 py-2 text-xs text-blue-200 hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300';

export default function ExplorationLoop({ project, scopeId, state, connected, runningScopes = [], onPage, onNote, onHeartbeat, onRuns }: {
  project: Project; scopeId: string; state?: Awakening; connected: boolean; runningScopes?: string[];
  onPage?: (page: ProjectPage, scopeId?: string) => void; onNote?: (id: string) => void; onHeartbeat?: () => void; onRuns?: () => void;
}) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<LoopStage>();
  const [expanded, setExpanded] = useState(false);
  const loop = explorationLoop(project, scopeId, state, connected, runningScopes);
  const shown = selected || loop.stage;
  const color = loop.status === 'active' ? 'text-emerald-300' : ['blocked', 'unknown', 'needs_user'].includes(loop.status) ? 'text-amber-300' : 'text-blue-200';
  return <section aria-label={t('探索循环', 'Exploration loop')} className="rounded-xl border border-blue-500/25 bg-slate-950/60 p-3 sm:p-5 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-base">{t('探索循环', 'Exploration loop')}</h3><span className="text-xs text-slate-400">{t('问题 → 行动 → 反馈 → 认知', 'Question → Action → Feedback → Learning')}</span></header>
    <p className="text-sm text-slate-200 break-words">{loop.details.question}</p>
    <p className="text-[11px] text-slate-500">{loop.source === 'cloud' ? t('当前问题的云端研究 · 子问题在小循环中查看', 'Cloud research for this question · expand smaller loops for subquestions') : loop.source === 'browser' ? t('当前问题的浏览器团队 · 子问题在小循环中查看', 'Browser team for this question · expand smaller loops for subquestions') : t('根据当前问题的已有记录展示', 'Based on this question’s existing records')}</p>
    <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 items-start">
      <div>
        <div className="relative grid grid-cols-3 grid-rows-[90px_110px_90px] gap-2 max-w-xl mx-auto" aria-label={t('选择循环环节', 'Select a loop stage')}>
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full text-slate-600 pointer-events-none" viewBox="0 0 300 300" preserveAspectRatio="none"><path d="M50 45 H250 V255 H50 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5" /><path d="m151 41 5 4-5 4 M246 149l4 5 4-5 m-103 110-5-4 5-4 M46 151l4-5 4 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          {LOOP_STAGES.map((stage, index) => <button key={stage} style={{ gridRow: positions[index][0], gridColumn: positions[index][1] }} aria-pressed={shown === stage} aria-current={loop.stage === stage ? 'step' : undefined} onClick={() => setSelected(stage)} className={`relative self-center min-h-16 rounded-xl border px-1.5 py-2 text-xs leading-snug focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${shown === stage ? 'border-blue-400 bg-blue-950 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-400'}`}><span className="block text-[10px] text-slate-500 mb-1">{index + 1} {loop.stage === stage && <span className={color}>{t('· 当前', '· Current')}</span>}</span>{t(...labels[stage])}</button>)}
          <div className="relative col-start-2 row-start-2 flex flex-col items-center justify-center text-center px-1 gap-1"><span className={`text-sm font-semibold ${color}`}>{t(...statuses[loop.status])}</span><span className="text-[10px] text-slate-400">{loop.role ? t(INQUIRY_ROLES[loop.role].name) : t('无需持续空转', 'No idle reasoning')}</span></div>
        </div>
        <p className="text-[11px] text-slate-500 text-center">{t('环节可回退、暂停或分支；环形不代表全部已完成。', 'Stages can pause, branch or repeat. The ring is not a completion score.')}</p>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0 space-y-3">
        <div className="flex flex-wrap gap-2 items-center"><h4 className="text-sm font-semibold text-blue-200">{t(...labels[shown])}</h4>{selected && selected !== loop.stage && <button className="text-[11px] underline text-slate-400" onClick={() => setSelected(undefined)}>{t('回到当前环节', 'Back to current stage')}</button>}</div>
        <p className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{loop.details[shown]}</p>
        <div className="flex flex-wrap gap-2">
          {onPage && <button className={button} onClick={() => onPage(['verification', 'learning', 'feedback'].includes(shown) ? 'facts' : shown === 'next' ? 'worktree' : 'team', shown === 'next' ? 'root' : scopeId)}>{['verification', 'learning', 'feedback'].includes(shown) ? t('打开事实看板 →', 'Open fact board →') : shown === 'next' ? t('决策与探索分支 →', 'Decisions & branches →') : t('打开 AI 团队 →', 'Open AI team →')}</button>}
          {loop.state && onHeartbeat && ['learning', 'next', 'feedback'].includes(shown) && <button className={button} onClick={onHeartbeat}>{t('处理等待 / 认知变化 ↓', 'Review waits / judgments ↓')}</button>}
          {loop.run && onRuns && ['action', 'execution', 'verification'].includes(shown) && <button className={button} onClick={onRuns}>{t('查看本轮记录 ↓', 'View run record ↓')}</button>}
        </div>
      </div>
    </div>
    <div className="grid sm:grid-cols-2 gap-3 border-t border-slate-800 pt-3 text-xs">
      <div><p className="text-slate-500 mb-1">{t('现在的状态', 'Current status')}</p><p className="text-slate-300 whitespace-pre-wrap break-words">{loop.reason}</p></div>
      <div><p className="text-slate-500 mb-1">{t('继续的条件', 'Condition for continuing')}</p><p className="text-slate-300 whitespace-pre-wrap break-words">{loop.details.next}</p>{loop.nextCheckAt && <p className="text-[11px] text-slate-500 mt-2">{t('计划下次检查：', 'Next scheduled check: ')}{displayDate(loop.nextCheckAt)}{t('（不代表届时一定产生新进展）', ' (does not guarantee progress)')}</p>}</div>
    </div>
    <div className="border-t border-slate-800 pt-3">
      <button className={button} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t('收起小循环', 'Collapse smaller loops') : t('展开假设与实验小循环', 'Expand hypothesis & experiment loops')} · {loop.smallLoops.length} {expanded ? '−' : '+'}</button>
      {expanded && <div className="mt-3 space-y-3">{loop.smallLoops.length === 0 && <p className="text-xs text-slate-400">{t('尚无假设或实验记录。团队提出假设、或笔记中建立实验后，会出现在这里。', 'No hypotheses or experiments yet. Team hypotheses and experiments in notes will appear here.')}</p>}{loop.smallLoops.map(small => <article key={small.id} className="rounded-xl border border-slate-700 p-3 space-y-2">
        <p className="text-[11px] text-slate-400">{small.kind === 'hypothesis' ? t('假设循环', 'Hypothesis loop') : t('实验循环', 'Experiment loop')} · {t(...statuses[small.status])} · {t(...labels[small.stage])}</p><h5 className="text-sm text-slate-200 break-words">{small.title}</h5>
        <p className="text-[11px] text-blue-300">{t('假设 → 执行 → 反馈 → 核验 ↺ 修订假设', 'Hypothesis → Action → Feedback → Review ↺ Revise')}</p>
        <dl className="text-xs space-y-2 text-slate-400"><div><dt className="text-slate-500">{t('执行', 'Action')}</dt><dd className="break-words whitespace-pre-wrap max-h-32 overflow-y-auto">{small.action}</dd></div><div><dt className="text-slate-500">{small.kind === 'hypothesis' ? t('AI 核验意见 · 不等于事实', 'AI review · not a verified fact') : t('实验反馈 · 待核验', 'Experiment feedback · unverified')}</dt><dd className="break-words whitespace-pre-wrap max-h-32 overflow-y-auto">{small.feedback}</dd></div><div><dt className="text-slate-500">{t('证伪 / 判断条件', 'Falsification / decision rule')}</dt><dd className="break-words">{small.condition}</dd></div></dl>
        <div className="flex flex-wrap gap-2">{small.id.startsWith('cloud:') && onRuns ? <button className={button} onClick={onRuns}>{t('查看本轮记录 ↓', 'View run record ↓')}</button> : onPage && <button className={button} onClick={() => onPage(small.kind === 'hypothesis' ? 'team' : 'research', small.scopeId)}>{t('进入对应研究空间 →', 'Open research workspace →')}</button>}{onNote && project.nodes.some(n => n.id === small.scopeId) && <button className={button} onClick={() => onNote(small.scopeId)}>{t('查看笔记 →', 'Open note →')}</button>}</div>
      </article>)}</div>}
    </div>
  </section>;
}
