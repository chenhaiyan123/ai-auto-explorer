import ResearchActivation from './ResearchActivation';
import { t as ui } from '../services/language';
import ProblemHeartbeatPanel from './ProblemHeartbeatPanel';
import { useLanguage } from '../services/language';
import SharedModelPicker from './SharedModelPicker';
import React, { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { INQUIRY_ROLES } from '../services/inquiry';
import { WAKE_DEFAULTS, visibleWakeStatus, utcDay, type WakePolicy, type Awakening } from '../services/awakening';
import { WAKE_API, projectWakeContext, wakeRequest, type WakeReply } from '../services/wakeClient';
import type { useInquiryTeams } from '../services/useInquiryTeams';

const when = (at?: number) => at ? new Date(at).toLocaleString('zh-CN') : '尚无';
const field = 'w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-xs text-slate-200';
const button = 'rounded-lg bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40';
const resultLabels = { running: '进行中', progress: '有新进展', waiting: '等待新依据', failed: '执行受阻', interrupted: '执行中断' };
const kinds = { hypothesis: '假设', plan: '待执行计划', observation: '候选观察', limitation: '证据局限' };

export default function ProjectLifePanel({ project, scopeId, teams, onFacts, browserBusy }: { project: Project; scopeId: string; teams: ReturnType<typeof useInquiryTeams>; onFacts: () => void; browserBusy?: boolean }) {
  const { t } = useLanguage();
  const context = projectWakeContext(project, scopeId);
  const current = useRef(context); current.current = context;
  const [reply, setReply] = useState<WakeReply>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const [settings, setSettings] = useState(false);
  const [policy, setPolicy] = useState<WakePolicy>({ ...WAKE_DEFAULTS });
  const policyLoaded = useRef(false); const alive = useRef(true);
  const [clue, setClue] = useState(''); const [source, setSource] = useState('');
  const [model, setModel] = useState({ role: 'default', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: '', apiKey: '' });
  const state = reply?.state || undefined;
  const status = visibleWakeStatus(state, connected);
  const refresh = async (signal?: AbortSignal) => {
    const result = await wakeRequest(current.current, '/state', 'GET', undefined, signal);
    if (!alive.current) return;
    setReply(result); setConnected(true);
    if (result.state && !policyLoaded.current) { setPolicy(result.state.policy); policyLoaded.current = true; }
  };
  useEffect(() => {
    alive.current = true;
    if (!WAKE_API) return () => { alive.current = false; };
    const controller = new AbortController(); let polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try { await refresh(controller.signal); }
      catch (e) { if (!controller.signal.aborted && alive.current) { setConnected(false); setError(e instanceof Error ? e.message : '云端连接中断'); } }
      finally { polling = false; }
    };
    void poll(); const interval = setInterval(poll, 10000);
    return () => { alive.current = false; controller.abort(); clearInterval(interval); };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); if (alive.current) await refresh(); return true; }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败'); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  // Sync changed evidence while this note is open. The cloud retains the last synchronized context after closure.
  const contextJSON = JSON.stringify(context);
  const attached = !!state;
  useEffect(() => {
    if (!attached || !WAKE_API) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void wakeRequest(current.current, '/context', 'PUT', JSON.parse(contextJSON), controller.signal).catch(e => {
        if (!controller.signal.aborted && alive.current) setError(`背景同步失败：${e.message}`);
      });
    }, 1200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [contextJSON, attached]);
  const sync = () => wakeRequest(context, '/context', 'PUT', context);
  const toggle = () => act(async () => {
    if (!state?.policy.enabled && (browserBusy || teams.isProjectRunning(project.id))) throw new Error('请先暂停浏览器中的探索，等待当前操作结束');
    await sync(); await wakeRequest(context, '/policy', 'PUT', { ...policy, enabled: !state?.policy.enabled });
  });
  const submit = () => act(async () => {
    await sync(); await wakeRequest(context, '/events', 'POST', { kind: 'input', body: clue, source }); setClue(''); setSource(''); setMessage('线索已保存。开启后台研究后由项目经理判断是否值得推进。');
  });
  const adopt = (run: NonNullable<Awakening['runs']>[number], index: number) => {
    const finding = run.findings![index]; const id = `wake:${run.id}:${index}`;
    const events = state!.events.filter(e => finding.evidenceIds.includes(e.id));
    const facts = (run.contextSnapshot?.facts || []).filter(f => finding.evidenceIds.includes(f.id));
    teams.change(project.id, scopeId, context.question, w => w.facts.some(f => f.id === id) ? w : ({ ...w, facts: [...w.facts, {
      id, claim: finding.claim, source: [...events.map(e => e.source), ...facts.map(f => f.source)].join('\n'),
      excerpt: [...events.map(e => e.body), ...facts.map(f => f.excerpt)].join('\n').slice(0, 1800), scope: '云端研究候选，适用范围待人工核验',
      origin: 'ai', status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), taskId: id, reviews: [],
    }] }));
    onFacts();
  };
  return <section aria-label={ui("智能生命体")} className="rounded-xl border border-emerald-800/60 bg-slate-900/70 p-4 space-y-4">
    <div className="flex flex-wrap items-center gap-2"><span aria-hidden className={`h-2.5 w-2.5 rounded-full ${status.active ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : status.status === 'blocked' ? 'bg-amber-400' : 'bg-slate-600'}`} /><h3 className="text-sm font-semibold">{ui("AI 项目经理 ·")}{ui(status.label)}</h3><button className={`${button} ml-auto`} onClick={() => setSettings(!settings)}>{ui("唤醒设置")}</button></div>
    <p className="text-xs text-slate-400">{state?.reason || ui("有新线索时推进，有证据时更新认知，其余时间安静等待。")}</p>
    {!WAKE_API && <p className="text-xs text-amber-300">{ui("云端执行器待接入。目前关闭页面后不会继续研究。")}</p>}
    {reply?.testMode && <p className="text-xs text-amber-300">{ui("本机模拟环境 · 不调用真实模型，结果只用于验证流程。")}</p>}
    {state && <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-400"><span>{ui("待处理线索")}{state.events.filter(e => e.status === 'pending').length}</span><span>{ui("今日调用")}{state.budget.day === utcDay(Date.now()) ? state.budget.calls : 0} / {state.policy.maxCallsPerDay}</span><span>{ui("下次检查")}{state.policy.enabled ? when(state.nextCheckAt) : ui("已暂停")}</span><span>{ui("策略复盘")}{state.policy.enabled ? when(state.nextReviewAt) : ui("已暂停")}</span></div>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}{message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
    {WAKE_API && !state?.policy.enabled && <ResearchActivation busy={busy} starterTokens={reply?.starterTokens || 0} mailReady={!!reply?.notifications?.ready} recipient={reply?.notifications?.recipient || ''}
      onAdvanced={() => setSettings(true)} onStart={(modelId, paperQuery, emailEnabled) => act(async () => {
        if (browserBusy || teams.isProjectRunning(project.id)) throw new Error(t('请先暂停浏览器研究并等待完成。', 'Pause browser research and wait for it to finish first.'));
        await wakeRequest(context, '/activate', 'POST', { context, modelId, paperQuery, emailEnabled });
        policyLoaded.current = false;
        setMessage(t('已开启云端长期关注，关闭电脑后也会按计划继续。首次研究将在调度器运行时开始。', 'Cloud research is enabled and continues when your computer is off. The first run starts on the scheduler.'));
      })} />}
    {state && <section className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 space-y-2" aria-label={t('研究约定', 'Research agreement')}>
      <h4 className="text-sm font-semibold">{t('我们接下来怎样研究', 'Our research agreement')}</h4>
      <p className="text-sm">{state.runs.at(-1)?.plan?.hypothesis || t('尚未形成可验证假设；首轮项目经理会明确问题和证据缺口。', 'No testable hypothesis yet. The first run will clarify the question and evidence gaps.')}</p>
      <p className="text-xs text-slate-400">{t('下一步：', 'Next: ')}{state.runs.at(-1)?.next || state.runs.at(-1)?.plan?.task || state.reason}</p>
      <p className="text-xs text-slate-400">{t('缺少依据：', 'Missing evidence: ')}{state.runs.at(-1)?.plan?.missingEvidence || t('等待项目经理梳理；尚未确认不等于不存在。', 'Awaiting review; unknown does not mean absent.')}</p>
      <p className="text-xs text-slate-400">{t('本轮停止条件：', 'Stop condition: ')}{state.runs.at(-1)?.plan?.stopCondition || t('无足够新依据时等待，不反复推演。', 'Wait when evidence is insufficient; avoid repeated speculation.')}</p>
      <p className="text-xs text-slate-400">{t('观察来源：', 'Watching: ')}{state.policy.paperQuery ? `Crossref · ${state.policy.paperQuery}` : t('你提交的资料或实验结果；尚未接入自动外部来源', 'Your submitted materials or results; no automated external source configured')}</p>
      <p className="text-xs text-slate-500">{t('最近实际检查：', 'Last actual check: ')}{when(state.lastCheckedAt)} · {t('下次检查：', 'Next check: ')}{state.policy.enabled ? when(state.nextCheckAt) : t('已暂停', 'Paused')}</p>
    </section>}
    {state && reply?.notifications && <section className="rounded-lg border border-slate-700 p-3 space-y-2">
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={reply.notifications.enabled} disabled={busy || (!reply.notifications.enabled && !reply.notifications.ready)} onChange={e => { const enabled = e.target.checked; void act(async () => { await wakeRequest(context, '/notifications', 'PUT', { enabled }); }); }} />{t('重要变化发送邮件', 'Email meaningful updates')}</label>
      <p className="text-xs text-slate-400">{reply.notifications.ready ? `${t('发送到登录邮箱：', 'To your verified login email: ')}${reply.notifications.recipient}` : t('服务端发信配置尚未完成；站内提醒照常保留。', 'Server email setup is incomplete; in-app updates remain available.')}</p>
      <p className="text-xs text-slate-500">{t('仅提醒有依据的判断变化、需要你的待办或运行受阻；不发送普通检查。每个账号每 24 小时最多 2 封，至少间隔 12 小时。安静模式不发邮件。', 'Only evidence-backed judgment changes, decisions or blocked research. No routine-check emails. At most 2 per account per 24 hours, at least 12 hours apart. Quiet mode suppresses email.')}</p>
      {reply.notifications.lastSentAt && <p className="text-xs text-slate-500">{t('最近提交邮件服务：', 'Last accepted by email provider: ')}{when(reply.notifications.lastSentAt)}</p>}
      {reply.notifications.error && <p role="alert" className="text-xs text-amber-300">{reply.notifications.error}</p>}
    </section>}
    {settings && <div className="space-y-4 border-t border-slate-700 pt-4">
      <p className="text-xs text-slate-400">{ui("当前问题、当前探索分支独立配置。云端使用最后同步的背景和事实；其他分支已开启的研究会继续，需分别暂停。")}</p>
      <div className="grid sm:grid-cols-3 gap-3">{([{ key: 'checkEveryHours', label: '基础检查间隔（小时）', min: 1, max: 168 }, { key: 'reviewEveryDays', label: '策略复盘间隔（天）', min: 1, max: 30 }, { key: 'maxCallsPerDay', label: '每日最多模型调用', min: 4, max: 100 }] as const).map(item => <label key={item.key} className="text-xs text-slate-400">{ui(item.label)}<input className={`${field} mt-1`} type="number" min={item.min} max={item.max} value={policy[item.key]} onChange={e => setPolicy(p => ({ ...p, [item.key]: Number(e.target.value) }))} /></label>)}</div>
      <label className="block text-xs text-slate-400">{ui("关注的论文关键词（Crossref，可留空）")}<input className={`${field} mt-1`} value={policy.paperQuery} maxLength={300} onChange={e => setPolicy(p => ({ ...p, paperQuery: e.target.value }))} placeholder={ui("例如：passive cooling window shading ventilation")} /></label>
      <p className="text-[11px] text-slate-500">{ui("没有新线索时不调用模型；持续无更新会延长检查间隔，最长为基础间隔的 3 倍。论文标题、摘要和 DOI 仅作为线索。每次最多")}{policy.maxCallsPerWake}{ui("次调用、每次输出最多")}{policy.maxOutputTokens}{ui("tokens；预算按 UTC 日期重置。")}</p>
      <div className="flex gap-2"><button className={button} disabled={!WAKE_API || busy} onClick={() => act(async () => { await sync(); await wakeRequest(context, '/policy', 'PUT', { ...policy, enabled: state?.policy.enabled || false }); setMessage('唤醒计划已保存'); })}>{ui("保存计划")}</button><button className={`${button} text-emerald-300`} disabled={!WAKE_API || busy} onClick={toggle}>{state?.policy.enabled ? ui("暂停云端研究") : ui("开启云端研究")}</button></div>
      <details className="border-t border-slate-700 pt-3"><summary className="cursor-pointer text-xs text-blue-300">{ui("后台模型与 API Key")}</summary><div className="mt-3 space-y-3">
        <p className="text-xs text-slate-400">{ui("可选择平台共享模型，或为后台单独授权自己的模型。自带密钥保存后发送到本项目配置的云端执行器并加密存储，浏览器已有密钥不会自动上传。角色描述沿用团队页的设置。")}</p>
        <div className="grid sm:grid-cols-2 gap-2"><label className="text-xs">{ui("使用角色")}<select aria-label={ui("后台模型角色")} className={field} value={model.role} onChange={e => setModel(m => ({ ...m, role: e.target.value, apiKey: '' }))}><option value="default">{ui("团队通用（未单独配置的角色）")}</option>{Object.entries(INQUIRY_ROLES).map(([key, role]) => <option key={key} value={key}>{ui(role.name)}</option>)}</select></label><label className="text-xs">{ui("API 协议")}<select className={field} value={model.provider} onChange={e => setModel(m => ({ ...m, provider: e.target.value, model: '', apiKey: '' }))}><option value="platform">{ui("平台共享模型（使用额度）")}</option><option value="openai-compatible">{ui("OpenAI 兼容（DeepSeek / Qwen 等）")}</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic / Claude</option></select></label></div>
        {model.provider === 'platform' ? <SharedModelPicker value={model.model} onChange={id => setModel(m => ({ ...m, model: id, apiKey: '' }))} /> : <>
        <label className="block text-xs">{ui("API 地址")}<input className={field} value={model.baseUrl} onChange={e => setModel(m => ({ ...m, baseUrl: e.target.value }))} placeholder="https://api.anthropic.com/v1" /></label>
        <label className="block text-xs">{ui("模型 ID")}<input className={field} value={model.model} onChange={e => setModel(m => ({ ...m, model: e.target.value }))} placeholder={ui("填写服务商提供的模型 ID")} /></label>
        <label className="block text-xs">API Key<input className={field} type="password" autoComplete="new-password" value={model.apiKey} onChange={e => setModel(m => ({ ...m, apiKey: e.target.value }))} /></label>
        </>}
        <button className={button} disabled={!WAKE_API || busy || (model.provider !== 'platform' && !model.apiKey) || !model.model} onClick={() => act(async () => { await sync(); await wakeRequest(context, '/model', 'PUT', model); setModel(m => ({ ...m, apiKey: '' })); setMessage('后台模型已保存，密钥不会返回到页面'); })}>{ui("保存后台模型")}</button>
        {Object.entries(reply?.models || {}).map(([role, config]) => <p key={role} className="text-xs text-slate-400">{role === 'default' ? ui("团队通用") : INQUIRY_ROLES[role as keyof typeof INQUIRY_ROLES]?.name}：{config.model} · {config.baseUrl}</p>)}
      </div></details>
    </div>}
    {WAKE_API && <details><summary className="cursor-pointer text-xs text-blue-300">{ui("提供新线索，唤醒下一步研究")}</summary><div className="mt-3 space-y-2"><textarea aria-label={ui("新线索内容")} className={field} rows={3} value={clue} maxLength={12000} onChange={e => setClue(e.target.value)} placeholder={ui("实验结果、失败记录、新发现或想进一步追问的问题…")} /><input aria-label={ui("线索来源")} className={field} value={source} onChange={e => setSource(e.target.value)} placeholder={ui("来源链接、数据文件位置或实验记录（可选）")} /><button className={button} disabled={busy || !clue.trim()} onClick={submit}>{ui("保存线索")}</button></div></details>}
    {state && <ProblemHeartbeatPanel state={state} busy={busy} act={body => act(async () => { await wakeRequest(context, '/heartbeat', 'POST', body); })} />}
    {!!state?.runs.length && <div className="space-y-3"><div className="flex items-center justify-between"><h4 className="text-xs font-semibold">{ui("这段时间的进展")}</h4><button className="text-xs text-blue-300" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `research-${project.id}-${scopeId}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{ui("导出完整记录")}</button></div>
      {state.runs.slice(-10).reverse().map(run => <details key={run.id} className="rounded-lg border border-slate-700 p-3"><summary className="cursor-pointer text-xs"><span className="text-emerald-300">{ui(resultLabels[run.outcome])}</span><span className="ml-2 text-slate-500">{when(run.startedAt)}</span><p className="mt-2 text-slate-300">{run.summary || run.reason}</p></summary><div className="mt-3 space-y-3 text-xs"><p>{ui("唤醒原因：")}{run.reason}</p><p className="text-amber-200">{ui("下一步：")}{run.next || ui("研究中")}</p>
        {run.findings?.map((f, i) => <div key={i} className="border-l-2 border-blue-600 pl-3"><p>{ui(kinds[f.kind])}：{f.claim}</p><p className="text-[11px] text-slate-500 break-all">{ui("依据：")}{f.evidenceIds.join('、') || ui("规划性推断，无已确认事实")}</p>{['observation', 'limitation'].includes(f.kind) && <button className="mt-1 text-blue-300" onClick={() => adopt(run, i)}>{ui("送事实看板核验 →")}</button>}</div>)}
        <p className="text-slate-500">{ui("记忆依据：本轮读取")}{run.contextSnapshot?.facts.filter(f => f.status === 'confirmed').length || 0}{ui("条已确认事实。候选发现不会自动写入已验证记忆。")}</p>
        {run.memoryChanges && <p className="text-slate-500">{ui("相较上轮，各角色共用的事实记忆：新增")}{run.memoryChanges.added.length}{ui("· 撤回")}{run.memoryChanges.withdrawn.length}{ui("· 修订")}{run.memoryChanges.updated.length}。<span className="break-all">{[...run.memoryChanges.added, ...run.memoryChanges.withdrawn, ...run.memoryChanges.updated].join('、')}</span></p>}
        {run.contextSnapshot?.facts.some(f => f.status === 'confirmed' && !context.facts.some(currentFact => currentFact.id === f.id && JSON.stringify(currentFact) === JSON.stringify(f))) && <p className="text-amber-300">{ui("此历史轮次引用的事实已有变化或撤回，请按当前事实看板重新核对，勿直接沿用旧结论。")}</p>}
        {state.events.filter(e => run.eventIds.includes(e.id)).map(e => <details key={e.id}><summary className="cursor-pointer text-blue-300">{ui("线索：")}{e.title}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-400">{e.body}</pre>{/^https?:\/\//i.test(e.source) ? <a className="break-all text-blue-300" href={e.source} target="_blank" rel="noreferrer">{ui("查看来源 ↗")}</a> : <p>{e.source}</p>}</details>)}
        {run.steps.map((step, i) => <details key={i}><summary className="cursor-pointer text-slate-400">{ui(INQUIRY_ROLES[step.role].name)} · {step.purpose} · {step.completedAt ? ui("已返回") : ui("尚未返回")}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-400">{step.result || ui("请求已预留预算；中断时不会自动重试。")}</pre></details>)}
      </div></details>)}
    </div>}
  </section>;
}
