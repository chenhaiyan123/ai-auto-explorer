import { UserStats, KnowledgeCard, ResearchFinding } from './types';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MessageBoard from './components/MessageBoard';
import { v4 as uuidv4 } from 'uuid';
import { ProblemNode, NodeStatus, DecisionPoint, Project, ChatMessage } from './types';
import GraphVisualization from './components/GraphVisualization';
import NodeDetails from './components/NodeDetails';
import DecisionModal from './components/DecisionModal';
import { exploreNode, chatWithNode, generateProjectSummary, callGemini, identifyNodeTask } from './services/geminiService';
import { monitor } from './services/monitoringService';
import { auth, hasAuthBackend } from './services/authService';
import { GEMINI_MODEL } from './constants';
import { analyzeIntentWithAutoConfirm, IntentAnalysis, ExplorationMode } from './services/intentService';
import IntentConfirmModal from './components/IntentConfirmModal';
import { exploreResearchNode, generateResearchReport } from './services/researchExplorer';
import ResearchReport from './components/ResearchReport';
import AgentTeamPanel, { AgentTeamState, initialAgentTeamState } from './components/AgentTeamPanel';
import QuestionEvaluator from './components/QuestionEvaluator';
import QuestionBoard from './components/QuestionBoard';
import TeamChat from './components/TeamChat';
import DownloadModal from './components/DownloadModal';
const IS_DESKTOP = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);
import SettingsModal from './components/SettingsModal';
import { QVSReport } from './services/qvsService';
import { resolveNodeByTitle } from './services/noteLinks';
import { exportVaultZip, importMarkdownFiles, saveVaultToDirectory, supportsDirectoryPicker } from './services/vault';
import { buildTeamPlan } from './services/teamService';
import { loadLLMSettings, isTrialMode, getTrialQuota, hasTrialBackend } from './services/llmProvider';
import { getWithMigration, idbSet } from './services/storage';

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
  chatHistory?: ChatMessage[];
  onUpdateChatHistory?: (messages: ChatMessage[]) => void;
}> = ({ project, nodes, onAddNode, onUpdateNode, onStartExploration, onUpdateProjectInsight, quotedNode, onClearQuotedNode, chatHistory, onUpdateChatHistory }) => {
  const [messages, setMessages] = useState<ChatMessage[]>(chatHistory || []);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeAgents, setActiveAgents] = useState<Agent[]>([]);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [projectInsight, setProjectInsight] = useState<ProjectInsight | null>(null);
  const [showInsightPanel, setShowInsightPanel] = useState(false);
  const [currentQuotedNode, setCurrentQuotedNode] = useState<ProblemNode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 同步外部聊天记录
  useEffect(() => {
    if (chatHistory && chatHistory.length > 0 && messages.length === 0) {
      setMessages(chatHistory);
    }
  }, [chatHistory]);

  // 保存聊天记录到父组件
  useEffect(() => {
    if (messages.length > 0 && onUpdateChatHistory) {
      onUpdateChatHistory(messages);
    }
  }, [messages, onUpdateChatHistory]);

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
      ], undefined);

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
      ], undefined);

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
        const response = await callGemini([{ role: "system", content: `你是需求对齐AI。任务:"${taskTitle}"。向执行人解释背景目标，确认理解，后续监督进度。` }, { role: "user", content: "请开始讲解。" }], undefined);
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
      const response = await callGemini([{ role: "system", content: `你是进度监督AI。任务:${taskTitle}。引导执行人完成并同步进度。` }, ...newMsgs.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }))], undefined);
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

// ===== 笔记模板（项目像一个代码仓库：README + 主文件 + 关键方向子节点） =====
const readmeTemplate = (name: string) => `# ${name}

> 项目说明（README）· 本项目不限于代码，也可以是研究 / 产品 / 其它类型。

## 这个项目要解决什么
（用一两句话写清核心问题或目标）

## 项目类型
代码开发 / 研究探索 / 产品 / 其它

## 关键节点（二级，建议 5–8 个）
把项目分解成 5–8 个重要节点，每个是一篇子笔记，像公司里不同部门分工，可由一个专门的 Agent 负责；节点内部可再建三级详情：

- [[方向一]] — 负责 Agent：
- [[方向二]] — 负责 Agent：

## 说明
- 「项目总览」笔记里持续更新整体进展。
- 每个子节点笔记里记录该方向的探索现状与后续方向。`;

const overviewTemplate = (name: string) => `# ${name} · 总览

> 上方「📊 项目概览」会自动汇总主要方向、探索进度、待解决问题和相关笔记链接。这里写需要人来把握的部分：

## 项目简介
（这个项目要解决什么、背景与意义）

## 打算用的方法 / 思路
-

## 阶段小结
（阶段性发现与判断，可手动维护或让 AI 更新）
`;

const directionTemplate = (title: string) => `# ${title}

## 探索现状
（这个关键方向目前了解到什么、做到哪一步）

## 后续探索方向
-

## 负责 Agent
（指派一个专门的 Agent 负责这个子任务）`;

// 按方向标题启发式推荐一个负责 Agent（AI 团队分工，像公司里不同部门）
const recommendAgentFor = (title: string): string => {
  const t = (title || '').toLowerCase();
  const rules: [RegExp, string][] = [
    [/代码|开发|程序|算法|系统|架构|工程|api|部署|后端|前端/, '全栈工程师'],
    [/设计|ui|ux|界面|视觉|交互|原型/, 'UI/UX 设计师'],
    [/数据|分析|统计|指标|图表|可视化/, '数据分析师'],
    [/市场|营销|推广|增长|获客|用户运营|渠道/, '增长运营官'],
    [/研究|文献|调研|综述|理论|学术/, '研究分析员'],
    [/法律|合规|政策|监管|条款/, '法务顾问'],
    [/财务|成本|预算|商业|盈利|定价|模式/, '商业分析师'],
    [/内容|文案|写作|脚本|叙事|品牌/, '内容策划'],
    [/实验|测试|验证|仿真|物理|硬件|设备/, '实验工程师'],
    [/安全|风险|审计|隐私/, '安全审计员'],
  ];
  for (const [re, role] of rules) if (re.test(t)) return role;
  return '通用研究员';
};

// 确保每个项目都有 README + 总览（老项目自动补齐）
function ensureOverview(p: Project): Project {
  const nodes = p.nodes || [];
  if (nodes.some(n => n.noteType === 'overview')) return p;
  const name = p.name || (p.metaProblem || '').slice(0, 12) || '项目';
  const now = Date.now();
  const add: ProblemNode[] = [];
  if (!nodes.some(n => n.noteType === 'readme')) {
    add.push({ id: uuidv4(), title: 'README', noteType: 'readme', status: NodeStatus.SOLVED, confidence: 1, dependencies: [], notes: '', chatHistory: [], agentResults: [], fullNote: readmeTemplate(name), noteUpdatedAt: now });
  }
  add.push({ id: uuidv4(), title: '总览', noteType: 'overview', status: NodeStatus.SOLVED, confidence: 1, dependencies: [], notes: '', chatHistory: [], agentResults: [], fullNote: overviewTemplate(name), noteUpdatedAt: now });
  return { ...p, nodes: [...add, ...nodes] };
}

// 项目=文件夹，里面是 README / 项目总览 / 关键方向子节点
const NotesPanel: React.FC<{
  projects: Project[];
  currentProjectId: string | null;
  selectedNodeId: string | null;
  search: string;
  onSearch: (s: string) => void;
  onOpenNode: (projectId: string, nodeId: string) => void;
  onCreateProject: () => void;
  onCreateDirection: (projectId: string, title?: string) => void;
  onAddChild: (projectId: string, parentId: string) => void;
  onBuildTeam: (projectId: string) => void;
  onCleanup: (projectId: string) => void;
  onImport?: () => void;
  onExportVault?: () => void;
  onSaveToFolder?: () => void;
}> = ({ projects, currentProjectId, selectedNodeId, search, onSearch, onOpenNode, onCreateProject, onCreateDirection, onAddChild, onBuildTeam, onCleanup, onImport, onExportVault, onSaveToFolder }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set()); // 节点子项默认收起，只有手动展开的才显示子节点
  const toggleNode = (id: string) => setExpandedNodes(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const q = search.trim().toLowerCase();

  // 节点排序：README → 总览 → 子节点（按方向/链接热度）
  const typeRank = (n: ProblemNode) => n.noteType === 'readme' ? 0 : n.noteType === 'overview' ? 1 : 2;
  const sortNotes = (list: ProblemNode[]) => [...list].sort((a, b) =>
    typeRank(a) - typeRank(b) || (b.noteUpdatedAt || 0) - (a.noteUpdatedAt || 0));

  const allNodes = useMemo(() => projects.flatMap(p => (p.nodes || []).map(n => ({ n, p }))), [projects]);
  const searchResults = useMemo(() => {
    if (!q) return [] as { n: ProblemNode; p: Project }[];
    return allNodes.filter(({ n, p }) =>
      n.title.toLowerCase().includes(q) ||
      (n.fullNote || '').toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q)));
  }, [allNodes, q]);

  const toggleProject = (id: string) => setCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const noteIcon = (n: ProblemNode) => n.noteType === 'readme' ? '📘' : n.noteType === 'overview' ? '🏠' : '📄';

  // 一行笔记。childCount>0 时显示折叠箭头（默认收起）。canAddChild: 二级节点可加三级详情。
  const NoteRow = (projectId: string, n: ProblemNode, depth: number, opts?: { showProject?: string; canAddChild?: boolean; childCount?: number; expanded?: boolean }) => (
    <div key={n.id} className="flex items-center group/row" style={{ paddingLeft: 16 + depth * 16 }}>
      {opts?.childCount ? (
        <button onClick={() => toggleNode(n.id)} className="px-1 py-1.5 text-slate-500 hover:text-slate-300 flex-shrink-0" title={opts.expanded ? '收起' : `展开 ${opts.childCount} 个子项`}>
          <span className={`text-[9px] inline-block transition-transform ${opts.expanded ? 'rotate-90' : ''}`}>▶</span>
        </button>
      ) : <span className="w-[16px] flex-shrink-0" />}
      <button
        onClick={() => onOpenNode(projectId, n.id)}
        className={`flex-1 text-left pr-2 py-1.5 rounded-lg border transition-colors min-w-0 ${
          selectedNodeId === n.id ? 'bg-purple-600/15 border-purple-500/50' : 'bg-transparent border-transparent hover:bg-slate-800 hover:border-slate-700'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px]">{noteIcon(n)}</span>
            <span className={`text-[11px] font-semibold truncate ${selectedNodeId === n.id ? 'text-purple-200' : 'text-slate-200'}`}>{n.title || '未命名'}</span>
            {!opts?.expanded && opts?.childCount ? <span className="flex-shrink-0 text-[9px] text-slate-600">{opts.childCount}</span> : null}
          </span>
          {n.assignedAgent && <span className="flex-shrink-0 text-[8px] text-blue-400 bg-blue-900/30 border border-blue-500/30 rounded-full px-1.5 py-0.5 truncate max-w-[72px]">🤖 {n.assignedAgent}</span>}
        </div>
        {opts?.showProject && <div className="text-[9px] text-slate-600 truncate mt-0.5 ml-5">📁 {opts.showProject}</div>}
      </button>
      {opts?.canAddChild && <button onClick={() => onAddChild(projectId, n.id)} className="opacity-0 group-hover/row:opacity-100 px-1.5 text-slate-500 hover:text-emerald-400 text-sm flex-shrink-0" title="在这个节点下加一条三级详情">＋</button>}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-slate-800 space-y-2">
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="🔍 搜索 / 新建项目名…"
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[11px] text-slate-200 outline-none focus:ring-1 focus:ring-purple-500"
        />
        <button onClick={() => onCreateProject()} className="w-full py-2 bg-purple-600/80 hover:bg-purple-500 text-white rounded-lg text-[11px] font-bold transition-colors">
          ＋ 新建项目{q ? `「${search.trim()}」` : ''}
        </button>
        {(onImport || onExportVault || onSaveToFolder) && (
          <div className="flex gap-1">
            {onImport && <button onClick={onImport} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-medium transition-colors" title="导入 .md 文件">⬆ 导入</button>}
            {onExportVault && <button onClick={onExportVault} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-medium transition-colors" title="导出当前项目为 Markdown(.zip，项目即文件夹)">⬇ 导出</button>}
            {onSaveToFolder && <button onClick={onSaveToFolder} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-medium transition-colors" title="保存到本地文件夹(Vault)">💾 本地库</button>}
          </div>
        )}
        <div className="text-[9px] text-slate-600 flex justify-between">
          <span>{projects.length} 个项目</span>
          <span>项目 › 节点 › 详情（3 级）</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-hide p-2 space-y-0.5">
        {q ? (
          searchResults.length === 0
            ? <div className="text-center text-[11px] text-slate-600 py-8">没有匹配的笔记</div>
            : searchResults.map(({ n, p }) => NoteRow(p.id, n, 0, { showProject: p.name }))
        ) : projects.length === 0 ? (
          <div className="text-center text-[11px] text-slate-600 py-8">还没有项目，点上方新建</div>
        ) : (
          projects.map(p => {
            const isOpen = !collapsed.has(p.id);
            const pn = p.nodes || [];
            const byId = new Map(pn.map(n => [n.id, n]));
            const isDir = (n?: ProblemNode) => !!n && (n.noteType === 'direction' || !n.noteType);
            // 结构父级 = 依赖里那个「方向」节点（README/总览 不作为嵌套父级）
            const parentOf = (n: ProblemNode) => (n.dependencies || []).map(d => byId.get(d)).find(pp => isDir(pp));
            const specials = pn.filter(n => n.noteType === 'readme' || n.noteType === 'overview');
            const level2 = sortNotes(pn.filter(n => isDir(n) && !parentOf(n)));
            const childrenOf = (id: string) => sortNotes(pn.filter(n => isDir(n) && parentOf(n)?.id === id));
            // 二级节点可按 folder 字段归到「工作板块」文件夹下（按成员分工）
            const fname = (n: ProblemNode) => (n.folder || '').trim();
            const grouped = new Map<string, ProblemNode[]>();
            const ungrouped: ProblemNode[] = [];
            for (const n of level2) { const f = fname(n); if (f) { if (!grouped.has(f)) grouped.set(f, []); grouped.get(f)!.push(n); } else ungrouped.push(n); }
            // 递归渲染节点（子项默认收起；seen 防止依赖成环时无限递归）
            const renderNode = (n: ProblemNode, depth: number, seen: Set<string>): React.ReactNode => {
              if (seen.has(n.id)) return null;
              const nextSeen = new Set(seen); nextSeen.add(n.id);
              const kids = childrenOf(n.id).filter(c => !nextSeen.has(c.id));
              const expanded = expandedNodes.has(n.id);
              return (
                <div key={n.id}>
                  {NoteRow(p.id, n, depth, { canAddChild: !parentOf(n), childCount: kids.length, expanded })}
                  {expanded && kids.map(c => renderNode(c, Math.min(depth + 1, 3), nextSeen))}
                </div>
              );
            };
            return (
              <div key={p.id}>
                <div className={`flex items-center group rounded-lg ${p.id === currentProjectId ? 'bg-slate-800/40' : ''}`}>
                  <button onClick={() => toggleProject(p.id)} className="flex-1 flex items-center gap-1.5 py-2 px-1 text-left min-w-0">
                    <span className={`text-slate-500 text-[9px] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-[12px]">{isOpen ? '📂' : '📁'}</span>
                    <span className={`text-[11px] font-bold truncate ${p.id === currentProjectId ? 'text-purple-300' : 'text-slate-200'}`}>{p.name}</span>
                    <span className="text-[9px] text-slate-600">{level2.length}</span>
                  </button>
                  <button onClick={() => onCleanup(p.id)} className="opacity-0 group-hover:opacity-100 px-1 text-slate-500 hover:text-amber-400 text-[11px]" title={`清理「${p.name}」里待探索且无内容的子问题`}>🧹</button>
                  <button onClick={() => onBuildTeam(p.id)} className="opacity-0 group-hover:opacity-100 px-1 text-slate-500 hover:text-blue-400 text-[11px]" title={`AI 组建团队：读懂「${p.name}」目标→拆解 5–8 个关键节点→各配一名负责 Agent`}>🤝</button>
                  <button onClick={() => onCreateDirection(p.id)} className="opacity-0 group-hover:opacity-100 px-1.5 text-slate-500 hover:text-emerald-400 text-sm" title={`在「${p.name}」里新增一个关键节点（二级）`}>＋</button>
                </div>
                {isOpen && (
                  <div>
                    {specials.map(n => NoteRow(p.id, n, 0))}
                    {Array.from(grouped.entries()).map(([fn, fnodes]) => {
                      const fkey = `${p.id}::f::${fn}`;
                      const fopen = !collapsed.has(fkey);
                      const agent = fnodes.find(n => n.assignedAgent)?.assignedAgent;
                      return (
                        <div key={fkey}>
                          <button onClick={() => toggleProject(fkey)} style={{ paddingLeft: 14 }} className="w-full flex items-center gap-1.5 py-1.5 text-left min-w-0 hover:bg-slate-800/40 rounded-lg">
                            <span className={`text-slate-500 text-[9px] transition-transform ${fopen ? 'rotate-90' : ''}`}>▶</span>
                            <span className="text-[11px]">{fopen ? '📂' : '📁'}</span>
                            <span className="text-[11px] font-bold text-slate-300 truncate">{fn}</span>
                            {agent && <span className="flex-shrink-0 text-[8px] text-blue-400 bg-blue-900/30 border border-blue-500/30 rounded-full px-1.5 py-0.5 truncate max-w-[84px]">🤖 {agent}</span>}
                            <span className="text-[9px] text-slate-600">{fnodes.length}</span>
                          </button>
                          {fopen && sortNotes(fnodes).map(n => renderNode(n, 1, new Set<string>()))}
                        </div>
                      );
                    })}
                    {ungrouped.map(n => renderNode(n, 0, new Set<string>()))}
                    {pn.length === 0 && <div className="text-[9px] text-slate-600 italic pl-7 py-1">空项目</div>}
                  </div>
                )}
              </div>
            );
          })
        )}
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

  // 主题：白天 / 深色
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('aae-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.classList.add('light'); else root.classList.remove('light');
    try { localStorage.setItem('aae-theme', theme); } catch {}
  }, [theme]);

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
  const [showQVSModal, setShowQVSModal] = useState(false);           // 问题价值评估
  const [showSettingsModal, setShowSettingsModal] = useState(false); // 设置（模型接入 / IoT 设备）
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
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'butler' | 'agents' | 'research' | 'notes'>('notes');
  const [notesSearch, setNotesSearch] = useState('');
  const [showGraphModal, setShowGraphModal] = useState(false); // 图谱弹出层
  const [showQuestionBoard, setShowQuestionBoard] = useState(false); // 问题广场
  const [showDownloadModal, setShowDownloadModal] = useState(false); // 下载客户端
  const [teamBusy, setTeamBusy] = useState(false); // AI 组队进行中
  const [activeModel, setActiveModel] = useState<string>(() => { try { return loadLLMSettings().model || ''; } catch { return ''; } });
  // 免配置体验：剩余次数（仅托管版体验模式下显示）
  const [trialQuota, setTrialQuota] = useState<{ scope: 'anon' | 'user'; remaining: number; limit: number } | null>(null);
  useEffect(() => {
    if (!isTrialMode()) { setTrialQuota(null); return; }
    let alive = true;
    const refresh = async () => { const q = await getTrialQuota(); if (alive && q && q.enabled) setTrialQuota({ scope: q.scope, remaining: q.remaining, limit: q.limit }); };
    refresh();
    const id = setInterval(refresh, 20000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [activeModel]);
  const [rightChatOpen, setRightChatOpen] = useState(true);     // 右侧 AI 对话栏
  const [rightChatWidth, setRightChatWidth] = useState(360);
  const [nodes, setNodes] = useState<ProblemNode[]>([]);
  const pendingSelectRef = useRef<string | null>(null); // 切换项目后要自动选中的节点
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
  
  // 通知系统
  const [notifications, setNotifications] = useState<Array<{id: string, type: 'discovery' | 'warning' | 'info', title: string, message: string, time: number}>>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  
  // 会员与7x24探索
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const [is24x7ExplorationEnabled, setIs24x7ExplorationEnabled] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
  // AI管家聊天记录（持久化到项目中）
  const [butlerChatHistory, setButlerChatHistory] = useState<ChatMessage[]>([]);
  
  // Agent团队状态（持久化）
  const [agentTeamState, setAgentTeamState] = useState<AgentTeamState>(initialAgentTeamState);
  
  const isLoopingRef = useRef(false);
  const isProcessingRef = useRef(false);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
  // 持续探索模式：探索完现有节点后自动提出新方向，永不停（7×24）
  const [continuousMode, setContinuousMode] = useState(false);
  const continuousModeRef = useRef(false);
  const isProposingRef = useRef(false);
  const runExplorationCycleRef = useRef<(() => void) | null>(null);
  useEffect(() => { continuousModeRef.current = continuousMode; }, [continuousMode]);
  const MAX_AUTO_NODES = 50;

  // 加载会员状态
  useEffect(() => {
    if (user) {
      const premiumKey = `premium_${user.username}`;
      const premium = localStorage.getItem(premiumKey);
      if (premium) {
        const data = JSON.parse(premium);
        if (data.expireAt > Date.now()) {
          setIsPremiumUser(true);
          setIs24x7ExplorationEnabled(data.is24x7Enabled || false);
        }
      }
    }
  }, [user]);

  // 页面关闭时停止探索（非会员）
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isLooping && !is24x7ExplorationEnabled) {
        setIsLooping(false);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isLooping, is24x7ExplorationEnabled]);

  // 添加通知的函数
  const addNotification = useCallback((type: 'discovery' | 'warning' | 'info', title: string, message: string) => {
    const notification = { id: uuidv4(), type, title, message, time: Date.now() };
    setNotifications(prev => [notification, ...prev].slice(0, 20));
  }, []);

  // 清除单个通知
  const clearNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // 更新AI管家聊天记录到项目
  const handleUpdateButlerChat = useCallback((messages: ChatMessage[]) => {
    setButlerChatHistory(messages);
    if (currentProjectId) {
      setProjects(prev => prev.map(p => 
        p.id === currentProjectId ? { ...p, butlerChatHistory: messages } as any : p
      ));
    }
  }, [currentProjectId]);

  // 从项目加载AI管家聊天记录
  useEffect(() => {
    if (currentProject) {
      setButlerChatHistory((currentProject as any).butlerChatHistory || []);
    }
  }, [currentProjectId]);

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

  useEffect(() => {
    if (!user) { setProjects([]); setCurrentProjectId(null); return; }
    const k = `exploration_projects_${user.username}`;
    let cancelled = false;
    (async () => {
      let p: Project[] | undefined;
      try { p = await getWithMigration<Project[]>(k); } catch { p = undefined; }
      if (cancelled) return;
      const list = (Array.isArray(p) ? p : []).map(ensureOverview);
      setProjects(list);
      setCurrentProjectId(null);
      if (list.length === 0) setShowMetaModal(true);
    })();
    return () => { cancelled = true; };
  }, [user?.username]);
  useEffect(() => { if (user) { monitor.incrementSession(); const i = setInterval(() => monitor.updateHeartbeat(), 10000); return () => clearInterval(i); } }, [user]);

  const currentProject = useMemo(() => projects.find(p => p.id === currentProjectId) || null, [projects, currentProjectId]);
  // 项目视图：当前项目用实时 nodes，其它项目用各自保存的 nodes（供左侧项目树使用）
  const projectsView = useMemo(() => projects.map(p => p.id === currentProjectId ? { ...p, nodes } : p), [projects, currentProjectId, nodes]);
  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const decisionNode = useMemo(() => decision ? nodes.find(n => n.id === decision.nodeId) || null : null, [decision, nodes]);
  const filteredNodes = useMemo(() => { if (!focusedNodeId) return nodes; const vis = new Set<string>([focusedNodeId]); const findA = (id: string) => { const n = nodes.find(x => x.id === id); if (n) n.dependencies.forEach(d => { if (!vis.has(d)) { vis.add(d); findA(d); } }); }; const findD = (id: string) => { nodes.forEach(n => { if (n.dependencies.includes(id) && !vis.has(n.id)) { vis.add(n.id); findD(n.id); } }); }; findA(focusedNodeId); findD(focusedNodeId); return nodes.filter(n => vis.has(n.id)); }, [nodes, focusedNodeId]);
  const criticalNodes = useMemo(() => nodes.filter(n => n.isCritical), [nodes]);

  useEffect(() => { if (user && projects.length > 0) idbSet(`exploration_projects_${user.username}`, projects).catch(e => console.warn('[HiExplore] 保存项目失败', e)); }, [projects, user?.username]);
  useEffect(() => { const p = projects.find(x => x.id === currentProjectId); if (p) { setSelectedNodeId(pendingSelectRef.current); pendingSelectRef.current = null; setFocusedNodeId(null); setDecision(null); setNodes(p.nodes || []); setIsLooping(false); setKnowledgeCards((p as any).knowledgeCards || []); setResearchFindings((p as any).researchFindings || []); setResearchReport(null); setAgentTeamState((p as any).agentTeamState || initialAgentTeamState); } else if (projects.length > 0 && !currentProjectId) setCurrentProjectId(projects[0].id); }, [currentProjectId, projects.length]);
  useEffect(() => { if (currentProjectId && nodes.length > 0) setProjects(prev => { const i = prev.findIndex(p => p.id === currentProjectId); if (i === -1 || prev[i].nodes === nodes) return prev; const n = [...prev]; n[i] = { ...n[i], nodes }; return n; }); }, [nodes, currentProjectId]);
  useEffect(() => { if (currentProjectId && currentProject?.explorationMode === 'research') setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, knowledgeCards, researchFindings } as any : p)); }, [knowledgeCards, researchFindings, currentProjectId]);
  
  // 保存Agent团队状态到项目
  useEffect(() => { if (currentProjectId && agentTeamState) setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, agentTeamState } as any : p)); }, [agentTeamState, currentProjectId]);

  const addNode = useCallback((title: string, deps: string[] = [], notes = "") => { const n: ProblemNode = { id: uuidv4(), title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: deps, notes, chatHistory: [], agentResults: [] }; setNodes(prev => [...prev, n]); return n; }, []);
  const updateNode = useCallback((id: string, u: Partial<ProblemNode>) => setNodes(prev => prev.map(n => n.id === id ? { ...n, ...u } : n)), []);
  const createProjectWithMode = useCallback((input: string, mode: ExplorationMode, analysis?: IntentAnalysis) => { const p: Project = { id: uuidv4(), name: analysis?.suggestedTitle || input.slice(0, 15), metaProblem: input, createdAt: Date.now(), explorationMode: mode, intentAnalysis: analysis, nodes: [{ id: uuidv4(), title: input, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: "", chatHistory: [], agentResults: [] }] }; setProjects(prev => [...prev, p]); setCurrentProjectId(p.id); setPendingIntent(null); setMetaInput(''); setShowMetaModal(false); }, []);

  // 探索重试计数
  const retryCountRef = useRef<Record<string, number>>({});
  const MAX_RETRIES = 3;

  // 持续模式下：探索完现有节点后，让 AI 自主提出一个新关键方向（加为待探索节点）
  const proposeNewDirection = useCallback(async () => {
    if (isProposingRef.current) return;
    isProposingRef.current = true;
    try {
      const overview = nodes.find(n => n.noteType === 'overview');
      const dirs = nodes.filter(n => n.noteType === 'direction' || !n.noteType);
      const existing = dirs.map(n => n.title).join('、');
      const goal = currentProject?.metaProblem || currentProject?.name || '';
      const out = await callGemini([{ role: 'user', content: `项目核心问题：${goal}\n已有方向：${existing || '（无）'}\n请再提出 1 个还没覆盖、且值得深入的新关键方向，名词短语、不超过 10 字。只返回 JSON：{"title":"…"}` }], undefined, 'application/json');
      const cleaned = out.replace(/```json\n?|\n?```/g, '').trim();
      let title = '';
      try { const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}'); title = JSON.parse(a >= 0 && b > a ? cleaned.slice(a, b + 1) : cleaned).title; } catch {}
      title = String(title || '').trim().replace(/^(如何|怎么|怎样|为什么|什么是|关于)/u, '').replace(/[？?。.！!]+$/u, '').slice(0, 12);
      if (title && !nodes.some(n => n.title === title)) {
        addNode(title, overview ? [overview.id] : []);
        addNotification('discovery', '🧭 自主提出新方向', title);
      }
    } catch { /* 提方向失败就下次再试 */ }
    finally { isProposingRef.current = false; }
  }, [nodes, currentProject, addNode, addNotification]);

  const runExplorationCycle = useCallback(async () => {
    if (decision || isProcessingRef.current || !isLoopingRef.current) return;
    
    // 查找待探索节点
    let unexplored = focusedNodeId ? (() => { 
      const desc = new Set<string>([focusedNodeId]); 
      const q = [focusedNodeId]; 
      let i = 0; 
      while (i < q.length) { 
        const c = q[i++]; 
        nodes.forEach(n => { 
          if (n.dependencies.includes(c) && !desc.has(n.id)) { 
            desc.add(n.id); 
            q.push(n.id); 
          } 
        }); 
      } 
      return nodes.find(n => desc.has(n.id) && n.status === NodeStatus.UNEXPLORED); 
    })() : undefined;
    
    if (!unexplored) unexplored = nodes.find(n => n.status === NodeStatus.UNEXPLORED);
    
    if (!unexplored) {
      if (!nodes.some(n => n.status === NodeStatus.EXPLORING)) {
        // 持续模式：现有节点都探索完了 → 自主提一个新方向，循环继续（7×24）
        if (continuousModeRef.current && nodes.filter(n => n.noteType === 'direction' || !n.noteType).length < MAX_AUTO_NODES) {
          if (!isProposingRef.current) proposeNewDirection();
          // 不论提方向成功与否，过几秒再来一轮，避免卡死
          if (isLoopingRef.current) setTimeout(() => { if (isLoopingRef.current) runExplorationCycleRef.current?.(); }, 8000);
        } else if (!continuousModeRef.current) {
          setIsLooping(false);
          addNotification('info', '🎉 探索完成', '所有节点已探索完毕，可以生成研究报告了！');
        }
      }
      return;
    }
    
    isProcessingRef.current = true;
    const cid = unexplored.id;
    const nodeTitle = unexplored.title;
    updateNode(cid, { status: NodeStatus.EXPLORING });
    
    try {
      const isResearch = currentProject?.explorationMode === 'research';
      
      // 添加超时控制
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('API调用超时')), 60000)
      );
      
      const explorationPromise = isResearch 
        ? exploreResearchNode(unexplored, nodes, (c: KnowledgeCard) => {
            setKnowledgeCards(p => [...p, c]);
            addNotification('discovery', '💡 新知识卡片', `在「${nodeTitle}」中发现：${c.title}`);
          }, (f: ResearchFinding) => {
            setResearchFindings(p => [...p, f]);
            if (f.importance === 'high') {
              addNotification('discovery', '🔥 重要发现', f.insight.slice(0, 50) + '...');
            }
          }) 
        : exploreNode(unexplored, nodes);
      
      const result = await Promise.race([explorationPromise, timeoutPromise]) as any;
      
      if (!isLoopingRef.current) { 
        updateNode(cid, { status: NodeStatus.UNEXPLORED }); 
        isProcessingRef.current = false; 
        return; 
      }
      
      // 简化：不再单独调用 identifyNodeTask，直接使用结果中的 taskType
      const taskType = result.taskType || 'research';
      
      if (result.subProblems?.length) {
        console.log('[探索] 创建子节点, 父节点ID:', cid, '子问题数:', result.subProblems.length);
        
        // 计算父节点层级
        const getNodeLevel = (nodeId: string, visited = new Set<string>()): number => {
          if (visited.has(nodeId)) return 0;
          visited.add(nodeId);
          const node = nodes.find(n => n.id === nodeId);
          if (!node || !node.dependencies?.length) return 0;
          const parentId = node.dependencies[0];
          return 1 + getNodeLevel(parentId, visited);
        };
        const parentLevel = getNodeLevel(cid);
        const childLevel = parentLevel + 1;
        
        setNodes(prev => {
          const newNodes = result.subProblems.map((sp: any) => {
            const newNode = { 
              id: uuidv4(), 
              title: sp.title || '未命名子问题', 
              status: NodeStatus.UNEXPLORED, 
              confidence: 0, 
              dependencies: [cid], 
              notes: sp.initialNotes || "", 
              chatHistory: [], 
              agentResults: [],
              // 第2层及以上节点默认折叠
              isCollapsed: childLevel >= 2
            };
            console.log('[探索] 新节点:', newNode.title, '层级:', childLevel, '依赖:', newNode.dependencies);
            return newNode;
          });
          
          // 如果父节点是第1层，自动设置为折叠状态（这样子节点默认不显示）
          const updatedPrev = prev.map(n => {
            if (n.id === cid && parentLevel >= 1) {
              return { ...n, isCollapsed: true };
            }
            return n;
          });
          
          return [...updatedPrev, ...newNodes];
        });
        addNotification('info', '🌿 发现新方向', `从「${nodeTitle}」衍生出 ${result.subProblems.length} 个新探索方向`);
      }
      
      if (result.triggerDecision) { 
        updateNode(cid, { 
          status: NodeStatus.NEEDS_REVIEW, 
          confidence: result.confidence, 
          notes: result.notes, 
          taskType, 
          pendingDecision: { 
            nodeId: cid, 
            context: result.decisionContext, 
            options: [
              { label: '方案A：继续', action: 'continue' }, 
              { label: '方案B：新子方向', action: 'add_subproblem' }, 
              { label: '方案C：终止', action: 'terminate' }
            ] 
          } 
        }); 
        setIsLooping(false);
        addNotification('warning', '⚠️ 需要您的决策', `「${nodeTitle}」遇到了分支点，请做出选择`);
      } else {
        updateNode(cid, { status: NodeStatus.SOLVED, confidence: result.confidence, notes: result.notes, taskType });
      }
      
      // 成功后重置重试计数
      retryCountRef.current[cid] = 0;
      
    } catch (e) { 
      console.error('探索出错:', e);
      
      // 重试机制
      const retryCount = (retryCountRef.current[cid] || 0) + 1;
      retryCountRef.current[cid] = retryCount;
      
      if (retryCount < MAX_RETRIES) {
        // 还可以重试，保持UNEXPLORED状态，继续探索
        updateNode(cid, { status: NodeStatus.UNEXPLORED });
        addNotification('warning', '⚠️ 探索遇到问题', `「${nodeTitle}」将自动重试 (${retryCount}/${MAX_RETRIES})`);
        // 不停止循环，让它继续
      } else {
        // 超过重试次数，标记为需要人工处理
        updateNode(cid, { 
          status: NodeStatus.NEEDS_REVIEW, 
          notes: `自动探索失败，请手动处理。错误: ${(e as Error).message}`,
          pendingDecision: {
            nodeId: cid,
            context: '自动探索多次失败，需要人工干预',
            options: [
              { label: '重新探索', action: 'continue' },
              { label: '跳过此节点', action: 'terminate' }
            ]
          }
        });
        addNotification('warning', '⚠️ 需要人工处理', `「${nodeTitle}」探索失败，请手动处理`);
        // 继续探索其他节点，不停止
      }
    } finally { 
      isProcessingRef.current = false; 
    }
  }, [nodes, decision, updateNode, focusedNodeId, currentProject?.explorationMode, addNotification, proposeNewDirection]);

  // 让 ref 始终指向最新的探索循环（持续模式里用它自我重排，避免卡死）
  useEffect(() => { runExplorationCycleRef.current = runExplorationCycle; }, [runExplorationCycle]);

  // 优化探索间隔：成功后500ms，避免太快触发API限流
  useEffect(() => {
    if (isLooping && !decision) {
      const t = setTimeout(() => runExplorationCycle(), 500);
      return () => clearTimeout(t);
    }
  }, [isLooping, decision, runExplorationCycle]);

  const handleDecisionChoice = (action: 'continue' | 'add_subproblem' | 'terminate', subTitle?: string) => { if (!decision) return; if (action === 'terminate') updateNode(decision.nodeId, { status: NodeStatus.INVALID, pendingDecision: undefined }); else if (action === 'add_subproblem' && subTitle) addNode(subTitle, [decision.nodeId]); else if (action === 'continue') updateNode(decision.nodeId, { status: NodeStatus.SOLVED, pendingDecision: undefined }); setDecision(null); setIsLooping(true); };
  const handleNodeClick = (node: ProblemNode) => { setSelectedNodeId(node.id); if (node.status === NodeStatus.NEEDS_REVIEW && node.pendingDecision) setDecision(node.pendingDecision); };

  // 点击笔记里的 [[标题]]：已存在则跳转，不存在则创建一篇新笔记并关联（Obsidian 行为）
  const handleWikiLink = useCallback((target: string, exists: boolean, fromNode: ProblemNode) => {
    const found = resolveNodeByTitle(nodes, target);
    if (found) { setSelectedNodeId(found.id); return; }
    // 创建新笔记：以来源节点为父，正文里反向链接回来源，形成双向连接
    const n: ProblemNode = {
      id: uuidv4(), title: target.trim(), status: NodeStatus.UNEXPLORED, confidence: 0,
      dependencies: fromNode ? [fromNode.id] : [], notes: '', chatHistory: [], agentResults: [],
      fullNote: fromNode ? `> 由 [[${fromNode.title}]] 链接创建\n\n` : '', noteUpdatedAt: Date.now()
    };
    setNodes(prev => [...prev, n]);
    setSelectedNodeId(n.id);
  }, [nodes]);

  // 新建项目（一个项目=一个文件夹，像代码仓库：自带 README + 项目总览主文件）
  const handleCreateProject = useCallback((presetName?: string) => {
    const name = (presetName || notesSearch || '').trim().slice(0, 40) || '新项目';
    const projId = uuidv4();
    const readmeId = uuidv4();
    const overviewId = uuidv4();
    const now = Date.now();
    const readme: ProblemNode = { id: readmeId, title: 'README', status: NodeStatus.SOLVED, confidence: 1, dependencies: [], notes: '', chatHistory: [], agentResults: [], noteType: 'readme', fullNote: readmeTemplate(name), noteUpdatedAt: now };
    const overview: ProblemNode = { id: overviewId, title: '总览', status: NodeStatus.SOLVED, confidence: 1, dependencies: [], notes: '', chatHistory: [], agentResults: [], noteType: 'overview', fullNote: overviewTemplate(name), noteUpdatedAt: now };
    const p: Project = { id: projId, name, metaProblem: name, createdAt: now, explorationMode: 'research', nodes: [readme, overview] };
    setProjects(prev => [...prev, p]);
    pendingSelectRef.current = overviewId; // 切换后自动打开「项目总览」
    setCurrentProjectId(projId);
    setNotesSearch('');
  }, [notesSearch]);

  // 在某个项目里新增一个关键方向（子节点，带模板）
  const handleCreateDirection = useCallback((projectId: string, title?: string) => {
    const t = (title || (notesSearch || '').trim() || '新方向');
    const id = uuidv4();
    const dir: ProblemNode = { id, title: t, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: '', chatHistory: [], agentResults: [], noteType: 'direction', fullNote: directionTemplate(t), noteUpdatedAt: Date.now() };
    if (projectId === currentProjectId) {
      setNodes(prev => [...prev, dir]);
      setSelectedNodeId(id);
    } else {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, nodes: [...(p.nodes || []), dir] } : p));
      pendingSelectRef.current = id;
      setCurrentProjectId(projectId);
    }
    setNotesSearch('');
  }, [notesSearch, currentProjectId]);

  // 清理「待探索且无内容」的子问题（自动探索产生的一堆未完成空标题）
  const handleCleanupProject = useCallback((projectId: string) => {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;
    const src = projectId === currentProjectId ? nodes : (proj.nodes || []);
    const hasChild = (id: string) => src.some(n => (n.dependencies || []).includes(id));
    const isJunk = (n: ProblemNode) =>
      (n.noteType === 'direction' || !n.noteType) &&
      n.status === NodeStatus.UNEXPLORED &&
      !hasChild(n.id) &&
      !(n.agentResults && n.agentResults.length) &&
      !(n.notes && n.notes.trim()) &&
      (!n.fullNote || n.fullNote.includes('（待探索）') || n.fullNote.trim().length < 30);
    const junkIds = new Set(src.filter(isJunk).map(n => n.id));
    if (junkIds.size === 0) { alert('没有需要清理的「待探索且无内容」子问题。'); return; }
    if (!window.confirm(`将删除 ${junkIds.size} 个「待探索且无内容」的子问题（不影响有内容/已完成的节点），确定吗？`)) return;
    const clean = (list: ProblemNode[]) => list.filter(n => !junkIds.has(n.id)).map(n => ({ ...n, dependencies: (n.dependencies || []).filter(d => !junkIds.has(d)) }));
    if (projectId === currentProjectId) { setNodes(prev => clean(prev)); if (selectedNodeId && junkIds.has(selectedNodeId)) setSelectedNodeId(null); }
    else setProjects(prev => prev.map(p => p.id === projectId ? { ...p, nodes: clean(p.nodes || []) } : p));
  }, [projects, nodes, currentProjectId, selectedNodeId]);

  // 在某个节点下新增三级详情（子节点）
  const handleCreateChild = useCallback((projectId: string, parentId: string) => {
    const id = uuidv4();
    const child: ProblemNode = { id, title: '新详情', status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [parentId], notes: '', chatHistory: [], agentResults: [], noteType: 'direction', fullNote: directionTemplate('新详情'), noteUpdatedAt: Date.now() };
    if (projectId === currentProjectId) { setNodes(prev => [...prev, child]); setSelectedNodeId(id); }
    else { setProjects(prev => prev.map(p => p.id === projectId ? { ...p, nodes: [...(p.nodes || []), child] } : p)); pendingSelectRef.current = id; setCurrentProjectId(projectId); }
  }, [currentProjectId]);

  // 打开某个节点（必要时先切换到它所属的项目）
  const openNode = useCallback((projectId: string, nodeId: string) => {
    if (projectId === currentProjectId) { setSelectedNodeId(nodeId); }
    else { pendingSelectRef.current = nodeId; setCurrentProjectId(projectId); }
  }, [currentProjectId]);

  // 兜底：纯启发式给现有方向指派 Agent（无模型时用）
  const assignAgentsHeuristic = useCallback((projectId: string) => {
    const apply = (list: ProblemNode[]) => list.map(n =>
      (n.noteType === 'direction' || !n.noteType) && !n.assignedAgent
        ? { ...n, assignedAgent: recommendAgentFor(n.title) } : n);
    const proj = projects.find(p => p.id === projectId);
    const liveNodes = projectId === currentProjectId ? nodes : (proj?.nodes || []);
    const targets = liveNodes.filter(n => (n.noteType === 'direction' || !n.noteType) && !n.assignedAgent).length;
    if (targets === 0) { alert('这个项目还没有「未指派」的关键方向，也没配置模型。先在项目里添加几个方向（子节点）。'); return; }
    if (projectId === currentProjectId) setNodes(prev => apply(prev));
    else setProjects(prev => prev.map(p => p.id === projectId ? { ...p, nodes: apply(p.nodes || []) } : p));
    alert(`已为 ${targets} 个方向各指派一个负责 Agent（本地启发式）。配置模型后可用 AI 智能拆解+组队。`);
  }, [projects, nodes, currentProjectId]);

  // AI 组建团队：读懂目标 → 拆解 5–10 个关键方向 → 各配负责 Agent → 分层(方向挂在项目总览下)
  const handleBuildTeam = useCallback(async (projectId: string) => {
    if (teamBusy) return;
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;
    const srcNodes = projectId === currentProjectId ? nodes : (proj.nodes || []);
    const overview = srcNodes.find(n => n.noteType === 'overview');
    const readme = srcNodes.find(n => n.noteType === 'readme');
    const goal = proj.metaProblem || proj.name;
    const context = `${overview?.fullNote || ''}\n${readme?.fullNote || ''}`.trim();
    setTeamBusy(true);
    try {
      const plan = await buildTeamPlan(goal, context);
      const overviewId = overview?.id;
      const norm = (s: string) => (s || '').trim().replace(/[？?]+$/u, '').toLowerCase();
      const now = Date.now();
      // 生成「总览」主文件内容：项目目标 + 团队分工 + 指向各关键节点的链接
      const buildOverviewDoc = (): string => {
        const byArea = new Map<string, typeof plan.directions>();
        for (const m of plan.directions) { const a = m.area || '未分组'; if (!byArea.has(a)) byArea.set(a, [] as any); (byArea.get(a) as any).push(m); }
        let doc = `# ${proj.name} · 总览\n\n> 目标：${goal}\n> 总协调：${plan.lead.role}（${plan.lead.duty}）\n\n## 关键节点与分工\n按工作板块（文件夹）组织，点链接进入对应笔记：\n`;
        for (const [area, ms] of byArea) {
          doc += `\n### 📁 ${area}\n`;
          for (const m of ms) doc += `- [[${m.title}]] — 🤖 ${m.agent}｜${m.duty}\n`;
        }
        doc += `\n## 相关链接\n- 项目说明：[[README]]\n${plan.directions.map(m => `- [[${m.title}]]`).join('\n')}\n`;
        return doc;
      };
      const apply = (list: ProblemNode[]): ProblemNode[] => {
        const next = list.map(n => n.id === overviewId ? { ...n, assignedAgent: plan.lead.role, fullNote: buildOverviewDoc(), noteUpdatedAt: now } : n);
        for (const m of plan.directions) {
          const existing = next.find(n => norm(n.title) === norm(m.title));
          if (existing) {
            const idx = next.indexOf(existing);
            next[idx] = { ...existing, assignedAgent: existing.assignedAgent || m.agent, folder: existing.folder || m.area || undefined, dependencies: existing.dependencies?.length ? existing.dependencies : (overviewId ? [overviewId] : []) };
          } else {
            next.push({ id: uuidv4(), title: m.title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: overviewId ? [overviewId] : [], notes: '', chatHistory: [], agentResults: [], noteType: 'direction', assignedAgent: m.agent, folder: m.area || undefined, fullNote: `# ${m.title}\n\n> 工作板块：${m.area || '未分组'} ｜ 负责 Agent：${m.agent}\n> 职责：${m.duty}\n\n## 探索现状\n（待探索）\n\n## 后续探索方向\n- `, noteUpdatedAt: now });
          }
        }
        return next;
      };
      if (projectId === currentProjectId) setNodes(prev => apply(prev));
      else setProjects(prev => prev.map(p => p.id === projectId ? { ...p, nodes: apply(p.nodes || []) } : p));
      setTeamBusy(false);
      const goExplore = window.confirm(`✅ AI 已组建团队：\n· 总协调：${plan.lead.role}\n· ${plan.directions.length} 个关键方向，各配一名 Agent\n\n现在让团队开始自动探索各自方向吗？`);
      if (goExplore) {
        if (projectId !== currentProjectId) { pendingSelectRef.current = overview?.id || null; setCurrentProjectId(projectId); }
        setTimeout(() => setIsLooping(true), 300);
      }
    } catch (e: any) {
      setTeamBusy(false);
      if (window.confirm('AI 组队失败（可能未配置模型）：' + (e?.message || e) + '\n\n是否改用本地启发式，给现有方向指派 Agent？')) {
        assignAgentsHeuristic(projectId);
      }
    }
  }, [teamBusy, projects, nodes, currentProjectId, assignAgentsHeuristic]);

  // 导入 .md
  const handleImportMd = useCallback(async () => {
    const parsed = await importMarkdownFiles();
    if (!parsed.length) return;
    const newNodes: ProblemNode[] = parsed.map(p => ({
      id: uuidv4(), title: p.title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [],
      notes: '', chatHistory: [], agentResults: [], folder: p.folder, tags: p.tags, fullNote: p.body, noteUpdatedAt: Date.now()
    }));
    setNodes(prev => [...prev, ...newNodes]);
    if (newNodes[0]) setSelectedNodeId(newNodes[0].id);
    alert(`已导入 ${newNodes.length} 篇笔记。`);
  }, []);

  // 导出整库 zip
  const handleExportVault = useCallback(() => {
    if (!nodes.length) { alert('当前没有笔记可导出。'); return; }
    // 文件夹代表一个项目：以项目名作为顶层文件夹，子节点作为里面的 .md
    exportVaultZip(nodes, (currentProject?.name || 'AI-Explorer') + '-Vault', currentProject?.name);
  }, [nodes, currentProject]);

  // 保存到本地文件夹（File System Access）
  const handleSaveToFolder = useCallback(async () => {
    if (!supportsDirectoryPicker()) { alert('当前浏览器不支持直接保存到本地文件夹，请用「导出」下载 .zip（推荐 Chrome / Edge）。'); return; }
    if (!nodes.length) { alert('当前没有笔记可保存。'); return; }
    try { const count = await saveVaultToDirectory(nodes); alert(`已保存 ${count} 篇 .md 到所选文件夹。`); }
    catch (e: any) { if (e?.name !== 'AbortError') alert('保存失败：' + (e?.message || e)); }
  }, [nodes]);
  const handleDeleteNode = useCallback((id: string) => { setNodes(prev => prev.filter(n => n.id !== id).map(n => ({ ...n, dependencies: n.dependencies.filter(d => d !== id) }))); if (selectedNodeId === id) setSelectedNodeId(null); if (focusedNodeId === id) setFocusedNodeId(null); if (decision?.nodeId === id) setDecision(null); }, [selectedNodeId, focusedNodeId, decision]);
  const handleGenerateReport = async () => { if (!currentProject || isGeneratingReport) return; setIsGeneratingReport(true); try { setResearchReport(await generateResearchReport(currentProject.metaProblem, nodes, knowledgeCards)); } finally { setIsGeneratingReport(false); } };

  if (routeInfo.type === 'delegate' && routeInfo.nodeId) return <DelegationView nodeId={routeInfo.nodeId} taskTitle={routeInfo.taskTitle} />;

  if (!user) return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 to-emerald-600"></div>
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-xl">🧭</div>
          <h2 className="text-xl sm:text-2xl font-bold">HiExplore · AI 自动探究平台</h2>
          <p className="text-slate-500 text-xs sm:text-sm mt-2">{isLoginAsAdmin ? '管理员验证' : '选择登录方式'}</p>
        </div>
        
        {!isLoginAsAdmin ? (
          <div className="space-y-4">
            {/* 登录方式切换 */}
            {!isOtpSent && (
              <div className="flex gap-2 p-1 bg-slate-800 rounded-xl">
                {/* 托管版当前只有邮箱是真登录，微信/短信暂隐藏（需后端+资质） */}
                {!hasAuthBackend() && (
                <button
                  onClick={() => setLoginMethod('wechat')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'wechat' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg>
                  微信
                </button>
                )}
                {!hasAuthBackend() && (
                <button
                  onClick={() => setLoginMethod('phone')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'phone' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
                  短信
                </button>
                )}
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
                <button onClick={async () => {
                  if (!loginEmail.includes('@')) { alert('请输入正确的邮箱'); return; }
                  if (hasAuthBackend()) {
                    try { const d = await auth.sendEmailCode(loginEmail); setIsOtpSent(true); setOtpCode(''); if (d.devCode) alert('开发模式验证码：' + d.devCode); }
                    catch (e: any) { alert(e.message || '发送失败'); }
                  } else { setIsOtpSent(true); setOtpCode('123456'); }
                }} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl">获取邮箱验证码</button>
              </>
            )}
            
            {/* 验证码输入 */}
            {isOtpSent && (
              <>
                <div className="text-center text-xs text-slate-500 mb-2">
                  验证码已发送至 {loginMethod === 'phone' ? loginPhone : loginEmail}
                </div>
                <input type="text" placeholder="输入验证码" value={otpCode} onChange={e => setOtpCode(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-4 text-center text-xl tracking-[0.5em] font-mono text-white outline-none" />
                <button onClick={async () => {
                  if (hasAuthBackend() && loginMethod === 'email') {
                    try { setUser(await auth.verifyEmailCode(loginEmail, otpCode)); }
                    catch (e: any) { alert(e.message || '验证失败'); }
                  } else { setUser(auth.loginWithEmail(loginMethod === 'phone' ? loginPhone : loginEmail)); }
                }} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl">确认登录</button>
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
        
        {/* 免注册体验：游客进入，按匿名设备给小额度 */}
        {!isLoginAsAdmin && hasTrialBackend() && (
          <button
            onClick={() => setUser(auth.loginAsGuest())}
            className="w-full mt-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold py-3.5 rounded-xl flex items-center justify-center gap-2"
          >
            🎁 先免注册体验一下
          </button>
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
          {/* 7x24会员按钮 */}
          {!isPremiumUser && (
            <button 
              onClick={() => setShowPremiumModal(true)} 
              className="hidden sm:flex px-2.5 py-1.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 rounded-full text-[10px] font-bold hover:from-amber-500/30 hover:to-orange-500/30 items-center gap-1.5 transition-all"
            >
              <span>👑</span> 7×24探索
            </button>
          )}
          {isPremiumUser && (
            <div className="hidden sm:flex px-2.5 py-1.5 bg-gradient-to-r from-amber-600/20 to-orange-600/20 text-amber-400 border border-amber-500/30 rounded-full text-[10px] font-bold items-center gap-1.5">
              <span>👑</span> 会员
            </div>
          )}

          {/* 当前模型：一眼确认用的是哪个模型，点击打开设置 */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full transition-colors text-[11px] font-bold text-emerald-400 max-w-[180px]"
            title="当前使用的模型（点击修改）"
          >
            <span>🧠</span>
            <span className="truncate">{activeModel || '未配置模型'}</span>
          </button>

          {/* 体验剩余次数：仅免配置体验模式显示，用完引导注册/填 Key */}
          {trialQuota && (
            <button
              onClick={() => setShowSettingsModal(true)}
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${trialQuota.remaining > 0 ? 'bg-emerald-600/15 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/25' : 'bg-amber-600/15 text-amber-400 border-amber-600/30 hover:bg-amber-600/25'}`}
              title={trialQuota.scope === 'anon' ? '免注册体验额度（登录可获得更多，或填入你自己的模型 Key）' : '今日体验额度（用完可填入你自己的模型 Key）'}
            >
              <span>🎁</span>
              <span>体验剩余 {trialQuota.remaining}/{trialQuota.limit}</span>
            </button>
          )}

          {/* 下载客户端（在桌面客户端内则隐藏） */}
          {!IS_DESKTOP && (
            <button
              onClick={() => setShowDownloadModal(true)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-blue-600 hover:text-white border border-slate-700 rounded-full transition-colors text-[11px] font-bold text-blue-400 flex items-center gap-1"
              title="下载桌面客户端（支持本地模型 / 7×24）"
            >⬇ 客户端</button>
          )}

          {/* 问题广场：筛选有价值的问题 */}
          <button
            onClick={() => setShowQuestionBoard(true)}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-amber-600 hover:text-white border border-slate-700 rounded-full transition-colors text-[11px] font-bold text-amber-400 flex items-center gap-1"
            title="问题广场：筛选有价值的问题"
          >🔥 问题</button>

          {/* 主题切换：白天 / 深色 */}
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full transition-colors"
            title={theme === 'dark' ? '切换到白天模式' : '切换到深色模式'}
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>
            )}
          </button>

          {/* 设置：模型接入 / IoT 设备 */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full transition-colors"
            title="设置：模型接入 / IoT 设备"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>

          {/* 通知按钮 */}
          <div className="relative">
            <button 
              onClick={() => setShowNotificationPanel(!showNotificationPanel)} 
              className="relative p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {notifications.length > 9 ? '9+' : notifications.length}
                </span>
              )}
            </button>
            
            {/* 通知面板 */}
            {showNotificationPanel && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotificationPanel(false)} />
                <div className="absolute right-0 top-full mt-2 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-hidden flex flex-col">
                  <div className="p-3 border-b border-slate-700 flex items-center justify-between">
                    <span className="text-sm font-bold text-white">通知</span>
                    {notifications.length > 0 && (
                      <button onClick={() => setNotifications([])} className="text-[10px] text-slate-500 hover:text-slate-300">全部清除</button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-slate-500 text-xs">暂无通知</div>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} className={`p-3 border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer ${n.type === 'discovery' ? 'bg-emerald-500/5' : n.type === 'warning' ? 'bg-orange-500/5' : ''}`} onClick={() => clearNotification(n.id)}>
                          <div className="flex items-start gap-2">
                            <span className="text-sm">{n.type === 'discovery' ? '💡' : n.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-slate-200">{n.title}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{n.message}</div>
                              <div className="text-[9px] text-slate-600 mt-1">{new Date(n.time).toLocaleTimeString()}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

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
            <button onClick={() => setSidebarActiveTab('notes')} className={`flex-1 py-3 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${sidebarActiveTab === 'notes' ? 'bg-purple-600/10 text-purple-400 border-b-2 border-purple-500' : 'text-slate-500 hover:text-slate-300'}`}><span>📝</span> 笔记</button>
            <button onClick={() => setSidebarActiveTab('agents')} className={`flex-1 py-3 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${sidebarActiveTab === 'agents' ? 'bg-violet-600/10 text-violet-400 border-b-2 border-violet-500' : 'text-slate-500 hover:text-slate-300'}`}><span>🤖</span> 团队</button>
            <button onClick={() => setSidebarActiveTab('research')} className={`flex-1 py-3 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${sidebarActiveTab === 'research' ? 'bg-emerald-600/10 text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}><span>📊</span> 研究</button>
          </div>
          <div className="flex-1 overflow-hidden">
            {sidebarActiveTab === 'notes' && <NotesPanel projects={projectsView} currentProjectId={currentProjectId} selectedNodeId={selectedNodeId} search={notesSearch} onSearch={setNotesSearch} onOpenNode={openNode} onCreateProject={handleCreateProject} onCreateDirection={handleCreateDirection} onAddChild={handleCreateChild} onBuildTeam={handleBuildTeam} onCleanup={handleCleanupProject} onImport={handleImportMd} onExportVault={handleExportVault} onSaveToFolder={handleSaveToFolder} />}
            {sidebarActiveTab === 'agents' && <AgentTeamPanel projectId={currentProjectId || ''} projectGoal={currentProject?.metaProblem || ''} nodes={nodes} state={agentTeamState} onStateChange={setAgentTeamState} onTeamOutput={(output) => { if (currentProjectId) setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, agentOutput: output } : p)); }} />}
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

        {/* ===== 中间：笔记内容（Obsidian 主编辑区） ===== */}
        <div className="flex-1 relative z-0 min-w-0 bg-slate-800">
          {/* 顶部工具条 */}
          <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/60 pointer-events-none">
            <div className="text-[11px] text-slate-500 truncate pointer-events-auto">{selectedNode ? '📝 笔记' : ''}</div>
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onClick={() => { const next = !continuousMode; setContinuousMode(next); setIsLooping(next); if (next) addNotification('info', '♾️ 持续探索已开启', '保持本应用打开，AI 会不停探索并自主提出新方向'); }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1.5 ${continuousMode ? 'bg-emerald-600 text-white animate-pulse' : 'bg-slate-700/70 text-slate-200 hover:bg-emerald-600 hover:text-white'}`}
                title="7×24 持续探索：探索完会自主提出新方向，永不停（保持应用打开即可）"
              >♾️ {continuousMode ? '探索中' : '持续探索'}</button>
              <button onClick={() => setShowGraphModal(true)} className="px-3 py-1.5 bg-slate-700/70 hover:bg-purple-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1.5" title="打开关系图谱">🕸️ 图谱</button>
              <button onClick={() => setRightChatOpen(v => !v)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1.5 ${rightChatOpen ? 'bg-blue-600 text-white' : 'bg-slate-700/70 text-slate-200 hover:bg-blue-600 hover:text-white'}`} title="切换 AI 对话栏">💬 对话</button>
            </div>
          </div>

          <div className="h-full pt-11">
            {selectedNode ? (
              <NodeDetails node={selectedNode} variant="center" isFocused={focusedNodeId === selectedNodeId} isWide={isDetailsWide} onToggleWide={() => setIsDetailsWide(!isDetailsWide)} onClose={() => setSelectedNodeId(null)} onSendMessage={async (id, text) => { const node = nodes.find(n => n.id === id); if (!node) return; const updated = [...(node.chatHistory || []), { role: 'user', text } as ChatMessage]; updateNode(id, { chatHistory: updated }); const resp = await chatWithNode(node, text, updated); updateNode(id, { chatHistory: [...updated, { role: 'model', text: resp } as ChatMessage] }); }} onUpdateNotes={(id, notes) => updateNode(id, { notes })} onUpdateNodeData={(id, updates) => updateNode(id, updates)} onAddChildNode={(parentId, title) => { const id = uuidv4(); const dir: ProblemNode = { id, title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [parentId], notes: '', chatHistory: [], agentResults: [], noteType: 'direction', fullNote: directionTemplate(title), noteUpdatedAt: Date.now() }; setNodes(prev => [...prev, dir]); setSelectedNodeId(id); }} allNodes={nodes} onNavigate={(id) => setSelectedNodeId(id)} onWikiLink={handleWikiLink} onAppendToSummary={(text) => { if (!currentProjectId) return; setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, summaryNote: (p.summaryNote || '') + text } : p)); }} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-4">
                <div className="text-5xl opacity-40">📂</div>
                <div className="text-slate-400 text-sm font-bold">从左侧选择一个项目里的笔记，或新建项目</div>
                <div className="text-slate-600 text-[11px] max-w-sm leading-relaxed">一个项目就是一个文件夹（含 README + 项目总览），里面放 5–10 个关键方向，每个方向是一篇子笔记、可由一个专门的 Agent 负责。用 <span className="text-purple-400">[[标题]]</span> 互相关联，点上方 <span className="text-purple-400">🕸️ 图谱</span> 看关系网络。</div>
                <button onClick={() => handleCreateProject()} className="mt-2 px-4 py-2 bg-purple-600/80 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-colors">＋ 新建项目</button>
              </div>
            )}
          </div>
        </div>

        {/* ===== 右侧：AI 对话 ===== */}
        <div className="hidden md:flex h-full flex-col bg-slate-900 border-l border-slate-800 overflow-hidden transition-all duration-300" style={{ width: rightChatOpen ? rightChatWidth : 0 }}>
          <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
            <h3 className="text-xs font-bold text-blue-400 flex items-center gap-1.5"><span>🤝</span> 团队群聊</h3>
            <button onClick={() => setRightChatOpen(false)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400" title="收起"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 17 5-5-5-5M13 17l5-5-5-5"/></svg></button>
          </div>
          <div className="flex-1 overflow-hidden">
            <TeamChat key={currentProjectId || 'none'} project={currentProject} nodes={nodes} selectedNode={selectedNode} onAppendToNote={(nodeId, text) => { const nn = nodes.find(n => n.id === nodeId); updateNode(nodeId, { fullNote: ((nn?.fullNote || nn?.notes || '') + text), noteUpdatedAt: Date.now() }); setSelectedNodeId(nodeId); }} onOpenNode={(id) => setSelectedNodeId(id)} chatHistory={((currentProject as any)?.butlerChatHistory) || []} onUpdateChatHistory={handleUpdateButlerChat} />
          </div>
        </div>

        {/* 收起时的右侧重新展开把手 */}
        {!rightChatOpen && (
          <div className="hidden md:flex w-8 h-full bg-slate-900 border-l border-slate-800 items-center justify-center cursor-pointer hover:bg-slate-800 z-20 group" onClick={() => setRightChatOpen(true)} title="展开 AI 对话">
            <div className="rotate-90 whitespace-nowrap text-[10px] font-bold text-slate-500 group-hover:text-blue-400">AI 对话</div>
          </div>
        )}

        {/* ===== 关系图谱弹出层 ===== */}
        {showGraphModal && (
          <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/95 backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80">
              <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2"><span>🕸️</span> 关系图谱{currentProject?.name ? ` · ${currentProject.name}` : ''}</h3>
              <button onClick={() => setShowGraphModal(false)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors" title="关闭"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 relative">
              <GraphVisualization nodes={filteredNodes} onNodeClick={(node) => { handleNodeClick(node); setShowGraphModal(false); }} onNodeContextMenu={(node, x, y) => setContextMenu({ x, y, nodeId: node.id })} onToggleCollapse={(nodeId) => { const n = nodes.find(x => x.id === nodeId); if (n) updateNode(n.id, { isCollapsed: !n.isCollapsed }); }} onBatchUpdateNodes={(updates) => { setNodes(prev => prev.map(n => { const u = updates.find(x => x.id === n.id); return u ? { ...n, ...u.changes } : n; })); }} />
            </div>
          </div>
        )}
      </main>

      {contextMenu && <div className="fixed z-[100] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 w-48" style={{ top: Math.min(contextMenu.y, window.innerHeight - 350), left: Math.min(contextMenu.x, window.innerWidth - 200) }} onClick={e => e.stopPropagation()}>
        {/* 在团队群聊里讨论这个节点（选中它 + 打开右侧群聊，群聊会自动把当前笔记带进上下文） */}
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2 text-blue-400" onClick={() => { setSelectedNodeId(contextMenu.nodeId); setRightChatOpen(true); setContextMenu(null); }}>💬 在团队群聊里讨论</button>
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

      {showMetaModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-8 shadow-2xl"><h2 className="text-2xl font-bold">新探索任务</h2><textarea value={metaInput} onChange={e => setMetaInput(e.target.value)} placeholder="描述你想探索的问题..." className="w-full bg-slate-800 border border-slate-700 rounded-xl p-5 mt-6 min-h-[100px] outline-none text-slate-200 resize-none" /><button disabled={!metaInput.trim()} onClick={() => { setShowMetaModal(false); setShowQVSModal(true); }} className="w-full mt-4 py-3 bg-gradient-to-r from-violet-600/20 to-blue-600/20 border border-violet-500/30 text-violet-300 rounded-xl font-bold text-sm hover:from-violet-600/30 hover:to-blue-600/30 transition-all disabled:opacity-40 flex items-center justify-center gap-2"><span>📊</span> 先评估问题价值（推荐）</button><div className="flex gap-4 mt-4"><button onClick={() => setShowMetaModal(false)} className="flex-1 py-4 bg-slate-800 rounded-xl font-bold">取消</button><button disabled={isAnalyzingIntent || !metaInput.trim()} onClick={async () => { if (!metaInput.trim()) return; setIsAnalyzingIntent(true); try { const { analysis, needsConfirmation } = await analyzeIntentWithAutoConfirm(metaInput); if (needsConfirmation) { setPendingIntent({ input: metaInput, analysis }); setShowMetaModal(false); } else createProjectWithMode(metaInput, analysis.mode, analysis); } catch { createProjectWithMode(metaInput, 'research'); } finally { setIsAnalyzingIntent(false); } }} className="flex-[2] py-4 bg-blue-600 rounded-xl font-bold disabled:opacity-50">{isAnalyzingIntent ? '分析中...' : '直接开启探索'}</button></div></div></div>}

      {/* 问题价值评估（QVS）模块 */}
      {showQVSModal && (
        <QuestionEvaluator
          initialQuestion={metaInput}
          onClose={() => { setShowQVSModal(false); setShowMetaModal(true); }}
          onStartExploration={async (question: string, report: QVSReport) => {
            setShowQVSModal(false);
            setMetaInput(question);
            setIsAnalyzingIntent(true);
            try {
              const { analysis, needsConfirmation } = await analyzeIntentWithAutoConfirm(question);
              if (needsConfirmation) { setPendingIntent({ input: question, analysis }); }
              else createProjectWithMode(question, analysis.mode, analysis);
            } catch { createProjectWithMode(question, 'research'); }
            finally { setIsAnalyzingIntent(false); }
          }}
        />
      )}

      {/* AI 组队进行中提示 */}
      {teamBusy && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[120] bg-slate-900 border border-blue-500/40 rounded-full px-5 py-3 shadow-2xl flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-xs font-bold text-blue-300">🤝 AI 正在读懂目标、拆解方向、组建团队…</span>
        </div>
      )}

      {/* 下载客户端 */}
      {showDownloadModal && <DownloadModal onClose={() => setShowDownloadModal(false)} />}

      {/* 问题广场 */}
      {showQuestionBoard && <QuestionBoard userKey={user?.username || 'guest'} onClose={() => setShowQuestionBoard(false)} onStartProject={(text) => handleCreateProject(text)} />}

      {/* 设置：模型接入 / IoT 设备 */}
      {showSettingsModal && <SettingsModal onClose={() => { setShowSettingsModal(false); try { setActiveModel(loadLLMSettings().model || ''); } catch {} }} />}

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

      {/* 会员购买弹窗 */}
      {showPremiumModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" onClick={() => setShowPremiumModal(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl mx-auto flex items-center justify-center text-3xl mb-4 shadow-xl">👑</div>
              <h3 className="text-xl font-bold text-white">7×24 长期探索会员</h3>
              <p className="text-slate-400 text-sm mt-2">解锁后台持续探索能力</p>
            </div>
            
            <div className="bg-slate-800/50 rounded-2xl p-5 mb-6 border border-slate-700">
              <div className="flex items-baseline justify-center gap-1 mb-4">
                <span className="text-4xl font-bold text-amber-400">¥19.9</span>
                <span className="text-slate-500">/月</span>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-slate-300">关闭网页后继续探索</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-slate-300">7×24小时后台自动运行</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-slate-300">重要发现微信/邮件提醒</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-slate-300">无限探索项目数量</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-slate-300">优先使用新功能</span>
                </div>
              </div>
            </div>

            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 mb-6">
              <div className="text-[11px] text-orange-400 text-center">
                💡 普通用户每天可探索1个项目，关闭网页即停止
              </div>
            </div>

            <div className="space-y-3">
              <button 
                onClick={() => {
                  // 模拟购买成功
                  const premiumKey = `premium_${user?.username}`;
                  localStorage.setItem(premiumKey, JSON.stringify({
                    expireAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
                    is24x7Enabled: true
                  }));
                  setIsPremiumUser(true);
                  setIs24x7ExplorationEnabled(true);
                  setShowPremiumModal(false);
                  addNotification('info', '🎉 开通成功', '您已成为7×24探索会员！');
                }}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold rounded-xl transition-all shadow-lg"
              >
                立即开通
              </button>
              <button 
                onClick={() => setShowPremiumModal(false)}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 font-medium rounded-xl transition-colors"
              >
                稍后再说
              </button>
            </div>
            
            <p className="text-[10px] text-slate-600 text-center mt-4">
              开通即表示同意《会员服务协议》
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
