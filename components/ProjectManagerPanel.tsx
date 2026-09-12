import { t as ui } from '../services/language';
import React, { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import type { useInquiryTeams } from '../services/useInquiryTeams';
import { agentProfile } from '../services/agentProfiles';
import { managerScope } from '../services/projectManager';

export default function ProjectManagerPanel({ project, teams, onTeam }: {
  project: Project; teams: ReturnType<typeof useInquiryTeams>; onTeam?: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const root = managerScope(project, 'root').workspace;
  const profile = agentProfile(root, 'manager');
  const busy = teams.isManaging(project.id);
  const messages = root.managerMessages || [];
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = historyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, project.id]);
  const button = 'rounded-lg border border-slate-600 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40';
  return <section aria-label={ui("AI 项目经理")} className="rounded-xl border border-blue-500/30 bg-slate-900 p-4 space-y-3">
    <div className="flex justify-between gap-3"><div><h3 className="font-semibold text-sm">🧭 {profile.name}</h3><p className="text-xs text-blue-300 mt-1">{profile.model.model || ui("跟随全局模型")}{ui("· 项目内沟通与协调")}</p></div>{onTeam && <button className={button} onClick={onTeam}>{ui("配置经理和团队")}</button>}</div>
    <p className="text-xs text-slate-400">{ui("汇总各想法的进展、事实与审计意见。协调建议可直接启动或暂停对应团队；对话保存在项目探索阶段中。")}</p>
    <div ref={historyRef} className="max-h-96 overflow-y-auto space-y-3" aria-live="polite">
      {!messages.length && <p className="text-xs text-slate-500">{ui("可以告诉我你的目标、限制和新发现，或让我整理当前最值得验证的问题。")}</p>}
      {messages.map(message => <article key={message.id} className={`rounded-lg p-3 text-xs ${message.role === 'user' ? 'bg-blue-950/50' : 'bg-slate-800/70'}`}>
        <p className="text-[10px] text-slate-500 mb-2">{message.role === 'user' ? ui("你") : message.agentSnapshot?.name || profile.name} · {new Date(message.createdAt).toLocaleString('zh-CN')}</p>
        <p className="whitespace-pre-wrap leading-relaxed break-words">{message.content}</p>
        {message.actions?.map(action => <div key={action.id} className="mt-3 border-t border-slate-700 pt-2 space-y-2">
          <p className="text-blue-300">{action.type === 'start' ? ui("开始 / 继续团队") : ui("当前步骤后暂停")} · {action.questionId === 'root' ? project.metaProblem : project.nodes.find(n => n.id === action.questionId)?.title || '已删除想法'}</p>
          <p className="text-slate-400 whitespace-pre-wrap">{action.reason}</p>
          <button className={button} disabled={action.status !== 'proposed'} onClick={async () => { try { setError(''); await teams.executeManagerAction(project.id, message.id, action.id); } catch (e) { setError(e instanceof Error ? e.message : '协调失败'); } }}>{({ proposed: '执行此建议', running: '团队正在执行…', done: '已处理', failed: '未完成' })[action.status]}</button>
          {action.error && <p className="text-amber-300">{action.error}</p>}
        </div>)}
      </article>)}
    </div>
    <div className="flex flex-wrap gap-2">{['总结项目进展和证据缺口', '下一步最值得验证什么？没有新证据就先等待。'].map(prompt => <button key={prompt} className={button} disabled={busy} onClick={() => setText(prompt)}>{prompt}</button>)}</div>
    <form className="space-y-2" onSubmit={async e => { e.preventDefault(); const value = text; try { setError(''); await teams.sendManager(project.id, value); setText(''); } catch (err) { setError(err instanceof Error ? err.message : '沟通失败'); } }}>
      <textarea aria-label={ui("给项目经理的消息")} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm focus:border-blue-400 focus:outline-none" rows={3} maxLength={6000} value={text} disabled={busy} onChange={e => setText(e.target.value)} placeholder={ui("告诉项目经理你的目标、新证据，或需要协调的事情…")} />
      <button className={`${button} bg-blue-600`} disabled={busy || !text.trim()} type="submit">{busy ? ui("项目经理正在梳理…") : ui("发送给项目经理")}</button>
    </form>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>;
}
