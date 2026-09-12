import { t as ui } from '../services/language';
import React, { useState } from 'react';
import type { Project } from '../types';
import { overviewBrief, isOverviewNote } from '../services/projectOverview';
import MarkdownView from './MarkdownView';

type Save = (text: string) => void;
function EditableSection({ title, value, placeholder, onSave, children }: { title: string; value: string; placeholder: string; onSave?: Save; children?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  return <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
    <div className="flex justify-between gap-2 items-center"><h3 className="text-sm font-semibold">{title}</h3>{onSave && <button className="text-xs text-blue-300" onClick={() => { setDraft(value); setEditing(!editing); }}>{editing ? ui("取消") : ui("编辑")}</button>}</div>
    {editing ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); onSave?.(draft); setEditing(false); }}>
      <textarea aria-label={title} className="w-full min-h-48 rounded-lg bg-slate-950 border border-slate-600 p-3 text-sm" value={draft} maxLength={40000} onChange={e => setDraft(e.target.value)} placeholder={placeholder} />
      <button className="rounded-lg bg-blue-600 px-3 py-2 text-xs" type="submit">{ui("保存")}{title}</button>
    </form> : value.trim() ? <div className="max-h-72 overflow-y-auto">{children || <MarkdownView source={value} />}</div> : <p className="text-xs text-slate-500">{placeholder}</p>}
  </section>;
}
export default function ProjectOverviewContent({ project, onSaveBrief, onSaveSummary, onNote }: {
  project: Project; onSaveBrief?: Save; onSaveSummary?: (id: string, text: string) => void; onNote: (id: string) => void;
}) {
  const overview = project.nodes.find(n => n.noteType === 'overview');
  const summary = overview?.fullNote || overview?.notes || '';
  const originals = project.overviewMigration?.originals || project.nodes.filter(isOverviewNote);
  const render = (source: string) => <MarkdownView source={source} linkResolver={title => project.nodes.some(n => n.title === title)} onWikiLink={title => { const n = project.nodes.find(n => n.title === title); if (n && !isOverviewNote(n)) onNote(n.id); }} />;
  return <div className="space-y-3">
    <div className="grid lg:grid-cols-2 gap-4">
      <EditableSection title={ui("目标与范围")} value={overviewBrief(project)} placeholder={ui("为什么探索这个问题？什么算成功？有哪些限制？这里由你维护，AI 不会覆盖。")} onSave={onSaveBrief}>{render(overviewBrief(project))}</EditableSection>
      <EditableSection title={ui("研究摘要")} value={summary} placeholder={ui("尚无研究摘要。可与项目经理梳理现状，或在这里记录当前判断、卡点与下一步。")} onSave={overview && onSaveSummary ? text => onSaveSummary(overview.id, text) : undefined}>{render(summary)}</EditableSection>
    </div>
    <p className="text-[11px] text-slate-500">{ui("目标与范围由你维护；研究摘要中的判断需结合下方事实依据阅读。")}{overview?.noteUpdatedAt ? `摘要更新于 ${new Date(overview.noteUpdatedAt).toLocaleString('zh-CN')}。` : ''}{overview?.autoNote === false ? ui("摘要已由你接管，AI 不会自动覆盖。") : ''}</p>
    {originals.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer">{ui("合并前的笔记原文（")}{originals.length}{ui("篇）")}</summary><div className="space-y-3 mt-3">{originals.map(n => <details key={n.id} className="rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer">{n.title}</summary><div className="mt-3">{render(n.fullNote || n.notes || '（空笔记）')}</div></details>)}</div></details>}
  </div>;
}
