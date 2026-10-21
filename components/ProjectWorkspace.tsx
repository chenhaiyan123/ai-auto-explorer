import { t as ui, useLanguage } from '../services/language';
import ProjectManagerPanel from './ProjectManagerPanel';
import ProjectLifePanel from './ProjectLifePanel';
import React from 'react';
import type { Project } from '../types';
import { PROJECT_PAGES, type ProjectPage } from '../services/projectWorktree';
import type { useInquiryTeams } from '../services/useInquiryTeams';
import InquiryPanel from './InquiryPanel';
import ProjectHome from './ProjectHome';
import ExplorationWorktree, { type WorktreeActions } from './ExplorationWorktree';

export default function ProjectWorkspace({ project, scopeId, page, teams, onPage, onNote, worktree, busy, onStop, onGenerateReport, generating, onSaveBrief, onSaveSummary, onSaveSuccess, routePanel, onSeekHelp, pulsePanel, memoryPanel, onCloudState, openActivation }: {
  /** AI 记忆 ·「你交代过的」 */
  memoryPanel?: React.ReactNode;
  onCloudState?: React.ComponentProps<typeof ProjectLifePanel>['onCloudState'];
  openActivation?: number;
  /** 项目总览顶部的「长期关注」卡 */
  pulsePanel?: React.ReactNode;
  onSeekHelp?: (fact: import('../services/inquiry').InquiryFact, question: string) => void;
  project: Project; scopeId: string; page: ProjectPage; teams: ReturnType<typeof useInquiryTeams>;
  onPage: (page: ProjectPage, scopeId?: string) => void; onNote: (id: string) => void;
  onSaveSuccess?: (text: string) => void; worktree: WorktreeActions; busy: boolean; onStop: () => void; onGenerateReport?: () => void; generating?: boolean; onSaveBrief?: (text: string) => void; onSaveSummary?: (id: string, text: string) => void; routePanel?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const idea = project.nodes.find(n => n.id === scopeId);
  const scope = idea ? scopeId : 'root';
  return <div className="h-full flex flex-col min-h-0 bg-slate-950 text-slate-200">
    <header className="border-b border-slate-700 bg-slate-900 px-3 pt-2 flex-shrink-0">
      {idea && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-3"><button onClick={() => onPage('research', 'root')} className="hover:text-blue-300">📁 {project.name}</button>{idea && <><span>/</span><span>{idea.title}</span><button className="ml-auto text-blue-300" onClick={() => onNote(idea.id)}>{ui("查看正文笔记 ↗")}</button></>}<span>/</span><span className="text-slate-200">{page === 'research' && scope !== 'root' ? ui("想法总览") : ui(PROJECT_PAGES[page].label)}</span></div>}
      <nav aria-label={ui("项目内页面")} className="flex flex-wrap gap-1">{(Object.keys(PROJECT_PAGES) as ProjectPage[]).filter(p => scope === 'root' || p !== 'worktree').map(p => <button key={p} aria-current={page === p ? 'page' : undefined} onClick={() => onPage(p, scope)} className={`px-3 py-2 text-xs border-b-2 ${page === p ? 'border-violet-400 text-violet-300' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{PROJECT_PAGES[p].icon} {p === 'research' && scope !== 'root' ? ui("想法总览") : ui(PROJECT_PAGES[p].label)}</button>)}</nav>
      {scope === 'root' && (page === 'team' || page === 'facts') && <div className="border-t border-slate-800 py-3 space-y-2"><p className="text-[11px] text-slate-500">{ui("当前查看：项目核心问题。各想法拥有独立的")}{page === 'team' ? ui("团队") : ui("事实看板")}：</p><div className="flex flex-wrap gap-2">{project.nodes.filter(n => !n.noteType || n.noteType === 'direction').map(n => <button key={n.id} className="text-[11px] text-blue-300 rounded-lg bg-slate-800 px-2 py-1" onClick={() => onPage(page, n.id)}>{n.title} · {page === 'team' ? `${project.inquiries?.[n.id]?.rounds.length || 0} 轮` : `${project.inquiries?.[n.id]?.facts.length || 0} 条`}</button>)}</div></div>}
    </header>
    <div className={`flex-1 min-h-0 ${page === 'team' || page === 'facts' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <div className={page === 'research' ? 'max-w-6xl mx-auto px-3 pt-3' : 'hidden'}>{scope === 'root' && pulsePanel && <div className="mb-3">{pulsePanel}</div>}<ProjectLifePanel onCloudState={onCloudState} openActivation={openActivation} onSaveSuccess={scope === 'root' ? onSaveSuccess : undefined} key={`${project.id}:${project.worktree?.activeBranchId || 'main'}:${scope}`} project={project} scopeId={scope} teams={teams} browserBusy={busy} onFacts={() => onPage('facts', scope)} onPage={onPage} onNote={onNote} /></div>
      {page === 'research' && <div className="max-w-6xl mx-auto p-3 space-y-3">
        {scope === 'root' && <details className="rounded-xl border border-blue-500/30 p-4"><summary className="cursor-pointer text-sm font-semibold text-blue-300">{ui("与 AI 项目经理沟通 · 梳理进展与下一步")}</summary><div className="mt-3"><ProjectManagerPanel key={project.id} project={project} teams={teams} onTeam={() => onPage('team', 'root')} /></div></details>}
        <details className="rounded-xl border border-slate-700 p-4"><summary className="cursor-pointer text-sm">{t('自主能力与边界 · 7 项', 'Autonomy & boundaries · 7 areas')}</summary><dl className="mt-3 space-y-3 text-xs leading-relaxed">
          {[
            [t('目标', 'Goal'), t('由你定义完成标准；任务完成不会自动宣告目标达成。', 'You define success. Task completion does not automatically resolve the goal.')],
            [t('自主规划', 'Planning'), t('已有团队分工与研究计划；自动选择市场服务、组装执行流程仍待接入。', 'Team roles and research plans exist. Autonomous market selection and execution assembly are not connected yet.')],
            [t('资源与钱包', 'Resources & wallet'), t('模型按个人 Token 额度使用；服务报价与模型额度分开，服务双方自行结算，暂无自主充值。', 'Models use personal token credits. Service quotes are separate and settled directly; automatic top-ups are not available.')],
            [t('权限', 'Permissions'), t('市场 Agent 按显式授权和报价上限行动；不因运行时间变长而自动扩大权限。', 'Market agents act within explicit grants and quote caps. Permissions do not expand merely with time.')],
            [t('闭环执行', 'Execution loop'), t('需求、接单、交付、返工和验收已接通；交付先进入待核验线索，设备仍需专门适配。', 'Needs, orders, delivery, rework and acceptance are connected. Deliveries enter as unverified evidence; devices need adapters.')],
            [t('记忆与认知', 'Memory & learning'), t('保留事实、判断和探索阶段；依据变化时重新核验，不把服务方结论直接当事实。', 'Facts, judgments and research stages are retained. Changed evidence needs review; provider claims are not automatically facts.')],
            [t('唤醒与人类介入', 'Wake-up & human input'), t('已启用的云端研究按事件和周期检查；缺数据、权限或预算时等待，不保证持续产生进展。', 'Enabled cloud research checks events and schedules. It waits for data, permission or budget; progress is not guaranteed.')],
          ].map(([title, text]) => <div key={title} className="grid sm:grid-cols-[8rem_1fr] gap-1"><dt className="font-medium text-slate-200">{title}</dt><dd className="text-slate-400">{text}</dd></div>)}
        </dl></details>
        <details className="rounded-xl border border-slate-700 p-4"><summary className="cursor-pointer text-sm">{t('项目资料、笔记与研究详情', 'Project materials, notes & research details')}</summary><ProjectHome project={project} scopeId={scope} onPage={onPage} onNote={onNote} onGenerateReport={onGenerateReport} generating={generating} onSaveBrief={onSaveBrief} onSaveSummary={onSaveSummary} routePanel={routePanel} /></details>
      </div>}
      {(page === 'team' || page === 'facts') && <InquiryPanel key={`${project.id}:${scope}`} project={project} nodes={project.nodes} scopeId={scope} mode={page} teams={teams} onOpenFacts={() => onPage('facts', scope)} onSeekHelp={onSeekHelp} memoryPanel={scope === 'root' ? memoryPanel : undefined} />}
      {page === 'worktree' && <ExplorationWorktree project={project} actions={worktree} busy={busy} onStop={onStop} />}
    </div>
  </div>;
}
