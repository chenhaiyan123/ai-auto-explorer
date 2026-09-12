import { t as ui } from '../services/language';
import { projectOverviewContext } from '../services/projectOverview';
import ProjectManagerPanel from './ProjectManagerPanel';
import React, { useState } from 'react';
import type { ProblemNode, Project } from '../types';
import { INQUIRY_ROLES, InquiryFact, InquiryWorkspace, InquiryRole, FactStatus, addFact, createInquiry, reviewFact } from '../services/inquiry';
import type { useInquiryTeams } from '../services/useInquiryTeams';
import AgentTeamSettings, { AgentMemoryPanel } from './AgentTeamSettings';
import { AGENT_ROLES, agentProfile } from '../services/agentProfiles';

const STATUS: Record<FactStatus, string> = { confirmed: '已确认', pending: '待验证', disputed: '有争议', rejected: '已驳回' };
const COLOR: Record<FactStatus, string> = { confirmed: 'text-emerald-400 border-emerald-700/50', pending: 'text-amber-300 border-amber-700/50', disputed: 'text-rose-300 border-rose-700/50', rejected: 'text-slate-400 border-slate-600' };
const VERDICT: Record<string, string> = { supported: '现有材料支持', refuted: '现有材料反对', uncertain: '证据不足' };
const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-400';
const buttonClass = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-700 disabled:opacity-40';
const date = (at: number) => new Date(at).toLocaleString('zh-CN');
const blank = { claim: '', source: '', excerpt: '', scope: '' };

function FactCard({ fact, onReview }: { fact: InquiryFact; onReview: (status: FactStatus, reason: string, evidence: { source: string; excerpt: string; scope: string }) => void }) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState({ source: fact.source, excerpt: fact.excerpt, scope: fact.scope });
  const [error, setError] = useState('');
  const decide = (status: FactStatus) => {
    try { onReview(status, reason, evidence); setEditing(false); setReason(''); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '审核失败'); }
  };
  const sourceURL = /^https?:\/\//i.test(fact.source) ? fact.source : undefined;
  return <article className={`rounded-xl border bg-slate-800/40 p-3 space-y-2 ${COLOR[fact.status]}`}>
    <div className="flex justify-between items-center text-[10px]"><span>{STATUS[fact.status]} · {fact.origin === 'ai' ? ui("AI 候选") : ui("人工录入")}</span><span className="text-slate-500">{date(fact.updatedAt)}</span></div>
    <p className="text-sm text-slate-100 whitespace-pre-wrap break-words">{fact.claim}</p>
    <div className="text-[11px] text-slate-400 break-words">{ui("来源：")}{sourceURL ? <a className="text-blue-400 underline" href={sourceURL} target="_blank" rel="noopener noreferrer">{fact.source}</a> : fact.source || '待补充'}</div>
    {fact.excerpt && <blockquote className="border-l-2 border-slate-600 pl-2 text-xs text-slate-400 whitespace-pre-wrap">{fact.excerpt}</blockquote>}
    <p className="text-[11px] text-slate-500">{ui("适用范围：")}{fact.scope || ui("待明确")}</p>
    <details className="text-[11px] text-slate-400"><summary className="cursor-pointer">{ui("审核历史（")}{fact.reviews.length}）</summary>
      <div className="mt-2 space-y-2">{fact.reviews.length === 0 && <p>{ui("尚未审核。AI 候选需核验来源后才能确认。")}</p>}{fact.reviews.map((r, i) => <div key={i} className="border-l border-slate-600 pl-2"><div>{r.actor === 'human' ? ui("人工核验") : INQUIRY_ROLES[r.actor].name} · {STATUS[r.decision as FactStatus] || VERDICT[r.decision] || r.decision} · {date(r.at)}</div><p className="whitespace-pre-wrap">{r.reason}</p>{r.evidence && <details className="mt-1 text-slate-500"><summary className="cursor-pointer">{ui("当时的证据")}</summary><p className="break-words whitespace-pre-wrap">{ui("来源：")}{r.evidence.source || ui("未填写")}<br />{ui("证据：")}{r.evidence.excerpt || ui("未填写")}<br />{ui("范围：")}{r.evidence.scope || ui("未填写")}</p></details>}</div>)}</div>
    </details>
    <button className={buttonClass} onClick={() => { setEditing(!editing); setEvidence({ source: fact.source, excerpt: fact.excerpt, scope: fact.scope }); }}> {editing ? ui("收起审核") : ui("核验 / 更新状态")}</button>
    {editing && <div className="space-y-2 pt-2">
      {fact.status !== 'confirmed' && <>
        <input aria-label={ui("核验来源")} className={inputClass} value={evidence.source} maxLength={1200} placeholder={ui("来源 URL、文件名与页码、实验记录编号")} onChange={e => setEvidence({ ...evidence, source: e.target.value })} />
        <textarea aria-label={ui("证据摘录")} className={inputClass} rows={3} value={evidence.excerpt} maxLength={1800} placeholder={ui("核对后的原始数据或证据摘录")} onChange={e => setEvidence({ ...evidence, excerpt: e.target.value })} />
        <input aria-label={ui("适用范围")} className={inputClass} value={evidence.scope} maxLength={600} placeholder={ui("适用时间、样本、条件与范围")} onChange={e => setEvidence({ ...evidence, scope: e.target.value })} />
      </>}
      <textarea aria-label={ui("审核理由")} className={inputClass} rows={2} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} placeholder={ui("审核理由：如何核对了来源，或发现了什么问题")} />
      <div className="flex flex-wrap gap-2">
        {fact.status !== 'confirmed' && <button className={`${buttonClass} text-emerald-300`} onClick={() => decide('confirmed')}>{ui("已核对来源，确认")}</button>}
        {fact.status !== 'pending' && <button className={buttonClass} onClick={() => decide('pending')}>{ui("退回待验证")}</button>}
        {fact.status !== 'disputed' && <button className={`${buttonClass} text-rose-300`} onClick={() => decide('disputed')}>{ui("标记争议")}</button>}
        {fact.status !== 'rejected' && <button className={buttonClass} onClick={() => decide('rejected')}>{ui("驳回")}</button>}
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>}
  </article>;
}

function FactBoard({ workspace, change }: { workspace: InquiryWorkspace; change: (fn: (w: InquiryWorkspace) => InquiryWorkspace) => void }) {
  const [filter, setFilter] = useState<FactStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState('');
  const facts = workspace.facts.filter(f => (filter === 'all' || f.status === filter) && `${f.claim} ${f.source} ${f.scope}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="font-semibold text-sm">{ui("事实看板")}<span className="text-slate-500 font-normal">v{workspace.factRevision}</span></h3><button className={buttonClass} onClick={() => setAdding(!adding)}>{adding ? ui("收起") : ui("+ 录入事实")}</button></div>
    <p className="text-xs text-slate-400 leading-relaxed">{ui("只把有来源、证据与适用范围并经人工核验的信息作为事实。AI 的验证与审计意见会保留在记录中，候选结论不会自动转正。")}</p>
    {adding && <form className="rounded-xl bg-slate-800/60 p-3 space-y-2" onSubmit={e => {
      e.preventDefault();
      try { change(w => addFact(w, draft)); setDraft(blank); setAdding(false); setError(''); }
      catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    }}>
      <textarea aria-label={ui("事实陈述")} required maxLength={1000} className={inputClass} rows={3} placeholder={ui("一条明确、可核验的事实陈述")} value={draft.claim} onChange={e => setDraft({ ...draft, claim: e.target.value })} />
      <input aria-label={ui("事实来源")} maxLength={1200} className={inputClass} placeholder={ui("来源 URL / 文件与页码 / 实验记录")} value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} />
      <textarea aria-label={ui("原始证据")} maxLength={1800} className={inputClass} rows={2} placeholder={ui("原始数据或证据摘录")} value={draft.excerpt} onChange={e => setDraft({ ...draft, excerpt: e.target.value })} />
      <input aria-label={ui("事实适用范围")} maxLength={600} className={inputClass} placeholder={ui("适用时间、样本与范围")} value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value })} />
      <button className={buttonClass} type="submit">{ui("保存为待验证")}</button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </form>}
    <div className="flex flex-wrap gap-1">{(['all', 'confirmed', 'pending', 'disputed', 'rejected'] as const).map(s => <button key={s} onClick={() => setFilter(s)} aria-pressed={filter === s} className={`rounded-md px-2 py-1 text-[11px] ${filter === s ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{s === 'all' ? ui("全部") : STATUS[s]} {s === 'all' ? workspace.facts.length : workspace.facts.filter(f => f.status === s).length}</button>)}</div>
    <input aria-label={ui("搜索事实")} className={inputClass} placeholder={ui("搜索陈述、来源、适用范围")} value={search} onChange={e => setSearch(e.target.value)} />
    {facts.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">{workspace.facts.length ? ui("没有符合条件的记录") : ui("还没有事实。录入一条证据，或启动团队探究收集候选发现。")}</div>}
    {facts.slice().reverse().map(f => <FactCard key={f.id} fact={f} onReview={(status, reason, evidence) => change(w => reviewFact(w, f.id, status, reason, evidence))} />)}
  </div>;
}

export default function InquiryPanel({ project, nodes, mode, teams, onOpenFacts, scopeId }: {
  project: Project | null;
  nodes: ProblemNode[];
  mode: 'team' | 'facts';
  teams: ReturnType<typeof useInquiryTeams>;
  onOpenFacts: () => void;
  /** Embedded in a project's note tree: scope is controlled by the opened page. */
  scopeId?: string;
}) {
  const [questionId, setQuestionId] = useState('root');
  const [error, setError] = useState('');
  if (!project) return <div className="p-5 text-sm text-slate-400">{ui("请先创建或选择一个问题项目。")}</div>;
  const articles = nodes.filter(n => n.noteType !== 'readme' && n.noteType !== 'overview' && n.noteType !== 'simulation');
  const selected = articles.find(n => n.id === (scopeId ?? questionId));
  const effectiveId = selected ? selected.id : 'root';
  const question = selected?.title || project.metaProblem || project.name;
  const workspace = project.inquiries?.[effectiveId] || createInquiry(effectiveId, question);
  const change = (fn: (w: InquiryWorkspace) => InquiryWorkspace) => teams.change(project.id, effectiveId, question, fn);
  const running = teams.isRunning(project.id, effectiveId);
  const stopping = teams.isStopping(project.id, effectiveId);
  const preparing = teams.isPreparing?.(project.id, effectiveId);
  const background = selected ? (selected.fullNote || selected.notes || '') : projectOverviewContext({ ...project, nodes });
  const needsDescriptions = AGENT_ROLES.some(role => !agentProfile(workspace, role).description.trim());
  const last = workspace.rounds.at(-1);
  const taskStatus = { pending: '待执行', running: '执行中', completed: '已完成', failed: '失败' };
  const roundStatus = { running: '进行中', paused: '已暂停', completed: '已完成', failed: '待重试' };
  return <div className="h-full flex flex-col bg-slate-900 text-slate-200">
    {scopeId === undefined && <div className="p-3 border-b border-slate-700 space-y-2">
      <label className="text-[11px] text-slate-400" htmlFor="inquiry-question">{ui("一个问题 · 一个专属团队")}</label>
      <select id="inquiry-question" className={inputClass} value={effectiveId} onChange={e => { setQuestionId(e.target.value); setError(''); }}>
        <option value="root">{ui("核心问题：")}{project.metaProblem || project.name}</option>
        {articles.map(n => <option key={n.id} value={n.id}>{ui("文章：")}{n.title}</option>)}
      </select>
      <p className="text-[10px] text-slate-500">{ui("团队历史和事实按问题分别保存，切换文章可查看各自的探究。")}</p>
    </div>}
    <div className="flex-1 overflow-y-auto p-3 space-y-4" key={effectiveId}>
      {mode === 'facts' ? <FactBoard workspace={workspace} change={change} /> : <>
        {effectiveId === 'root' && <ProjectManagerPanel project={project} teams={teams} />}
        <AgentTeamSettings workspace={workspace} projectId={project.id} teams={teams} background={background} busy={running || !!teams.isManaging?.(project.id)} />
        <AgentMemoryPanel workspace={workspace} onOpenFacts={onOpenFacts} />
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 space-y-3">
          <h3 className="font-semibold text-sm">{ui("围绕这个问题，持续迭代认知")}</h3>
          <p className="text-xs text-slate-400 leading-relaxed">{ui("每轮提出 3–6 个假设，逐项执行、独立验证和审计。下一轮继承已确认事实与前两轮审计意见。")}</p>
          <div className="grid grid-cols-2 gap-2">{Object.entries(INQUIRY_ROLES).map(([role, info]) => {
            const profile = running && last?.agents ? (last.agents[role as InquiryRole] || agentProfile(workspace, role as InquiryRole)) : agentProfile(workspace, role as InquiryRole);
            return <div key={role} className={`rounded-lg border p-2 min-w-0 ${running && last?.tasks.some(t => t.role === role && t.status === 'running') ? 'border-violet-400 bg-violet-500/20' : 'border-slate-700 bg-slate-800/60'}`}><p className="text-xs mb-1 break-words">{info.icon} {profile.name}</p><p className="text-[10px] text-violet-300 break-all">{profile.model.model || ui("全局默认模型")}</p><p className="text-[10px] text-slate-500 leading-relaxed">{info.duty}</p></div>;
          })}</div>
          <p className="text-[10px] text-slate-500">{ui("各角色使用上方配置的模型，未配置时跟随全局设置。首次补齐描述额外调用一次；每轮探究约 10–19 次调用。执行范围为材料分析、计算推理与方案生成，现实实验需另行执行并录入证据。")}</p>
          {preparing && <p role="status" className="text-xs text-violet-300">{ui("AI 正在起草角色描述…")}</p>}
          {running ? <button className={`${buttonClass} w-full`} disabled={stopping} onClick={() => teams.stop(project.id, effectiveId)}>{stopping ? ui("等待当前步骤结束后暂停…") : ui("当前步骤完成后暂停")}</button> : <button className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 p-2 text-sm font-medium" onClick={async () => {
            setError('');
            try { await teams.start(project.id, effectiveId, question, background); }
            catch (e) { setError(e instanceof Error ? e.message : '启动失败'); }
          }}>{!last ? needsDescriptions ? '生成角色描述并开始首轮探究' : '组建团队并开始首轮探究' : last.status === 'completed' ? '开始下一轮探究' : '继续探究（保留已完成步骤）'}</button>}
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </div>
        <button onClick={onOpenFacts} className="w-full flex justify-between rounded-xl border border-slate-700 p-3 text-xs"><span>{ui("查看事实看板 →")}</span><span className="text-emerald-400">{workspace.facts.filter(f => f.status === 'confirmed').length}{ui("已确认")}<span className="text-amber-300">/ {workspace.facts.filter(f => f.status === 'pending').length}{ui("待验证")}</span></span></button>
        {!last && <p className="text-xs text-slate-500 text-center py-5">{ui("还没有探究记录。启动后可查看每一步的完整成果和审核意见。")}</p>}
        {workspace.rounds.slice().reverse().map(round => <section key={round.id} className="space-y-2">
          <div className="flex justify-between text-xs"><h4 className="font-semibold">{ui("第")}{round.number}{ui("轮")}</h4><span className="text-slate-500">{roundStatus[round.status]} · {round.tasks.filter(t => t.status === 'completed').length}/{round.tasks.length}</span></div>
          {round.error && <p role="alert" className="rounded bg-red-500/10 p-2 text-xs text-red-400">{round.error}{ui("。后续步骤已停止，可重试当前步骤。")}</p>}
          {!!round.configHistory?.length && <details className="text-xs text-slate-400"><summary className="cursor-pointer">{ui("本轮配置调整记录（")}{round.configHistory.length}）</summary>{round.configHistory.map((c, i) => <p className="mt-2 whitespace-pre-wrap break-words" key={i}>{INQUIRY_ROLES[c.role].name} · {new Date(c.at).toLocaleString('zh-CN')}<br />{ui("模型：")}{c.before.model.model || ui("全局默认")} → {c.after.model.model || ui("全局默认")}<br />{ui("描述原文：")}{c.before.description || ui("默认职责")}<br />{ui("描述更新：")}{c.after.description || ui("默认职责")}</p>)}</details>}
          {round.hypotheses.map((h, i) => <div key={h.id} className="rounded-lg bg-slate-800/60 p-2 text-xs"><p>{i + 1}. {h.statement}</p><p className="mt-1 text-[11px] text-slate-500">{ui("证伪条件：")}{h.falsification}</p></div>)}
          {round.tasks.map(task => <details key={task.id} className="rounded-lg border border-slate-700 bg-slate-800/30 p-2">
            <summary className="cursor-pointer text-xs"><span className={task.status === 'running' ? 'text-violet-300' : task.status === 'failed' ? 'text-red-400' : 'text-slate-300'}>{INQUIRY_ROLES[task.role].icon} {INQUIRY_ROLES[task.role].name}{task.hypothesisId ? ` · 假设 ${round.hypotheses.findIndex(h => h.id === task.hypothesisId) + 1}` : ''} · {taskStatus[task.status]}</span></summary>
            <div className="mt-2 space-y-2 text-xs text-slate-400">
              {task.agentSnapshot && <details><summary className="cursor-pointer text-violet-300">{ui("本步角色：")}{task.agentSnapshot.name} · {task.agentSnapshot.model.model || ui("全局默认模型")}</summary><p className="whitespace-pre-wrap mt-2">{task.agentSnapshot.description || ui("使用默认职责")}<br />{ui("API 协议：")}{task.agentSnapshot.model.provider}</p></details>}
              {task.result?.verdict && <p className="text-amber-300">{ui("审核意见：")}{VERDICT[task.result.verdict]}{ui("（不自动确认为事实）")}</p>}
              <p className="whitespace-pre-wrap break-words leading-relaxed">{task.result?.summary || task.error || ui("等待前置步骤完成")}</p>
              {task.result?.candidates?.map((f, i) => <p className="border-l border-amber-700 pl-2" key={i}>{ui("候选发现：")}{f.claim}</p>)}
              {task.factSnapshot && <details><summary className="cursor-pointer text-[10px]">{ui("查看本步读取的事实快照 v")}{task.factRevision}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-[10px]">{task.factSnapshot}</pre></details>}
            </div>
          </details>)}
        </section>)}
      </>}
    </div>
  </div>;
}
