import { migrateProjectOverview } from '../services/projectOverview';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectWorkspace from '../components/ProjectWorkspace';
import ProjectNotesTree from '../components/ProjectNotesTree';
import { NodeStatus, type Project } from '../types';
import { ensureWorktree, saveStage, branchFromStage, switchExplorationBranch, type ProjectPage } from '../services/projectWorktree';
import { addFact, createInquiry, recoverInquiry, reviewFact } from '../services/inquiry';
import { useInquiryTeams } from '../services/useInquiryTeams';
import { AGENT_ROLES } from '../services/agentProfiles';
import '../index.css';
const KEY = 'hiexplore-overview-ui-test-v2';
const n = (id: string, title: string) => ({ id, title, notes: `这是${title}的模拟正文。`, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], chatHistory: [], agentResults: [] });
const make = (id: string) => {
  let p: Project = ensureWorktree({ id, name: `演示项目 ${id}`, metaProblem: `${id}：一个问题，一个持续探究的生命体`, createdAt: Date.now(), nodes: [{ ...n(`${id}-readme`, 'README'), noteType: 'readme', fullNote: '## 研究目标\n弄清翻译眼镜在什么场景值得长期使用。\n\n## 成功标准\n找到可被真实用户行为验证的需求。' }, { ...n(`${id}-overview`, '总览'), noteType: 'overview', fullNote: '## 当前判断\n目前只有合成测试记录，尚不能证明真实需求。\n\n## 下一步\n设计用户访谈，明确推翻假设的条件。' }, n(`${id}-a`, '翻译需求'), n(`${id}-b`, '隐私需求')] });
  let w = addFact(createInquiry(`${id}-a`, '翻译需求'), { claim: '模拟样本共 10 条记录', source: '本地测试记录第 1 页', excerpt: '模拟编号 1 到 10', scope: '仅用于功能测试' });
  w = reviewFact(w, w.facts[0].id, 'confirmed', '逐个核对模拟编号');
  p = saveStage({ ...p, inquiries: { [w.questionId]: w } }, '完成第一轮验证', '模拟样本已经核验');
  return migrateProjectOverview(p);
};
function Fixture() {
  const [projects, setProjects] = useState<Project[]>(() => (JSON.parse(localStorage.getItem(KEY) || 'null') || [make('A'), make('B')]).map((p: Project) => ({ ...p, inquiries: Object.fromEntries(Object.entries(p.inquiries || {}).map(([id, w]) => [id, recoverInquiry(w)])) })));
  const [currentId, setCurrentId] = useState('A');
  const [view, setView] = useState<{scopeId: string; page: ProjectPage}>({ scopeId: 'root', page: 'research' });
  const [note, setNote] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(true);
  const project = projects.find(p => p.id === currentId)!;
  const teams = useInquiryTeams(projects, setProjects, 'workspace-test', async (messages, context) => {
    await new Promise(r => setTimeout(r, 100));
    if (context?.purpose === 'profiles') return JSON.stringify({ agents: Object.fromEntries(AGENT_ROLES.map(role => [role, { name: `测试${role}`, description: `围绕当前问题履行 ${role} 职责；明确可证伪条件，核对真实来源，不将 AI 推测写入事实记忆。` }])) });
    if (context?.purpose === 'manager') return JSON.stringify({ reply: '模拟总结：先核验真实用户需求，再决定下一步。', actions: [] });
    const sys = messages[0].content;
    if (sys.includes('团队的思想家')) return JSON.stringify({ summary: '模拟思考', hypotheses: [1,2,3].map(i => ({ statement: `可验证的假设 ${i}`, falsification: '实测结果不支持' })) });
    if (sys.includes('团队的执行者')) return JSON.stringify({ summary: '模拟分析，未执行现实实验', candidates: [] });
    return JSON.stringify({ summary: '模拟审计，证据不足', verdict: 'uncertain' });
  });
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(projects)), [projects]);
  const put = (p: Project) => setProjects(prev => prev.map(x => x.id === p.id ? p : x));
  const open = (pid: string, scopeId: string, page: ProjectPage) => { setCurrentId(pid); setView({ scopeId: page === 'worktree' ? 'root' : scopeId, page }); setNote(null); };
  const restore = (p: Project) => { put(p); setView({ scopeId: 'root', page: 'research' }); };
  return <main className="h-screen bg-slate-950 text-slate-200 flex flex-col"><header className="p-2 text-xs text-amber-300 border-b border-slate-700 flex justify-between"><span>本地测试 · 模拟数据 · 不调用外部 API</span><button onClick={() => setShowTree(v => !v)}>切换笔记树</button></header><div className="flex-1 min-h-0 flex">
    {showTree && <aside className="w-64 flex-shrink-0 bg-slate-900"><ProjectNotesTree projects={projects} currentProjectId={currentId} selectedNodeId={note} selectedPage={view} search="" onSearch={() => {}} onOpenNode={(pid, id) => { setCurrentId(pid); setNote(id); }} onCreateProject={() => {}} onCreateDirection={() => {}} onAddChild={() => {}} onBuildTeam={() => {}} onCleanup={() => {}} onOpenPage={open} /></aside>}
    <section className="flex-1 min-w-0">{note ? <div className="p-5"><button onClick={() => setNote(null)}>返回仪表盘</button><p>{project.nodes.find(n => n.id === note)?.notes}</p></div> : <ProjectWorkspace project={project} scopeId={view.scopeId} page={view.page} teams={teams} onPage={(page, scopeId = view.scopeId) => open(currentId, scopeId, page)} onNote={setNote} onSaveBrief={text => put({ ...project, overviewBrief: text })} onSaveSummary={(id, text) => put({ ...project, nodes: project.nodes.map(n => n.id === id ? { ...n, fullNote: text, autoNote: false, noteUpdatedAt: Date.now() } : n) })} busy={teams.isProjectRunning(currentId)} onStop={() => teams.stopProject(currentId)} worktree={{ save: (label, reason) => put(saveStage(project, label, reason)), branch: (id, name) => restore(branchFromStage(project, id, name)), switchBranch: id => restore(switchExplorationBranch(project, id)), recordDecision: () => {}, legacyFork: () => {} }} />}</section>
  </div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
