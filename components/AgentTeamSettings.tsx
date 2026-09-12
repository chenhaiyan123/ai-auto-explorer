import { t as ui } from '../services/language';
import SharedModelPicker from './SharedModelPicker';
import React, { useState } from 'react';
import { INQUIRY_ROLES, type InquiryRole, type InquiryWorkspace } from '../services/inquiry';
import { AGENT_ROLES, agentProfile, type AgentModelConfig, type AgentProfile } from '../services/agentProfiles';
import { activeAgentMemory } from '../services/agentMemory';
import type { useInquiryTeams } from '../services/useInquiryTeams';

type Teams = ReturnType<typeof useInquiryTeams>;
const input = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 focus:border-violet-400 focus:outline-none';
const button = 'rounded-lg border border-slate-600 px-2 py-1.5 text-xs hover:bg-slate-700 disabled:opacity-40';
const PROVIDERS: Record<AgentModelConfig['provider'], string> = { platform: '平台共享模型（使用额度）', default: '跟随全局设置', openai: 'OpenAI API', 'openai-compatible': 'OpenAI 兼容 API', anthropic: 'Claude Messages API', 'cloud-proxy': '云端代理', trial: '体验代理' };

function AgentCard({ role, profile, disabled, onSave, onGenerate, onApply, teams }: {
  role: InquiryRole; profile: AgentProfile; disabled: boolean; onSave: (profile: AgentProfile, secret: string, clear: boolean) => void;
  onGenerate: () => Promise<void>; onApply?: () => void; teams: Teams;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [secret, setSecret] = useState(''); const [clear, setClear] = useState(false);
  const [message, setMessage] = useState(''); const [testing, setTesting] = useState(false);
  const patchModel = (patch: Partial<AgentModelConfig>) => { setDraft(d => ({ ...d, model: { ...d.model, ...patch } })); setMessage(''); };
  const preset = (provider: AgentModelConfig['provider'], baseUrl: string, model: string) => { patchModel({ provider, baseUrl, model, credentialId: undefined }); setSecret(''); setClear(false); };
  return <article className="rounded-xl border border-slate-700 bg-slate-900 p-3 space-y-3 min-w-0">
    <div className="flex items-start justify-between gap-2"><div><h4 className="text-sm font-semibold">{INQUIRY_ROLES[role].icon} {profile.name}</h4><p className="text-[10px] text-slate-500">{INQUIRY_ROLES[role].name} · {profile.descriptionOrigin === 'ai' ? ui("AI 起草") : profile.descriptionOrigin === 'user' ? '用户编辑' : '待起草'}</p></div><button className={button} disabled={disabled || testing} onClick={() => { setDraft(profile); setSecret(''); setClear(false); setEditing(!editing); setMessage(''); }}>{editing ? ui("取消") : ui("编辑")}</button></div>
    <p className="text-xs text-violet-300 break-all">{PROVIDERS[profile.model.provider]}{profile.model.provider !== 'default' && ` · ${profile.model.model || '未填写模型 ID'}`}</p>
    {!editing && <p className="whitespace-pre-wrap text-xs text-slate-400 leading-relaxed">{profile.description || ui("AI 会结合这个问题生成角色描述，你可以在起草后编辑。")}</p>}
    {!editing && <button className={button} disabled={disabled || testing} onClick={async () => { try { setMessage(''); await onGenerate(); } catch (e) { setMessage(e instanceof Error ? e.message : '生成失败'); } }}>{profile.description ? ui("AI 重新起草描述") : ui("AI 起草描述")}</button>}
    {!editing && onApply && <button className={`${button} text-amber-300`} disabled={disabled || testing} onClick={() => { try { onApply(); setMessage('配置已应用到未完成步骤，已完成成果保留'); } catch (e) { setMessage(e instanceof Error ? e.message : '更新失败'); } }}>{ui("应用已保存配置到本轮未完成步骤")}</button>}
    {editing && <form className="space-y-3" onSubmit={e => { e.preventDefault(); try { onSave(draft, secret, clear); setEditing(false); setSecret(''); setMessage(role === 'manager' ? '已保存，下次沟通生效' : '已保存，下轮生效'); } catch (err) { setMessage(err instanceof Error ? err.message : '保存失败'); } }}>
      <fieldset disabled={disabled || testing} className="space-y-3 disabled:opacity-50">
        <label className="block text-xs text-slate-400">{ui("名称")}<input aria-label={`${INQUIRY_ROLES[role].name}名称`} className={input} value={draft.name} required maxLength={80} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="block text-xs text-slate-400">{ui("角色描述")}<textarea aria-label={`${INQUIRY_ROLES[role].name}描述`} className={input} value={draft.description} maxLength={2400} rows={6} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <div className="flex flex-wrap gap-2">{[
          ['DeepSeek', 'openai-compatible', 'https://api.deepseek.com', 'deepseek-v4-flash'],
          ['智谱', 'openai-compatible', 'https://open.bigmodel.cn/api/paas/v4', ''],
          ['Claude', 'anthropic', 'https://api.anthropic.com/v1', 'claude-sonnet-4-6'],
          ['OpenAI / ChatGPT', 'openai', 'https://api.openai.com/v1', 'gpt-4.1-mini'],
          ['Gemini', 'openai-compatible', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.8-flash'],
          ['Ollama 本地', 'openai-compatible', 'http://localhost:11434/v1', ''],
          ['LM Studio 本地', 'openai-compatible', 'http://localhost:1234/v1', ''],
          ['自定义兼容 API', 'openai-compatible', '', ''],
        ].map(([label, provider, baseUrl, model]) => <button key={label} type="button" className={button} onClick={() => preset(provider as AgentModelConfig['provider'], baseUrl, model)}>{label}</button>)}</div>
        <p className="text-[10px] text-slate-500">{ui("选择云端预设后填入自己的 API Key 即可测试；地址和模型 ID 均可修改。本地模型需先启动服务并填写已安装模型的 ID，支持兼容 API 的开源模型。")}</p>
        <label className="block text-xs text-slate-400">{ui("API 协议")}<select aria-label={`${INQUIRY_ROLES[role].name}API协议`} className={input} value={draft.model.provider} onChange={e => { patchModel({ provider: e.target.value as AgentModelConfig['provider'], model: '', credentialId: undefined }); setSecret(''); }}>{Object.entries(PROVIDERS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        {draft.model.provider === 'platform' && <SharedModelPicker value={draft.model.model} onChange={id => patchModel({ model: id, baseUrl: '', credentialId: undefined })} />}
        {!['default', 'platform'].includes(draft.model.provider) && <>
          <label className="block text-xs text-slate-400">{ui("API 地址")}<input aria-label={`${INQUIRY_ROLES[role].name}API地址`} className={input} required type="url" value={draft.model.baseUrl} placeholder="https://api.example.com/v1" onChange={e => patchModel({ baseUrl: e.target.value })} /></label>
          <label className="block text-xs text-slate-400">{ui("模型 ID")}<input aria-label={`${INQUIRY_ROLES[role].name}模型ID`} className={input} required value={draft.model.model} placeholder={ui("填写服务商提供的 API 模型 ID")} onChange={e => patchModel({ model: e.target.value })} /></label>
          <label className="block text-xs text-slate-400">API Key<input aria-label={`${INQUIRY_ROLES[role].name}API密钥`} className={input} type="password" autoComplete="new-password" value={secret} placeholder={teams.hasCredential(profile) ? ui("已保存；留空保持当前密钥") : ui("填写密钥；无需鉴权的本地接口可留空")} onChange={e => setSecret(e.target.value)} /></label>
          {profile.model.credentialId && <label className="flex gap-2 text-xs"><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} />{ui("解除此角色的密钥绑定")}</label>}
          <p className="text-[10px] text-slate-500">{ui("ChatGPT 对应 OpenAI API，需服务商的 API 接入。地址通常以 /v1 结尾；跨域受限时可填写代理地址。测试会发送一条简短请求。")}</p>
        </>}
        <div className="flex flex-wrap gap-2"><button type="submit" className={`${button} bg-violet-600`}>{ui("保存配置")}</button><button type="button" className={button} onClick={async () => { setTesting(true); setMessage('测试连接中…'); try { setMessage(await teams.testAgent(draft, secret, clear)); } catch (e) { setMessage(e instanceof Error ? e.message : '连接失败'); } finally { setTesting(false); } }}>{ui("测试连接")}</button></div>
      </fieldset>
    </form>}
    {message && <p role="status" className="text-xs text-amber-300 break-words">{message}</p>}
  </article>;
}

export default function AgentTeamSettings({ workspace, projectId, teams, background, busy }: {
  workspace: InquiryWorkspace; projectId: string; teams: Teams; background: string; busy: boolean;
}) {
  const [error, setError] = useState('');
  const missing = AGENT_ROLES.some(r => !agentProfile(workspace, r).description.trim());
  return <details className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
    <summary className="text-sm font-semibold cursor-pointer">{ui("团队配置 · 模型与角色描述")}{missing ? ui("（待起草）") : ''}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-400">{ui("每个问题独立配置。AI 先起草描述，你可以修改名称、职责和每个角色的模型。配置变更默认用于新轮次；如果要修复暂停或失败的任务，可显式应用到本轮未完成步骤。")}</p>
      <p className="text-[10px] text-slate-500">{ui("自带密钥单独存于当前浏览器，不写入项目或探索快照；平台共享 Key 由后台管理，用户只选择模型。")}</p>
      {missing && <button className={button} disabled={busy} onClick={async () => { try { setError(''); await teams.generateDescriptions(projectId, workspace.questionId, workspace.question, background); } catch (e) { setError(e instanceof Error ? e.message : '起草失败'); } }}>{ui("AI 起草所有未填写描述")}</button>}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="grid lg:grid-cols-2 gap-3">{AGENT_ROLES.map(role => {
        const profile = agentProfile(workspace, role);
        return <AgentCard key={`${role}:${profile.updatedAt || 0}`} role={role} profile={profile} teams={teams} disabled={busy}
          onApply={role !== 'manager' && workspace.rounds.at(-1) && workspace.rounds.at(-1)?.status !== 'completed' ? () => teams.applySavedAgent(projectId, workspace.questionId, role) : undefined}
          onSave={(draft, secret, clear) => teams.saveAgent(projectId, workspace.questionId, workspace.question, role, draft, secret, clear)}
          onGenerate={() => teams.generateDescriptions(projectId, workspace.questionId, workspace.question, background, role)} />;
      })}</div>
    </div>
  </details>;
}

export function AgentMemoryPanel({ workspace, onOpenFacts }: { workspace: InquiryWorkspace; onOpenFacts: () => void }) {
  const [role, setRole] = useState<InquiryRole>('thinker');
  const entries = activeAgentMemory(workspace, role);
  const events = (workspace.memoryHistory || []).filter(e => e.role === role).slice().reverse();
  const [limit, setLimit] = useState(10);
  return <details className="rounded-xl border border-emerald-800/50 p-3">
    <summary className="cursor-pointer text-sm font-semibold">{ui("Agent 记忆 · 逐轮变化与事实依据")}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-400">{ui("事实记忆只保存已核验陈述及其范围，不把 AI 推测当成记忆。每轮完成留痕；事实核验后同步，争议或撤回后移出有效记忆。历史不会删除。")}</p>
      <select aria-label={ui("查看哪个agent的记忆")} className={input} value={role} onChange={e => { setRole(e.target.value as InquiryRole); setLimit(10); }}>{AGENT_ROLES.map(r => <option key={r} value={r}>{agentProfile(workspace, r).name}（{INQUIRY_ROLES[r].name}）</option>)}</select>
      <p className="text-xs text-emerald-300">{ui("当前有效记忆")}{entries.length}{ui("条 · v")}{workspace.agentMemories?.[role]?.version || 0}</p>
      <details><summary className="text-xs cursor-pointer">{ui("查看当前记忆原文")}</summary><div className="space-y-2 mt-2">{entries.map(e => <article key={e.factId} className="border-l border-emerald-700 pl-2 text-xs"><p>{e.claim}</p><p className="text-slate-500 break-words">{ui("范围：")}{e.scope}<br />{ui("来源：")}{e.source}</p></article>)}{!entries.length && <p className="text-xs text-slate-500">{ui("暂无已核验事实记忆。")}</p>}</div></details>
      <button className={button} onClick={onOpenFacts}>{ui("查看事实与审核记录 →")}</button>
      {!events.length && <p className="text-xs text-slate-500">{ui("完成一轮探究或核验事实后，会记录记忆变化。")}</p>}
      {events.slice(0, limit).map(event => <article key={event.id} className="rounded-lg bg-slate-800/50 p-3 space-y-2 text-xs">
        <p className="font-medium">{event.roundNumber ? `第 ${event.roundNumber} 轮` : ui("探究开始前")} · {event.trigger === 'round-completed' ? ui("轮次完成") : ui("事实审核同步")} · v{event.version}</p>
        <p className="text-[10px] text-slate-500">{new Date(event.at).toLocaleString('zh-CN')}{ui("· 当时有效")}{event.total}{ui("条")}</p>
        {!event.changes.length && <p className="text-slate-400">{ui("本轮无变化：没有新增或变更的已核验依据。")}</p>}
        {event.changes.map(c => <details key={c.factId}><summary className="cursor-pointer">{c.kind === 'added' ? ui("新增") : c.kind === 'revised' ? '修订' : '撤回'} · {(c.after || c.before)?.claim}</summary><div className="mt-2 space-y-2 text-slate-400 break-words">
          {c.before && <p>{ui("更新前：")}{c.before.claim}<br />{ui("范围：")}{c.before.scope}<br />{ui("来源：")}{c.before.source}<br />{ui("摘录：")}{c.before.excerpt}</p>}
          {c.after && <p>{ui("更新后：")}{c.after.claim}<br />{ui("范围：")}{c.after.scope}<br />{ui("来源：")}{c.after.source}<br />{ui("摘录：")}{c.after.excerpt}</p>}
          <p>{ui("依据 ID：")}{c.factId}<br />{ui("变更原因：")}{c.reason}</p>
        </div></details>)}
      </article>)}
      {events.length > limit && <button className={button} onClick={() => setLimit(limit + 10)}>{ui("加载更早的记忆记录")}</button>}
    </div>
  </details>;
}
