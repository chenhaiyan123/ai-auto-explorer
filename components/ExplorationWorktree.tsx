import React, { useState } from 'react';
import type { Project } from '../types';
import { hasUnsavedStage, type ExplorationStage } from '../services/projectWorktree';

export interface WorktreeActions {
  save: (label: string, reason: string) => void;
  branch: (stageId: string, name: string) => void;
  switchBranch: (branchId: string) => void;
  recordDecision: () => void;
  legacyFork: (decisionId: string) => void;
}
const input = 'w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200';
const button = 'rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40';

export default function ExplorationWorktree({ project, actions, busy, onStop }: {
  project: Project; actions: WorktreeActions; busy: boolean; onStop: () => void;
}) {
  const tree = project.worktree;
  const [selectedId, setSelectedId] = useState('');
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState('');
  const selected = tree?.stages.find(s => s.id === selectedId) || tree?.stages.find(s => s.id === tree.currentStageId);
  const act = (fn: () => void) => { try { fn(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } };
  const legacy = (project.decisions || []).filter(d => !tree?.stages.some(s => s.decisionId === d.id));
  const decision = selected?.snapshot.decisions?.find(d => d.id === selected.decisionId);
  const branch = tree?.branches.find(b => b.id === tree.activeBranchId);
  const renderStage = (stage: ExplorationStage, seen: Set<string>): React.ReactNode => {
    if (seen.has(stage.id)) return null;
    const next = new Set(seen).add(stage.id);
    const children = tree!.stages.filter(s => s.parentId === stage.id);
    return <li key={stage.id} className="pl-3 border-l border-slate-700 py-1">
      <button onClick={() => { setSelectedId(stage.id); setBranchName(''); }} className={`w-full text-left rounded-lg p-2 border ${selected?.id === stage.id ? 'border-violet-500 bg-violet-500/15' : 'border-transparent hover:bg-slate-800'}`}>
        <div className="text-xs text-slate-200 break-words">{stage.decisionId ? '⚖️' : '○'} {stage.label}{tree!.currentStageId === stage.id && <span className="ml-2 text-emerald-400">当前</span>}</div>
        <div className="text-[10px] text-slate-500 mt-1">{tree!.branches.find(b => b.id === stage.branchId)?.name} · {new Date(stage.createdAt).toLocaleString('zh-CN')}</div>
      </button>
      {children.length > 0 && <ul className="ml-2">{children.map(s => renderStage(s, next))}</ul>}
    </li>;
  };
  return <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-white">决策与探索分支</h2><p className="mt-1 text-xs text-slate-400 leading-relaxed">保存关键阶段，查看当时的判断，从任意阶段继续。返回时自动保留当前进展，原路线仍可切回。</p></div>
      <button onClick={actions.recordDecision} className={button}>⚖️ 记录项目决策</button>
    </div>
    <div className="flex flex-wrap gap-3 items-center text-xs">
      <label className="text-slate-400">当前分支 <select aria-label="当前探索分支" disabled={busy} className="ml-2 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200" value={tree?.activeBranchId || ''} onChange={e => act(() => actions.switchBranch(e.target.value))}>
        {tree?.branches.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}
      </select></label>
      <span className="text-amber-300">{hasUnsavedStage(project) ? '有尚未保存为阶段的新进展' : '当前进展已保存'}</span>
      {busy && <button className={button} onClick={onStop}>暂停运行以切换阶段</button>}
    </div>
    {busy && <p className="text-xs text-amber-300">有任务正在运行。可以保存快照；切换阶段需等待当前请求结束，避免旧结果写入新分支。</p>}
    <form onSubmit={e => { e.preventDefault(); act(() => { actions.save(label, reason); setLabel(''); setReason(''); setSelectedId(''); }); }} className="grid md:grid-cols-[1fr_1.4fr_auto] gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3">
      <input required aria-label="探索阶段名称" value={label} maxLength={100} onChange={e => setLabel(e.target.value)} className={input} placeholder="阶段名称，例如：完成第一轮用户验证" />
      <input aria-label="阶段说明" value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} className={input} placeholder="为什么保存，当前判断是什么？" />
      <button className="bg-violet-600 hover:bg-violet-500 rounded-lg px-4 py-2 text-sm">保存当前阶段</button>
    </form>
    {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    <div className="grid lg:grid-cols-[minmax(230px,1fr)_minmax(0,1.4fr)] gap-4">
      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 overflow-x-auto"><h3 className="text-xs text-slate-400 mb-3">探索树 · {tree?.stages.length || 0} 个阶段 / {tree?.branches.length || 0} 条分支</h3>
        <ul aria-label="探索阶段树">{tree?.stages.filter(s => !s.parentId || !tree.stages.some(p => p.id === s.parentId)).map(s => renderStage(s, new Set()))}</ul>
      </section>
      {selected && <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 space-y-4">
        <div><h3 className="text-base font-semibold text-white">{selected.label}</h3><p className="text-xs text-slate-500 mt-1">{new Date(selected.createdAt).toLocaleString('zh-CN')}</p></div>
        {selected.reason && <p className="text-sm text-slate-300 whitespace-pre-wrap">{selected.reason}</p>}
        <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>{selected.snapshot.nodes.length} 篇笔记</span><span>· {Object.values(selected.snapshot.inquiries || {}).length} 个问题空间</span><span>· {Object.values(selected.snapshot.inquiries || {}).flatMap(w => w.facts).filter(f => f.status === 'confirmed').length} 条已确认事实</span><span>· {selected.snapshot.decisions?.length || 0} 条决策</span></div>
        {decision && <div className="border-l-2 border-amber-500 pl-3 space-y-2"><p className="text-sm text-amber-200">{decision.question}</p>{decision.options.map((o, i) => <p key={i} className="text-xs text-slate-300">{o.chosen ? '✓ 选择' : '× 放弃'} {o.label}{o.reason && <span className="text-slate-500"> — {o.reason}</span>}</p>)}</div>}
        <details className="text-xs text-slate-400"><summary className="cursor-pointer">查看当时的笔记与事实</summary><div className="mt-2 space-y-2 max-h-80 overflow-auto">{selected.snapshot.nodes.map(n => <details key={n.id} className="rounded bg-slate-950 p-2"><summary className="cursor-pointer">{n.title}</summary><p className="mt-2 whitespace-pre-wrap break-words">{n.fullNote || n.notes || '当时尚无正文'}</p></details>)}{Object.values(selected.snapshot.inquiries || {}).flatMap(w => w.facts.map(f => <p key={`${w.questionId}:${f.id}`} className="text-[11px]">{w.question} · {f.status === 'confirmed' ? '已确认' : '未确认'}：{f.claim}</p>))}</div></details>
        <div className="border-t border-slate-700 pt-4 space-y-2"><input aria-label="新探索分支名称" value={branchName} maxLength={80} onChange={e => setBranchName(e.target.value)} className={input} placeholder={`新分支名称（默认：从 ${selected.label} 继续）`} />
          <button disabled={busy} className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 py-2 text-sm" onClick={() => act(() => { actions.branch(selected.id, branchName.trim() || `从 ${selected.label} 继续`); setSelectedId(''); setBranchName(''); })}>返回此阶段并新建分支</button>
          <p className="text-[11px] text-slate-500">会恢复当时的笔记、团队、事实、研究路线和决策；「{branch?.name || '当前分支'}」保留。</p>
        </div>
      </section>}
    </div>
    {legacy.length > 0 && <section className="rounded-xl border border-slate-700 p-4 space-y-3"><h3 className="text-sm text-slate-300">历史决策 · 仅有节点快照</h3><p className="text-xs text-slate-500">这些旧记录没有当时完整的团队与事实信息，可以查看和复刻笔记子树。</p>{legacy.map(d => <div key={d.id} className="border-t border-slate-800 pt-3"><p className="text-sm">{d.question}</p>{d.options.map((o, i) => <p className="text-xs text-slate-400" key={i}>{o.chosen ? '✓' : '×'} {o.label} {o.reason}</p>)}<button disabled={busy} className={`${button} mt-2`} onClick={() => actions.legacyFork(d.id)}>复刻节点快照</button></div>)}</section>}
  </div>;
}
