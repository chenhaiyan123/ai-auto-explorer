import { t as ui } from '../services/language';
import ProjectManagerPanel from './ProjectManagerPanel';
import ProjectLifePanel from './ProjectLifePanel';
import React from 'react';
import type { Project } from '../types';
import { PROJECT_PAGES, type ProjectPage } from '../services/projectWorktree';
import type { useInquiryTeams } from '../services/useInquiryTeams';
import InquiryPanel from './InquiryPanel';
import ProjectHome from './ProjectHome';
import ExplorationWorktree, { type WorktreeActions } from './ExplorationWorktree';

export default function ProjectWorkspace({ project, scopeId, page, teams, onPage, onNote, worktree, busy, onStop, onGenerateReport, generating, onSaveBrief, onSaveSummary, routePanel }: {
  project: Project; scopeId: string; page: ProjectPage; teams: ReturnType<typeof useInquiryTeams>;
  onPage: (page: ProjectPage, scopeId?: string) => void; onNote: (id: string) => void;
  worktree: WorktreeActions; busy: boolean; onStop: () => void; onGenerateReport?: () => void; generating?: boolean; onSaveBrief?: (text: string) => void; onSaveSummary?: (id: string, text: string) => void; routePanel?: React.ReactNode;
}) {
  const idea = project.nodes.find(n => n.id === scopeId);
  const scope = idea ? scopeId : 'root';
  return <div className="h-full flex flex-col min-h-0 bg-slate-950 text-slate-200">
    <header className="border-b border-slate-700 bg-slate-900 px-4 pt-3 flex-shrink-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-3"><button onClick={() => onPage('research', 'root')} className="hover:text-blue-300">📁 {project.name}</button>{idea && <><span>/</span><span>{idea.title}</span><button className="ml-auto text-blue-300" onClick={() => onNote(idea.id)}>{ui("查看正文笔记 ↗")}</button></>}<span>/</span><span className="text-slate-200">{page === 'research' && scope !== 'root' ? ui("想法总览") : ui(PROJECT_PAGES[page].label)}</span></div>
      <nav aria-label={ui("项目内页面")} className="flex flex-wrap gap-1">{(Object.keys(PROJECT_PAGES) as ProjectPage[]).filter(p => scope === 'root' || p !== 'worktree').map(p => <button key={p} aria-current={page === p ? 'page' : undefined} onClick={() => onPage(p, scope)} className={`px-3 py-2 text-xs border-b-2 ${page === p ? 'border-violet-400 text-violet-300' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{PROJECT_PAGES[p].icon} {p === 'research' && scope !== 'root' ? ui("想法总览") : ui(PROJECT_PAGES[p].label)}</button>)}</nav>
      {scope === 'root' && (page === 'team' || page === 'facts') && <div className="border-t border-slate-800 py-3 space-y-2"><p className="text-[11px] text-slate-500">{ui("当前查看：项目核心问题。各想法拥有独立的")}{page === 'team' ? ui("团队") : ui("事实看板")}：</p><div className="flex flex-wrap gap-2">{project.nodes.filter(n => !n.noteType || n.noteType === 'direction').map(n => <button key={n.id} className="text-[11px] text-blue-300 rounded-lg bg-slate-800 px-2 py-1" onClick={() => onPage(page, n.id)}>{n.title} · {page === 'team' ? `${project.inquiries?.[n.id]?.rounds.length || 0} 轮` : `${project.inquiries?.[n.id]?.facts.length || 0} 条`}</button>)}</div></div>}
    </header>
    <div className={`flex-1 min-h-0 ${page === 'team' || page === 'facts' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <div className={page === 'research' ? 'max-w-6xl mx-auto px-6 pt-6' : 'hidden'}><ProjectLifePanel key={`${project.id}:${project.worktree?.activeBranchId || 'main'}:${scope}`} project={project} scopeId={scope} teams={teams} browserBusy={busy} onFacts={() => onPage('facts', scope)} /></div>
      {page === 'research' && <ProjectHome project={project} scopeId={scope} onPage={onPage} onNote={onNote} onGenerateReport={onGenerateReport} generating={generating} onSaveBrief={onSaveBrief} onSaveSummary={onSaveSummary} routePanel={routePanel} manager={scope === 'root' ? <details className="rounded-xl border border-blue-500/30 p-4"><summary className="cursor-pointer text-sm font-semibold text-blue-300">{ui("与 AI 项目经理沟通 · 梳理进展与下一步")}</summary><div className="mt-3"><ProjectManagerPanel key={project.id} project={project} teams={teams} onTeam={() => onPage('team', 'root')} /></div></details> : undefined} />}
      {(page === 'team' || page === 'facts') && <InquiryPanel key={`${project.id}:${scope}`} project={project} nodes={project.nodes} scopeId={scope} mode={page} teams={teams} onOpenFacts={() => onPage('facts', scope)} />}
      {page === 'worktree' && <ExplorationWorktree project={project} actions={worktree} busy={busy} onStop={onStop} />}
    </div>
  </div>;
}
