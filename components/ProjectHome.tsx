import ProjectOverviewContent from './ProjectOverviewContent';
import React from 'react';
import type { Project } from '../types';
import { buildDashboard } from '../services/dashboardService';
import { PROJECT_PAGES, scopeNodes, type ProjectPage } from '../services/projectWorktree';
import { INQUIRY_ROLES } from '../services/inquiry';

export default function ProjectHome({ project, scopeId, onPage, onNote, onGenerateReport, generating, onSaveBrief, onSaveSummary, manager, routePanel }: {
  project: Project; scopeId: string; onPage: (page: ProjectPage, scopeId?: string) => void;
  onNote: (id: string) => void; onGenerateReport?: () => void; generating?: boolean; onSaveBrief?: (text: string) => void; onSaveSummary?: (id: string, text: string) => void; manager?: React.ReactNode; routePanel?: React.ReactNode;
}) {
  const nodes = scopeNodes(project, scopeId);
  const ids = new Set(nodes.map(n => n.id));
  const workspaces = Object.values(project.inquiries || {}).filter(w => scopeId === 'root' || ids.has(w.questionId));
  const facts = workspaces.flatMap(w => w.facts.map(f => ({ ...f, scopeId: w.questionId, question: w.question })));
  const rounds = workspaces.flatMap(w => w.rounds.map(r => ({ ...r, scopeId: w.questionId, question: w.question })));
  const pending = facts.filter(f => f.status === 'pending');
  const confirmed = facts.filter(f => f.status === 'confirmed');
  const disputed = facts.filter(f => f.status === 'disputed');
  const running = rounds.filter(r => r.status === 'running');
  const blocked = rounds.filter(r => r.status === 'failed' || r.status === 'paused');
  const probes = (project.probes || []).filter(p => scopeId === 'root' || ids.has(p.nodeId));
  const dashboard = buildDashboard(nodes, Date.now(), probes);
  const findings = (project.researchFindings || []).filter(f => scopeId === 'root' || ids.has(f.sourceNodeId));
  const cards = (project.knowledgeCards || []).filter(c => scopeId === 'root' || ids.has(c.sourceNodeId));
  const audits = rounds.flatMap(r => r.tasks.filter(t => t.role === 'auditor' && t.result).map(t => ({ ...t, question: r.question, scopeId: r.scopeId }))).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const branch = project.worktree?.branches.find(b => b.id === project.worktree?.activeBranchId);
  const stage = project.worktree?.stages.find(s => s.id === project.worktree?.currentStageId);
  const heading = scopeId === 'root' ? project.metaProblem : nodes.find(n => n.id === scopeId)?.title;
  const hypotheses = workspaces.flatMap(w => (w.rounds.at(-1)?.hypotheses || []).map(h => ({ ...h, scopeId: w.questionId, question: w.question })));
  return <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
    <div className="rounded-2xl border border-blue-500/25 bg-gradient-to-br from-blue-950/60 to-slate-900 p-5">
      <div className="flex justify-between items-center gap-3 mb-3"><p className="text-xs text-blue-300">{scopeId === 'root' ? '项目总览' : '想法总览'}</p>{onGenerateReport && scopeId === 'root' && <button className="text-xs text-slate-300 border border-slate-600 rounded-lg px-3 py-2 disabled:opacity-40" disabled={generating} onClick={onGenerateReport}>{generating ? '正在生成…' : '生成研究报告'}</button>}</div>
      <h2 className="text-xl md:text-2xl font-semibold leading-relaxed text-white">{heading || project.name}</h2>
      <div className="flex flex-wrap gap-3 mt-4 text-xs text-slate-400"><span>{nodes.filter(n => n.noteType !== 'overview' && n.noteType !== 'readme').length} 篇探索笔记</span><span>{rounds.length} 轮团队探究</span><span>{cards.length} 张知识卡片</span><span>{findings.length} 项研究发现</span></div>
      <button className="mt-3 text-xs text-violet-300 hover:underline" onClick={() => onPage('worktree', 'root')}>⑂ {branch?.name || '主线'} / {stage?.label || '初始阶段'} → 查看探索阶段</button>
    </div>
    {scopeId === 'root' && <ProjectOverviewContent key={project.id + (project.worktree?.activeBranchId || '') + (project.worktree?.currentStageId || '')} project={project} onSaveBrief={onSaveBrief} onSaveSummary={onSaveSummary} onNote={onNote} />}
    <div className="grid sm:grid-cols-3 gap-3">{[
      { page: 'team' as const, title: '团队进展', value: running.length ? `${running.length} 轮进行中` : `${rounds.filter(r => r.status === 'completed').length} 轮已完成`, detail: `${blocked.length} 轮待继续 · 5 种协作角色` },
      { page: 'facts' as const, title: '可信信息', value: `${confirmed.length} 条已确认`, detail: `${pending.length} 条待验证 · ${disputed.length} 条有争议` },
      { page: 'worktree' as const, title: '探索路线', value: `${project.worktree?.branches.length || 1} 条分支`, detail: `${project.worktree?.stages.length || 0} 个阶段 · ${project.decisions?.length || 0} 条决策` },
    ].map(card => <button key={card.page} className="text-left rounded-xl border border-slate-700 bg-slate-900 p-4 hover:border-violet-400 transition-colors" onClick={() => onPage(card.page, card.page === 'worktree' ? 'root' : scopeId)}><p className="text-xs text-slate-400">{PROJECT_PAGES[card.page].icon} {card.title}</p><p className="text-xl text-white font-semibold my-2">{card.value}</p><p className="text-xs text-slate-500">{card.detail}</p></button>)}</div>
    {(pending.length > 0 || blocked.length > 0 || disputed.length > 0) && <section className="rounded-xl border border-amber-600/30 bg-amber-950/10 p-4 space-y-2"><h3 className="text-sm font-semibold text-amber-200">现在需要关注</h3>{disputed.slice(0, 3).map(f => <button key={f.id} className="block text-left text-xs text-rose-300 hover:underline" onClick={() => onPage('facts', f.scopeId)}>有争议：{f.claim}</button>)}{pending.length > 0 && <button className="block text-left text-xs text-amber-300 hover:underline" onClick={() => onPage('facts', pending[0].scopeId)}>有 {pending.length} 条候选事实需要核对来源 →</button>}{blocked.slice(0, 3).map(r => <button key={r.id} className="block text-left text-xs text-slate-300 hover:underline" onClick={() => onPage('team', r.scopeId)}>{r.question} · 第 {r.number} 轮{r.status === 'failed' ? '执行失败，等待重试' : '已暂停，可继续'}</button>)}</section>}
    {manager}
    <div className="grid lg:grid-cols-2 gap-4">
      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 space-y-3"><div className="flex justify-between"><h3 className="text-sm font-semibold">团队当前在做什么</h3><button className="text-xs text-violet-300" onClick={() => onPage('team')}>打开团队 →</button></div>{workspaces.length === 0 && <p className="text-xs text-slate-500">还未启动专属团队。先提出竞争假设，再逐项验证。</p>}{workspaces.slice(0, 8).map(w => {
        const r = w.rounds.at(-1); const t = r?.tasks.find(t => t.status === 'running');
        return <button key={w.questionId} className="block w-full text-left rounded-lg bg-slate-800/60 p-3 hover:bg-slate-800" onClick={() => onPage('team', w.questionId)}><p className="text-xs text-slate-200">{w.question}</p><p className="text-[11px] text-slate-500 mt-1">{!r ? '尚未开始探究' : `第 ${r.number} 轮 · ${r.tasks.filter(t => t.status === 'completed').length}/${r.tasks.length} 步`}{t ? ` · ${INQUIRY_ROLES[t.role].name}正在工作` : ''}</p></button>;
      })}</section>
      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 space-y-3"><div className="flex justify-between"><h3 className="text-sm font-semibold">已确认的事实</h3><button className="text-xs text-emerald-300" onClick={() => onPage('facts')}>事实看板 →</button></div>{confirmed.length === 0 && <p className="text-xs text-slate-500">目前还没有经核验的事实，AI 观点不会被当作事实展示。</p>}{confirmed.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map(f => <button key={f.id} className="block text-left w-full border-l-2 border-emerald-600 pl-3" onClick={() => onPage('facts', f.scopeId)}><p className="text-xs text-slate-200">{f.claim}</p><p className="text-[10px] text-slate-500 mt-1">适用范围：{f.scope}</p></button>)}</section>
    </div>
    {audits.length > 0 && <section className="rounded-xl border border-slate-700 p-4 space-y-3"><h3 className="text-sm font-semibold">最近的审计结论</h3>{audits.slice(0, 3).map(a => <button key={a.id} onClick={() => onPage('team', a.scopeId)} className="block text-left w-full text-xs text-slate-300 hover:text-white"><span className="text-violet-300">{a.question}：</span>{a.result!.summary.slice(0, 240)}<span className="text-slate-500">（审核意见，尚不等同于事实）</span></button>)}</section>}
    {findings.length > 0 && <section className="rounded-xl border border-slate-700 p-4 space-y-2"><h3 className="text-sm font-semibold">研究发现 · 待进一步核验</h3>{findings.slice(-5).reverse().map(f => <button className="block text-left text-xs text-slate-300 hover:text-blue-300" key={f.id} onClick={() => onNote(f.sourceNodeId)}>{f.insight || f.title}</button>)}</section>}
    {hypotheses.length > 0 && <section className="rounded-xl border border-violet-500/30 p-4 space-y-3"><h3 className="text-sm font-semibold">正在检验的假设</h3>{hypotheses.slice(0, 6).map(h => <button key={h.id} className="block w-full text-left text-xs text-slate-300" onClick={() => onPage('team', h.scopeId)}><p>{h.statement}</p><p className="text-slate-500 mt-1">证伪条件：{h.falsification}</p></button>)}</section>}
    <section className="rounded-xl border border-slate-700 p-4 space-y-3"><h3 className="text-sm font-semibold">笔记探索进度</h3><div className="flex flex-wrap gap-4 text-xs"><span className="text-emerald-300">已完成 {dashboard.solved}</span><span className="text-blue-300">进行中 {dashboard.exploring}</span><span className="text-slate-400">待探索 {dashboard.unexplored}</span><span className="text-amber-300">等待现实验证 {dashboard.awaitingReality}</span><span className="text-rose-300">被推翻 / 待复核 {dashboard.contradicted + dashboard.review}</span></div><p className="text-[11px] text-slate-500">笔记完成状态与事实核验分别统计，写完一篇笔记不代表结论已被证实。</p>
      {dashboard.biggestUnknown && <button className="text-left text-xs text-amber-300" onClick={() => onNote(dashboard.biggestUnknown!.nodeId)}>最大未知量：{dashboard.biggestUnknown.text}</button>}
    </section>
    {scopeId === 'root' && routePanel}
    {scopeId === 'root' && !routePanel && project.route && <section className="rounded-xl border border-slate-700 p-4 space-y-2"><h3 className="text-sm font-semibold">当前研究路线</h3><p className="text-xs text-slate-400">{project.route.goal}</p>{project.route.anchors.map((a, i) => <p key={a.id} className="text-xs text-slate-300">{i + 1}. {a.title} <span className="text-slate-500">· {({ pending: '待开始', exploring: '探索中', waiting: '待验证', passed: '已通过', failed: '未通过', skipped: '已跳过' } as Record<string, string>)[a.status] || a.status}</span></p>)}</section>}
    {dashboard.directions.length > 0 && <section className="rounded-xl border border-slate-700 p-4 space-y-3"><h3 className="text-sm font-semibold">各个想法的研究空间</h3><div className="grid sm:grid-cols-2 gap-2">{dashboard.directions.map(d => <button key={d.id} className="rounded-lg bg-slate-800 p-3 text-left text-xs hover:bg-slate-700" onClick={() => onPage('research', d.id)}><p className="text-slate-200">{d.title} →</p><p className="text-slate-500 mt-1">{project.inquiries?.[d.id]?.rounds.length || 0} 轮探究 · {project.inquiries?.[d.id]?.facts.filter(f => f.status === 'confirmed').length || 0} 条已确认事实</p></button>)}</div></section>}
    <section className="rounded-xl border border-slate-700 p-4"><h3 className="text-sm font-semibold mb-3">进入笔记查看细节</h3><div className="flex flex-wrap gap-2">{nodes.filter(n => n.noteType !== 'readme' && n.noteType !== 'overview').map(n => <button key={n.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-blue-300" onClick={() => onNote(n.id)}>📄 {n.title}</button>)}</div></section>
  </div>;
}
