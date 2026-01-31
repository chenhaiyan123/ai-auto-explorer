import { UserStats } from './types';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MessageBoard from './components/MessageBoard';
import { v4 as uuidv4 } from 'uuid';
import { ProblemNode, NodeStatus, DecisionPoint, Project, ChatMessage } from './types';
import GraphVisualization from './components/GraphVisualization';
import NodeDetails from './components/NodeDetails';
import DecisionModal from './components/DecisionModal';
import { exploreNode, chatWithNode, generateProjectSummary, callGemini, identifyNodeTask } from './services/geminiService';
import { monitor } from './services/monitoringService';
import { auth } from './services/authService';
import { GEMINI_MODEL } from './constants';
import { analyzeIntentWithAutoConfirm, IntentAnalysis, ExplorationMode } from './services/intentService';
import IntentConfirmModal from './components/IntentConfirmModal';
import { exploreResearchNode, generateResearchReport, KnowledgeCard, ResearchFinding } from './services/researchExplorer';
import ResearchReport from './components/ResearchReport';

// ========== Agent 类型 ==========
interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  status: 'idle' | 'working' | 'offline';
  specialty: string[];
}

// ========== AI管家组件 ==========
const AIButler: React.FC<{
  project: Project | null;
  nodes: ProblemNode[];
  onAddNode: (title: string, deps?: string[]) => void;
  onUpdateNode: (id: string, updates: Partial<ProblemNode>) => void;
  onStartExploration: () => void;
}> = ({ project, nodes, onAddNode, onUpdateNode, onStartExploration }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeAgents, setActiveAgents] = useState<Agent[]>([]);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const availableAgents: Agent[] = [
    { id: 'researcher', name: '研究员', role: '深度调研', avatar: '🔬', status: 'idle', specialty: ['research', 'analysis'] },
    { id: 'coder', name: '开发者', role: '代码实现', avatar: '💻', status: 'idle', specialty: ['code', 'build'] },
    { id: 'designer', name: '设计师', role: 'UI/UX设计', avatar: '🎨', status: 'idle', specialty: ['design', 'image'] },
    { id: 'writer', name: '文案', role: '内容创作', avatar: '✍️', status: 'idle', specialty: ['writing', 'content'] },
    { id: 'analyst', name: '分析师', role: '数据分析', avatar: '📊', status: 'idle', specialty: ['data', 'analysis'] },
  ];

  useEffect(() => {
    if (project && messages.length === 0) {
      setMessages([{ role: 'model', text: `你好！我是项目管家 🏠\n\n📋 ${project.name}\n📊 进度: ${nodes.filter(n => n.status === NodeStatus.SOLVED).length}/${nodes.length}\n\n有什么可以帮你的？` }]);
    }
  }, [project?.id]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const inviteAgent = (agent: Agent) => {
    if (activeAgents.find(a => a.id === agent.id)) return;
    setActiveAgents(prev => [...prev, { ...agent, status: 'idle' as const }]);
    setShowAgentPicker(false);
    setMessages(prev => [...prev, { role: 'model', text: `🤝 **${agent.name}** (${agent.role}) 已加入群聊！` }]);
  };

  const removeAgent = (agentId: string) => {
    const agent = activeAgents.find(a => a.id === agentId);
    if (agent) {
      setActiveAgents(prev => prev.filter(a => a.id !== agentId));
      setMessages(prev => [...prev, { role: 'model', text: `👋 **${agent.name}** 已离开群聊` }]);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setInput('');
    setIsTyping(true);
    try {
      const projectContext = project ? `项目:${project.name}, 目标:${project.metaProblem}, 节点:${nodes.length}, 完成:${nodes.filter(n => n.status === NodeStatus.SOLVED).length}, Agent:${activeAgents.map(a => a.name).join(',') || '无'}` : '';
      const systemPrompt = `你是项目AI管家。${projectContext}\n职责:分析进展、推荐Agent、协调任务。简洁回复，像微信聊天。`;
      const response = await callGemini([{ role: "system", content: systemPrompt }, ...messages.slice(-10).map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })), { role: "user", content: userMessage }], GEMINI_MODEL);
      setMessages(prev => [...prev, { role: 'model', text: response }]);
    } catch (e) { setMessages(prev => [...prev, { role: 'model', text: '抱歉，稍后再试。' }]); }
    finally { setIsTyping(false); }
  };

  return (
    <div className="h-full flex flex-col">
      {activeAgents.length > 0 && (
        <div className="p-3 border-b border-slate-800 bg-slate-900/50">
          <div className="text-[10px] text-slate-500 mb-2">群聊成员</div>
          <div className="flex gap-2 flex-wrap">
            {activeAgents.map(agent => (
              <div key={agent.id} className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 rounded-full text-xs group cursor-pointer hover:bg-slate-700" onClick={() => removeAgent(agent.id)}>
                <span>{agent.avatar}</span><span className="text-slate-300">{agent.name}</span><span className="text-slate-500 group-hover:text-red-400">×</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-slate-800 text-slate-300 rounded-bl-sm'}`}>{m.text}</div>
          </div>
        ))}
        {isTyping && <div className="flex justify-start"><div className="bg-slate-800 text-slate-400 px-3 py-2 rounded-2xl rounded-bl-sm text-xs animate-pulse">正在输入...</div></div>}
        <div ref={messagesEndRef} />
      </div>
      {showAgentPicker && (
        <div className="p-3 border-t border-slate-800 bg-slate-900">
          <div className="text-[10px] text-slate-500 mb-2">选择 Agent</div>
          <div className="grid grid-cols-2 gap-2">
            {availableAgents.filter(a => !activeAgents.find(aa => aa.id === a.id)).map(agent => (
              <button key={agent.id} onClick={() => inviteAgent(agent)} className="flex items-center gap-2 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-left transition-colors">
                <span className="text-lg">{agent.avatar}</span>
                <div><div className="text-xs font-medium text-slate-200">{agent.name}</div><div className="text-[10px] text-slate-500">{agent.role}</div></div>
              </button>
            ))}
          </div>
          <button onClick={() => setShowAgentPicker(false)} className="w-full mt-2 py-1.5 text-[10px] text-slate-500 hover:text-slate-300">取消</button>
        </div>
      )}
      <form onSubmit={handleSend} className="p-3 border-t border-slate-800 bg-slate-900/80">
        <div className="flex gap-2 items-end">
          <button type="button" onClick={() => setShowAgentPicker(!showAgentPicker)} className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors" title="邀请Agent">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
          </button>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="输入消息..." className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500" />
          <button type="submit" disabled={isTyping || !input.trim()} className="p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-xl transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </div>
      </form>
    </div>
  );
};

// ========== 简化版研究面板 ==========
const SimpleResearchPanel: React.FC<{
  project: Project | null;
  nodes: ProblemNode[];
  knowledgeCards: KnowledgeCard[];
  findings: ResearchFinding[];
  criticalNodes: ProblemNode[];
  isLooping: boolean;
  isGeneratingReport: boolean;
  onNodeSelect: (id: string) => void;
  onStartExploration: () => void;
  onStopExploration: () => void;
  onGenerateReport: () => void;
}> = ({ project, nodes, knowledgeCards, findings, criticalNodes, isLooping, isGeneratingReport, onNodeSelect, onStartExploration, onStopExploration, onGenerateReport }) => {
  const [activeSection, setActiveSection] = useState<'overview' | 'nodes' | 'findings'>('overview');

  const stats = useMemo(() => {
    const total = nodes.length;
    const solved = nodes.filter(n => n.status === NodeStatus.SOLVED).length;
    const exploring = nodes.filter(n => n.status === NodeStatus.EXPLORING).length;
    const unexplored = nodes.filter(n => n.status === NodeStatus.UNEXPLORED).length;
    const needsReview = nodes.filter(n => n.status === NodeStatus.NEEDS_REVIEW).length;
    const coverage = total > 0 ? Math.round((solved / total) * 100) : 0;
    return { total, solved, exploring, unexplored, needsReview, coverage };
  }, [nodes]);

  // 计算阶段目标和问题
  const projectAnalysis = useMemo(() => {
    const solvedNodes = nodes.filter(n => n.status === NodeStatus.SOLVED);
    const problemNodes = nodes.filter(n => n.status === NodeStatus.NEEDS_REVIEW || n.status === NodeStatus.INVALID);
    const exploringNodes = nodes.filter(n => n.status === NodeStatus.EXPLORING);
    
    // 当前阶段目标：正在探索的节点或下一个待探索的节点
    const currentPhase = exploringNodes.length > 0 
      ? exploringNodes[0].title 
      : nodes.find(n => n.status === NodeStatus.UNEXPLORED)?.title || '所有目标已完成';
    
    // 遇到的问题：待决策的节点
    const problems = problemNodes.map(n => n.title);
    
    // 验证：已完成的关键发现
    const validations = findings.slice(0, 3).map(f => f.insight);
    
    // 改进建议：基于当前状态
    const suggestions: string[] = [];
    if (stats.needsReview > 0) suggestions.push(`有 ${stats.needsReview} 个节点需要决策`);
    if (stats.unexplored > stats.solved) suggestions.push('建议继续深入探索未知领域');
    if (criticalNodes.length === 0 && stats.solved > 2) suggestions.push('可标记关键节点以聚焦重点');
    if (knowledgeCards.length < stats.solved) suggestions.push('整理已有发现形成知识卡片');
    
    return { currentPhase, problems, validations, suggestions };
  }, [nodes, findings, stats, criticalNodes, knowledgeCards]);

  return (
    <div className="h-full flex flex-col">
      {/* 进度环 */}
      <div className="p-4 flex justify-center">
        <div className="relative w-24 h-24">
          <svg className="w-full h-full transform -rotate-90">
            <circle cx="48" cy="48" r="40" stroke="#1e293b" strokeWidth="6" fill="none" />
            <circle cx="48" cy="48" r="40" stroke="url(#grad)" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={`${stats.coverage * 2.51} 251`} className="transition-all duration-500" />
            <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#10b981" /></linearGradient></defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-white">{stats.coverage}%</span>
            <span className="text-[9px] text-slate-500">探索进度</span>
          </div>
        </div>
      </div>

      {/* 分段选择 */}
      <div className="flex gap-1 px-4 mb-2">
        {[{ key: 'overview', label: '概览' }, { key: 'nodes', label: `节点` }, { key: 'findings', label: `发现` }].map(item => (
          <button key={item.key} onClick={() => setActiveSection(item.key as any)} className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-all ${activeSection === item.key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>{item.label}</button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-2">
        {activeSection === 'overview' && (
          <>
            {/* 项目总体目标 */}
            {project && (
              <div className="bg-gradient-to-r from-blue-600/10 to-purple-600/10 rounded-lg p-3 border border-blue-500/20">
                <div className="text-[10px] font-medium text-blue-400 mb-1.5">🎯 项目总体目标</div>
                <div className="text-[12px] text-slate-200 leading-relaxed">{project.metaProblem}</div>
              </div>
            )}

            {/* 当前阶段目标 */}
            <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
              <div className="text-[10px] font-medium text-emerald-400 mb-1.5">📍 当前阶段</div>
              <div className="text-[11px] text-slate-300">{projectAnalysis.currentPhase}</div>
            </div>

            {/* 探索进度 */}
            <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
              <div className="text-[10px] font-medium text-slate-400 mb-2">📊 探索进度</div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div><div className="text-sm font-bold text-emerald-400">{stats.solved}</div><div className="text-[8px] text-slate-500">已完成</div></div>
                <div><div className="text-sm font-bold text-yellow-400">{stats.exploring}</div><div className="text-[8px] text-slate-500">进行中</div></div>
                <div><div className="text-sm font-bold text-blue-400">{stats.unexplored}</div><div className="text-[8px] text-slate-500">待探索</div></div>
                <div><div className="text-sm font-bold text-orange-400">{stats.needsReview}</div><div className="text-[8px] text-slate-500">待决策</div></div>
              </div>
            </div>

            {/* 遇到的问题 */}
            {projectAnalysis.problems.length > 0 && (
              <div className="bg-orange-500/5 rounded-lg p-3 border border-orange-500/20">
                <div className="text-[10px] font-medium text-orange-400 mb-1.5">⚠️ 遇到的问题</div>
                <div className="space-y-1">
                  {projectAnalysis.problems.slice(0, 3).map((p, i) => (
                    <div key={i} className="text-[11px] text-slate-400 flex items-start gap-1.5">
                      <span className="text-orange-400">•</span>
                      <span className="truncate">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 验证/发现 */}
            {projectAnalysis.validations.length > 0 && (
              <div className="bg-emerald-500/5 rounded-lg p-3 border border-emerald-500/20">
                <div className="text-[10px] font-medium text-emerald-400 mb-1.5">✅ 已验证发现</div>
                <div className="space-y-1">
                  {projectAnalysis.validations.map((v, i) => (
                    <div key={i} className="text-[11px] text-slate-400 flex items-start gap-1.5">
                      <span className="text-emerald-400">•</span>
                      <span className="line-clamp-2">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 改进建议 */}
            {projectAnalysis.suggestions.length > 0 && (
              <div className="bg-blue-500/5 rounded-lg p-3 border border-blue-500/20">
                <div className="text-[10px] font-medium text-blue-400 mb-1.5">💡 改进建议</div>
                <div className="space-y-1">
                  {projectAnalysis.suggestions.map((s, i) => (
                    <div key={i} className="text-[11px] text-slate-400 flex items-start gap-1.5">
                      <span className="text-blue-400">•</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 关键节点 */}
            {criticalNodes.length > 0 && (
              <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
                <div className="text-[10px] font-medium text-yellow-400 mb-2">⭐ 关键节点</div>
                {criticalNodes.slice(0, 3).map(node => (
                  <button key={node.id} onClick={() => onNodeSelect(node.id)} className="w-full text-left p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg mb-1 transition-colors">
                    <div className="text-[11px] text-slate-200 truncate">{node.title}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {activeSection === 'nodes' && nodes.map(node => (
          <button key={node.id} onClick={() => onNodeSelect(node.id)} className="w-full text-left p-2 bg-slate-800/30 hover:bg-slate-700/50 rounded-lg transition-colors border border-slate-700/30">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${node.status === NodeStatus.SOLVED ? 'bg-emerald-500' : node.status === NodeStatus.EXPLORING ? 'bg-yellow-500 animate-pulse' : node.status === NodeStatus.NEEDS_REVIEW ? 'bg-orange-500' : 'bg-slate-500'}`} />
              <span className="text-[11px] text-slate-200 flex-1 truncate">{node.title}</span>
              {node.isCritical && <span className="text-[9px]">⭐</span>}
            </div>
          </button>
        ))}
        {activeSection === 'findings' && (findings.length === 0 ? <div className="text-center py-8 text-[10px] text-slate-600">暂无研究发现</div> : findings.map((f, i) => (
          <div key={i} className="p-2.5 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <div className="flex items-start gap-2">
              <span className="text-sm">💡</span>
              <div className="flex-1"><div className="text-[11px] text-slate-200">{f.insight}</div><div className="text-[9px] text-slate-500 mt-1">来源: {f.sourceNodeTitle}</div></div>
            </div>
          </div>
        )))}
      </div>

      {/* 底部操作 */}
      <div className="p-4 border-t border-slate-800 space-y-2">
        <button onClick={isLooping ? onStopExploration : onStartExploration} className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${isLooping ? 'bg-red-600/20 text-red-400 border border-red-500/30' : 'bg-blue-600/20 text-blue-400 border border-blue-500/30'}`}>
          {isLooping ? <><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />停止探索</> : <>▶ 开始长期探索</>}
        </button>
        <button onClick={onGenerateReport} disabled={isGeneratingReport || stats.solved === 0} className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 disabled:from-slate-700 disabled:to-slate-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg">
          {isGeneratingReport ? <><div className="w-2 h-2 bg-white rounded-full animate-ping" />生成中...</> : <>📄 生成研究报告</>}
        </button>
      </div>
    </div>
  );
};

// --- 外协执行页面 ---
const DelegationView: React.FC<{ nodeId: string, taskTitle: string }> = ({ nodeId, taskTitle }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const init = async () => {
      setIsTyping(true);
      try {
        const response = await callGemini([{ role: "system", content: `你是需求对齐AI。任务:"${taskTitle}"。向执行人解释背景目标，确认理解，后续监督进度。` }, { role: "user", content: "请开始讲解。" }], GEMINI_MODEL);
        setMessages([{ role: 'model', text: response }]);
      } catch (e) { setMessages([{ role: 'model', text: "任务: " + taskTitle }]); }
      finally { setIsTyping(false); }
    };
    init();
  }, [taskTitle]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    const newMsgs = [...messages, { role: 'user', text: input } as ChatMessage];
    setMessages(newMsgs);
    setInput('');
    setIsTyping(true);
    try {
      const response = await callGemini([{ role: "system", content: `你是进度监督AI。任务:${taskTitle}。引导执行人完成并同步进度。` }, ...newMsgs.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }))], GEMINI_MODEL);
      setMessages([...newMsgs, { role: 'model', text: response }]);
    } finally { setIsTyping(false); }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 flex flex-col items-center p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col h-full overflow-hidden">
        <header className="p-6 border-b border-slate-800"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-xl">🤝</div><div><h2 className="text-lg font-bold text-white">需求对齐AI</h2><p className="text-xs text-slate-500">任务：{taskTitle}</p></div></div></header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => (<div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[80%] px-5 py-3.5 rounded-2xl text-[14px] whitespace-pre-wrap ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 rounded-tl-none'}`}>{m.text}</div></div>))}
          {isTyping && <div className="text-xs text-slate-500 animate-pulse">AI输入中...</div>}
        </div>
        <form onSubmit={handleSend} className="p-4 border-t border-slate-800"><div className="flex gap-2"><input value={input} onChange={e => setInput(e.target.value)} placeholder="回复或同步进度..." className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none" /><button type="submit" className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl">发送</button></div></form>
      </div>
    </div>
  );
};

// --- 主应用 ---
const App: React.FC = () => {
  const [user, setUser] = useState(auth.getUser());
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  useEffect(() => { const h = () => setCurrentHash(window.location.hash); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  const routeInfo = useMemo(() => { if (currentHash.startsWith('#/delegate/')) { const parts = currentHash.split('/'); return { type: 'delegate', nodeId: parts[2]?.split('?')[0], taskTitle: new URLSearchParams(currentHash.split('?')[1] || '').get('task') || '未知任务' }; } return { type: 'main' }; }, [currentHash]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loginEmail, setLoginEmail] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [isLoginAsAdmin, setIsLoginAsAdmin] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [metaInput, setMetaInput] = useState('');
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [cloudStats, setCloudStats] = useState<UserStats[]>([]);
  const [adminActiveTab, setAdminActiveTab] = useState<'stats' | 'messages'>('stats');
  const [adminMessages, setAdminMessages] = useState<any[]>([]);
  const [pendingIntent, setPendingIntent] = useState<{ input: string; analysis: IntentAnalysis; } | null>(null);
  const [isAnalyzingIntent, setIsAnalyzingIntent] = useState(false);
  const [knowledgeCards, setKnowledgeCards] = useState<KnowledgeCard[]>([]);
  const [researchFindings, setResearchFindings] = useState<ResearchFinding[]>([]);
  const [researchReport, setResearchReport] = useState<any>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  // 个人中心相关状态
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  
  useEffect(() => { if (showAdminDashboard) { (async () => { setCloudStats(await monitor.fetchCloudStats()); try { const { getMessages } = await import('./services/messageService'); setAdminMessages(await getMessages()); } catch { setAdminMessages([]); } })(); } }, [showAdminDashboard]);

  // 删除项目
  const handleDeleteProject = useCallback((projectId: string) => {
    if (projects.length <= 1) {
      alert('至少保留一个项目');
      return;
    }
    if (!confirm('确定要删除这个项目吗？此操作不可恢复。')) return;
    setProjects(prev => prev.filter(p => p.id !== projectId));
    if (currentProjectId === projectId) {
      const remaining = projects.filter(p => p.id !== projectId);
      setCurrentProjectId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [projects, currentProjectId]);

  const [notesPanelMode, setNotesPanelMode] = useState<number>(1);
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'butler' | 'research'>('butler');
  const [nodes, setNodes] = useState<ProblemNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [isDetailsWide, setIsDetailsWide] = useState(false);
  const [decision, setDecision] = useState<DecisionPoint | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, nodeId: string } | null>(null);
  const isLoopingRef = useRef(false);
  const isProcessingRef = useRef(false);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);

  useEffect(() => { if (user) { const k = `exploration_projects_${user.username}`; try { const s = localStorage.getItem(k); const p = s ? JSON.parse(s) : []; setProjects(p); setCurrentProjectId(null); if (p.length === 0) setShowMetaModal(true); } catch { setProjects([]); setShowMetaModal(true); } } else { setProjects([]); setCurrentProjectId(null); } }, [user?.username]);
  useEffect(() => { if (user) { monitor.incrementSession(); const i = setInterval(() => monitor.updateHeartbeat(), 10000); return () => clearInterval(i); } }, [user]);

  const currentProject = useMemo(() => projects.find(p => p.id === currentProjectId) || null, [projects, currentProjectId]);
  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const decisionNode = useMemo(() => decision ? nodes.find(n => n.id === decision.nodeId) || null : null, [decision, nodes]);
  const filteredNodes = useMemo(() => { if (!focusedNodeId) return nodes; const vis = new Set<string>([focusedNodeId]); const findA = (id: string) => { const n = nodes.find(x => x.id === id); if (n) n.dependencies.forEach(d => { if (!vis.has(d)) { vis.add(d); findA(d); } }); }; const findD = (id: string) => { nodes.forEach(n => { if (n.dependencies.includes(id) && !vis.has(n.id)) { vis.add(n.id); findD(n.id); } }); }; findA(focusedNodeId); findD(focusedNodeId); return nodes.filter(n => vis.has(n.id)); }, [nodes, focusedNodeId]);
  const criticalNodes = useMemo(() => nodes.filter(n => n.isCritical), [nodes]);

  useEffect(() => { if (user && projects.length > 0) localStorage.setItem(`exploration_projects_${user.username}`, JSON.stringify(projects)); }, [projects, user?.username]);
  useEffect(() => { const p = projects.find(x => x.id === currentProjectId); if (p) { setSelectedNodeId(null); setFocusedNodeId(null); setDecision(null); setNodes(p.nodes || []); setIsLooping(false); setKnowledgeCards((p as any).knowledgeCards || []); setResearchFindings((p as any).researchFindings || []); setResearchReport(null); } else if (projects.length > 0 && !currentProjectId) setCurrentProjectId(projects[0].id); }, [currentProjectId, projects.length]);
  useEffect(() => { if (currentProjectId && nodes.length > 0) setProjects(prev => { const i = prev.findIndex(p => p.id === currentProjectId); if (i === -1 || prev[i].nodes === nodes) return prev; const n = [...prev]; n[i] = { ...n[i], nodes }; return n; }); }, [nodes, currentProjectId]);
  useEffect(() => { if (currentProjectId && currentProject?.explorationMode === 'research') setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, knowledgeCards, researchFindings } as any : p)); }, [knowledgeCards, researchFindings, currentProjectId]);

  const addNode = useCallback((title: string, deps: string[] = [], notes = "") => { const n: ProblemNode = { id: uuidv4(), title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: deps, notes, chatHistory: [], agentResults: [] }; setNodes(prev => [...prev, n]); return n; }, []);
  const updateNode = useCallback((id: string, u: Partial<ProblemNode>) => setNodes(prev => prev.map(n => n.id === id ? { ...n, ...u } : n)), []);
  const createProjectWithMode = useCallback((input: string, mode: ExplorationMode, analysis?: IntentAnalysis) => { const p: Project = { id: uuidv4(), name: analysis?.suggestedTitle || input.slice(0, 15), metaProblem: input, createdAt: Date.now(), explorationMode: mode, intentAnalysis: analysis, nodes: [{ id: uuidv4(), title: input, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: "", chatHistory: [], agentResults: [] }] }; setProjects(prev => [...prev, p]); setCurrentProjectId(p.id); setPendingIntent(null); setMetaInput(''); setShowMetaModal(false); }, []);

  const runExplorationCycle = useCallback(async () => {
    if (decision || isProcessingRef.current || !isLoopingRef.current) return;
    let unexplored = focusedNodeId ? (() => { const desc = new Set<string>([focusedNodeId]); const q = [focusedNodeId]; let i = 0; while (i < q.length) { const c = q[i++]; nodes.forEach(n => { if (n.dependencies.includes(c) && !desc.has(n.id)) { desc.add(n.id); q.push(n.id); } }); } return nodes.find(n => desc.has(n.id) && n.status === NodeStatus.UNEXPLORED); })() : undefined;
    if (!unexplored) unexplored = nodes.find(n => n.status === NodeStatus.UNEXPLORED);
    if (!unexplored) { if (!nodes.some(n => n.status === NodeStatus.EXPLORING)) setIsLooping(false); return; }
    isProcessingRef.current = true;
    const cid = unexplored.id;
    updateNode(cid, { status: NodeStatus.EXPLORING });
    try {
      const isResearch = currentProject?.explorationMode === 'research';
      const result = isResearch ? await exploreResearchNode(unexplored, nodes, c => setKnowledgeCards(p => [...p, c]), f => setResearchFindings(p => [...p, f])) : await exploreNode(unexplored, nodes);
      if (!isLoopingRef.current) { updateNode(cid, { status: NodeStatus.UNEXPLORED }); isProcessingRef.current = false; return; }
      let taskType = result.taskType; if (!taskType || taskType === 'none') taskType = await identifyNodeTask({ ...unexplored, notes: result.notes });
      if (result.subProblems?.length) setNodes(prev => [...prev, ...result.subProblems.map((sp: any) => ({ id: uuidv4(), title: sp.title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [cid], notes: sp.initialNotes || "", chatHistory: [], agentResults: [] }))]);
      if (result.triggerDecision) { updateNode(cid, { status: NodeStatus.NEEDS_REVIEW, confidence: result.confidence, notes: result.notes, taskType, pendingDecision: { nodeId: cid, context: result.decisionContext, options: [{ label: '方案A：继续', action: 'continue' }, { label: '方案B：新子方向', action: 'add_subproblem' }, { label: '方案C：终止', action: 'terminate' }] } }); setIsLooping(false); }
      else updateNode(cid, { status: NodeStatus.SOLVED, confidence: result.confidence, notes: result.notes, taskType });
    } catch (e) { console.error(e); updateNode(cid, { status: NodeStatus.UNEXPLORED }); setIsLooping(false); }
    finally { isProcessingRef.current = false; }
  }, [nodes, decision, updateNode, focusedNodeId, currentProject?.explorationMode]);

  useEffect(() => { if (isLooping && !decision) { const t = setTimeout(() => runExplorationCycle(), 1000); return () => clearTimeout(t); } }, [isLooping, decision, runExplorationCycle]);

  const handleDecisionChoice = (action: 'continue' | 'add_subproblem' | 'terminate', subTitle?: string) => { if (!decision) return; if (action === 'terminate') updateNode(decision.nodeId, { status: NodeStatus.INVALID, pendingDecision: undefined }); else if (action === 'add_subproblem' && subTitle) addNode(subTitle, [decision.nodeId]); else if (action === 'continue') updateNode(decision.nodeId, { status: NodeStatus.SOLVED, pendingDecision: undefined }); setDecision(null); setIsLooping(true); };
  const handleNodeClick = (node: ProblemNode) => { setSelectedNodeId(node.id); if (node.status === NodeStatus.NEEDS_REVIEW && node.pendingDecision) setDecision(node.pendingDecision); };
  const handleDeleteNode = useCallback((id: string) => { setNodes(prev => prev.filter(n => n.id !== id).map(n => ({ ...n, dependencies: n.dependencies.filter(d => d !== id) }))); if (selectedNodeId === id) setSelectedNodeId(null); if (focusedNodeId === id) setFocusedNodeId(null); if (decision?.nodeId === id) setDecision(null); }, [selectedNodeId, focusedNodeId, decision]);
  const handleGenerateReport = async () => { if (!currentProject || isGeneratingReport) return; setIsGeneratingReport(true); try { setResearchReport(await generateResearchReport(currentProject.metaProblem, nodes, knowledgeCards, researchFindings)); } finally { setIsGeneratingReport(false); } };

  if (routeInfo.type === 'delegate' && routeInfo.nodeId) return <DelegationView nodeId={routeInfo.nodeId} taskTitle={routeInfo.taskTitle} />;

  if (!user) return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 to-emerald-600"></div>
        <div className="text-center mb-8"><div className="w-14 h-14 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-xl">A</div><h2 className="text-xl sm:text-2xl font-bold">AI 自动探索助手</h2><p className="text-slate-500 text-xs sm:text-sm mt-2">{isLoginAsAdmin ? '管理员验证' : '邮箱快速登录'}</p></div>
        {!isLoginAsAdmin ? (<div className="space-y-4">{!isOtpSent ? (<><input type="email" placeholder="电子邮箱" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none" /><button onClick={() => { if (loginEmail.includes('@')) { setIsOtpSent(true); setOtpCode('123456'); } }} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl">获取验证码</button></>) : (<><input type="text" placeholder="验证码" value={otpCode} onChange={e => setOtpCode(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-4 text-center text-xl tracking-[0.5em] font-mono text-white outline-none" /><button onClick={() => setUser(auth.loginWithEmail(loginEmail))} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl">确认登录</button></>)}</div>) : (<div className="space-y-4"><input type="text" placeholder="管理账号" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none" /><input type="password" placeholder="管理密码" value={adminPass} onChange={e => setAdminPass(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none" /><button onClick={() => { if (auth.loginAsAdmin(adminUsername, adminPass)) setUser(auth.getUser()); else alert('账号或密码错误'); }} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl">管理员登录</button></div>)}
        <div className="mt-8 pt-6 border-t border-slate-800 text-center"><button onClick={() => { setIsLoginAsAdmin(!isLoginAsAdmin); setOtpCode(''); setIsOtpSent(false); }} className="text-slate-500 hover:text-white text-sm font-medium">{isLoginAsAdmin ? '返回普通登录' : '管理员入口'}</button></div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden" onClick={() => setContextMenu(null)}>
      <header className="relative h-14 border-b border-slate-800 flex items-center justify-between px-3 sm:px-6 bg-slate-900/50 backdrop-blur-md z-50">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-fit"><div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">A</div><h1 className="text-lg font-semibold hidden lg:block">Explorer</h1></div>
          <select className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs outline-none text-white max-w-[120px] sm:max-w-[200px]" value={currentProjectId || ''} onChange={e => setCurrentProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {currentProject?.explorationMode && <div className={`hidden sm:flex px-2 py-1 rounded-full text-[10px] font-bold items-center gap-1 ${currentProject.explorationMode === 'research' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'}`}>{currentProject.explorationMode === 'research' ? '🔬研究' : '🔧构建'}</div>}
          <button onClick={() => setShowMetaModal(true)} className="p-2 text-slate-400 hover:text-blue-400"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg></button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {user.role === 'admin' && <button onClick={() => setShowAdminDashboard(true)} className="p-2 sm:px-3 sm:py-1.5 bg-purple-600/20 text-purple-400 border border-purple-500/30 rounded-full text-[10px] font-bold hover:bg-purple-600/30"><span className="sm:inline hidden">管理看板</span><span className="sm:hidden">📊</span></button>}
          
          {/* 个人中心 */}
          <div className="relative">
            <button 
              onClick={() => setShowUserMenu(!showUserMenu)} 
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full transition-colors"
            >
              <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white">
                {user.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <span className="text-xs text-slate-300 hidden sm:inline max-w-[80px] truncate">{user.username || user.email?.split('@')[0]}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-slate-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            
            {/* 下拉菜单 */}
            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  {/* 用户信息 */}
                  <div className="px-4 py-2 border-b border-slate-700">
                    <div className="text-sm font-medium text-white">{user.username || '用户'}</div>
                    <div className="text-[10px] text-slate-500">{user.email || ''}</div>
                  </div>
                  
                  {/* 菜单项 */}
                  <button 
                    onClick={() => { setShowProjectManager(true); setShowUserMenu(false); }} 
                    className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-700 flex items-center gap-3 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>
                    项目管理
                  </button>
                  <button 
                    onClick={() => { setShowHelpModal(true); setShowUserMenu(false); }} 
                    className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-700 flex items-center gap-3 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
                    帮助与反馈
                  </button>
                  
                  <div className="h-px bg-slate-700 my-1" />
                  
                  <button 
                    onClick={() => { auth.logout(); setUser(null); setShowUserMenu(false); }} 
                    className="w-full text-left px-4 py-2.5 text-xs text-red-400 hover:bg-red-600/10 flex items-center gap-3 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        <aside className={`h-full bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col z-20 overflow-hidden ${notesPanelMode === 0 ? 'w-0 border-none' : notesPanelMode === 2 ? 'w-full sm:w-[380px]' : 'w-[300px]'}`}>
          <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
            <h3 className="text-xs font-bold text-slate-400">EXPLORER</h3>
            <div className="flex gap-1">
              <button onClick={() => setNotesPanelMode(notesPanelMode === 2 ? 1 : 2)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">{notesPanelMode === 2 ? <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>}</button>
              <button onClick={() => setNotesPanelMode(0)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
            </div>
          </div>
          <div className="flex border-b border-slate-800">
            <button onClick={() => setSidebarActiveTab('butler')} className={`flex-1 py-3 text-xs font-bold transition-all flex items-center justify-center gap-2 ${sidebarActiveTab === 'butler' ? 'bg-blue-600/10 text-blue-400 border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300'}`}><span>🏠</span> AI管家</button>
            <button onClick={() => setSidebarActiveTab('research')} className={`flex-1 py-3 text-xs font-bold transition-all flex items-center justify-center gap-2 ${sidebarActiveTab === 'research' ? 'bg-emerald-600/10 text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}><span>📊</span> 研究面板</button>
          </div>
          <div className="flex-1 overflow-hidden">
            {sidebarActiveTab === 'butler' && <AIButler project={currentProject} nodes={nodes} onAddNode={addNode} onUpdateNode={updateNode} onStartExploration={() => setIsLooping(true)} />}
            {sidebarActiveTab === 'research' && <SimpleResearchPanel project={currentProject} nodes={nodes} knowledgeCards={knowledgeCards} findings={researchFindings} criticalNodes={criticalNodes} isLooping={isLooping} isGeneratingReport={isGeneratingReport} onNodeSelect={setSelectedNodeId} onStartExploration={() => setIsLooping(true)} onStopExploration={() => setIsLooping(false)} onGenerateReport={handleGenerateReport} />}
          </div>
        </aside>
        {notesPanelMode === 0 && <div className="w-8 h-full bg-slate-900 border-r border-slate-800 flex items-center justify-center cursor-pointer hover:bg-slate-800 z-20 group" onClick={() => setNotesPanelMode(1)}><div className="rotate-90 whitespace-nowrap text-[10px] font-bold text-slate-500 group-hover:text-blue-400">展开面板</div></div>}
        <div className="flex-1 relative z-0"><GraphVisualization nodes={filteredNodes} onNodeClick={handleNodeClick} onNodeContextMenu={(node, x, y) => setContextMenu({ x, y, nodeId: node.id })} /></div>
        <div className={`fixed inset-0 z-40 md:relative md:inset-auto md:z-20 transition-all duration-300 ${selectedNodeId ? 'translate-x-0 opacity-100 md:w-96' : 'translate-x-full opacity-0 md:w-0 overflow-hidden'}`} style={{ width: selectedNodeId && window.innerWidth >= 768 ? (isDetailsWide ? '600px' : '384px') : undefined }}>
          <div className="absolute inset-0 bg-black/60 md:hidden" onClick={() => setSelectedNodeId(null)}></div>
          <div className="relative h-full ml-auto"><NodeDetails node={selectedNode} isFocused={focusedNodeId === selectedNodeId} isWide={isDetailsWide} onToggleWide={() => setIsDetailsWide(!isDetailsWide)} onClose={() => setSelectedNodeId(null)} onSendMessage={async (id, text) => { const node = nodes.find(n => n.id === id); if (!node) return; const updated = [...(node.chatHistory || []), { role: 'user', text } as ChatMessage]; updateNode(id, { chatHistory: updated }); const resp = await chatWithNode(node, text, updated); updateNode(id, { chatHistory: [...updated, { role: 'model', text: resp } as ChatMessage] }); }} onUpdateNotes={(id, notes) => updateNode(id, { notes })} onUpdateNodeData={(id, updates) => updateNode(id, updates)} onAppendToSummary={(text) => { if (!currentProjectId) return; setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, summaryNote: (p.summaryNote || '') + text } : p)); }} /></div>
        </div>
      </main>

      {contextMenu && <div className="fixed z-[100] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 w-44" style={{ top: Math.min(contextMenu.y, window.innerHeight - 300), left: Math.min(contextMenu.x, window.innerWidth - 180) }} onClick={e => e.stopPropagation()}>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { setFocusedNodeId(focusedNodeId === contextMenu.nodeId ? null : contextMenu.nodeId); setContextMenu(null); }}>🎯 {focusedNodeId === contextMenu.nodeId ? '取消聚焦' : '聚焦节点'}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isCritical: !n.isCritical }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isCritical ? '⭐ 取消关键' : '⭐ 设为关键'}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isPinned: !n.isPinned }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isPinned ? '📍 取消固定' : '📌 固定节点'}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const title = prompt('标题:'); if (title) addNode(title, [contextMenu.nodeId]); setContextMenu(null); }}>➕ 增加子节点</button>
        <div className="h-px bg-slate-700 my-1"></div>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-red-600 text-red-400 hover:text-white flex items-center gap-2" onClick={() => { updateNode(contextMenu.nodeId, { status: NodeStatus.INVALID }); setContextMenu(null); }}>🚫 设为无效</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-emerald-600 flex items-center gap-2" onClick={() => { updateNode(contextMenu.nodeId, { status: NodeStatus.SOLVED }); setContextMenu(null); }}>✅ 标记完成</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-red-600 text-red-400 hover:text-white flex items-center gap-2" onClick={() => { if (confirm('确认删除？')) handleDeleteNode(contextMenu.nodeId); setContextMenu(null); }}>🗑️ 删除节点</button>
      </div>}

      {showAdminDashboard && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6"><div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full p-8 shadow-2xl flex flex-col h-full max-h-[90vh]">
        <div className="flex items-center justify-between mb-6"><h2 className="text-2xl font-bold text-purple-400">📊 监控看板</h2><div className="flex gap-2"><button onClick={() => setAdminActiveTab('stats')} className={`px-4 py-2 rounded-lg text-xs font-bold ${adminActiveTab === 'stats' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}>用户统计</button><button onClick={() => setAdminActiveTab('messages')} className={`px-4 py-2 rounded-lg text-xs font-bold ${adminActiveTab === 'messages' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}>用户留言</button></div></div>
        {adminActiveTab === 'stats' && <><div className="grid grid-cols-3 gap-6 mb-6">{Object.entries(monitor.getSystemSummary()).map(([k, v]) => <div key={k} className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700 text-center"><div className="text-[10px] uppercase text-slate-500 font-bold mb-1">{k}</div><div className="text-2xl font-bold text-white">{v}</div></div>)}</div><div className="flex-1 overflow-auto border border-slate-800 rounded-2xl"><table className="w-full text-left text-sm"><thead className="bg-slate-800 text-slate-400"><tr><th className="px-4 py-4 text-[10px] uppercase">用户</th><th className="px-4 py-4 text-[10px] uppercase">会话</th><th className="px-4 py-4 text-[10px] uppercase">时长(m)</th><th className="px-4 py-4 text-[10px] uppercase">Token</th><th className="px-4 py-4 text-[10px] uppercase">最后活跃</th></tr></thead><tbody className="divide-y divide-slate-800">{cloudStats.map((s, i) => <tr key={i} className="hover:bg-slate-800/30"><td className="px-4 py-4 text-blue-400">{s.username}</td><td className="px-4 py-4">{s.sessionCount}</td><td className="px-4 py-4">{(s.totalActiveSeconds / 60).toFixed(1)}</td><td className="px-4 py-4 text-emerald-400">{(s.totalPromptTokens + s.totalCompletionTokens).toLocaleString()}</td><td className="px-4 py-4 text-slate-500 text-xs">{new Date(s.lastActiveTimestamp).toLocaleString()}</td></tr>)}</tbody></table></div></>}
        {adminActiveTab === 'messages' && <div className="flex-1 overflow-auto space-y-3">{adminMessages.length === 0 ? <div className="text-center py-12 text-slate-500">暂无留言</div> : adminMessages.map((msg, i) => <div key={i} className="p-4 bg-slate-800/50 rounded-xl border border-slate-700"><div className="flex justify-between mb-2"><span className="text-sm font-bold text-blue-400">{msg.username}</span><span className="text-[10px] text-slate-500">{new Date(msg.createdAt).toLocaleString()}</span></div><p className="text-sm text-slate-300">{msg.content}</p></div>)}</div>}
        <button onClick={() => setShowAdminDashboard(false)} className="mt-6 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl">关闭</button>
      </div></div>}

      {showMetaModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-8 shadow-2xl"><h2 className="text-2xl font-bold">新探索任务</h2><textarea value={metaInput} onChange={e => setMetaInput(e.target.value)} placeholder="描述你想探索的问题..." className="w-full bg-slate-800 border border-slate-700 rounded-xl p-5 mt-6 min-h-[100px] outline-none text-slate-200 resize-none" /><div className="flex gap-4 mt-8"><button onClick={() => setShowMetaModal(false)} className="flex-1 py-4 bg-slate-800 rounded-xl font-bold">取消</button><button disabled={isAnalyzingIntent || !metaInput.trim()} onClick={async () => { if (!metaInput.trim()) return; setIsAnalyzingIntent(true); try { const { analysis, needsConfirmation } = await analyzeIntentWithAutoConfirm(metaInput); if (needsConfirmation) { setPendingIntent({ input: metaInput, analysis }); setShowMetaModal(false); } else createProjectWithMode(metaInput, analysis.mode, analysis); } catch { createProjectWithMode(metaInput, 'research'); } finally { setIsAnalyzingIntent(false); } }} className="flex-[2] py-4 bg-blue-600 rounded-xl font-bold disabled:opacity-50">{isAnalyzingIntent ? '分析中...' : '开启探索'}</button></div></div></div>}

      {showHelpModal && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" onClick={() => setShowHelpModal(false)}><div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-10 shadow-2xl flex flex-col items-center max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}><h3 className="text-xl font-bold text-white mb-8">有问题请联系</h3><div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 w-full text-center mb-8"><p className="text-slate-500 text-xs mb-3 uppercase tracking-widest font-bold">联系微信号</p><p className="text-2xl font-mono font-bold text-blue-400 select-all tracking-wider">seabird36</p></div><MessageBoard /><button onClick={() => setShowHelpModal(false)} className="mt-6 w-full py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl border border-slate-700">关闭</button></div></div>}

      {/* 项目管理弹窗 */}
      {showProjectManager && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" onClick={() => setShowProjectManager(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-8 shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">📁 项目管理</h3>
              <button onClick={() => setShowProjectManager(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            
            <div className="text-xs text-slate-500 mb-4">共 {projects.length} 个项目</div>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {projects.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <div className="text-4xl mb-4">📭</div>
                  <p>暂无项目</p>
                </div>
              ) : (
                projects.map(p => (
                  <div 
                    key={p.id} 
                    className={`p-4 rounded-xl border transition-all ${
                      p.id === currentProjectId 
                        ? 'bg-blue-600/10 border-blue-500/30' 
                        : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-bold text-white truncate">{p.name}</h4>
                          {p.id === currentProjectId && (
                            <span className="px-1.5 py-0.5 bg-blue-600/20 text-blue-400 text-[9px] font-bold rounded">当前</span>
                          )}
                          {p.explorationMode && (
                            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                              p.explorationMode === 'research' 
                                ? 'bg-purple-600/20 text-purple-400' 
                                : 'bg-emerald-600/20 text-emerald-400'
                            }`}>
                              {p.explorationMode === 'research' ? '研究' : '构建'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2 mb-2">{p.metaProblem}</p>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          <span>📊 {p.nodes?.length || 0} 节点</span>
                          <span>✅ {p.nodes?.filter(n => n.status === NodeStatus.SOLVED).length || 0} 完成</span>
                          <span>📅 {new Date(p.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.id !== currentProjectId && (
                          <button 
                            onClick={() => { setCurrentProjectId(p.id); setShowProjectManager(false); }}
                            className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-[10px] font-bold rounded-lg transition-colors"
                          >
                            切换
                          </button>
                        )}
                        <button 
                          onClick={() => handleDeleteProject(p.id)}
                          className="p-1.5 hover:bg-red-600/20 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                          title="删除项目"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="mt-6 pt-4 border-t border-slate-800">
              <button 
                onClick={() => { setShowProjectManager(false); setShowMetaModal(true); }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg>
                创建新项目
              </button>
            </div>
          </div>
        </div>
      )}

      {decision && decisionNode && <DecisionModal decision={decision} node={decisionNode} onChoice={handleDecisionChoice} onClose={() => setDecision(null)} />}
      {pendingIntent && <IntentConfirmModal analysis={pendingIntent.analysis} onConfirm={(mode, analysis) => createProjectWithMode(pendingIntent.input, mode, analysis)} onCancel={() => { setPendingIntent(null); setShowMetaModal(true); }} />}
      {researchReport && <ResearchReport report={researchReport} onClose={() => setResearchReport(null)} />}
    </div>
  );
};

export default App;
