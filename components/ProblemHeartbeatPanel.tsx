import React, { useState } from 'react';
import type { Awakening } from '../services/awakening';
import { heartbeatOf, judgmentSupported, type WaitItem } from '../services/problemHeartbeat';
import { useLanguage, displayDate } from '../services/language';

const button = 'rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40';
const input = 'w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100';
export default function ProblemHeartbeatPanel({ state, act, busy }: { state: Awakening; act: (body: unknown) => Promise<boolean>; busy: boolean }) {
  const { t } = useLanguage(); const h = heartbeatOf(state);
  const [answer, setAnswer] = useState(''); const [source, setSource] = useState(''); const [selected, setSelected] = useState<WaitItem>();
  const unread = h.updates.filter(u => !u.readAt);
  const waits = h.waits.filter(w => w.status === 'waiting');
  const life = { watching: t('持续观察', 'Watching'), waiting: t('等待反馈', 'Waiting'), dormant: t('休眠', 'Dormant'), resolved: t('已解决', 'Resolved') };
  const days = Math.max(0, Math.floor((Date.now() - h.lastMeaningfulAt) / 86400000));
  const reply = async (decision: string) => { if (!await act({ action: 'reply', id: selected!.id, answer, source, decision })) return; setSelected(undefined); setAnswer(''); setSource(''); };
  return <div className="space-y-4" aria-label="Problem heartbeat">
    <div className="rounded-xl bg-slate-950/60 border border-slate-700 p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold text-sm">{t('问题心跳', 'Problem heartbeat')}</h4><span className="text-xs text-blue-300">{state.policy.enabled ? life[h.lifecycle] : t('后台已暂停', 'Cloud research paused')}</span></div>
      <p className="text-sm text-slate-300">{!state.policy.enabled ? t('后台研究已暂停；已有记录仍然保留。', 'Cloud research is paused. Existing records are preserved.') : unread.length ? t('有值得查看的变化或待办', 'There are updates or decisions worth your attention') : state.policy.enabled ? t('暂无新的重要提醒，按计划等待或观察。', 'No important updates. Waiting or watching as scheduled.') : t('后台研究已暂停；已有记录仍然保留。', 'Cloud research is paused. Existing records are preserved.')}</p>
      <p className="text-xs text-slate-500">{t('距上次采纳判断', 'Since the last accepted judgment')}: {days} {t('天', 'days')} · {t('未读', 'Unread')}: {unread.length}</p>
      <div className="flex flex-wrap gap-2">
        {h.lifecycle !== 'resolved' && <button className={button} disabled={busy} onClick={() => act({ action: 'lifecycle', lifecycle: h.lifecycle === 'dormant' ? 'watching' : 'dormant' })}>{h.lifecycle === 'dormant' ? t('重新关注', 'Reactivate') : t('让问题休眠', 'Let it rest')}</button>}
        <button className={button} disabled={busy} onClick={() => act({ action: 'lifecycle', lifecycle: h.lifecycle === 'resolved' ? 'watching' : 'resolved' })}>{h.lifecycle === 'resolved' ? t('重新打开问题', 'Reopen question') : t('标记已解决并停止研究', 'Resolve & stop research')}</button>
      </div>
      <p className="text-xs text-slate-500">{t('休眠仍观察已配置来源；重新关注不会自动解除研究暂停。', 'Resting still allows configured source checks. Reactivating never overrides an explicit research pause.')}</p>
    </div>
    <section className="space-y-2"><div className="flex justify-between gap-2"><h4 className="text-sm font-semibold">{t('自上次查看以来', 'Since your last visit')}</h4>{unread.length > 0 && <button className={button} disabled={busy} onClick={() => act({ action: 'read', ids: unread.slice(0, 200).map(u => u.id) })}>{t('标记已读', 'Mark as read')}</button>}</div>
      {!unread.length && <p className="text-xs text-slate-500">{t('无变化的检查不会生成一条新提醒。', 'Unchanged checks do not create new notifications.')}</p>}
      {unread.slice(-20).reverse().map(u => <article key={u.id} className={`rounded-lg border p-3 space-y-1 ${u.level === 'now' ? 'border-amber-600/60 bg-amber-950/20' : 'border-blue-800/60 bg-blue-950/20'}`}>
        <p className="text-[11px] text-slate-400">{u.level === 'now' ? t('需要你', 'Needs you') : t('重要更新', 'Meaningful update')} · {displayDate(u.createdAt)}</p><h5 className="text-sm font-semibold">{u.title}</h5><p className="text-sm text-slate-300">{u.body}</p><p className="text-xs text-slate-400">{u.reason}</p>
        {u.category === 'knowledge' && (() => { const j = h.judgments.find(j => j.id === u.targetId); if (!j) return null;
          return <div className="mt-2 space-y-1 text-xs border-t border-slate-700 pt-2">
            <p>{t('原判断 →', 'Before →')} {j.before || t('尚无已采纳判断', 'No accepted judgment yet')}</p>
            <p>{t('当前判断 →', 'Now →')} {j.after} · {j.status === 'accepted' ? t('已采纳', 'Accepted') : t('待审核', 'Needs review')}</p>
            <p>{t('变化依据 →', 'Evidence →')} {j.evidenceIds.map(id => state.context.facts.find(f => f.id === id)?.claim || id).join('；')}</p>
            <p>{t('核验 →', 'Verification →')} {judgmentSupported(state, j) ? t('引用已核验事实；解释仍需复核', 'References verified facts; interpretation needs review') : t('依据已变化或撤回，请重新核验', 'Evidence changed or was withdrawn; recheck')}</p>
            <p>{t('下一步 →', 'Next →')} {state.runs.find(r => r.id === j.runId)?.next || t('查看下方判断记录，核对后采纳或拒绝', 'Review the judgment below, then accept or reject')}</p>
          </div>; })()}
      </article>)}
      <details className="text-xs text-slate-400"><summary>{t('已读更新', 'Read updates')} ({h.updates.filter(u => u.readAt).length})</summary>{h.updates.filter(u => u.readAt).slice(-20).reverse().map(u => <p key={u.id} className="py-2">{displayDate(u.createdAt)} · {u.title}: {u.body}</p>)}</details>
    </section>
    <section className="space-y-2"><h4 className="text-sm font-semibold">{t('等待清单', 'What we are waiting for')}</h4>
      {!waits.length && <p className="text-xs text-slate-400">{t('没有待处理的等待事项。', 'No outstanding waiting items.')}</p>}
      {waits.map(w => <article key={w.id} className="rounded-lg border border-slate-700 p-3 space-y-2"><h5 className="text-sm font-medium">{w.title}</h5><p className="text-xs text-slate-300">{w.detail}</p><p className="text-xs text-slate-400">{t('负责人', 'Owner')}: {w.owner} · {t('来源', 'Source')}: {w.source || '—'}</p><p className="text-xs text-blue-300">{t('恢复条件', 'Resume when')}: {w.condition}</p><p className="text-xs text-slate-500">{t('下次来源检查', 'Next source check')}: {state.policy.enabled ? displayDate(state.nextCheckAt) : t('已暂停', 'Paused')}</p><button className={button} disabled={busy} onClick={() => { setSelected(w); setAnswer(''); setSource(''); }}>{t('回复此事项', 'Respond')}</button></article>)}
      {selected && <form className="rounded-lg border border-blue-700 p-3 space-y-2" onSubmit={e => { e.preventDefault(); void reply(['permission', 'decision'].includes(selected.kind) ? 'approve' : 'provide'); }}>
        <p className="text-sm">{selected.title}</p><textarea required aria-label="Response" className={input} value={answer} maxLength={6000} onChange={e => setAnswer(e.target.value)} placeholder={t('提供数据、决定或授权范围', 'Provide data, a decision, or the exact permission scope')} /><input aria-label="Response source" className={input} value={source} onChange={e => setSource(e.target.value)} placeholder={t('来源或记录链接', 'Source or record link')} />
        <p className="text-xs text-slate-500">{t('提交材料不等于核验为事实。批准只适用于此请求，不会自动执行外部实验或付款。', 'Submitting data does not verify it. Approval applies only to this request; no external experiment or payment is automatically executed.')}</p>
        <div className="flex gap-2"><button disabled={busy || !answer.trim()} type="submit" className={button}>{['permission', 'decision'].includes(selected.kind) ? t('批准此请求', 'Approve this request') : t('提交回复', 'Submit response')}</button>{['permission', 'decision'].includes(selected.kind) && <button className={button} type="button" disabled={busy || !answer.trim()} onClick={() => reply('decline')}>{t('拒绝', 'Decline')}</button>}<button className={button} type="button" onClick={() => setSelected(undefined)}>{t('取消', 'Cancel')}</button></div>
      </form>}
    </section>
    <section className="space-y-2"><h4 className="text-sm font-semibold">{t('判断如何变化', 'How our understanding changed')}</h4><p className="text-xs text-slate-400">{t('计划和假设另存研究记录；这里的判断必须关联已核验事实，并经过采纳。', 'Plans stay in the research log. These interpretations reference verified facts and require review before adoption.')}</p>
      {!h.judgments.length && <p className="text-xs text-slate-500">{t('尚无有证据依据的判断变化。', 'No evidence-based judgment changes yet.')}</p>}
      {h.judgments.slice(-20).reverse().map(j => <article key={j.id} className="rounded-lg border border-slate-700 p-3 space-y-2"><h5 className="text-sm font-medium">{j.subject} · {j.status === 'accepted' ? t('已采纳', 'Accepted') : j.status === 'rejected' ? t('未采纳', 'Rejected') : t('待审核', 'Proposed')}</h5><p className="text-xs text-slate-400">{t('之前', 'Before')}: {j.before || t('尚无已记录判断', 'No previously recorded judgment')}</p><p className="text-sm text-blue-200">{t('现在', 'After')}: {j.after}</p><p className="text-xs text-slate-300">{t('为什么', 'Why')}: {j.reason}</p>
        {!judgmentSupported(state, j) && <p className="text-xs text-amber-300">{t('依据已变化，此记录仅保留历史，需重新核验。', 'Supporting evidence changed. This is a historical record and needs rechecking.')}</p>}<div className="text-xs text-slate-400">{j.evidenceIds.map(e => { const f = state.context.facts.find(f => f.id === e); return <p key={e}>{f?.status !== 'confirmed' && '⚠ '}{e}: {f?.claim || t('证据已撤回', 'Evidence withdrawn')} {f?.source && /^https:\/\//.test(f.source) && <a className="text-blue-300 underline" href={f.source} target="_blank" rel="noreferrer">{t('来源', 'Source')}</a>}</p>; })}</div>
        {j.status === 'proposed' && <div className="flex gap-2"><button disabled={busy} className={button} onClick={() => act({ action: 'judgment', id: j.id, status: 'accepted' })}>{t('核对依据后采纳', 'Review evidence & accept')}</button><button disabled={busy} className={button} onClick={() => act({ action: 'judgment', id: j.id, status: 'rejected' })}>{t('不采纳', 'Reject')}</button></div>}
      </article>)}
    </section>
    <label className="block text-xs text-slate-400">{t('提醒偏好', 'Attention preferences')}<select aria-label="Attention preferences" className={`${input} mt-1`} value={h.preference} disabled={busy} onChange={e => act({ action: 'preferences', preference: e.target.value, priority: h.priority })}><option value="important">{t('只看重要变化', 'Meaningful updates only')}</option><option value="all">{t('包含更多研究更新', 'Include more research updates')}</option><option value="quiet">{t('安静模式（保留必要待办）', 'Quiet mode (required decisions remain)')}</option></select></label>
    <p className="text-xs text-slate-500">{t('提醒保存在此问题中。可在上方订阅登录邮箱的重要事件邮件；手机推送尚未接入。', 'Updates are saved with this question. Opt in above for important-event emails to your login address; mobile push is not connected.')}</p>
  </div>;
}
