
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ProblemNode, NodeStatus, DecisionPoint, Project, ChatMessage } from './types';
import GraphVisualization from './components/GraphVisualization';
import NodeDetails from './components/NodeDetails';
import DecisionModal from './components/DecisionModal';
import { exploreNode, chatWithNode, generateProjectSummary, callGemini, identifyNodeTask } from './services/geminiService';
import { monitor } from './services/monitoringService';
import { auth } from './services/authService';
import { GEMINI_MODEL } from './constants';

// --- 新增：外协执行人员专用的 AI 对话页面 ---
const DelegationView: React.FC<{ nodeId: string, taskTitle: string }> = ({ nodeId, taskTitle }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // 初始化 AI：向执行人解释需求
  useEffect(() => {
    const initAI = async () => {
      setIsTyping(true);
      const systemPrompt = `你是一个专业的“需求对齐与工作监督 AI”。
任务背景：用户已将节点任务“${taskTitle}”委托给当前这位执行人员。
你的目标：
1. 以非常专业且清晰的口吻向执行人员解释这项工作的背景与目标。
2. 确认执行人员是否完全理解需求，并询问其初步计划。
3. 扮演监督者角色，后续会引导对方同步进度。
请直接开始你的开场白。`;
      
      try {
        const response = await callGemini([{ role: "system", content: systemPrompt }, { role: "user", content: "请开始需求讲解。" }], GEMINI_MODEL);
        setMessages([{ role: 'model', text: response }]);
      } catch (e) {
        setMessages([{ role: 'model', text: "系统繁忙，请稍后刷新。但我收到的任务是： " + taskTitle }]);
      } finally {
        setIsTyping(false);
      }
    };
    initAI();
  }, [taskTitle]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    
    const newMessages = [...messages, { role: 'user', text: input } as ChatMessage];
    setMessages(newMessages);
    setInput('');
    setIsTyping(true);

    try {
      const response = await callGemini([
        { role: "system", content: `你是一个需求对齐与进度监督 AI。当前任务：${taskTitle}。请继续引导执行人员完成工作并同步进度。` },
        ...newMessages.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }))
      ], GEMINI_MODEL);
      setMessages([...newMessages, { role: 'model', text: response }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 flex flex-col items-center p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col h-full overflow-hidden">
        <header className="p-6 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-xl shadow-lg shadow-emerald-900/20">🤝</div>
            <div>
              <h2 className="text-lg font-bold text-white">需求对齐与监督 AI</h2>
              <p className="text-xs text-slate-500">正在为你讲解任务：{taskTitle}</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scroll-hide">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-5 py-3.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap shadow-md ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 border border-slate-700 rounded-tl-none'}`}>
                {m.text}
              </div>
            </div>
          ))}
          {isTyping && <div className="text-xs text-slate-500 animate-pulse ml-2">AI 正在输入中...</div>}
        </div>

        <form onSubmit={handleSend} className="p-4 border-t border-slate-800 bg-slate-900/80">
          <div className="flex gap-2">
            <input 
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="回复 AI 或同步你的进度..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            />
            <button type="submit" className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-900/30">发送</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- 主应用组件 ---
const App: React.FC = () => {
  const [user, setUser] = useState(auth.getUser());
  const [currentHash, setCurrentHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const routeInfo = useMemo(() => {
    if (currentHash.startsWith('#/delegate/')) {
      const parts = currentHash.split('/');
      const nodeId = parts[2]?.split('?')[0];
      const params = new URLSearchParams(currentHash.split('?')[1] || '');
      return { type: 'delegate', nodeId, taskTitle: params.get('task') || '未知任务' };
    }
    return { type: 'main' };
  }, [currentHash]);

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
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [adminTick, setAdminTick] = useState(0); // 强制刷新管理看板
  
  useEffect(() => {
    if (showAdminDashboard) {
      monitor.fetchCloudStats().then(() => setAdminTick(t => t + 1));
    }
  }, [showAdminDashboard]);

  const [notesPanelMode, setNotesPanelMode] = useState<number>(1);
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'notes' | 'critical' | 'tasks'>('notes');
  const [taskFilter, setTaskFilter] = useState<'solved' | 'exploring' | 'pending'>('pending');
  const [nodes, setNodes] = useState<ProblemNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [isDetailsWide, setIsDetailsWide] = useState<boolean>(false);
  const [decision, setDecision] = useState<DecisionPoint | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, nodeId: string } | null>(null);

  const isLoopingRef = useRef(false);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  useEffect(() => {
    if (user) {
      const userKey = `exploration_projects_${user.username}`;
      try {
        const saved = localStorage.getItem(userKey);
        const loadedProjects = saved ? JSON.parse(saved) : [];
        setProjects(loadedProjects);
        setCurrentProjectId(null); 
        if (loadedProjects.length === 0) {
          setShowMetaModal(true);
        }
      } catch (e) {
        setProjects([]);
        setShowMetaModal(true);
      }
    } else {
      setProjects([]);
      setCurrentProjectId(null);
    }
  }, [user?.username]);

  useEffect(() => {
    if (user) {
      monitor.incrementSession();
      const interval = setInterval(() => monitor.updateHeartbeat(), 10000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const currentProject = useMemo(() => projects.find(p => p.id === currentProjectId) || null, [projects, currentProjectId]);
  
  const selectedNode = useMemo(() => {
    const list = nodes || [];
    if (list.length === 0 || !selectedNodeId) return null;
    return list.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  const decisionNode = useMemo(() => {
    if (!decision) return null;
    return (nodes || []).find(n => n.id === decision.nodeId) || null;
  }, [decision, nodes]);

  const filteredNodes = useMemo(() => {
    const list = nodes || [];
    if (list.length === 0) return [];
    if (!focusedNodeId) return list;
    const visibleIds = new Set<string>([focusedNodeId]);
    const findAncestors = (id: string) => {
      const node = list.find(n => n.id === id);
      if (!node) return;
      node.dependencies.forEach(depId => { if (!visibleIds.has(depId)) { visibleIds.add(depId); findAncestors(depId); } });
    };
    const findDescendants = (id: string) => {
      list.forEach(node => { if (node.dependencies.includes(id)) { if (!visibleIds.has(node.id)) { visibleIds.add(node.id); findDescendants(node.id); } } });
    };
    findAncestors(focusedNodeId);
    findDescendants(focusedNodeId);
    return list.filter(n => visibleIds.has(n.id));
  }, [nodes, focusedNodeId]);

  useEffect(() => {
    if (user && projects.length > 0) {
      localStorage.setItem(`exploration_projects_${user.username}`, JSON.stringify(projects));
    }
  }, [projects, user?.username]);

  useEffect(() => {
    const proj = projects.find(p => p.id === currentProjectId);
    if (proj) {
      setSelectedNodeId(null);
      setFocusedNodeId(null);
      setDecision(null);
      setNodes(proj.nodes || []);
      setIsLooping(false);
    } else if (projects.length > 0 && !currentProjectId) {
      setCurrentProjectId(projects[0].id);
    }
  }, [currentProjectId, projects.length]);

  useEffect(() => {
    if (currentProjectId && nodes && nodes.length > 0) {
      setProjects(prev => {
        const idx = prev.findIndex(p => p.id === currentProjectId);
        if (idx === -1) return prev;
        if (prev[idx].nodes === nodes) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], nodes };
        return next;
      });
    }
  }, [nodes, currentProjectId]);

  const addNode = useCallback((title: string, dependencies: string[] = [], initialNotes: string = "") => {
    const newNode: ProblemNode = { id: uuidv4(), title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies, notes: initialNotes, chatHistory: [], agentResults: [] };
    setNodes(prev => [...prev, newNode]);
    return newNode;
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<ProblemNode>) => {
    setNodes(prev => prev.map(node => node.id === id ? { ...node, ...updates } : node));
  }, []);

  const runExplorationCycle = useCallback(async () => {
    if (decision || isProcessingRef.current) return;
    if (!isLoopingRef.current) return;
    
    let unexploredNode: ProblemNode | undefined;
    if (focusedNodeId) {
      const descendantIds = new Set<string>();
      const queue = [focusedNodeId];
      descendantIds.add(focusedNodeId);
      let i = 0;
      while (i < queue.length) {
        const currentId = queue[i++];
        nodes.forEach(n => {
          if (n.dependencies.includes(currentId) && !descendantIds.has(n.id)) {
            descendantIds.add(n.id);
            queue.push(n.id);
          }
        });
      }
      unexploredNode = nodes.find(n => descendantIds.has(n.id) && n.status === NodeStatus.UNEXPLORED);
    }
    
    if (!unexploredNode) {
      unexploredNode = nodes.find(n => n.status === NodeStatus.UNEXPLORED);
    }

    if (!unexploredNode) { 
      const isAnyExploring = nodes.some(n => n.status === NodeStatus.EXPLORING);
      if (!isAnyExploring) {
        setIsLooping(false); 
      }
      return; 
    }
    
    isProcessingRef.current = true;
    const currentNodeId = unexploredNode.id;
    updateNode(currentNodeId, { status: NodeStatus.EXPLORING });
    
    try {
      const result = await exploreNode(unexploredNode, nodes);
      
      if (!isLoopingRef.current) {
        updateNode(currentNodeId, { status: NodeStatus.UNEXPLORED });
        isProcessingRef.current = false;
        return;
      }

      let taskType = result.taskType;
      if (!taskType || taskType === 'none') {
        taskType = await identifyNodeTask({ ...unexploredNode, notes: result.notes });
      }
      
      if (result.subProblems && result.subProblems.length > 0) {
        const newSubNodes = result.subProblems.map((sp: any) => ({
          id: uuidv4(),
          title: sp.title,
          status: NodeStatus.UNEXPLORED,
          confidence: 0,
          dependencies: [currentNodeId],
          notes: sp.initialNotes || "",
          chatHistory: [],
          agentResults: []
        }));
        setNodes(prev => [...prev, ...newSubNodes]);
      }
      
      if (result.triggerDecision) {
        const newDecision: DecisionPoint = {
          nodeId: currentNodeId,
          context: result.decisionContext,
          options: [
            { label: '方案 A：按原计划继续探索 (推荐)', action: 'continue' }, 
            { label: '方案 B：注入新子方向供选择', action: 'add_subproblem' }, 
            { label: '方案 C：终止当前路径', action: 'terminate' }
          ]
        };
        updateNode(currentNodeId, { 
          status: NodeStatus.NEEDS_REVIEW, 
          confidence: result.confidence, 
          notes: result.notes,
          taskType,
          pendingDecision: newDecision
        });
        // 关键点：待决策框不再自动弹出，仅停止循环，让用户点击节点手动弹出
        setIsLooping(false);
      } else {
        updateNode(currentNodeId, { 
          status: NodeStatus.SOLVED, 
          confidence: result.confidence, 
          notes: result.notes, 
          taskType 
        });
      }
    } catch (e) {
      console.error("探索循环异常:", e);
      updateNode(currentNodeId, { status: NodeStatus.UNEXPLORED });
      setIsLooping(false);
    } finally {
      isProcessingRef.current = false;
    }
  }, [nodes, decision, updateNode, focusedNodeId]);

  useEffect(() => {
    if (isLooping && !decision) {
      const timer = setTimeout(() => runExplorationCycle(), 1000);
      return () => clearTimeout(timer);
    }
  }, [isLooping, decision, runExplorationCycle]);

  const handleDecisionChoice = (action: 'continue' | 'add_subproblem' | 'terminate', subTitle?: string) => {
    if (!decision) return;
    if (action === 'terminate') updateNode(decision.nodeId, { status: NodeStatus.INVALID, pendingDecision: undefined });
    else if (action === 'add_subproblem' && subTitle) addNode(subTitle, [decision.nodeId]);
    else if (action === 'continue') updateNode(decision.nodeId, { status: NodeStatus.SOLVED, pendingDecision: undefined });
    setDecision(null);
    setIsLooping(true);
  };

  const handleNodeClick = (node: ProblemNode) => {
    setSelectedNodeId(node.id);
    if (node.status === NodeStatus.NEEDS_REVIEW && node.pendingDecision) {
      setDecision(node.pendingDecision);
    }
  };

  const handleGenerateProjectSummary = async () => {
    if (!currentProject) return;
    setIsGeneratingSummary(true);
    try {
      const summary = await generateProjectSummary(currentProject);
      setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, summaryNote: summary } : p));
      setNotesPanelMode(1);
      setSidebarActiveTab('notes');
    } finally { setIsGeneratingSummary(false); }
  };

  const handleNoteChange = (val: string) => {
    setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, summaryNote: val } : p));
  };

  const handleDeleteNode = useCallback((id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id).map(n => ({...n, dependencies: n.dependencies.filter(d => d !== id)})));
    if (selectedNodeId === id) setSelectedNodeId(null);
    if (focusedNodeId === id) setFocusedNodeId(null);
    if (decision?.nodeId === id) setDecision(null);
  }, [selectedNodeId, focusedNodeId, decision]);

  const criticalNodes = useMemo(() => (nodes || []).filter(n => n.isCritical), [nodes]);
  const taskListNodes = useMemo(() => {
    const list = nodes || [];
    const tasks = list.filter(n => n.taskType && n.taskType !== 'none');
    return {
      solved: tasks.filter(n => n.status === NodeStatus.SOLVED),
      exploring: tasks.filter(n => n.status === NodeStatus.EXPLORING),
      pending: tasks.filter(n => n.status === NodeStatus.UNEXPLORED || n.status === NodeStatus.NEEDS_REVIEW)
    };
  }, [nodes]);

  if (routeInfo.type === 'delegate' && routeInfo.nodeId) {
    return <DelegationView nodeId={routeInfo.nodeId} taskTitle={routeInfo.taskTitle} />;
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 to-emerald-600"></div>
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-xl">A</div>
            <h2 className="text-xl sm:text-2xl font-bold">AI 自动探索助手</h2>
            <p className="text-slate-500 text-xs sm:text-sm mt-2">{isLoginAsAdmin ? '管理员身份验证' : '邮箱验证快速登录'}</p>
          </div>
          {!isLoginAsAdmin ? (
            <div className="space-y-4">
              {!isOtpSent ? (
                <>
                  <input type="email" placeholder="电子邮箱地址" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                  <button onClick={() => { if(loginEmail.includes('@')) { setIsOtpSent(true); setOtpCode('123456'); } }} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-900/30">获取验证码</button>
                </>
              ) : (
                <>
                  <input type="text" placeholder="验证码" value={otpCode} onChange={e => setOtpCode(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-4 text-center text-xl tracking-[0.5em] font-mono text-white outline-none" />
                  <button onClick={() => setUser(auth.loginWithEmail(loginEmail))} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl transition-all">确认登录</button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <input type="text" placeholder="管理账号" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none" />
              <input type="password" placeholder="管理密码" value={adminPass} onChange={e => setAdminPass(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none" />
              <button onClick={() => { if(auth.loginAsAdmin(adminUsername, adminPass)) setUser(auth.getUser()); else alert('账号或密码错误'); }} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl transition-all">管理员登录</button>
            </div>
          )}
          <div className="mt-8 pt-6 border-t border-slate-800 text-center">
            <button onClick={() => { setIsLoginAsAdmin(!isLoginAsAdmin); setOtpCode(''); setIsOtpSent(false); }} className="text-slate-500 hover:text-white text-sm font-medium transition-colors">{isLoginAsAdmin ? '返回普通登录' : '管理员入口'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden" onClick={() => setContextMenu(null)}>
      <header className="relative h-14 sm:h-16 border-b border-slate-800 flex items-center justify-between px-3 sm:px-6 bg-slate-900/50 backdrop-blur-md z-50">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-fit">
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">A</div>
            <h1 className="text-lg font-semibold hidden lg:block">Explorer</h1>
          </div>
          <select className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs sm:text-sm outline-none text-white focus:ring-1 focus:ring-blue-500 max-w-[100px] sm:max-w-[200px]" value={currentProjectId || ''} onChange={(e) => setCurrentProjectId(e.target.value)}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowMetaModal(true)} className="p-2 text-slate-400 hover:text-blue-400 transition-colors flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          </button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {user.role === 'admin' && (
            <button onClick={() => setShowAdminDashboard(true)} className="p-2 sm:px-3 sm:py-1.5 bg-purple-600/20 text-purple-400 border border-purple-500/30 rounded-full text-[10px] sm:text-xs font-bold hover:bg-purple-600/30">
               <span className="sm:inline hidden">管理看板</span>
               <span className="sm:hidden">📊</span>
            </button>
          )}
          
          <button onClick={() => setIsLooping(true)} disabled={isLooping} className={`px-4 sm:px-6 py-2 rounded-full text-[10px] sm:text-xs font-bold transition-all shadow-lg ${isLooping ? 'bg-blue-600/40 text-blue-200 border border-blue-500/30 animate-pulse cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
            {isLooping ? '正在探索...' : '自动探索'}
          </button>
          <button onClick={() => setIsLooping(false)} disabled={!isLooping} className={`px-4 sm:px-6 py-2 rounded-full text-[10px] sm:text-xs font-bold transition-all shadow-lg ${!isLooping ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-500 hover:shadow-red-900/40'}`}>
            停止探索
          </button>

          <button onClick={() => setShowHelpModal(true)} className="p-2 sm:px-3 sm:py-1.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-[10px] sm:text-xs font-bold hover:bg-blue-600/20 hover:text-blue-400 hover:border-blue-500/30 transition-all" title="帮助">
            ？
          </button>
          <button onClick={() => { auth.logout(); setUser(null); }} className="p-2 sm:px-3 sm:py-1.5 bg-slate-800 text-slate-500 border border-slate-700 rounded-full text-[10px] sm:text-xs font-bold hover:bg-red-600/20 hover:text-red-400 hover:border-red-500/30 transition-all" title="退出登录">
            <span className="sm:inline hidden">退出</span>
            <span className="sm:hidden">🚪</span>
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden relative">
        <aside className={`h-full bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col z-20 overflow-hidden ${notesPanelMode === 0 ? 'w-0 border-none' : notesPanelMode === 2 ? 'w-full sm:w-[600px]' : 'w-[300px]'}`}>
          <div className="p-2 border-b border-slate-800 flex flex-col gap-2 flex-shrink-0 bg-slate-900/80 backdrop-blur-sm sticky top-0">
            <div className="flex items-center justify-between px-2 pt-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Explorer Panel</h3>
              <div className="flex gap-1">
                <button onClick={() => setNotesPanelMode(notesPanelMode === 2 ? 1 : 2)} className="p-1 hover:bg-slate-800 rounded text-slate-400 transition-colors">
                  {notesPanelMode === 2 ? (<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg>) : (<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M21 3l-7 7"/></svg>)}
                </button>
                <button onClick={() => setNotesPanelMode(0)} className="p-1 hover:bg-slate-800 rounded text-slate-400 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
              </div>
            </div>
            <div className="flex gap-1 px-2 pb-1">
              <button 
                onClick={() => setSidebarActiveTab('notes')} 
                className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${sidebarActiveTab === 'notes' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:text-slate-300'}`}
              >
                探索笔记
              </button>
              <button 
                onClick={() => setSidebarActiveTab('critical')} 
                className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${sidebarActiveTab === 'critical' ? 'bg-yellow-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:text-slate-300'}`}
              >
                关键节点
              </button>
              <button 
                onClick={() => setSidebarActiveTab('tasks')} 
                className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${sidebarActiveTab === 'tasks' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:text-slate-300'}`}
              >
                任务列表
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-hide bg-slate-950/30">
            {sidebarActiveTab === 'notes' && (
              <div className="h-full flex flex-col p-4">
                <button 
                  onClick={handleGenerateProjectSummary} 
                  disabled={isGeneratingSummary || !nodes || nodes.length === 0} 
                  className={`mb-4 w-full py-2.5 rounded-lg text-[10px] font-bold transition-all border flex items-center justify-center gap-2 ${isGeneratingSummary ? 'bg-slate-800 border-slate-700 text-slate-500' : 'bg-emerald-600/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/20'}`}
                >
                  {isGeneratingSummary ? (
                    <><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></div>编写总结中...</>
                  ) : (
                    <>📝 生成全案总结</>
                  )}
                </button>
                <textarea className="flex-1 w-full bg-transparent text-slate-300 text-xs sm:text-sm leading-relaxed outline-none resize-none font-sans" placeholder="AI 探索结论将实时汇总在此..." value={currentProject?.summaryNote || ''} onChange={(e) => handleNoteChange(e.target.value)} />
              </div>
            )}
            {sidebarActiveTab === 'critical' && (
              <div className="p-4 space-y-2">
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">⭐ 重要关注点</div>
                {criticalNodes.length === 0 ? (
                  <div className="text-center py-8 text-[10px] text-slate-600">暂无星标关键节点</div>
                ) : (
                  criticalNodes.map(node => (
                    <button key={node.id} onClick={() => setSelectedNodeId(node.id)} className="w-full text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-yellow-500/50 hover:bg-slate-800 transition-all group">
                      <div className="text-xs font-bold text-slate-200 group-hover:text-yellow-400 transition-colors flex items-center justify-between">
                        {node.title}
                        <span>⭐</span>
                      </div>
                      <div className="text-[9px] text-slate-500 mt-1 truncate">{node.notes || '尚无笔记'}</div>
                    </button>
                  ))
                )}
              </div>
            )}
            {sidebarActiveTab === 'tasks' && (
              <div className="p-4 space-y-4">
                <div className="flex gap-1 border-b border-slate-800 pb-2 mb-2">
                  <button onClick={() => setTaskFilter('pending')} className={`px-2 py-1 text-[9px] font-bold rounded ${taskFilter === 'pending' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>待执行</button>
                  <button onClick={() => setTaskFilter('exploring')} className={`px-2 py-1 text-[9px] font-bold rounded ${taskFilter === 'exploring' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>执行中</button>
                  <button onClick={() => setTaskFilter('solved')} className={`px-2 py-1 text-[9px] font-bold rounded ${taskFilter === 'solved' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>已完成</button>
                </div>
                {taskListNodes[taskFilter].length === 0 ? (
                  <div className="text-center py-8 text-[10px] text-slate-600">暂无该状态下的任务</div>
                ) : (
                  taskListNodes[taskFilter].map(node => (
                    <button key={node.id} onClick={() => setSelectedNodeId(node.id)} className="w-full text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800 transition-all group">
                      <div className="text-xs font-bold text-slate-200 group-hover:text-emerald-400 transition-colors flex items-center justify-between">
                        {node.title}
                        <span className="text-[8px] bg-slate-800 px-1.5 py-0.5 rounded uppercase">{node.taskType}</span>
                      </div>
                      <div className="text-[9px] text-slate-500 mt-1 truncate">{node.notes || '尚无笔记'}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
        {notesPanelMode === 0 && (<div className="w-8 h-full bg-slate-900 border-r border-slate-800 flex items-center justify-center cursor-pointer hover:bg-slate-800 transition-colors z-20 group" onClick={() => setNotesPanelMode(1)}><div className="rotate-90 whitespace-nowrap text-[10px] font-bold text-slate-500 group-hover:text-emerald-500 tracking-tighter">探索侧边栏</div></div>)}
        <div className="flex-1 relative z-0">
          <GraphVisualization nodes={filteredNodes} onNodeClick={handleNodeClick} onNodeContextMenu={(node, x, y) => setContextMenu({ x, y, nodeId: node.id })} />
        </div>
        <div className={`fixed inset-0 z-40 md:relative md:inset-auto md:z-20 transition-all duration-300 ease-in-out ${selectedNodeId ? 'translate-x-0 opacity-100 md:w-96 lg:w-96' : 'translate-x-full opacity-0 md:w-0 overflow-hidden md:pointer-events-none'}`} style={{ width: selectedNodeId && window.innerWidth >= 768 ? (isDetailsWide ? '600px' : '384px') : undefined }}>
           <div className="absolute inset-0 bg-black/60 md:hidden" onClick={() => setSelectedNodeId(null)}></div>
           <div className="relative h-full ml-auto">
             <NodeDetails 
                node={selectedNode} isFocused={focusedNodeId === selectedNodeId} isWide={isDetailsWide} onToggleWide={() => setIsDetailsWide(!isDetailsWide)} onClose={() => setSelectedNodeId(null)}
                onSendMessage={async (id, text) => {
                  const node = nodes.find(n => n.id === id); if (!node) return;
                  const updated = [...(node.chatHistory || []), { role: 'user', text } as ChatMessage];
                  updateNode(id, { chatHistory: updated });
                  const resp = await chatWithNode(node, text, updated);
                  updateNode(id, { chatHistory: [...updated, { role: 'model', text: resp } as ChatMessage] });
                }}
                onUpdateNotes={(id, notes) => updateNode(id, { notes })}
                onUpdateNodeData={(id, updates) => updateNode(id, updates)}
                onAppendToSummary={(text) => {
                  if (!currentProjectId) return;
                  setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, summaryNote: (p.summaryNote || '') + text } : p));
                }}
              />
           </div>
        </div>
      </main>
      {contextMenu && (
        <div className="fixed z-[100] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 w-44 animate-in fade-in zoom-in duration-150 overflow-hidden" style={{ top: Math.min(contextMenu.y, window.innerHeight - 300), left: Math.min(contextMenu.x, window.innerWidth - 180) }} onClick={(e) => e.stopPropagation()}>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 transition-colors flex items-center gap-2" onClick={() => { setFocusedNodeId(focusedNodeId === contextMenu.nodeId ? null : contextMenu.nodeId); setContextMenu(null); }}>🎯 {focusedNodeId === contextMenu.nodeId ? '取消聚焦' : '聚焦节点'}</button>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 transition-colors flex items-center gap-2" onClick={() => { const node = nodes.find(n => n.id === contextMenu.nodeId); if(node) updateNode(node.id, { isCritical: !node.isCritical }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isCritical ? '⭐ 取消关键节点' : '⭐ 设为关键节点'}</button>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 transition-colors flex items-center gap-2" onClick={() => { const node = nodes.find(n => n.id === contextMenu.nodeId); if(node) updateNode(node.id, { isPinned: !node.isPinned }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isPinned ? '📍 取消固定' : '📌 固定节点'}</button>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 transition-colors flex items-center gap-2" onClick={() => { const node = nodes.find(n => n.id === contextMenu.nodeId); if(node) updateNode(node.id, { isCollapsed: !node.isCollapsed }); setContextMenu(null); }}>📦 折叠/展开</button>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 transition-colors flex items-center gap-2" onClick={() => { const title = prompt('标题:'); if(title) addNode(title, [contextMenu.nodeId]); setContextMenu(null); }}>➕ 增加子节点</button>
          <div className="h-px bg-slate-700 my-1"></div>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-red-600 transition-colors flex items-center gap-2 text-red-400 hover:text-white" onClick={() => { updateNode(contextMenu.nodeId, { status: NodeStatus.INVALID }); setContextMenu(null); }}>🚫 设为无效</button>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-emerald-600 transition-colors flex items-center gap-2" onClick={() => { updateNode(contextMenu.nodeId, { status: NodeStatus.SOLVED }); setContextMenu(null); }}>✅ 标记完成</button>
          <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-red-600 transition-colors text-red-400 hover:text-white flex items-center gap-2" onClick={() => { if(confirm('确认删除？')) handleDeleteNode(contextMenu.nodeId); setContextMenu(null); }}>🗑️ 删除节点</button>
        </div>
      )}
      {showAdminDashboard && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full p-8 shadow-2xl flex flex-col h-full max-h-[90vh]">
            <h2 className="text-2xl font-bold mb-6 text-purple-400">📊 监控看板</h2>
            <div className="grid grid-cols-3 gap-6 mb-6">
              {Object.entries(monitor.getSystemSummary()).map(([k, v]) => (
                <div key={k} className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700 text-center">
                  <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">{k}</div>
                  <div className="text-2xl font-bold text-white">{v}</div>
                </div>
              ))}
            </div>
            <div className="flex-1 overflow-auto border border-slate-800 rounded-2xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">用户</th>
                    <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">会话</th>
                    <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">时长 (m)</th>
                    <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">Token 消耗</th>
                    <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">最后活跃</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {monitor.getAllStats().map((s, i) => (
                    <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-4 text-blue-400 font-medium">{s.username}</td>
                      <td className="px-4 py-4">{s.sessionCount}</td>
                      <td className="px-4 py-4">{(s.totalActiveSeconds/60).toFixed(1)}</td>
                      <td className="px-4 py-4 text-emerald-400">{(s.totalPromptTokens + s.totalCompletionTokens).toLocaleString()}</td>
                      <td className="px-4 py-4 text-slate-500 text-xs">{new Date(s.lastActiveTimestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setShowAdminDashboard(false)} className="mt-6 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors">关闭</button>
          </div>
        </div>
      )}
      {showMetaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-8 shadow-2xl">
            <h2 className="text-2xl font-bold">新探索任务</h2>
            <textarea value={metaInput} onChange={(e) => setMetaInput(e.target.value)} placeholder="请输入元问题" className="w-full bg-slate-800 border border-slate-700 rounded-xl p-5 mt-6 min-h-[80px] outline-none text-slate-200" />
            <div className="flex gap-4 mt-8"><button onClick={() => setShowMetaModal(false)} className="flex-1 py-4 bg-slate-800 rounded-xl font-bold">取消</button><button onClick={() => { if(!metaInput.trim()) return; const newProj = { id: uuidv4(), name: metaInput.slice(0, 15), metaProblem: metaInput, createdAt: Date.now(), nodes: [{ id: uuidv4(), title: metaInput, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: "", chatHistory: [] }] }; setProjects(prev => [...prev, newProj]); setCurrentProjectId(newProj.id); setMetaInput(''); setShowMetaModal(false); }} className="flex-[2] py-4 bg-blue-600 rounded-xl font-bold">开启探索</button></div>
          </div>
        </div>
      )}
      {showHelpModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" onClick={() => setShowHelpModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-sm w-full p-10 shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-200 relative" onClick={e => e.stopPropagation()}>
             <h3 className="text-xl font-bold text-white mb-8">有问题请联系</h3>
             <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 w-full text-center mb-8 shadow-inner">
                <p className="text-slate-500 text-xs mb-3 uppercase tracking-widest font-bold">联系微信号</p>
                <p className="text-2xl font-mono font-bold text-blue-400 select-all tracking-wider">seabird36</p>
             </div>
             <div className="text-center mb-8">
                <p className="text-slate-500 text-xs">如有任何建议、反馈或定制需求，<br/>欢迎通过上述微信号与我取得联系。</p>
             </div>
             <button onClick={() => setShowHelpModal(false)} className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl transition-all border border-slate-700">关闭</button>
             <button onClick={() => setShowHelpModal(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors p-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
             </button>
          </div>
        </div>
      )}
      {decision && decisionNode && (
        <DecisionModal 
          decision={decision} 
          node={decisionNode} 
          onChoice={handleDecisionChoice} 
          onClose={() => setDecision(null)} 
        />
      )}
    </div>
  );
};

export default App;
