import React from 'react';
import type { Project } from '../types';
import type { Awakening } from '../services/awakening';
import { explorationLoop, type LoopStatus } from '../services/explorationLoop';
import { judgmentSupported } from '../services/problemHeartbeat';
import { useLanguage, displayDate } from '../services/language';

const statuses: Record<LoopStatus, [string, string]> = {
  active: ['正在推进', 'In progress'], waiting: ['等待反馈', 'Waiting for feedback'], needs_user: ['需要你', 'Needs you'],
  paused: ['已暂停', 'Paused'], blocked: ['研究受阻', 'Research blocked'], unknown: ['状态待确认', 'Status unconfirmed'],
  dormant: ['休眠观察', 'Dormant'], resolved: ['已结束', 'Resolved'], idle: ['待开始', 'Not started'],
};
const link = 'text-xs text-blue-300 hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300';
const paragraph = 'text-sm leading-relaxed text-slate-200 break-words line-clamp-3';

/** Compact projection of existing evidence and tasks; never generates a new summary. */
export default function ProjectBrief({ project, scopeId, state, connected, runningScopes = [], onFacts, onReview, onSettings, onTeam }: {
  project: Project; scopeId: string; state?: Awakening; connected: boolean; runningScopes?: string[];
  onFacts: () => void; onReview: () => void; onSettings: () => void; onTeam: () => void;
}) {
  const { t } = useLanguage();
  const loop = explorationLoop(project, scopeId, state, connected, runningScopes);
  const cloud = loop.state;
  const h = cloud?.problemHeartbeat;
  const current = cloud && { ...cloud, context: { ...cloud.context, facts: loop.confirmed.map(({ id, claim, source, excerpt, scope, status }) => ({ id, claim, source, excerpt, scope, status })) } };
  const invalid = h?.judgments.filter(j => j.status === 'accepted' && (!j.evidenceIds.length || !current || !judgmentSupported(current, j))) || [];
  const proposed = h?.judgments.filter(j => j.status === 'proposed') || [];
  const waits = loop.waits.filter(w => w.contextVersion === cloud?.contextVersion);
  const human = waits.filter(w => w.kind !== 'observation' || w.trigger.type === 'user_reply')
    .sort((a, b) => Number(['decision', 'permission'].includes(b.kind)) - Number(['decision', 'permission'].includes(a.kind)));
  const unread = h?.updates.filter(u => !u.readAt) || [];
  const disputes = project.inquiries?.[scopeId]?.facts.filter(f => f.status === 'disputed') || [];
  const urgent = unread.filter(u => u.level === 'now');
  const needsAction = invalid.length || loop.status === 'blocked' || loop.status === 'unknown' || human.length || disputes.length || loop.candidates.length || proposed.length || urgent.length || loop.status === 'needs_user';
  const firstWait = human[0] || waits[0];
  const actionText = invalid.length ? t(`${invalid.length} 条已采纳判断的依据已变化，需要重新核验。`, `${invalid.length} accepted judgments have changed evidence and need review.`)
    : ['blocked', 'unknown'].includes(loop.status) ? loop.reason
    : human[0]?.title || (disputes.length ? t(`${disputes.length} 条事实存在争议，请核对来源。`, `${disputes.length} facts are disputed. Review their sources.`)
    : loop.candidates.length ? t(`${loop.candidates.length} 条候选事实等待核验。`, `${loop.candidates.length} candidate facts await review.`)
    : proposed.length ? t(`${proposed.length} 项判断变化等待你审核。`, `${proposed.length} judgment changes await your review.`)
    : urgent[0]?.title || loop.reason);
  const reviewAction = invalid.length ? onReview : ['blocked', 'unknown'].includes(loop.status) ? (cloud ? onSettings : onTeam) : human.length ? onReview : disputes.length || loop.candidates.length ? onFacts : onReview;
  const stopped = ['paused', 'blocked', 'unknown', 'resolved'].includes(loop.status);
  return <div className="space-y-4" aria-label={t('项目简报', 'Project brief')}>
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs"><span aria-hidden className={`h-2 w-2 rounded-full ${loop.status === 'active' ? 'bg-emerald-400' : ['needs_user', 'blocked', 'unknown'].includes(loop.status) ? 'bg-amber-400' : 'bg-slate-500'}`} /><span>{t(...statuses[loop.status])}</span>{loop.run?.completedAt && <span className="text-slate-500">· {t('最近记录', 'Last record')} {displayDate(loop.run.completedAt)}</span>}</div>
      <h2 className="text-lg sm:text-xl font-semibold leading-relaxed break-words">{loop.details.question}</h2>
      <button className={link} onClick={onReview}>{t('重要更新', 'Meaningful updates')} · {unread.length ? t(`${unread.length} 条未读`, `${unread.length} unread`) : t('暂无未读提醒', 'No unread updates')}</button>
    </header>
    <section className="rounded-xl bg-slate-950/60 border border-slate-700 p-4 space-y-2" aria-label={t('最新判断', 'Current understanding')}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs text-slate-400">{t('最新判断', 'Current understanding')}</h3><span className="text-[11px] text-slate-400">{loop.accepted ? t('已采纳 · 解释仍可修订', 'Accepted · open to revision') : t('尚未形成已采纳判断', 'No accepted judgment yet')}</span></div>
      <p className={paragraph}>{loop.accepted?.after || t('尚无已采纳判断。现有假设和 AI 分析保留在探索记录中。', 'There is no accepted judgment yet. Hypotheses and AI analysis remain in the research record.')}</p>
      {loop.accepted && <p className="text-xs text-slate-400 line-clamp-2 break-words">{t('变化原因：', 'Why it changed: ')}{loop.accepted.reason}</p>}
      <button className={link} onClick={onFacts}>{loop.accepted ? t(`核对依据 ${loop.accepted.evidenceIds.length} 条 →`, `Review ${loop.accepted.evidenceIds.length} supporting facts →`) : t('查看事实看板 →', 'Open fact board →')}</button>
    </section>
    {!!needsAction && <section className="rounded-xl border border-amber-700/60 bg-amber-950/15 p-4 space-y-2" aria-label={t('需要你', 'Needs you')}>
      <h3 className="text-xs font-semibold text-amber-300">{t('需要你', 'Needs you')}</h3><p className={paragraph}>{actionText}</p>
      <button className={link} onClick={reviewAction}>{t('查看并处理 →', 'Review & respond →')}{human.length > 1 ? t(` · 共 ${human.length} 项待回复`, ` · ${human.length} responses needed`) : ''}</button>
    </section>}
    <section className="border-t border-slate-800 pt-4 space-y-2" aria-label={t('等待与下一步', 'Waiting & next step')}>
      <h3 className="text-xs text-slate-400">{t('等待与下一步', 'Waiting & next step')}</h3>
      <p className={paragraph}>{invalid.length ? t('先重新核验受影响的依据，再决定后续行动。', 'Recheck the affected evidence before deciding on further action.') : stopped ? loop.reason : firstWait ? `${firstWait.owner} · ${firstWait.condition}` : loop.details.next}</p>
      {stopped && <p className="text-xs text-slate-500">{t('此状态下不承诺自动推进，请查看当前设置或记录。', 'Automatic progress is not promised in this state. Check settings or records.')}</p>}
      {!stopped && loop.nextCheckAt && <p className="text-xs text-slate-500">{t('下次检查：', 'Next check: ')}{displayDate(loop.nextCheckAt)}</p>}
      {cloud && <button className={link} onClick={onReview}>{t('查看等待条件与判断记录 →', 'Review waiting conditions & judgments →')}</button>}
    </section>
  </div>;
}
