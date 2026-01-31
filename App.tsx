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

// ========== 项目洞察类型 ==========
interface ProjectInsight {
  deepMotivation: string;      // 深层动机
  valueAssessment: string;     // 价值评估
  expectedOutcome: string;     // 期望产出
  explorationStrategy: string; // 探索策略建议
  keyQuestions: string[];      // 关键待解答问题
  riskPoints: string[];        // 风险点
  nextActions: string[];       // 建议下一步行动
}

// ========== AI管家组件（深度优化版）==========
const AIButler: React.FC<{
  project: Project | null;
  nodes: ProblemNode[];
  onAddNode: (title: string, deps?: string[]) => void;
  onUpdateNode: (id: string, updates: Partial<ProblemNode>) => void;
  onStartExploration: () => void;
  onUpdateProjectInsight?: (insight: ProjectInsight) => void;
  quotedNode?: ProblemNode | null;
  onClearQuotedNode?: () => void;
}> = ({ project, nodes, onAddNode, onUpdateNode, onStartExploration, onUpdateProjectInsight, quotedNode, onClearQuotedNode }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeAgents, setActiveAgents] = useState<Agent[]>([]);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [projectInsight, setProjectInsight] = useState<ProjectInsight | null>(null);
  const [showInsightPanel, setShowInsightPanel] = useState(false);
  const [currentQuotedNode, setCurrentQuotedNode] = useState<ProblemNode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 处理引用节点
  useEffect(() => {
    if (quotedNode) {
      setCurrentQuotedNode(quotedNode);
      onClearQuotedNode?.();
    }
  }, [quotedNode, onClearQuotedNode]);

  const availableAgents: Agent[] = [
    { id: 'researcher', name: '研究员', role: '深度调研', avatar: '🔬', status: 'idle', specialty: ['research', 'analysis'] },
    { id: 'coder', name: '开发者', role: '代码实现', avatar: '💻', status: 'idle', specialty: ['code', 'build'] },
    { id: 'designer', name: '设计师', role: 'UI/UX设计', avatar: '🎨', status: 'idle', specialty: ['design', 'image'] },
    { id: 'writer', name: '文案', role: '内容创作', avatar: '✍️', status: 'idle', specialty: ['writing', 'content'] },
    { id: 'analyst', name: '分析师', role: '数据分析', avatar: '📊', status: 'idle', specialty: ['data', 'analysis'] },
    { id: 'strategist', name: '策略师', role: '战略规划', avatar: '🎯', status: 'idle', specialty: ['strategy', 'planning'] },
  ];

  // 初始化：深度分析项目意图
  useEffect(() => {
    if (project && messages.length === 0) {
      analyzeProjectIntent();
    }
  }, [project?.id]);

  // 深度分析项目意图
  const analyzeProjectIntent = async () => {
    if (!project) return;
    setIsTyping(true);
    
    try {
      const analysisPrompt = `作为一个深度思考的AI管家，请分析这个探索项目：

**项目目标**: ${project.metaProblem}
**当前节点数**: ${nodes.length}
**已完成**: ${nodes.filter(n => n.status === NodeStatus.SOLVED).length}
**探索模式**: ${project.explorationMode || '研究'}

用户选择使用全自动AI探索引擎来研究这个问题，而不是简单地问AI获得答案。这意味着：
1. 这个问题可能很复杂，没有标准答案
2. 用户希望获得深度、系统性的理解
3. 问题可能涉及多个维度，需要持续探索
4. 每个阶段的最优解可能不同

请深入分析并返回JSON格式（不要markdown代码块）：
{
  "deepMotivation": "用户提出这个问题的深层动机是什么？他们真正想解决什么？",
  "valueAssessment": "这个问题的价值含量评估（从创新性、实用性、影响力等维度）",
  "expectedOutcome": "用户期望通过探索获得什么样的答案或成果？",
  "explorationStrategy": "针对这个问题的最佳探索策略是什么？",
  "keyQuestions": ["需要回答的3-5个关键子问题"],
  "riskPoints": ["探索过程中可能遇到的2-3个风险或陷阱"],
  "nextActions": ["建议用户接下来做的2-3个具体行动"],
  "greeting": "一段友好的开场白，展示你对项目的理解，并提出一个引导性问题来深入了解用户意图"
}`;

      const response = await callGemini([
        { role: "system", content: "你是一个擅长深度分析的AI管家，能够洞察用户的真实需求和深层动机。返回纯JSON，不要markdown。" },
        { role: "user", content: analysisPrompt }
      ], GEMINI_MODEL);

      try {
        const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
        const analysis = JSON.parse(cleanJson);
        
        const insight: ProjectInsight = {
          deepMotivation: analysis.deepMotivation || '',
          valueAssessment: analysis.valueAssessment || '',
          expectedOutcome: analysis.expectedOutcome || '',
          explorationStrategy: analysis.explorationStrategy || '',
          keyQuestions: analysis.keyQuestions || [],
          riskPoints: analysis.riskPoints || [],
          nextActions: analysis.nextActions || []
        };
        
        setProjectInsight(insight);
        onUpdateProjectInsight?.(insight);
        
        setMessages([{ 
          role: 'model', 
          text: analysis.greeting || `你好！我是这个项目的AI管家 🏠\n\n我注意到你正在探索「${project.name}」这个很有深度的问题。\n\n能告诉我，是什么契机让你想深入研究这个方向？你期望最终获得什么样的成果？`
        }]);
      } catch (parseError) {
        setMessages([{ 
          role: 'model', 
          text: `你好！我是项目管家 🏠\n\n📋 **${project.name}**\n\n我注意到你选择了全自动探索引擎来研究这个问题，而不是简单地寻求答案。这说明这个问题对你很重要。\n\n能和我聊聊，你为什么对这个方向感兴趣？你希望探索能带来什么样的价值？`
        }]);
      }
    } catch (e) {
      setMessages([{ 
        role: 'model', 
        text: `你好！我是项目管家 🏠\n\n📋 ${project.name}\n📊 进度: ${nodes.filter(n => n.status === NodeStatus.SOLVED).length}/${nodes.length}\n\n这个问题很值得深入探索。你最想先解决哪个方面？`
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const inviteAgent = (agent: Agent) => {
    if (activeAgents.find(a => a.id === agent.id)) return;
    setActiveAgents(prev => [...prev, { ...agent, status: 'idle' as const }]);
    setShowAgentPicker(false);
    setMessages(prev => [...prev, { role: 'model', text: `🤝 **${agent.name}** (${agent.role}) 已加入！\n\n${agent.avatar} 我会从${agent.specialty.join('、')}的角度协助分析这个问题。` }]);
  };

  const removeAgent = (agentId: string) => {
    const agent = activeAgents.find(a => a.id === agentId);
    if (agent) {
      setActiveAgents(prev => prev.filter(a => a.id !== agentId));
      setMessages(prev => [...prev, { role: 'model', text: `👋 **${agent.name}** 已离开群聊` }]);
    }
  };

  // 核心对话处理 - 影响探索方向
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setInput('');
    setIsTyping(true);
    
    try {
      // 构建丰富的上下文
      const nodesContext = nodes.slice(0, 10).map(n => ({
        title: n.title,
        status: n.status,
        notes: n.notes?.slice(0, 100)
      }));
      
      const conversationHistory = messages.slice(-8).map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.text
      }));

      const systemPrompt = `你是一个深度思考的AI项目管家，具备以下能力：

**核心职责**：
1. 深度挖掘用户的真实意图和深层需求
2. 评估问题的价值含量和探索优先级
3. 根据对话内容调整探索方向
4. 提供战略性建议而非简单回答

**项目背景**：
- 项目名称：${project?.name || '未命名'}
- 核心问题：${project?.metaProblem || ''}
- 探索模式：${project?.explorationMode || 'research'}
- 节点总数：${nodes.length}，已完成：${nodes.filter(n => n.status === NodeStatus.SOLVED).length}
- 当前探索的主要节点：${nodesContext.map(n => n.title).join('、')}

**已有洞察**：
${projectInsight ? `
- 深层动机：${projectInsight.deepMotivation}
- 价值评估：${projectInsight.valueAssessment}
- 期望产出：${projectInsight.expectedOutcome}
- 关键问题：${projectInsight.keyQuestions.join('、')}
` : '尚未深度分析'}

**当前群聊中的专家Agent**：${activeAgents.map(a => `${a.name}(${a.role})`).join('、') || '无'}

**回复原则**：
1. 像朋友聊天一样自然，但要有深度
2. 主动追问用户的动机和期望
3. 当用户提出新想法时，评估是否值得加入探索
4. 如果用户的想法能优化探索方向，明确建议调整
5. 适时推荐邀请专业Agent
6. 每次回复最后，如果有重要洞察，用【洞察】标记

**特殊指令识别**：
- 如果用户说"加入探索"/"新增方向"等，在回复末尾加上：[ACTION:ADD_NODE:节点标题]
- 如果用户说"调整优先级"/"先做这个"等，在回复末尾加上：[ACTION:PRIORITIZE:节点标题]
- 如果用户表达了重要的意图变化，在回复末尾加上：[INSIGHT:具体洞察内容]`;

      const response = await callGemini([
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: userMessage }
      ], GEMINI_MODEL);

      // 解析响应中的特殊指令
      let displayResponse = response;
      const actionMatch = response.match(/\[ACTION:(\w+):(.+?)\]/);
      const insightMatch = response.match(/\[INSIGHT:(.+?)\]/);
      
      if (actionMatch) {
        const [, action, target] = actionMatch;
        displayResponse = response.replace(/\[ACTION:\w+:.+?\]/, '').trim();
        
        if (action === 'ADD_NODE') {
          // 自动添加新节点
          setTimeout(() => {
            onAddNode(target, nodes.length > 0 ? [nodes[0].id] : []);
            setMessages(prev => [...prev, { 
              role: 'model', 
              text: `✅ 已将「${target}」加入探索计划！这个方向会在下一轮探索中展开。`
            }]);
          }, 500);
        }
      }
      
      if (insightMatch) {
        const [, insight] = insightMatch;
        displayResponse = displayResponse.replace(/\[INSIGHT:.+?\]/, '').trim();
        
        // 更新项目洞察
        if (projectInsight) {
          const updatedInsight = {
            ...projectInsight,
            keyQuestions: [...projectInsight.keyQuestions, insight].slice(-5)
          };
          setProjectInsight(updatedInsight);
          onUpdateProjectInsight?.(updatedInsight);
        }
      }

      setMessages(prev => [...prev, { role: 'model', text: displayResponse }]);
    } catch (e) { 
      setMessages(prev => [...prev, { role: 'model', text: '抱歉，我需要整理一下思路，请稍后再试。' }]); 
    }
    finally { setIsTyping(false); }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 项目洞察面板 */}
      {projectInsight && showInsightPanel && (
        <div className="p-3 border-b border-slate-800 bg-gradient-to-r from-blue-900/20 to-purple-900/20 max-h-[200px] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-blue-400">💡 项目洞察</div>
            <button onClick={() => setShowInsightPanel(false)} className="text-slate-500 hover:text-slate-300 text-xs">收起</button>
          </div>
          <div className="space-y-2 text-[11px]">
            <div><span className="text-slate-500">深层动机：</span><span className="text-slate-300">{projectInsight.deepMotivation}</span></div>
            <div><span className="text-slate-500">价值评估：</span><span className="text-emerald-400">{projectInsight.valueAssessment}</span></div>
            {projectInsight.keyQuestions.length > 0 && (
              <div>
                <span className="text-slate-500">关键问题：</span>
                <div className="mt-1 space-y-1">
                  {projectInsight.keyQuestions.slice(0, 3).map((q, i) => (
                    <div key={i} className="text-slate-400 pl-2 border-l border-slate-700">• {q}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* 洞察按钮 */}
      {projectInsight && !showInsightPanel && (
        <button 
          onClick={() => setShowInsightPanel(true)}
          className="mx-3 mt-2 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 rounded-lg text-[10px] text-blue-400 flex items-center gap-2 transition-colors"
        >
          <span>💡</span> 查看项目洞察
        </button>
      )}

      {/* 活跃的Agent */}
      {activeAgents.length > 0 && (
        <div className="p-3 border-b border-slate-800 bg-slate-900/50">
          <div className="text-[10px] text-slate-500 mb-2">协作专家</div>
          <div className="flex gap-2 flex-wrap">
            {activeAgents.map(agent => (
              <div key={agent.id} className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 rounded-full text-xs group cursor-pointer hover:bg-slate-700" onClick={() => removeAgent(agent.id)}>
                <span>{agent.avatar}</span><span className="text-slate-300">{agent.name}</span><span className="text-slate-500 group-hover:text-red-400">×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => {
          // 解析消息中的引用内容
          const quoteMatch = m.text.match(/^\[关于节点「(.+?)」\]\s*([\s\S]*)/);
          const hasQuote = m.role === 'user' && quoteMatch;
          const quotedTitle = hasQuote ? quoteMatch[1] : '';
          const actualMessage = hasQuote ? quoteMatch[2] : m.text;
          
          return (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl ${m.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-slate-800 text-slate-300 rounded-bl-sm'}`}>
                {/* 引用部分 - 微信风格小字显示 */}
                {hasQuote && (
                  <div className={`px-3 pt-2 pb-1 border-b ${m.role === 'user' ? 'border-blue-500/30' : 'border-slate-700'}`}>
                    <div className={`text-[10px] ${m.role === 'user' ? 'text-blue-200/70' : 'text-slate-500'} flex items-center gap-1`}>
                      <span className="opacity-60">┃</span>
                      <span>引用：{quotedTitle}</span>
                    </div>
                  </div>
                )}
                {/* 正文内容 */}
                <div className="px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">{actualMessage || (hasQuote ? '👆' : m.text)}</div>
              </div>
            </div>
          );
        })}
        {isTyping && <div className="flex justify-start"><div className="bg-slate-800 text-slate-400 px-3 py-2 rounded-2xl rounded-bl-sm text-xs animate-pulse">正在深度思考...</div></div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Agent选择器 */}
      {showAgentPicker && (
        <div className="p-3 border-t border-slate-800 bg-slate-900">
          <div className="text-[10px] text-slate-500 mb-2 opacity-60">邀请专家协助分析</div>
          <div className="grid grid-cols-2 gap-2">
            {availableAgents.filter(a => !activeAgents.find(aa => aa.id === a.id)).map(agent => (
              <button key={agent.id} onClick={() => inviteAgent(agent)} className="flex items-center gap-2 p-2 bg-slate-800/60 hover:bg-slate-700 rounded-lg text-left transition-colors">
                <span className="text-lg opacity-80">{agent.avatar}</span>
                <div><div className="text-xs font-medium text-slate-300">{agent.name}</div><div className="text-[10px] text-slate-500">{agent.role}</div></div>
              </button>
            ))}
          </div>
          <button onClick={() => setShowAgentPicker(false)} className="w-full mt-2 py-1.5 text-[10px] text-slate-600 hover:text-slate-400">取消</button>
        </div>
      )}

      {/* 引用的节点显示 */}
      {currentQuotedNode && (
        <div className="mx-3 mb-2 p-2.5 bg-blue-600/10 border border-blue-500/30 rounded-xl">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-blue-400 mb-1">📌 引用节点讨论</div>
              <div className="text-xs text-slate-200 font-medium truncate">{currentQuotedNode.title}</div>
              {currentQuotedNode.notes && (
                <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">{currentQuotedNode.notes}</div>
              )}
            </div>
            <button 
              onClick={() => setCurrentQuotedNode(null)} 
              className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-slate-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!input.trim() && !currentQuotedNode) return;
        // 如果有引用节点，自动添加到消息中
        let messageToSend = input.trim();
        if (currentQuotedNode) {
          const quotePrefix = `[关于节点「${currentQuotedNode.title}」] `;
          messageToSend = quotePrefix + messageToSend;
          setCurrentQuotedNode(null);
        }
        if (messageToSend) {
          // 调用原有的发送逻辑
          const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
          setInput(messageToSend);
          setTimeout(() => handleSend(fakeEvent), 0);
        }
      }} className="p-3 border-t border-slate-800 bg-slate-900/80">
        <div className="flex gap-2 items-end">
          <button type="button" onClick={() => setShowAgentPicker(!showAgentPicker)} className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors" title="邀请专家">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
          </button>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder={currentQuotedNode ? "针对这个节点说点什么..." : "聊聊你的想法..."} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500" />
          <button type="submit" disabled={isTyping || (!input.trim() && !currentQuotedNode)} className="p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-xl transition-colors">
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
            {/* 项目介绍 */}
            {project && (
              <div className="bg-gradient-to-r from-blue-600/10 to-purple-600/10 rounded-lg p-3 border border-blue-500/20">
                <div className="text-[10px] font-medium text-blue-400 mb-1.5">📋 项目介绍</div>
                <div className="text-[11px] text-slate-300 mb-2">{project.name}</div>
                <div className="text-[10px] font-medium text-purple-400 mb-1">🎯 核心目标</div>
                <div className="text-[11px] text-slate-200 leading-relaxed">{project.metaProblem}</div>
              </div>
            )}

            {/* 探索思路 */}
            <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
              <div className="text-[10px] font-medium text-cyan-400 mb-1.5">🧭 探索思路</div>
              <div className="text-[11px] text-slate-400 leading-relaxed">
                {project?.explorationMode === 'research' 
                  ? '采用研究模式：系统性地分解问题，深度调研每个子方向，收集知识卡片，验证假设，最终形成完整的研究报告。'
                  : '采用构建模式：以实践为导向，逐步实现目标，在过程中迭代优化方案。'
                }
              </div>
              {stats.total > 1 && (
                <div className="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-slate-500">
                  当前已展开 {stats.total} 个探索方向，{stats.solved > 0 ? `其中 ${stats.solved} 个已完成` : '正在探索中'}
                </div>
              )}
            </div>

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
        {/* 生成报告按钮：探索未完成时变暗 */}
        {(() => {
          const isExplorationComplete = stats.unexplored === 0 && stats.exploring === 0 && stats.solved > 0;
          const canGenerate = isExplorationComplete && !isGeneratingReport;
          return (
            <button 
              onClick={onGenerateReport} 
              disabled={!canGenerate}
              className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                canGenerate 
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg hover:shadow-xl' 
                  : 'bg-slate-800/50 text-slate-500 border border-slate-700/50 cursor-not-allowed'
              }`}
              title={!isExplorationComplete ? '请先完成所有探索' : ''}
            >
              {isGeneratingReport ? (
                <><div className="w-2 h-2 bg-white rounded-full animate-ping" />生成中...</>
              ) : (
                <>📄 生成研究报告 {!isExplorationComplete && <span className="text-[9px] opacity-60">({stats.unexplored + stats.exploring}个待完成)</span>}</>
              )}
            </button>
          );
        })()}
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
  const [loginPhone, setLoginPhone] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [isLoginAsAdmin, setIsLoginAsAdmin] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'wechat' | 'phone' | 'email'>('email'); // 登录方式
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
  const [sidebarWidth, setSidebarWidth] = useState<number>(320); // 可调节的侧边栏宽度
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'butler' | 'research'>('butler');
  const [nodes, setNodes] = useState<ProblemNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [isDetailsWide, setIsDetailsWide] = useState(false);
  // 引用节点到AI管家讨论
  const [quotedNodeForButler, setQuotedNodeForButler] = useState<ProblemNode | null>(null);
  // 项目重命名
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');
  const [decision, setDecision] = useState<DecisionPoint | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, nodeId: string } | null>(null);
  const isLoopingRef = useRef(false);
  const isProcessingRef = useRef(false);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);

  // 侧边栏拖拽调整大小
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  }, []);

  useEffect(() => {
    if (!isResizingSidebar) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 280), 600);
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizingSidebar(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // 项目重命名
  const handleRenameProject = useCallback((newName: string) => {
    if (!currentProjectId || !newName.trim()) return;
    setProjects(prev => prev.map(p => 
      p.id === currentProjectId ? { ...p, name: newName.trim() } : p
    ));
    setEditingProjectName(false);
    setTempProjectName('');
  }, [currentProjectId]);

  // 引用节点到AI管家
  const handleQuoteNodeToButler = useCallback((node: ProblemNode) => {
    setQuotedNodeForButler(node);
    setSidebarActiveTab('butler');
    if (notesPanelMode === 0) setNotesPanelMode(1);
  }, [notesPanelMode]);

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
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-xl">A</div>
          <h2 className="text-xl sm:text-2xl font-bold">AI 自动探索助手</h2>
          <p className="text-slate-500 text-xs sm:text-sm mt-2">{isLoginAsAdmin ? '管理员验证' : '选择登录方式'}</p>
        </div>
        
        {!isLoginAsAdmin ? (
          <div className="space-y-4">
            {/* 登录方式切换 */}
            {!isOtpSent && (
              <div className="flex gap-2 p-1 bg-slate-800 rounded-xl">
                <button 
                  onClick={() => setLoginMethod('wechat')} 
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'wechat' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg>
                  微信
                </button>
                <button 
                  onClick={() => setLoginMethod('phone')} 
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'phone' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
                  短信
                </button>
                <button 
                  onClick={() => setLoginMethod('email')} 
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'email' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  邮箱
                </button>
              </div>
            )}
            
            {/* 微信扫码登录 */}
            {loginMethod === 'wechat' && !isOtpSent && (
              <div className="text-center py-6">
                <div className="w-48 h-48 mx-auto bg-white rounded-2xl p-3 mb-4">
                  <div className="w-full h-full bg-slate-100 rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" className="mx-auto mb-2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01M7 12h.01M12 7h.01M17 7h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01M17 17h.01"/></svg>
                      <p className="text-xs text-slate-500">微信扫码区域</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-500">请使用微信扫一扫登录</p>
                <button onClick={() => setUser(auth.loginWithEmail('wechat_user@demo.com'))} className="mt-4 text-xs text-blue-400 hover:text-blue-300">模拟扫码成功</button>
              </div>
            )}
            
            {/* 短信验证码登录 */}
            {loginMethod === 'phone' && !isOtpSent && (
              <>
                <div className="flex gap-2">
                  <select className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-3.5 text-sm text-white outline-none">
                    <option>+86</option>
                    <option>+1</option>
                    <option>+852</option>
                  </select>
                  <input type="tel" placeholder="手机号码" value={loginPhone} onChange={e => setLoginPhone(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none" />
                </div>
                <button onClick={() => { if (loginPhone.length >= 11) { setIsOtpSent(true); setOtpCode('123456'); } }} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl">获取短信验证码</button>
              </>
            )}
            
            {/* 邮箱验证码登录 */}
            {loginMethod === 'email' && !isOtpSent && (
              <>
                <input type="email" placeholder="电子邮箱" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none" />
                <button onClick={() => { if (loginEmail.includes('@')) { setIsOtpSent(true); setOtpCode('123456'); } }} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl">获取邮箱验证码</button>
              </>
            )}
            
            {/* 验证码输入 */}
            {isOtpSent && (
              <>
                <div className="text-center text-xs text-slate-500 mb-2">
                  验证码已发送至 {loginMethod === 'phone' ? loginPhone : loginEmail}
                </div>
                <input type="text" placeholder="输入验证码" value={otpCode} onChange={e => setOtpCode(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-4 text-center text-xl tracking-[0.5em] font-mono text-white outline-none" />
                <button onClick={() => setUser(auth.loginWithEmail(loginMethod === 'phone' ? loginPhone : loginEmail))} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl">确认登录</button>
                <button onClick={() => { setIsOtpSent(false); setOtpCode(''); }} className="w-full text-xs text-slate-500 hover:text-slate-300 py-2">返回重新获取</button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <input type="text" placeholder="管理账号" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none" />
            <input type="password" placeholder="管理密码" value={adminPass} onChange={e => setAdminPass(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none" />
            <button onClick={() => { if (auth.loginAsAdmin(adminUsername, adminPass)) setUser(auth.getUser()); else alert('账号或密码错误'); }} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl">管理员登录</button>
          </div>
        )}
        
        <div className="mt-6 pt-4 border-t border-slate-800 text-center">
          <button onClick={() => { setIsLoginAsAdmin(!isLoginAsAdmin); setOtpCode(''); setIsOtpSent(false); }} className="text-slate-500 hover:text-white text-sm font-medium">{isLoginAsAdmin ? '返回普通登录' : '管理员入口'}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden" onClick={() => setContextMenu(null)}>
      <header className="relative h-14 border-b border-slate-800 flex items-center justify-between px-3 sm:px-6 bg-slate-900/50 backdrop-blur-md z-50">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-fit"><div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">A</div><h1 className="text-lg font-semibold hidden lg:block">Explorer</h1></div>
          
          {/* 项目选择器 + 重命名 */}
          <div className="flex items-center gap-1">
            {editingProjectName ? (
              <input
                type="text"
                value={tempProjectName}
                onChange={e => setTempProjectName(e.target.value)}
                onBlur={() => { handleRenameProject(tempProjectName); }}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameProject(tempProjectName); if (e.key === 'Escape') { setEditingProjectName(false); setTempProjectName(''); } }}
                className="bg-slate-800 border border-blue-500 rounded-md px-2 py-1 text-xs outline-none text-white max-w-[120px] sm:max-w-[200px]"
                autoFocus
              />
            ) : (
              <select className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs outline-none text-white max-w-[120px] sm:max-w-[200px]" value={currentProjectId || ''} onChange={e => setCurrentProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            )}
            {/* 重命名按钮 */}
            {currentProject && !editingProjectName && (
              <button 
                onClick={() => { setTempProjectName(currentProject.name); setEditingProjectName(true); }}
                className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-slate-800 rounded transition-colors"
                title="重命名项目"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            )}
          </div>
          
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
                <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); }} />
                <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 z-50" onClick={e => e.stopPropagation()}>
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
        {/* 可调整大小的侧边栏 */}
        <aside 
          className={`h-full bg-slate-900 border-r border-slate-800 flex flex-col z-20 overflow-hidden ${notesPanelMode === 0 ? 'w-0 border-none' : ''}`}
          style={{ width: notesPanelMode === 0 ? 0 : sidebarWidth }}
        >
          <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
            <h3 className="text-xs font-bold text-slate-400">EXPLORER</h3>
            <div className="flex gap-1">
              <button onClick={() => setSidebarWidth(sidebarWidth === 320 ? 480 : 320)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400" title="切换宽度">
                {sidebarWidth > 400 ? <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>}
              </button>
              <button onClick={() => setNotesPanelMode(0)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
            </div>
          </div>
          <div className="flex border-b border-slate-800">
            <button onClick={() => setSidebarActiveTab('butler')} className={`flex-1 py-3 text-xs font-bold transition-all flex items-center justify-center gap-2 ${sidebarActiveTab === 'butler' ? 'bg-blue-600/10 text-blue-400 border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300'}`}><span>🏠</span> AI管家</button>
            <button onClick={() => setSidebarActiveTab('research')} className={`flex-1 py-3 text-xs font-bold transition-all flex items-center justify-center gap-2 ${sidebarActiveTab === 'research' ? 'bg-emerald-600/10 text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}><span>📊</span> 研究面板</button>
          </div>
          <div className="flex-1 overflow-hidden">
            {sidebarActiveTab === 'butler' && <AIButler project={currentProject} nodes={nodes} onAddNode={addNode} onUpdateNode={updateNode} onStartExploration={() => setIsLooping(true)} quotedNode={quotedNodeForButler} onClearQuotedNode={() => setQuotedNodeForButler(null)} />}
            {sidebarActiveTab === 'research' && <SimpleResearchPanel project={currentProject} nodes={nodes} knowledgeCards={knowledgeCards} findings={researchFindings} criticalNodes={criticalNodes} isLooping={isLooping} isGeneratingReport={isGeneratingReport} onNodeSelect={setSelectedNodeId} onStartExploration={() => setIsLooping(true)} onStopExploration={() => setIsLooping(false)} onGenerateReport={handleGenerateReport} />}
          </div>
        </aside>
        
        {/* 拖拽调整宽度的把手 */}
        {notesPanelMode !== 0 && (
          <div 
            className={`w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-30 ${isResizingSidebar ? 'bg-blue-500' : 'bg-transparent'}`}
            onMouseDown={handleSidebarMouseDown}
          />
        )}
        
        {notesPanelMode === 0 && <div className="w-8 h-full bg-slate-900 border-r border-slate-800 flex items-center justify-center cursor-pointer hover:bg-slate-800 z-20 group" onClick={() => setNotesPanelMode(1)}><div className="rotate-90 whitespace-nowrap text-[10px] font-bold text-slate-500 group-hover:text-blue-400">展开面板</div></div>}
        <div className="flex-1 relative z-0"><GraphVisualization nodes={filteredNodes} onNodeClick={handleNodeClick} onNodeContextMenu={(node, x, y) => setContextMenu({ x, y, nodeId: node.id })} /></div>
        <div className={`fixed inset-0 z-40 md:relative md:inset-auto md:z-20 transition-all duration-300 ${selectedNodeId ? 'translate-x-0 opacity-100 md:w-96' : 'translate-x-full opacity-0 md:w-0 overflow-hidden'}`} style={{ width: selectedNodeId && window.innerWidth >= 768 ? (isDetailsWide ? '600px' : '384px') : undefined }}>
          <div className="absolute inset-0 bg-black/60 md:hidden" onClick={() => setSelectedNodeId(null)}></div>
          <div className="relative h-full ml-auto"><NodeDetails node={selectedNode} isFocused={focusedNodeId === selectedNodeId} isWide={isDetailsWide} onToggleWide={() => setIsDetailsWide(!isDetailsWide)} onClose={() => setSelectedNodeId(null)} onSendMessage={async (id, text) => { const node = nodes.find(n => n.id === id); if (!node) return; const updated = [...(node.chatHistory || []), { role: 'user', text } as ChatMessage]; updateNode(id, { chatHistory: updated }); const resp = await chatWithNode(node, text, updated); updateNode(id, { chatHistory: [...updated, { role: 'model', text: resp } as ChatMessage] }); }} onUpdateNotes={(id, notes) => updateNode(id, { notes })} onUpdateNodeData={(id, updates) => updateNode(id, updates)} onAppendToSummary={(text) => { if (!currentProjectId) return; setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, summaryNote: (p.summaryNote || '') + text } : p)); }} /></div>
        </div>
      </main>

      {contextMenu && <div className="fixed z-[100] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 w-48" style={{ top: Math.min(contextMenu.y, window.innerHeight - 350), left: Math.min(contextMenu.x, window.innerWidth - 200) }} onClick={e => e.stopPropagation()}>
        {/* 引用到AI管家 - 放在最上面 */}
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2 text-blue-400" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) handleQuoteNodeToButler(n); setContextMenu(null); }}>💬 引用到AI管家讨论</button>
        <div className="h-px bg-slate-700 my-1"></div>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { setFocusedNodeId(focusedNodeId === contextMenu.nodeId ? null : contextMenu.nodeId); setContextMenu(null); }}>🎯 {focusedNodeId === contextMenu.nodeId ? '取消聚焦' : '聚焦节点'}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isCritical: !n.isCritical }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isCritical ? '⭐ 取消关键' : '⭐ 设为关键'}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isPinned: !n.isPinned }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isPinned ? '📍 取消固定' : '📌 固定节点'}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isCollapsed: !n.isCollapsed }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isCollapsed ? '📂 展开节点' : '📁 折叠节点'}</button>
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
