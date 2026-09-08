import { managerMessages, parseManagerReply, managerScope, managerBasis, validateManagerAction, type ManagerMessage } from './projectManager';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project } from '../types';
import { InquiryModel, InquiryWorkspace, InquiryRole, createInquiry, newRound, runInquiry } from './inquiry';
import { saveStage } from './projectWorktree';
import { AGENT_ROLES, agentProfile, profilesOf, descriptionMessages, applyDescriptions, editAgentProfile, validateAgentModel, reconfigurePendingAgent, type AgentProfile } from './agentProfiles';
import { agentModelCaller, snapshotAgentModels, snapshotAgentProfile, saveAgentCredential, hasAgentCredential, resolveAgentModel } from './agentModel';
import { callLLM } from './llmProvider';

/** Runner lives with App, so switching tabs/questions never writes into another question. */
export function useInquiryTeams(projects: Project[], setProjects: Dispatch<SetStateAction<Project[]>>, owner?: string,
  model?: InquiryModel) {
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const active = useRef(new Map<string, { stop: boolean; disposed: boolean }>());
  const sessionEpoch = useRef(0);
  const managerActive = useRef(new Map<string, { disposed: boolean }>());
  const [managing, setManaging] = useState<string[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [stopping, setStopping] = useState<string[]>([]);
  const [preparing, setPreparing] = useState<string[]>([]);
  const caller = model || agentModelCaller(owner);
  useEffect(() => {
    setRunning([]); setStopping([]); setPreparing([]); setManaging([]);
    return () => {
      sessionEpoch.current++;
      active.current.forEach(token => { token.stop = true; token.disposed = true; });
      active.current.clear();
      managerActive.current.forEach(token => { token.disposed = true; });
      managerActive.current.clear();
    };
  }, [owner]);
  const key = (projectId: string, questionId: string) => JSON.stringify([projectId, questionId]);
  const read = (projectId: string, questionId: string) => projectsRef.current.find(p => p.id === projectId)?.inquiries?.[questionId];
  const write = (projectId: string, w: InquiryWorkspace) => {
    const existing = read(projectId, w.questionId);
    const completed = w.rounds.at(-1);
    const newlyCompleted = completed?.status === 'completed' && existing?.rounds.find(r => r.id === completed.id)?.status !== 'completed';
    // Each finished round is an exploration milestone. Build its checkpoint once, outside React updaters.
    const current = projectsRef.current.find(p => p.id === projectId);
    const tree = newlyCompleted && current ? saveStage({ ...current, inquiries: { ...current.inquiries, [w.questionId]: w } }, `${w.question.slice(0, 45)} · 第 ${completed.number} 轮完成`, '自动保存团队轮次完成时的笔记、事实和审计结果').worktree : undefined;
    const apply = (list: Project[]) => list.map(p => p.id === projectId ? { ...p, inquiries: { ...p.inquiries, [w.questionId]: w }, ...(tree ? { worktree: tree } : {}) } : p);
    projectsRef.current = apply(projectsRef.current);
    setProjects(apply);
  };
  const change = (projectId: string, questionId: string, question: string, update: (w: InquiryWorkspace) => InquiryWorkspace) => {
    write(projectId, update(read(projectId, questionId) || createInquiry(questionId, question)));
  };
  const saveAgent = (projectId: string, questionId: string, question: string, role: InquiryRole, profile: AgentProfile, secret: string, clearKey = false) => {
    if (active.current.has(key(projectId, questionId)) || managerActive.current.has(projectId)) throw new Error('请先等待当前操作完成再保存配置');
    let config = validateAgentModel(profile.model);
    if (clearKey) config = { ...config, credentialId: undefined };
    if (secret.trim() && config.provider !== 'default') config = { ...config, credentialId: saveAgentCredential(owner, config, secret.trim()) };
    change(projectId, questionId, question, w => editAgentProfile(w, role, { ...profile, model: config }));
  };
  const generateDescriptions = async (projectId: string, questionId: string, question: string, background: string, role?: InquiryRole) => {
    const runKey = key(projectId, questionId);
    if (active.current.has(runKey)) throw new Error('团队正在运行，请等待或暂停');
    const token = { stop: false, disposed: false };
    active.current.set(runKey, token); setRunning(prev => [...prev, runKey]); setPreparing(prev => [...prev, runKey]);
    try {
      const w = { ...(read(projectId, questionId) || createInquiry(questionId, question)), background: background.slice(0, 16000) };
      const roles = role ? [role] : AGENT_ROLES.filter(r => !agentProfile(w, r).description.trim());
      if (!roles.length) return;
      const generator = role || 'thinker';
      const raw = await caller(descriptionMessages(w, roles), { role: generator, agent: agentProfile(w, generator), purpose: 'profiles' });
      if (!token.disposed) write(projectId, applyDescriptions(read(projectId, questionId) || w, raw, roles));
    } finally {
      if (!token.disposed) {
        active.current.delete(runKey); setRunning(prev => prev.filter(k => k !== runKey)); setPreparing(prev => prev.filter(k => k !== runKey)); setStopping(prev => prev.filter(k => k !== runKey));
      }
    }
  };
  const start = async (projectId: string, questionId: string, question: string, background: string) => {
    const runKey = key(projectId, questionId);
    if (active.current.has(runKey)) return;
    const token = { stop: false, disposed: false };
    active.current.set(runKey, token);
    setRunning(prev => [...prev, runKey]);
    try {
      let w = read(projectId, questionId) || createInquiry(questionId, question);
      w = { ...w, question, background: background.slice(0, 16000) };
      const needsRound = !w.rounds.length || w.rounds.at(-1)?.status === 'completed';
      if (needsRound) {
        const missing = AGENT_ROLES.filter(r => !agentProfile(w, r).description.trim());
        if (missing.length) {
          write(projectId, w); setPreparing(prev => [...prev, runKey]);
          const raw = await caller(descriptionMessages(w, missing), { role: 'thinker', agent: agentProfile(w, 'thinker'), purpose: 'profiles' });
          if (token.disposed) return;
          w = applyDescriptions(read(projectId, questionId) || w, raw, missing);
          write(projectId, w); setPreparing(prev => prev.filter(k => k !== runKey));
          if (token.stop) return;
        }
        w = newRound(w, model ? profilesOf(w) : snapshotAgentModels(profilesOf(w), owner));
      }
      if (!needsRound && !w.rounds.at(-1)?.agents) {
        const agents = model ? profilesOf(w) : snapshotAgentModels(profilesOf(w), owner);
        w = { ...w, rounds: w.rounds.map((r, i) => i === w.rounds.length - 1 ? { ...r, agents } : r) };
      }
      write(projectId, w);
      await runInquiry({
        read: () => read(projectId, questionId) || w,
        write: next => { if (!token.disposed) write(projectId, next); },
        model: caller,
        shouldStop: () => token.stop,
      });
    } finally {
      if (!token.disposed) {
        active.current.delete(runKey);
        setRunning(prev => prev.filter(k => k !== runKey));
        setStopping(prev => prev.filter(k => k !== runKey));
        setPreparing(prev => prev.filter(k => k !== runKey));
      }
    }
  };
  const stop = (projectId: string, questionId: string) => {
    const runKey = key(projectId, questionId);
    const token = active.current.get(runKey);
    if (token) { token.stop = true; setStopping(prev => [...prev, runKey]); }
  };
  const isProjectRunning = (projectId: string) => managerActive.current.has(projectId) || [...active.current.keys()].some(k => JSON.parse(k)[0] === projectId);
  const stopProject = (projectId: string) => {
    const managerToken = managerActive.current.get(projectId);
    if (managerToken) { managerToken.disposed = true; managerActive.current.delete(projectId); setManaging(prev => prev.filter(id => id !== projectId)); }
    for (const runKey of active.current.keys()) {
      const [p, q] = JSON.parse(runKey);
      if (p === projectId) stop(p, q);
    }
  };
  const testAgent = async (profile: AgentProfile, secret: string, clearKey = false) => {
    const config = validateAgentModel(profile.model);
    // Testing a draft never changes shared/global settings or stores its key.
    const settings = resolveAgentModel(secret.trim() || clearKey ? { ...config, credentialId: undefined } : config, owner);
    if (secret.trim() && config.provider !== 'default') settings.apiKey = secret.trim();
    const result = await callLLM([{ role: 'user', content: '请只回复 OK' }], { maxTokens: 256, timeoutMs: 25000 }, settings);
    if (!result.content.trim()) throw new Error('接口已响应，但没有返回正文，请检查模型设置');
    return '连接成功';
  };
  const applySavedAgent = (projectId: string, questionId: string, role: InquiryRole) => {
    if (active.current.has(key(projectId, questionId))) throw new Error('请先暂停当前操作');
    const w = read(projectId, questionId);
    if (!w) return;
    const agents = model ? profilesOf(w) : snapshotAgentModels(profilesOf(w), owner);
    write(projectId, reconfigurePendingAgent(w, role, agents[role]));
  };
  const sendManager = async (projectId: string, text: string) => {
    if (!text.trim() || managerActive.current.has(projectId)) return;
    const token = { disposed: false };
    managerActive.current.set(projectId, token); setManaging(prev => [...prev, projectId]);
    try {
      let project = projectsRef.current.find(p => p.id === projectId);
      if (!project) throw new Error('项目不存在');
      let root = managerScope(project, 'root').workspace;
      if (!agentProfile(root, 'manager').description.trim()) {
        const raw = await caller(descriptionMessages(root, ['manager']), { role: 'manager', agent: agentProfile(root, 'manager'), purpose: 'profiles' });
        if (token.disposed) return;
        root = applyDescriptions(read(projectId, 'root') || root, raw, ['manager']);
        write(projectId, root);
      }
      const agent = model ? agentProfile(root, 'manager') : snapshotAgentProfile(agentProfile(root, 'manager'), owner);
      const userMessage: ManagerMessage = { id: crypto.randomUUID(), role: 'user', content: text.trim().slice(0, 6000), createdAt: Date.now() };
      root = { ...(read(projectId, 'root') || root), managerMessages: [...((read(projectId, 'root') || root).managerMessages || []), userMessage] };
      write(projectId, root);
      project = projectsRef.current.find(p => p.id === projectId)!;
      const result = parseManagerReply(await caller(managerMessages(project, root), { role: 'manager', agent, purpose: 'manager' }), project);
      if (token.disposed) return;
      const latest = read(projectId, 'root') || root;
      write(projectId, { ...latest, managerMessages: [...(latest.managerMessages || []), { ...result, id: crypto.randomUUID(), role: 'assistant', createdAt: Date.now(), agentSnapshot: agent }] });
    } finally {
      if (!token.disposed) { managerActive.current.delete(projectId); setManaging(prev => prev.filter(id => id !== projectId)); }
    }
  };
  const executeManagerAction = async (projectId: string, messageId: string, actionId: string) => {
    const epoch = sessionEpoch.current;
    const project = projectsRef.current.find(p => p.id === projectId);
    if (!project) throw new Error('项目不存在');
    const root = read(projectId, 'root');
    const action = root?.managerMessages?.find(m => m.id === messageId)?.actions?.find(a => a.id === actionId);
    if (!action || action.status !== 'proposed') throw new Error('该建议已处理，请重新询问项目经理');
    const patch = (status: 'running' | 'done' | 'failed', error?: string) => {
      if (epoch !== sessionEpoch.current) return;
      const current = read(projectId, 'root');
      if (current) write(projectId, { ...current, managerMessages: current.managerMessages?.map(m => m.id === messageId ? { ...m, actions: m.actions?.map(a => a.id === actionId ? { ...a, status, error } : a) } : m) });
    };
    const { workspace, question, background } = managerScope(project, action.questionId);
    try { validateManagerAction(project, action); } catch (e) { patch('failed', e instanceof Error ? e.message : '建议已失效'); return; }
    if (action.type === 'start' && active.current.has(key(projectId, action.questionId))) { patch('failed', '该团队正在运行'); return; }
    if (action.type === 'pause' && !active.current.has(key(projectId, action.questionId))) { patch('failed', '该团队当前没有运行任务'); return; }
    patch('running');
    if (action.type === 'pause') { stop(projectId, action.questionId); patch('done'); return; }
    try {
      await start(projectId, action.questionId, question, background);
      const round = read(projectId, action.questionId)?.rounds.at(-1);
      patch(round?.status === 'failed' ? 'failed' : 'done', round?.error);
    } catch (e) { patch('failed', e instanceof Error ? e.message : '启动失败'); }
  };
  return { change, start, stop, stopProject, isProjectRunning, sendManager, executeManagerAction,
    isManaging: (p: string) => managing.includes(p), saveAgent, generateDescriptions, testAgent, applySavedAgent,
    hasCredential: (profile: AgentProfile) => hasAgentCredential(owner, profile.model),
    isPreparing: (p: string, q: string) => preparing.includes(key(p, q)),
    isRunning: (p: string, q: string) => running.includes(key(p, q)), isStopping: (p: string, q: string) => stopping.includes(key(p, q)) };
}
