import React, { useState } from 'react';
import { useLanguage } from '../services/language';
import type { ProjectMandate, ProjectBudget } from '../services/projectMandate';
import SharedModelPicker from './SharedModelPicker';
const field = 'w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-xs text-slate-200';
const button = 'rounded-lg bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40';
const localDate = (n: number) => { const d = new Date(n); return new Date(n - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export default function ProjectMandatePanel({ mandate, question, busy, connected, checkpoint, stopCode, onSave, onAction, onDiscard }: {
  mandate?: ProjectMandate | null; question: string; busy: boolean; connected: boolean; checkpoint: boolean; stopCode?: string;
  onSave: (body: unknown) => Promise<boolean>; onAction: (action: string, note?: string) => Promise<boolean>; onDiscard: () => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(''); const [acceptance, setAcceptance] = useState(''); const [stop, setStop] = useState('');
  const [deadline, setDeadline] = useState(''); const [papers, setPapers] = useState(true);
  const [budgets, setBudgets] = useState<Record<string, ProjectBudget>>({}); const [model, setModel] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [revision, setRevision] = useState(0); const [note, setNote] = useState('');
  const edit = () => {
    setGoal(mandate?.goal || question); setAcceptance(mandate?.acceptance || '');
    setStop(mandate?.stopCondition || t('没有新证据就等待；预算不足或到期时停止。', 'Wait without new evidence; stop at the budget limit or deadline.'));
    setDeadline(localDate(mandate?.deadline || Date.now() + 7 * 86400000)); setPapers(mandate ? mandate.tools.includes('paper_search') : true);
    setBudgets(mandate?.budgets || {}); setRevision(mandate?.revision || 0); setConfirmed(false); setEditing(true);
  };
  const labels: Record<string, string> = { active: t('已授权', 'Authorized'), paused: t('已暂停', 'Paused'), stopped: t('已停止', 'Stopped'), completed: t('已验收', 'Accepted'), deadline: t('已到期', 'Expired'), uncertain: t('用量待核对', 'Usage uncertain') };
  const displayStatus = mandate?.effectiveStatus === 'active' && stopCode === 'PROJECT_BUDGET' ? t('预算受限，等待调整', 'Budget limit; review required') : mandate ? labels[mandate.effectiveStatus] || mandate.effectiveStatus : t('尚未设置', 'Not configured');
  return <details className="rounded-lg border border-slate-700 p-3" aria-label={t('阶段目标与项目预算', 'Milestone & project budget')}>
    <summary className="cursor-pointer text-xs text-slate-300">{t('阶段目标与项目预算', 'Milestone & project budget')} · {displayStatus}
      {mandate && <span className="ml-2 text-slate-400">{Object.entries(mandate.usage).map(([id, u]) => `${id}: ${u.remaining.toLocaleString()} Token`).join(' · ')}</span>}
    </summary>
    <div className="mt-3 space-y-3 text-xs">
      <p className="text-slate-400">{t('约束本项目所有分支、所有问题和所有 Agent 的云端研究。各模型分别设上限，仍受账号可用额度约束；保存不扣款、不充值，也不自动启动。浏览器手动聊天不计入此预算。', 'Limits cloud research across every branch, question and agent in this project. Model caps are separate and also subject to account credits. Saving does not charge, top up or start research. Manual browser chat is outside this budget.')}</p>
      {!mandate && <p className="text-amber-200">{t('尚未设项目累计上限；现有研究仍使用原来的每日调用和账号额度限制。', 'No cumulative project cap yet. Existing research retains its daily call and account credit limits.')}</p>}
      {mandate && <>
        <p className="font-medium">{mandate.goal}</p><p>{t('验收：', 'Acceptance: ')}{mandate.acceptance}</p>
        <p>{t('停止：', 'Stop: ')}{mandate.stopCondition} · {new Date(mandate.deadline).toLocaleString()}</p>
        <p className="text-slate-400">{t('自主权限：材料分析', 'Autonomous permission: material analysis')}{mandate.tools.includes('paper_search') && t('、论文元数据检索', ', paper metadata search')}{t('。采购、发消息和现实实验均未授权；条件性停止由经理判断，预算与期限由服务端强制检查。', '. Purchases, messaging and physical experiments are not authorized. The manager evaluates qualitative stop conditions; the server enforces budgets and deadlines.')}</p>
        <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{[t('模型', 'Model'), t('已用', 'Spent'), t('预留', 'Held'), t('剩余上限', 'Remaining cap')].map(x => <th className="p-1" key={x}>{x}</th>)}</tr></thead><tbody>{Object.entries(mandate.usage).map(([id, u]) => <tr key={id}><td className="p-1">{id}</td><td>{u.spent}</td><td>{u.held}</td><td>{u.remaining}</td></tr>)}</tbody></table></div>
        {checkpoint && <p className="text-amber-200">{t('已保存检查点。恢复时复用已返回步骤；事实或目标变化后需重新规划。', 'Checkpoint saved. Resume reuses completed steps; changed facts or goals require a new plan.')}</p>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !connected} onClick={() => onAction('resume')}>{t('授权并恢复当前问题', 'Authorize & resume this question')}</button><button className={button} disabled={busy || !connected} onClick={() => onAction('pause')}>{t('暂停整个项目', 'Pause whole project')}</button><button className={button} disabled={busy || !connected} onClick={() => onAction('stop')}>{t('结束本阶段', 'Stop this milestone')}</button></div>
        {checkpoint && <button className={button} disabled={busy || !connected} onClick={onDiscard}>{t('放弃检查点，保留历史与费用', 'Discard checkpoint; keep history & charges')}</button>}
        <details><summary className="cursor-pointer">{t('人工验收与用量记录', 'Human acceptance & usage history')}</summary><div className="mt-2 space-y-2"><textarea className={field} value={note} onChange={e => setNote(e.target.value)} maxLength={2500} placeholder={t('填写达到验收标准的证据或成果位置', 'Evidence or artifact location supporting acceptance')} /><button className={button} disabled={busy || !connected || !note.trim()} onClick={() => onAction('complete', note)}>{t('确认验收并停止', 'Accept & stop')}</button>{mandate.calls.map(c => <p key={c.id} className="text-slate-400">{new Date(c.at).toLocaleString()} · {c.modelId} · {c.scope.role} · {c.status} · {c.charged === undefined ? `${t('预留', 'Held')} ${c.reserved}` : c.charged} Token</p>)}</div></details>
      </>}
      <button className={button} disabled={busy || !connected} onClick={edit}>{mandate ? t('调整约定 / 预算', 'Edit agreement / caps') : t('设置有预算的自主阶段', 'Set a budgeted milestone')}</button>
      {editing && <form className="space-y-3 border-t border-slate-700 pt-3" onSubmit={async e => {
        e.preventDefault();
        if (await onSave({ expectedRevision: revision, confirmed, goal, acceptance, stopCondition: stop, deadline: mandate && deadline === localDate(mandate.deadline) ? mandate.deadline : new Date(deadline).getTime(), tools: papers ? ['model_analysis', 'paper_search'] : ['model_analysis'], budgets })) setEditing(false);
      }}>
        <label className="block">{t('阶段目标', 'Milestone goal')}<textarea required maxLength={1500} className={field} value={goal} onChange={e => setGoal(e.target.value)} /></label>
        <label className="block">{t('可观察的验收标准', 'Observable acceptance criteria')}<textarea required maxLength={2500} className={field} value={acceptance} onChange={e => setAcceptance(e.target.value)} placeholder={t('例如：取得 3 次真实访谈记录，列出证据支持的需求与反例；缺数据时报告未知。', 'Example: obtain 3 real interview records and identify supported needs and counterexamples; report missing data as unknown.')} /></label>
        <label className="block">{t('停止条件', 'Stop conditions')}<textarea required maxLength={1500} className={field} value={stop} onChange={e => setStop(e.target.value)} /></label>
        <label className="block">{t('截止时间（本地时间）', 'Deadline (local time)')}<input required type="datetime-local" className={field} value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={papers} onChange={e => setPapers(e.target.checked)} />{t('允许 Crossref 论文元数据检索', 'Allow Crossref paper metadata search')}</label>
        <p className="text-slate-400">{t('首版只支持平台共享模型。Token 上限不是人民币余额，也不是供应商费用担保。使用保守预留，收到供应商用量后结算；未知用量冻结后续调用。累计上限从首次设置起计算，调整预算不会清零历史消耗。', 'This version supports platform models only. Token caps are not cash balances or guaranteed provider charges. Conservative reservations settle against reported usage; unknown usage blocks further calls. Lifetime caps start at enrollment; editing never resets spending.')}</p>
        <details open={!Object.keys(budgets).length}><summary className="cursor-pointer text-blue-300">{t('添加模型预算', 'Add model budget')}</summary><div className="mt-2"><SharedModelPicker value={model} onChange={setModel} /><button type="button" className={button} disabled={!model || !!budgets[model]} onClick={() => setBudgets(b => ({ ...b, [model]: { totalTokens: 50000, dailyTokens: 50000, perCallTokens: 25000 } }))}>{t('添加此模型的预算', 'Add a cap for this model')}</button></div></details>
        {Object.entries(budgets).map(([id, b]) => <div className="rounded border border-slate-700 p-2 space-y-2" key={id}><p>{id}</p><div className="grid sm:grid-cols-3 gap-2">{([['totalTokens', t('累计上限 Token', 'Lifetime cap, tokens')], ['dailyTokens', t('UTC 每日上限', 'Daily cap (UTC)')], ['perCallTokens', t('单次预留上限', 'Per-call reservation cap')]] as const).map(([key, label]) => <label key={key}>{label}<input required type="number" min={0} max={1e9} step={1} className={field} value={b[key]} onChange={e => { const value = Number(e.target.value); setBudgets(all => ({ ...all, [id]: { ...all[id], [key]: value } })); }} /></label>)}</div><button type="button" className={button} onClick={() => setBudgets(all => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)))}>{t('移除此模型授权', 'Remove model authorization')}</button></div>)}
        <label className="flex gap-2"><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t('我确认目标、权限和以上预算上限。保存将暂停整个项目，需手动恢复。', 'I confirm the goal, permissions and caps. Saving pauses the whole project; resuming is manual.')}</label>
        <button className={button} disabled={busy || !connected || !confirmed || !Object.keys(budgets).length}>{t('确认保存约定', 'Confirm agreement')}</button><button type="button" className={`${button} ml-2`} onClick={() => setEditing(false)}>{t('取消', 'Cancel')}</button>
      </form>}
    </div>
  </details>;
}
