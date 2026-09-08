/** Local-only UI fixture: fake model, no network/API credentials, separate storage. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import InquiryPanel from '../components/InquiryPanel';
import { useInquiryTeams } from '../services/useInquiryTeams';
import { recoverInquiry, type InquiryModel } from '../services/inquiry';
import { AGENT_ROLES } from '../services/agentProfiles';
import type { Project } from '../types';
import { NodeStatus } from '../types';
import '../index.css';
const KEY = 'hiexplore-inquiry-ui-test-v1';
const seed: Project[] = ['A', 'B'].map(id => ({ id, name: `测试项目 ${id}`, metaProblem: `${id}：什么条件下用户会持续使用 AI 眼镜？`, createdAt: Date.now(), nodes: [{ id: `${id}-article`, title: `${id}：实时翻译是否是高频需求？`, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: '本地测试文章，不包含真实用户数据。', chatHistory: [], agentResults: [] }] }));
function Fixture() {
  const [projects, setProjects] = useState<Project[]>(() => {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null') || seed;
    return data.map((p: Project) => ({ ...p, inquiries: Object.fromEntries(Object.entries(p.inquiries || {}).map(([id, w]) => [id, recoverInquiry(w)])) }));
  });
  const [projectId, setProjectId] = useState('A');
  const [mode, setMode] = useState<'team' | 'facts'>('team');
  const [fail, setFail] = useState(false);
  const model: InquiryModel = async (messages, context) => {
    await new Promise(resolve => setTimeout(resolve, 700));
    if (context?.purpose === 'profiles') return JSON.stringify({ agents: Object.fromEntries(AGENT_ROLES.map(role => [role, { name: `测试${role}`, description: `围绕当前问题履行 ${role} 职责；保持竞争解释与来源核验，事实记忆只引用已经核验的材料。` }])) });
    const sys = messages[0].content;
    if (sys.includes('团队的思想家')) return JSON.stringify({ summary: '测试模型：分别从频率、准确率、隐私提出竞争解释。', hypotheses: ['高频跨语言交流驱动使用', '翻译准确率驱动使用', '隐私信任驱动使用'].map(statement => ({ statement, falsification: '在控制其他条件后，改变此变量没有改变实际使用频次。' })) });
    if (sys.includes('团队的执行者')) return JSON.stringify({ summary: '测试模型：已整理访谈方案；尚未执行真实访谈。', candidates: [{ claim: '测试样本中 8/10 人选择实时翻译（模拟数据）', source: '本地测试样本记录，第 1 页', excerpt: '模拟编号 1–8 选择翻译，9–10 选择导航。', scope: '仅限本地 UI 测试，不用于真实结论' }] });
    if (fail) throw new Error('模拟验证失败：用于测试断点续跑');
    return JSON.stringify({ summary: '测试模型：这些是模拟数据，无法推导真实市场结论；建议获取实测证据。', verdict: 'uncertain' });
  };
  const teams = useInquiryTeams(projects, setProjects, 'local-ui-fixture', model);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(projects)), [projects]);
  const project = projects.find(p => p.id === projectId)!;
  return <main className="h-screen bg-slate-950 text-slate-200 flex flex-col items-center p-4 gap-3">
    <p className="text-xs text-amber-300">本地交互测试 · 模拟模型与数据 · 不调用外部 API</p>
    <div className="flex flex-wrap gap-3 text-xs">
      <select aria-label="测试项目" value={projectId} onChange={e => setProjectId(e.target.value)} className="bg-slate-800 rounded p-2"><option value="A">测试项目 A</option><option value="B">测试项目 B</option></select>
      <button onClick={() => setMode('team')}>团队</button><button onClick={() => setMode('facts')}>事实</button>
      <label><input type="checkbox" checked={fail} onChange={e => setFail(e.target.checked)} /> 模拟验证失败（下次启动生效）</label>
    </div>
    <div className="w-full max-w-lg min-h-0 flex-1 border border-slate-700 rounded-xl overflow-hidden"><InquiryPanel key={project.id} project={project} nodes={project.nodes} teams={teams} mode={mode} onOpenFacts={() => setMode('facts')} /></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
