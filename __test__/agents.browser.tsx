import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import InquiryPanel from '../components/InquiryPanel';
import { useInquiryTeams } from '../services/useInquiryTeams';
import { AGENT_ROLES } from '../services/agentProfiles';
import { INQUIRY_ROLES, addFact, createInquiry, recoverInquiry, reviewFact } from '../services/inquiry';
import type { Project } from '../types';
import '../index.css';

const KEY = 'hiexplore-agents-ui-test-v1';
function Fixture() {
  const [projects, setProjects] = useState<Project[]>(() => {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    const seed = [{ id: 'agent-test', name: '独立测试', metaProblem: '什么条件下用户会持续使用翻译眼镜？', createdAt: Date.now(), nodes: [] }];
    return (stored || seed).map((p: Project) => ({ ...p, inquiries: Object.fromEntries(Object.entries(p.inquiries || {}).map(([id, w]) => [id, recoverInquiry(w)])) }));
  });
  const [mode, setMode] = useState<'team' | 'facts'>('team');
  const [calls, setCalls] = useState<string[]>([]);
  const teams = useInquiryTeams(projects, setProjects, 'agents-ui-fixture', async (messages, context) => {
    setCalls(prev => [...prev, `${context?.purpose} · ${context?.role} · ${context?.agent.model.model || '模拟默认'} · ${context?.agent.name}`]);
    await new Promise(resolve => setTimeout(resolve, 150));
    if (context?.purpose === 'profiles') return JSON.stringify({ agents: Object.fromEntries(AGENT_ROLES.map(role => [role, { name: `${INQUIRY_ROLES[role].name}·眼镜研究`, description: `围绕翻译眼镜的持续使用问题，${INQUIRY_ROLES[role].duty}。标明样本与适用范围，区分事实和猜测，交接可追溯证据，不能把模拟材料推导为真实市场结论。` }])) });
    if (context?.purpose === 'manager') return JSON.stringify({ reply: '模拟项目经理：目前缺少真实用户证据。先让团队设计最小验证方案，结果经核验后再进入事实看板。', actions: [{ type: 'start', questionId: 'root', reason: '设计一次可证伪的验证方案（模拟协调测试）' }] });
    const sys = messages[0].content;
    if (sys.includes('团队的思想家')) return JSON.stringify({ summary: '模拟模型提出三个竞争解释。', hypotheses: ['使用频率', '翻译准确率', '隐私信任'].map(statement => ({ statement, falsification: '控制其余条件后改变该变量没有改变使用行为' })) });
    if (sys.includes('团队的执行者')) return JSON.stringify({ summary: '只完成材料分析，未执行现实实验。', candidates: [] });
    return JSON.stringify({ summary: '模拟审计：不超出提供证据的适用范围。', verdict: 'uncertain' });
  });
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(projects)), [projects]);
  const project = projects[0];
  const updateFact = (withdraw: boolean) => teams.change(project.id, 'root', project.metaProblem, w => {
    if (withdraw) { const f = w.facts.find(f => f.status === 'confirmed'); return f ? reviewFact(w, f.id, 'disputed', '测试发现重复样本，撤回记忆') : w; }
    let next = addFact(w || createInquiry('root', project.metaProblem), { claim: '测试样本 10 人中 8 人选择翻译', source: '本地合成测试记录 01', excerpt: '测试编号 1–8 选翻译，9–10 选导航', scope: '仅用于交互测试，不代表真实用户数据' });
    return reviewFact(next, next.facts.at(-1)!.id, 'confirmed', '测试程序逐项核对固定合成记录');
  });
  return <main className="h-screen bg-slate-950 text-slate-200 flex flex-col">
    <header className="p-3 space-y-2 text-xs"><p className="text-amber-300">独立测试 · 模拟模型和证据 · 不调用外部 API（请勿点击连接测试）</p>
      <div className="flex flex-wrap gap-3"><button onClick={() => setMode('team')}>团队页</button><button onClick={() => setMode('facts')}>事实页</button><button onClick={() => updateFact(false)}>注入已核验测试事实</button><button onClick={() => updateFact(true)}>撤回测试依据</button></div>
      <details><summary>本次角色调用路由（{calls.length}）</summary>{calls.map((s, i) => <p key={i}>{s}</p>)}</details>
    </header>
    <div className="flex-1 min-h-0"><InquiryPanel project={project} nodes={[]} mode={mode} teams={teams} scopeId="root" onOpenFacts={() => setMode('facts')} /></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
