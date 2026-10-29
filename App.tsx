import ServiceMarket from './components/ServiceMarket';
import { platform } from './services/native';
import { useLanguage, t as ui } from './services/language';
import PersonalCenter from './components/PersonalCenter';
import SharedModelsPanel from './components/SharedModelsPanel';
import { BillingModal } from './components/BillingPanel';
import { billingRequest, BILLING_CHANGED, BILLING_API, BillingAccount } from './services/billingClient';
import AdminDashboard from './components/AdminDashboard';
import { sharedRequest, SHARED_API } from './services/sharedModelsClient';
import RouteMap from './components/RouteMap';
import { assertBrowserResearchAllowed, pauseCloudProject, WAKE_API } from './services/wakeClient';
import { migrateProjectOverview, isOverviewNote, projectOverviewContext, overviewExportNodes } from './services/projectOverview';
import { UserStats, KnowledgeCard, ResearchFinding } from './types';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MessageBoard from './components/MessageBoard';
import { v4 as uuidv4 } from 'uuid';
import { ProblemNode, NodeStatus, DecisionPoint, Project, ChatMessage, DecisionOption, DecisionTrigger, Probe, FeedItem } from './types';
import { type HelpSeek, seekFromFact } from './services/factHelp';
import { batchProgress, batchAsk, BATCH_SIZE, charterAsk, infoAsk, type Batch } from './services/agentFeed';
import { keyInfoContext, questionsFromBrief, addPending, nextPending, pendingCount, markAsked, answerInfo, skipInfo, remember } from './services/keyInfo';
import KeyInfoPanel from './components/KeyInfoPanel';
import ProjectWallet from './components/ProjectWallet';
import { ensurePmToken, pmBuyOrPost, pmWorkJobs } from './services/pmAgent';
import { marketRequestAs } from './services/serviceMarket';
import { money } from './services/serviceMarket';
import { onModelUsage, meterFor, addModelSpend, reportModelUsage, setDefaultMeterProject } from './services/projectWallet';
import { transferProject } from './services/billingClient';
import { logQuestions } from './services/questionLog';
import { paperNoteFor } from './services/papers';
import { uploadAudio } from './services/realityActions';
import LandingHero from './components/LandingHero';
import { profileDue, buildProfileMessages, parseProfile, solvedCount, profileSkills, profileToListing, type PmProfileState } from './services/pmProfile';
import { briefMarkdown, charterFromText, charterLabel } from './services/projectBrief';
import { pushFeed, answerFeed, closeAsks, openAsks, status as feedStatus, stepAsk, branchAsk, contradictedAsk, realityAsk, anchorAsk, unattendedAsk, haltedAsk, outlineAsk } from './services/agentFeed';
import { DecisionRecordModal, DecisionTimelineModal, DecisionDraft } from './components/DecisionCenter';
import { captureSubtree, createDecision, forkFromDecision } from './services/decisionService';
import { trackEvent, identifyChatUser } from './services/analytics';
import { markMilestone } from './services/funnel';
import GraphVisualization from './components/GraphVisualization';
import NodeDetails from './components/NodeDetails';
import DecisionModal from './components/DecisionModal';
import { exploreNode, chatWithNode, generateProjectSummary, callGemini, identifyNodeTask, synthesizeOverview } from './services/geminiService';
import { monitor } from './services/monitoringService';
import { auth, hasPasswordLogin, hasAuthBackend } from './services/authService';
import { GEMINI_MODEL } from './constants';
import { analyzeIntentWithAutoConfirm, IntentAnalysis, ExplorationMode } from './services/intentService';
import IntentConfirmModal from './components/IntentConfirmModal';
import { exploreResearchNode, generateResearchReport } from './services/researchExplorer';
import ResearchReport from './components/ResearchReport';
import ProjectWorkspace from './components/ProjectWorkspace';
import NotesPanel from './components/ProjectNotesTree';
import { ensureWorktree, saveStage, branchFromStage, switchExplorationBranch, PROJECT_PAGES, ProjectPage } from './services/projectWorktree';
import { useInquiryTeams } from './services/useInquiryTeams';
import { recoverInquiry, questionFactContext, addFact } from './services/inquiry';
import { lifeOf, defaultLife, pickDue, budgetAllows, spendBudget, buildPulseMessages, parsePulse, applyPulse, failPulse, notableToShow, touchViewed, setCadence, setWatching, glowOf, glowLine, litDays, type Glow, type PulseBudget } from './services/projectPulse';
import ProjectPulse from './components/ProjectPulse';
import { callLLM } from './services/llmProvider';
import AutonomyModal from './components/AutonomyModal';
import { asTask, setModelRouter, pickModel, type TaskLevel, type ModelPolicy } from './services/modelRouter';
import { SHARED_MODELS_CHANGED } from './services/sharedModelsClient';
import { marketCapability, grantAutonomy, isAutonomous, isRunningAutonomously, logAuto, autoChoice, budgetLeftCNY, autoSpentCNY, canPlanNextStage, entriesSince, reportDue, fallbackReport, buildReportMessages, parseReport, nextCheckIn } from './services/autonomy';
import { reportAsk, digestAsk } from './services/agentFeed';
import DigestPanel from './components/DigestPanel';
import RealityPanel from './components/RealityPanel';
import { platformRequest, pageUrl, buildActionMessages, parseAction, actionCost, shouldIngest, buildIngestMessages, parseIngest, addCheck, patchCheck, type RealityAction, type RealityCheck, type RealityKind, type PlatformCatalog } from './services/realityActions';
import { collectDigest, digestDue, lastDigestAt, fallbackDigest, buildDigestMessages, parseDigest, digestSections, addDigest } from './services/digest';
import type { Autonomy, AutoLogEntry } from './types';
import type { SharedCatalog } from './services/sharedModelsClient';
import QuestionEvaluator from './components/QuestionEvaluator';
import QuestionBoard from './components/QuestionBoard';
import TeamChat from './components/TeamChat';
import DownloadModal from './components/DownloadModal';
const IS_DESKTOP = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);
import SettingsModal from './components/SettingsModal';
import FeedbackModal from './components/FeedbackModal';
import { QVSReport } from './services/qvsService';
import { resolveNodeByTitle } from './services/noteLinks';
import { exportVaultZip, importMarkdownFiles, saveVaultToDirectory, supportsDirectoryPicker } from './services/vault';
import { buildTeamPlan } from './services/teamService';
import { checkTriggers, summarizeHits, isContradictedByReality, isBlockedOnReality, realityQueue } from './services/validationTrigger';
import { pendingProbeCount, designProbes, applyProbeResult } from './services/probeService';
import DeviceGuard from './components/DeviceGuard';
import ChatLauncher from './components/ChatLauncher';
import { designSimulation } from './services/simService';
import OutlinePlanner from './components/OutlinePlanner';
import { proposeOutline } from './services/outlineService';
import { confirmOutline, outlineProgress, outlineToMarkdown, keptItems, plainProgress, setUserNote, isStubNote, fillStubNote, stubNote } from './services/outline';
import { buildInbox, parseItemId, InboxReply } from './services/inbox';
import { pushInbox, pullReplies, ackReplies, nextPollDelay, hasSyncBackend } from './services/inboxSync';
import { loadPending, approvePending, dropPending } from './services/iotService';
import {
  currentAnchor, explorableNodes, legReady, reachAnchor, settleAnchor, skipAnchor,
  mergeRevision, anchorEvidence, anchorBrief, isWaitingAtAnchor, nodesOfAnchor,
  planRoute, planLegDirections, reviseRoute,
} from './services/routeService';
import { ExplorationRoute, RouteAnchor, ANCHOR_METHOD_LABEL, Outline, ExplorationPace } from './types';
import { loadLLMSettings, isTrialMode, getTrialQuota, hasTrialBackend } from './services/llmProvider';
import { loadWorkspace, saveWorkspace } from './services/projectSync';
import ProjectSyncPanel from './components/ProjectSyncPanel';

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
            <div className="text-[10px] font-bold text-blue-400">{ui("💡 项目洞察")}</div>
            <button onClick={() => setShowInsightPanel(false)} className="text-slate-500 hover:text-slate-300 text-xs">{ui("收起")}</button>
          </div>
          <div className="space-y-2 text-[11px]">
            <div><span className="text-slate-500">{ui("深层动机：")}</span><span className="text-slate-300">{projectInsight.deepMotivation}</span></div>
            <div><span className="text-slate-500">{ui("价值评估：")}</span><span className="text-emerald-400">{projectInsight.valueAssessment}</span></div>
            {projectInsight.keyQuestions.length > 0 && (
              <div>
                <span className="text-slate-500">{ui("关键问题：")}</span>
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
          <span>💡</span>{ui("查看项目洞察")}</button>
      )}

      {/* 活跃的Agent */}
      {activeAgents.length > 0 && (
        <div className="p-3 border-b border-slate-800 bg-slate-900/50">
          <div className="text-[10px] text-slate-500 mb-2">{ui("协作专家")}</div>
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
                      <span>{ui("引用：")}{quotedTitle}</span>
                    </div>
                  </div>
                )}
                {/* 正文内容 */}
                <div className="px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">{actualMessage || (hasQuote ? '👆' : m.text)}</div>
              </div>
            </div>
          );
        })}
        {isTyping && <div className="flex justify-start"><div className="bg-slate-800 text-slate-400 px-3 py-2 rounded-2xl rounded-bl-sm text-xs animate-pulse">{ui("正在深度思考...")}</div></div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Agent选择器 */}
      {showAgentPicker && (
        <div className="p-3 border-t border-slate-800 bg-slate-900">
          <div className="text-[10px] text-slate-500 mb-2 opacity-60">{ui("邀请专家协助分析")}</div>
          <div className="grid grid-cols-2 gap-2">
            {availableAgents.filter(a => !activeAgents.find(aa => aa.id === a.id)).map(agent => (
              <button key={agent.id} onClick={() => inviteAgent(agent)} className="flex items-center gap-2 p-2 bg-slate-800/60 hover:bg-slate-700 rounded-lg text-left transition-colors">
                <span className="text-lg opacity-80">{agent.avatar}</span>
                <div><div className="text-xs font-medium text-slate-300">{agent.name}</div><div className="text-[10px] text-slate-500">{agent.role}</div></div>
              </button>
            ))}
          </div>
          <button onClick={() => setShowAgentPicker(false)} className="w-full mt-2 py-1.5 text-[10px] text-slate-600 hover:text-slate-400">{ui("取消")}</button>
        </div>
      )}

      {/* 引用的节点显示 */}
      {currentQuotedNode && (
        <div className="mx-3 mb-2 p-2.5 bg-blue-600/10 border border-blue-500/30 rounded-xl">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-blue-400 mb-1">{ui("📌 引用节点讨论")}</div>
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
          <button type="button" onClick={() => setShowAgentPicker(!showAgentPicker)} className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors" title={ui("邀请专家")}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
          </button>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder={currentQuotedNode ? ui("针对这个节点说点什么...") : ui("聊聊你的想法...")} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500" />
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
            <span className="text-[9px] text-slate-500">{ui("探索进度")}</span>
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
                <div className="text-[10px] font-medium text-blue-400 mb-1.5">{ui("📋 项目介绍")}</div>
                <div className="text-[11px] text-slate-300 mb-2">{project.name}</div>
                <div className="text-[10px] font-medium text-purple-400 mb-1">{ui("🎯 核心目标")}</div>
                <div className="text-[11px] text-slate-200 leading-relaxed">{project.metaProblem}</div>
              </div>
            )}

            {/* 探索思路 */}
            <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
              <div className="text-[10px] font-medium text-cyan-400 mb-1.5">{ui("🧭 探索思路")}</div>
              <div className="text-[11px] text-slate-400 leading-relaxed">
                {project?.explorationMode === 'research' 
                  ? ui("采用研究模式：系统性地分解问题，深度调研每个子方向，收集知识卡片，验证假设，最终形成完整的研究报告。")
                  : ui("采用构建模式：以实践为导向，逐步实现目标，在过程中迭代优化方案。")
                }
              </div>
              {stats.total > 1 && (
                <div className="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-slate-500">{ui("当前已展开")}{stats.total}{ui("个探索方向，")}{stats.solved > 0 ? `其中 ${stats.solved} 个已完成` : ui("正在探索中")}
                </div>
              )}
            </div>

            {/* 当前阶段目标 */}
            <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
              <div className="text-[10px] font-medium text-emerald-400 mb-1.5">{ui("📍 当前阶段")}</div>
              <div className="text-[11px] text-slate-300">{projectAnalysis.currentPhase}</div>
            </div>

            {/* 探索进度 */}
            <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
              <div className="text-[10px] font-medium text-slate-400 mb-2">{ui("📊 探索进度")}</div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div><div className="text-sm font-bold text-emerald-400">{stats.solved}</div><div className="text-[8px] text-slate-500">{ui("已完成")}</div></div>
                <div><div className="text-sm font-bold text-yellow-400">{stats.exploring}</div><div className="text-[8px] text-slate-500">{ui("进行中")}</div></div>
                <div><div className="text-sm font-bold text-blue-400">{stats.unexplored}</div><div className="text-[8px] text-slate-500">{ui("待探索")}</div></div>
                <div><div className="text-sm font-bold text-orange-400">{stats.needsReview}</div><div className="text-[8px] text-slate-500">{ui("待决策")}</div></div>
              </div>
            </div>

            {/* 遇到的问题 */}
            {projectAnalysis.problems.length > 0 && (
              <div className="bg-orange-500/5 rounded-lg p-3 border border-orange-500/20">
                <div className="text-[10px] font-medium text-orange-400 mb-1.5">{ui("⚠️ 遇到的问题")}</div>
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
                <div className="text-[10px] font-medium text-emerald-400 mb-1.5">{ui("✅ 已验证发现")}</div>
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
                <div className="text-[10px] font-medium text-blue-400 mb-1.5">{ui("💡 改进建议")}</div>
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
                <div className="text-[10px] font-medium text-yellow-400 mb-2">{ui("⭐ 关键节点")}</div>
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
        {activeSection === 'findings' && (findings.length === 0 ? <div className="text-center py-8 text-[10px] text-slate-600">{ui("暂无研究发现")}</div> : findings.map((f, i) => (
          <div key={i} className="p-2.5 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <div className="flex items-start gap-2">
              <span className="text-sm">💡</span>
              <div className="flex-1"><div className="text-[11px] text-slate-200">{f.insight}</div><div className="text-[9px] text-slate-500 mt-1">{ui("来源:")}{f.sourceNodeTitle}</div></div>
            </div>
          </div>
        )))}
      </div>

      {/* 底部操作 */}
      <div className="p-4 border-t border-slate-800 space-y-2">
        <button onClick={isLooping ? onStopExploration : onStartExploration} className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${isLooping ? 'bg-red-600/20 text-red-400 border border-red-500/30' : 'bg-blue-600/20 text-blue-400 border border-blue-500/30'}`}>
          {isLooping ? <><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />{ui("停止探索")}</> : <>{ui("▶ 开始长期探索")}</>}
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
              title={!isExplorationComplete ? ui("请先完成所有探索") : ''}
            >
              {isGeneratingReport ? (
                <><div className="w-2 h-2 bg-white rounded-full animate-ping" />{ui("生成中...")}</>
              ) : (
                <>{ui("📄 生成研究报告")}{!isExplorationComplete && <span className="text-[9px] opacity-60">({stats.unexplored + stats.exploring}{ui("个待完成)")}</span>}</>
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
        <header className="p-6 border-b border-slate-800"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-xl">🤝</div><div><h2 className="text-lg font-bold text-white">{ui("需求对齐AI")}</h2><p className="text-xs text-slate-500">{ui("任务：")}{taskTitle}</p></div></div></header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => (<div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[80%] px-5 py-3.5 rounded-2xl text-[14px] whitespace-pre-wrap ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 rounded-tl-none'}`}>{m.text}</div></div>))}
          {isTyping && <div className="text-xs text-slate-500 animate-pulse">{ui("AI输入中...")}</div>}
        </div>
        <form onSubmit={handleSend} className="p-4 border-t border-slate-800"><div className="flex gap-2"><input value={input} onChange={e => setInput(e.target.value)} placeholder={ui("回复或同步进度...")} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none" /><button type="submit" className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl">{ui("发送")}</button></div></form>
      </div>
    </div>
  );
};

// 方向笔记模板；项目说明与摘要统一在项目总览中维护。
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

// 保留旧说明的原文和链接，统一进入项目总览。新项目仅创建一份摘要笔记。
function ensureOverview(project: Project): Project {
  const p = migrateProjectOverview(project);
  if (p.nodes.some(n => n.noteType === 'overview')) return p;
  const overview: ProblemNode = { id: uuidv4(), title: '项目总览', noteType: 'overview', status: NodeStatus.SOLVED, confidence: 1, dependencies: [], notes: '', chatHistory: [], agentResults: [], fullNote: '', noteUpdatedAt: Date.now() };
  return { ...p, nodes: [overview, ...p.nodes] };
}

// --- 主应用 ---
const App: React.FC = () => {
  const nativeIOS = platform() === 'ios';
  const { language, setLanguage } = useLanguage();
  const [user, setUser] = useState(auth.getUser());
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  useEffect(() => { const h = () => setCurrentHash(window.location.hash); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  const routeInfo = useMemo(() => { if (currentHash.startsWith('#/delegate/')) { const parts = currentHash.split('/'); return { type: 'delegate', nodeId: parts[2]?.split('?')[0], taskTitle: new URLSearchParams(currentHash.split('?')[1] || '').get('task') || '未知任务' }; } return { type: 'main' }; }, [currentHash]);

  // 主题：白天 / 深色
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    try { return (localStorage.getItem('aae-theme') as 'dark' | 'light' | 'system') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => document.documentElement.classList.toggle('light', theme === 'light' || (theme === 'system' && media.matches));
    apply(); media.addEventListener('change', apply);
    try { localStorage.setItem('aae-theme', theme); } catch {}
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [showProjectSync, setShowProjectSync] = useState(false);
  const [projectSyncStatus, setProjectSyncStatus] = useState('');
  const inquiryTeams = useInquiryTeams(projects, setProjects, user?.username);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [isLoginAsAdmin, setIsLoginAsAdmin] = useState(false);
  const [landingLogin, setLandingLogin] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'wechat' | 'phone' | 'email'>('email'); // 登录方式
  const [pwMode, setPwMode] = useState(() => { try { return localStorage.getItem('hx-login-mode') === 'password'; } catch { return false; } }); // 密码登录
  const [loginPassword, setLoginPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  // 打开登录页时按上次 / 刚设好的习惯选「验证码」还是「密码」
  useEffect(() => { if (!user) { try { setPwMode(localStorage.getItem('hx-login-mode') === 'password'); } catch { /* ignore */ } } }, [user, landingLogin]);
  // 记住登录：验证码登录的令牌快过期时悄悄续上
  useEffect(() => { if (user?.email) void auth.refreshIfNeeded(); }, [user?.email]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [metaInput, setMetaInput] = useState('');
  const [showSharedModels, setShowSharedModels] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [cloudStats, setCloudStats] = useState<UserStats[]>([]);
  const [isBackendAdmin, setIsBackendAdmin] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<'stats' | 'models' | 'users' | 'deals'>('users');
  useEffect(() => {
    let active = true;
    setIsBackendAdmin(false);
    const check = () => {
      if (!user || !SHARED_API) return;
      sharedRequest<{ isAdmin: boolean }>('/shared/session').then(s => { if (active) setIsBackendAdmin(s.isAdmin); }).catch(() => { if (active) setIsBackendAdmin(false); });
    };
    check(); window.addEventListener('focus', check);
    return () => { active = false; window.removeEventListener('focus', check); };
  }, [user]);
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
  const handleDeleteProject = useCallback(async (projectId: string, confirmed = false) => {
    if (projects.length <= 1) {
      alert('至少保留一个项目');
      return;
    }
    if (!confirmed && !confirm('确定要删除这个项目吗？此操作不可恢复。')) return;
    const deleting = projects.find(p => p.id === projectId);
    try { if (deleting) await pauseCloudProject(deleting); }
    catch { alert('无法确认云端已停止，暂未删除项目。请恢复连接后重试，避免项目删除后后台仍继续调用模型。'); return; }
    setProjects(prev => prev.filter(p => p.id !== projectId));
    if (currentProjectId === projectId) {
      const remaining = projects.filter(p => p.id !== projectId);
      setCurrentProjectId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [projects, currentProjectId]);

  const [notesPanelMode, setNotesPanelMode] = useState<number>(() => window.innerWidth < 768 ? 0 : 1);
  const [sidebarWidth, setSidebarWidth] = useState<number>(320); // 可调节的侧边栏宽度
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [projectPage, setProjectPage] = useState<{ projectId: string; scopeId: string; page: ProjectPage } | null>(null);
  const [notesSearch, setNotesSearch] = useState('');
  const [showGraphModal, setShowGraphModal] = useState(false); // 图谱弹出层
  const [showFeedback, setShowFeedback] = useState(false); // 反馈弹窗
  const [showServiceMarket, setShowServiceMarket] = useState(false);
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
  const [rightChatOpen, setRightChatOpen] = useState(false);     // 右侧 AI 对话栏
  const [rightChatWidth, setRightChatWidth] = useState(360);
  // 布局：中间是对话（交互和决策都在这），右侧是笔记 / 项目总览，只用来看内容
  const [noteOpen, setNoteOpen] = useState(() => { try { return window.innerWidth >= 768; } catch { return true; } });
  const [noteWidth, setNoteWidth] = useState(560);
  /** 事实看板里「找合作 Agent 验证」带过来的那条事实 */
  const [marketSeek, setMarketSeek] = useState<HelpSeek | null>(null);
  const [isMobileWidth, setIsMobileWidth] = useState(() => { try { return window.innerWidth < 768; } catch { return false; } });
  useEffect(() => {
    const onResize = () => setIsMobileWidth(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // 仪表盘点 Agent → 打开群聊并把 @某某 塞进输入框（nonce 保证同一个 Agent 连点两次也生效）
  const [chatPrefill, setChatPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const mentionAgentInChat = useCallback((agent: string) => {
    setRightChatOpen(true);
    setChatPrefill({ text: `@${agent} `, nonce: Date.now() });
  }, []);
  const [nodes, setNodes] = useState<ProblemNode[]>([]);
  const nodesRef = useRef<ProblemNode[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const workspaceEpochRef = useRef(0);
  const projectHydrationRef = useRef<{ nodes: ProblemNode[]; cards: KnowledgeCard[]; findings: ResearchFinding[] } | null>(null);
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
  // 决策节点持久化（重点功能）：记录弹窗草稿 + 项目级时间线
  const [decisionDraft, setDecisionDraft] = useState<(DecisionDraft & { projectId: string; pendingAction?: 'delete' | 'invalidate' }) | null>(null);
  const [showDecisionTimeline, setShowDecisionTimeline] = useState(false);
  
  // 通知已并入右侧对话流（project.feed），这里只保留「只看重要」这个偏好
  const [notificationMode, setNotificationMode] = useState<'all' | 'important'>(() => { try { return localStorage.getItem('aae-notification-mode') === 'important' ? 'important' : 'all'; } catch { return 'all'; } });
  useEffect(() => { try { localStorage.setItem('aae-notification-mode', notificationMode); } catch {} }, [notificationMode]);
  
  // 服务端核验的会员状态与收费入口
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
  // AI管家聊天记录（持久化到项目中）
  const [butlerChatHistory, setButlerChatHistory] = useState<ChatMessage[]>([]);
  
  const isLoopingRef = useRef(false);
  const isProcessingRef = useRef(false);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
  // 连写一轮：连着写一批（默认 5 篇）再停下来给汇总；不再 7×24 无限写
  const [continuousMode, setContinuousMode] = useState(false);
  const continuousModeRef = useRef(false);
  const isProposingRef = useRef(false);
  const runExplorationCycleRef = useRef<(() => void) | null>(null);
  useEffect(() => { continuousModeRef.current = continuousMode; }, [continuousMode]);
  // 「连写一轮」：continuousMode 现在表示「正在连写一轮」，batchRef 记这一轮写了什么
  const batchRef = useRef<Batch | null>(null);
  const endBatchRef = useRef<((reason: 'done' | 'empty' | 'stopped' | 'halted') => void) | null>(null);
  const MAX_AUTO_NODES = 50;
  // 「总览优先」：探索一开始先写总览，之后每解决若干节点自动刷新一次
  const overviewRefreshingRef = useRef(false);
  /** 每个项目上一次「开跑时写总览」的时间（避免一篇一停时每篇都多调一次模型） */
  const overviewStartAtRef = useRef<Record<string, number>>({});
  const solvedSinceOverviewRef = useRef(0);
  const OVERVIEW_REFRESH_EVERY = 3; // 每解决 3 个节点刷新一次总览

  // ===== 验证触发器：判断「什么时候该停止推理、去问现实」=====
  // recentTitlesRef 记录已出现过的节点标题，用来发现 AI 在原地打转（新方向都是老调重弹）
  const recentTitlesRef = useRef<string[]>([]);
  const emptyRoundsRef = useRef(0);          // 连续多少轮没产出新子问题
  const realityPromptedRef = useRef(false);  // 「剩下的全在等现实」这句话不重复刷屏
  // 假设被现实推翻 → 打开决策记录弹窗。用 ref 是因为探索循环定义在决策相关逻辑之前。
  const contradictedDecisionRef = useRef<((nodeId: string) => void) | null>(null);
  // 探索路线：循环要读它来决定"现在允许跑哪一段"，也要在到点时把锚点转成等待
  // 框架与节奏：探索循环要按用户排好的顺序走、写完一篇要停下来，都靠这两个 ref
  const outlineRef = useRef<Outline | undefined>(undefined);
  const paceRef = useRef<ExplorationPace>('step');
  /** 项目列表的最新快照（回调里读它，避免把 projects 加进依赖导致回调每次重建） */
  const projectsRef = useRef<Project[]>([]);
  /** 用户点了某一篇的「▶ 写这一篇」：下一轮优先写它，写完即清空 */
  const forceNodeRef = useRef<string | null>(null);
  const proposeOutlineRef = useRef<((projId?: string, goal?: string) => void) | null>(null);

  const routeRef = useRef<ExplorationRoute | undefined>(undefined);
  const reachAnchorRef = useRef<((anchorId: string) => void) | null>(null);
  const anchorPromptedRef = useRef<string | null>(null);   // 同一个锚点只提醒一次
  const settleAnchorRef = useRef<((id: string, v: 'pass' | 'fail' | 'unclear', s: string, o?: 'human' | 'probe') => void) | null>(null);

  // Membership is server-authoritative; legacy localStorage purchases grant no access.
  useEffect(() => {
    let active = true;
    setIsPremiumUser(false);
    const refresh = async () => {
      if (!user || !BILLING_API) return;
      try {
        const account = await billingRequest<BillingAccount>('/billing/account');
        if (active) setIsPremiumUser(account.plan === 'pro' && account.proUntil > Date.now());
      } catch { if (active) setIsPremiumUser(false); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener(BILLING_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener(BILLING_CHANGED, refresh); window.removeEventListener('focus', refresh); };
  }, [user]);

  // ===== 对话流（像 Codex 一样）=====
  // 进度和需要人拍板的地方，都以一行字 / 一张问题卡进右侧聊天记录，不再走铃铛和弹窗。
  const feedProjectRef = useRef<string | null>(null);
  const pmActRef = useRef<((node: ProblemNode) => void) | null>(null);
  /** 卡在现实那一步：AI 选发问卷 / 做预售页 / 查企业 / 去服务广场 */
  const realityRef = useRef<((node: ProblemNode, force?: RealityKind) => void) | null>(null);
  useEffect(() => { feedProjectRef.current = currentProjectId; }, [currentProjectId]);
  // 项目钱包：每次模型调用都记到对应项目的账上（后台醒来看一眼的记到被叫醒的那个项目）
  useEffect(() => { setDefaultMeterProject(() => feedProjectRef.current || null); }, []);
  // 大家在研究什么：项目的问题报给后台（每个问题只报一次；体验用户也报，登录页写明了）
  useEffect(() => { if (!user) return; const t = setTimeout(() => void logQuestions(projectsRef.current), 8000); return () => clearTimeout(t); }, [user, projects.length, projects.map(p => p.metaProblem).join('|')]);
  useEffect(() => onModelUsage((u, pid) => {
    const id = pid || feedProjectRef.current;
    if (!id) return;
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, wallet: addModelSpend(p.wallet, u) } : p)));
  }), []);
  const patchFeed = useCallback((fn: (feed: FeedItem[] | undefined) => FeedItem[], projectId?: string) => {
    const pid = projectId || feedProjectRef.current;
    if (!pid) return;
    setProjects(prev => prev.map(p => (p.id === pid ? { ...p, feed: fn(p.feed) } : p)));
  }, []);
  // ===== 自主运行：AI 当自己是个独立的人 =====
  /** 把一件事记进自主运行日志（只在项目授权了自主运行时记；用户回来时汇报的原料） */
  const noteAutoRef = useRef<((kind: AutoLogEntry['kind'], text: string, nodeId?: string, projectId?: string) => void) | null>(null);
  const noteAuto = useCallback((kind: AutoLogEntry['kind'], text: string, nodeId?: string, projectId?: string) => {
    const pid = projectId || feedProjectRef.current;
    if (!pid || !isAutonomous(projectsRef.current.find(p => p.id === pid))) return;
    projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, autolog: logAuto(p.autolog, kind, text, nodeId) } : p));
    setProjects(prev => prev.map(p => (p.id === pid ? { ...p, autolog: logAuto(p.autolog, kind, text, nodeId) } : p)));
  }, []);
  useEffect(() => { noteAutoRef.current = noteAuto; }, [noteAuto]);
  const patchAutonomy = useCallback((pid: string, patch: Partial<Autonomy> | null) => {
    const apply = (p: Project): Project => (p.id !== pid ? p : { ...p, autonomy: patch === null ? undefined : { ...(p.autonomy as Autonomy), ...patch } });
    projectsRef.current = projectsRef.current.map(apply);
    setProjects(prev => prev.map(apply));
  }, []);
  /** 自主运行时，不重要的问题卡 AI 自己答（答案标「🤖 我自己决定」），重要的才留给你 */
  const answerFeedRef = useRef<((item: FeedItem, optionId: string, text?: string, why?: string) => void) | null>(null);
  /** 平台模型的钱包价（分 / 百万 Token）：算自主运行花了多少 */
  const modelPricesRef = useRef<Record<string, number>>({});
  /** 平台模型目录（AI 换模型时看：哪些能用、多少钱、账上还有多少） */
  const modelCatalogRef = useRef<SharedCatalog | null>(null);
  useEffect(() => {
    if (!SHARED_API) return;
    const load = () => sharedRequest<SharedCatalog>('/shared/catalog').then(c => { modelCatalogRef.current = c; modelPricesRef.current = Object.fromEntries(c.models.map(m => [m.id, m.priceCentsPerM || 0])); }).catch(() => {});
    void load();
    const t = window.setInterval(load, 5 * 60_000);
    window.addEventListener(SHARED_MODELS_CHANGED, load); window.addEventListener(BILLING_CHANGED, load);
    return () => { clearInterval(t); window.removeEventListener(SHARED_MODELS_CHANGED, load); window.removeEventListener(BILLING_CHANGED, load); };
  }, []);
  // AI 自己换模型：按这件活的难度 + 项目的用模型策略，在平台模型里挑；换了就记进自主运行日志
  const lastRouteRef = useRef<Record<string, string>>({});
  useEffect(() => {
    setModelRouter((task: TaskLevel) => {
      const c = modelCatalogRef.current; if (!c) return undefined;
      const pid = feedProjectRef.current;
      const proj = projectsRef.current.find(p => p.id === pid);
      const r = pickModel(task, { models: c.models, balances: c.balances || {}, walletCents: c.walletCents || 0, defaultId: loadLLMSettings().model, policy: proj?.modelPolicy });
      if (r && pid && lastRouteRef.current[`${pid}:${task}`] !== r.modelId) {
        lastRouteRef.current[`${pid}:${task}`] = r.modelId;
        if (task !== 'normal') setTimeout(() => noteAutoRef.current?.('think', `${task === 'hard' ? '难的活' : '简单的活'}换成「${r.label}」来做（${r.why}）`, undefined, pid), 0);
      }
      return r;
    });
    return () => setModelRouter(null);
  }, []);

  /** 自主运行中默认安静：不播报「第几步 / 做了几轮」，过程只记进日志，回来时汇报 */
  const quietAuto = (pid?: string | null) => isRunningAutonomously(projectsRef.current.find(p => p.id === (pid || feedProjectRef.current)));
  const pushFeedItem = useCallback((item: FeedItem, projectId?: string) => {
    const pid = projectId || feedProjectRef.current;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (item.kind === 'ask' && item.ask && item.ask.type !== 'report' && item.ask.type !== 'digest' && isRunningAutonomously(proj)) {
      const c = autoChoice(item.ask.type, item.ask.options.map(o => o.id));
      if (c && pid === feedProjectRef.current) {
        // AI 自己拿主意的卡不进对话流（只记日志），不刷屏
        setTimeout(() => answerFeedRef.current?.(item, c.option, undefined, c.why), 30);
        return;
      }
      noteAuto(item.ask.type === 'halted' ? 'stuck' : 'need', item.text, item.nodeId, pid || undefined);
    } else if (item.kind === 'status' && isAutonomous(proj) && (item.tone === 'good' || item.tone === 'warn') && !item.text.startsWith('↻')) {
      noteAuto(item.tone === 'good' ? 'did' : 'stuck', item.text, item.nodeId, pid || undefined);
    }
    patchFeed(f => pushFeed(f, item), projectId);
    // 有问题要问你，就把对话栏打开——不然问题卡挂在收起的栏里等于没问
    if (item.kind === 'ask') setRightChatOpen(true);
  }, [patchFeed, noteAuto]);
  const closeFeedAsks = useCallback((type: Parameters<typeof closeAsks>[1], label?: string, nodeId?: string) => {
    patchFeed(f => closeAsks(f, type, label, nodeId));
  }, [patchFeed]);

  // 老的通知入口：原样保留签名，现在落成对话流里的一行字
  const addNotification = useCallback((type: 'discovery' | 'warning' | 'info', title: string, message: string) => {
    pushFeedItem(feedStatus(title, { detail: message || undefined, tone: type === 'warning' ? 'warn' : type === 'discovery' ? 'good' : 'info' }));
  }, [pushFeedItem]);

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
    setRightChatOpen(true);
    if (notesPanelMode === 0) setNotesPanelMode(1);
  }, [notesPanelMode]);

  useEffect(() => {
    setLoadedOwner(null); setShowProjectSync(false); setProjectSyncStatus('');
    if (!user) { setProjects([]); setCurrentProjectId(null); return; }
    let cancelled = false;
    (async () => {
      let p: Project[] | undefined;
      try { p = await loadWorkspace(user.username); } catch { p = undefined; }
      if (cancelled) return;
      const list = (Array.isArray(p) ? p : []).map(ensureOverview).map(project => ensureWorktree({ ...project, inquiries: Object.fromEntries(Object.entries(project.inquiries || {}).map(([id, workspace]) => [id, recoverInquiry(workspace)])) }));
      setProjects(list);
      setLoadedOwner(user.username);
      setCurrentProjectId(null);
      if (list.length === 0) setShowMetaModal(true);
    })();
    return () => { cancelled = true; };
  }, [user?.username]);
  useEffect(() => { if (user) { markMilestone('funnel_entered_app'); monitor.incrementSession(); const i = setInterval(() => monitor.updateHeartbeat(), 10000); return () => clearInterval(i); } }, [user]);
  // 登录后：把用户身份同步给聊天挂件 + 记一次登录事件（未配置统计/聊天时均为空操作）
  useEffect(() => { if (user) { identifyChatUser(user.username, user.email); trackEvent('login'); } }, [user?.username]);

  const currentProject = useMemo(() => projects.find(p => p.id === currentProjectId) || null, [projects, currentProjectId]);
  // 项目视图：当前项目用实时 nodes，其它项目用各自保存的 nodes（供左侧项目树使用）
  const projectsView = useMemo(() => projects.map(p => p.id === currentProjectId ? { ...p, nodes } : p), [projects, currentProjectId, nodes]);
  const activeProjectPage = selectedNodeId && nodes.some(n => n.id === selectedNodeId && isOverviewNote(n)) ? { scopeId: 'root', page: 'research' as ProjectPage } : projectPage?.projectId === currentProjectId ? projectPage : { scopeId: 'root', page: 'research' as ProjectPage };
  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId && !isOverviewNote(n)) || null, [nodes, selectedNodeId]);
  useEffect(() => {
    if (currentProjectId && nodes.some(n => n.id === selectedNodeId && isOverviewNote(n))) {
      setProjectPage({ projectId: currentProjectId, scopeId: 'root', page: 'research' });
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, currentProjectId, nodes]);
  const decisionNode = useMemo(() => decision ? nodes.find(n => n.id === decision.nodeId) || null : null, [decision, nodes]);
  const filteredNodes = useMemo(() => { if (!focusedNodeId) return nodes; const vis = new Set<string>([focusedNodeId]); const findA = (id: string) => { const n = nodes.find(x => x.id === id); if (n) n.dependencies.forEach(d => { if (!vis.has(d)) { vis.add(d); findA(d); } }); }; const findD = (id: string) => { nodes.forEach(n => { if (n.dependencies.includes(id) && !vis.has(n.id)) { vis.add(n.id); findD(n.id); } }); }; findA(focusedNodeId); findD(focusedNodeId); return nodes.filter(n => vis.has(n.id)); }, [nodes, focusedNodeId]);
  const criticalNodes = useMemo(() => nodes.filter(n => n.isCritical), [nodes]);

  useEffect(() => { if (user && loadedOwner === user.username) saveWorkspace(user.username, projects).catch(() => setProjectSyncStatus(ui('本地保存失败，请保留此页面并检查设备空间', 'Local save failed. Keep this page open and check storage.'))); }, [projects, user?.username, loadedOwner]);
  useEffect(() => {
    const p = projects.find(x => x.id === currentProjectId);
    if (p) {
      const loaded = { nodes: p.nodes || [], cards: p.knowledgeCards || [], findings: p.researchFindings || [] };
      projectHydrationRef.current = loaded;
      workspaceEpochRef.current++;
      setSelectedNodeId(pendingSelectRef.current); pendingSelectRef.current = null;
      setFocusedNodeId(null); setDecision(null); setDecisionDraft(null);
      setNodes(loaded.nodes); setKnowledgeCards(loaded.cards); setResearchFindings(loaded.findings);
      batchRef.current = null; setIsLooping(false); setContinuousMode(false); setResearchReport(null);
      recentTitlesRef.current = loaded.nodes.map(n => n.title).slice(-60);
      emptyRoundsRef.current = 0; realityPromptedRef.current = false;
    } else if (projects.length > 0 && !currentProjectId) setCurrentProjectId(projects[0].id);
  }, [currentProjectId, projects.length]);
  useEffect(() => { const h = projectHydrationRef.current; if (h && nodes !== h.nodes) return; if (currentProjectId && nodes.length > 0) setProjects(prev => { const i = prev.findIndex(p => p.id === currentProjectId); if (i === -1 || prev[i].nodes === nodes) return prev; const n = [...prev]; n[i] = { ...n[i], nodes }; return n; }); }, [nodes, currentProjectId]);
  useEffect(() => { const h = projectHydrationRef.current; if (h && (knowledgeCards !== h.cards || researchFindings !== h.findings)) return; if (currentProjectId && currentProject?.explorationMode === 'research') setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, knowledgeCards, researchFindings } as any : p)); }, [knowledgeCards, researchFindings, currentProjectId]);
  

  useEffect(() => { const h = projectHydrationRef.current; if (h && nodes === h.nodes && knowledgeCards === h.cards && researchFindings === h.findings) projectHydrationRef.current = null; }, [nodes, knowledgeCards, researchFindings]);

  const addNode = useCallback((title: string, deps: string[] = [], notes = "", anchorId?: string) => { const n: ProblemNode = { id: uuidv4(), title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: deps, notes, chatHistory: [], agentResults: [], anchorId }; setNodes(prev => [...prev, n]); return n; }, []);
  const updateNode = useCallback((id: string, u: Partial<ProblemNode>) => setNodes(prev => prev.map(n => n.id === id ? { ...n, ...u } : n)), []);
  const createProjectWithMode = useCallback((input: string, mode: ExplorationMode, analysis?: IntentAnalysis) => { markMilestone('funnel_project_created'); const p: Project = { id: uuidv4(), name: analysis?.suggestedTitle || input.slice(0, 15), metaProblem: input, createdAt: Date.now(), explorationMode: mode, intentAnalysis: analysis, nodes: [{ id: uuidv4(), title: input, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [], notes: "", chatHistory: [], agentResults: [] }] }; setProjects(prev => [...prev, ensureWorktree(ensureOverview(p))]); setCurrentProjectId(p.id); setPendingIntent(null); setMetaInput(''); setShowMetaModal(false);
    // 新项目不再直接开跑，先拟一份目录跟用户对齐——这是整个节奏改造的入口
    setTimeout(() => proposeOutlineRef.current?.(p.id, input), 300);
  }, []);

  // 探索重试计数
  const retryCountRef = useRef<Record<string, number>>({});
  const MAX_RETRIES = 3;
  /**
   * 跨节点的连续失败计数。
   * 原来的重试只按「单个节点」计数：后端整体挂掉时，循环会把每个节点各重试 3 次、
   * 标记待人工、再换下一个继续，持续模式还会每 8 秒自主提新方向造出新的失败目标——
   * 等于对着一个已经死掉的后端做永动机。（实测 24 小时打出 2973 次全失败调用。）
   * 连续失败达到阈值就判定为「链路问题」，直接停循环。
   */
  const consecutiveFailRef = useRef(0);
  const MAX_CONSECUTIVE_FAILS = 3;

  /**
   * 无人看管预算。
   * 成本核查发现：2026-07 函数计算执行了约 83 小时（约合一两万次模型调用），
   * 而同期只有 40 个访客——这些调用绝大多数是 7×24 循环在没人看结果时自己跑出来的。
   * 钱花在了「真实但无人查看」的探索上，这是最大的一笔浪费。
   *
   * 做法不是砍掉 7×24（那是产品卖点），而是给它一个预算：
   * 连续跑够 N 次探索且期间没有任何用户操作，就暂停并询问是否继续。
   * 用户只要动一下（点节点、切项目等）计数就归零，正常使用完全不受影响。
   */
  const unattendedRef = useRef(0);
  const UNATTENDED_BUDGET = 30;

  /** 判断错误是否属于「重试也没用」的链路级故障 */
  const isInfraFailure = (e: any): boolean => {
    if (e?.name === 'TrialQuotaError') return true;
    const msg = String(e?.message || e);
    return /Failed to fetch|NetworkError|ERR_|AccessDenied|欠费|HTTP (401|402|403|429|5\d\d)/i.test(msg);
  };

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
        // 自主提的新方向也要挂在当前这一段上，不然它会绕过路线闸门
        addNode(title, overview ? [overview.id] : [], '', currentAnchor(routeRef.current)?.id);
        addNotification('discovery', '🧭 自主提出新方向', title);
      }
    } catch { /* 提方向失败就下次再试 */ }
    finally { isProposingRef.current = false; }
  }, [nodes, currentProject, addNode, addNotification]);

  // 「总览优先」：把当前已探索到的内容合成/刷新为「项目总览」正文。
  // 用户手动编辑过总览（autoNote===false）则不再覆盖，尊重人的编辑。
  const refreshOverview = useCallback(async (reason: 'start' | 'progress' = 'progress') => {
    if (overviewRefreshingRef.current) return;
    const overview = nodes.find(n => n.noteType === 'overview');
    if (!overview) return;
    if (overview.autoNote === false) return; // 用户已接管，不自动覆盖
    const goal = currentProject?.metaProblem || currentProject?.name || '';
    const name = currentProject?.name || goal.slice(0, 16) || '项目';
    const statusZh = (s: NodeStatus) =>
      s === NodeStatus.SOLVED ? '已完成'
      : s === NodeStatus.EXPLORING ? '探索中'
      : s === NodeStatus.NEEDS_REVIEW ? '待人工复核'
      : s === NodeStatus.VALIDATING ? '等现实验证'
      : s === NodeStatus.CONTRADICTED ? '已被现实推翻'
      : s === NodeStatus.INVALID ? '已终止' : '待探索';
    const directions = nodes
      .filter(n => n.noteType === 'direction' || (!n.noteType))
      .map(n => ({ title: n.title, status: statusZh(n.status), note: n.notes || n.fullNote || '' }));
    const findings = researchFindings.map(f => f.insight).filter(Boolean);
    const cards = knowledgeCards.map(c => c.title).filter(Boolean);
    overviewRefreshingRef.current = true;
    const overviewEpoch = workspaceEpochRef.current;
    try {
      const md = await asTask('simple', () => synthesizeOverview(name, goal, directions, findings, cards));
      if (md && md.trim().length > 20) {
        if (overviewEpoch !== workspaceEpochRef.current) return;
        setNodes(prev => prev.map(n => n.id === overview.id && n.autoNote !== false ? { ...n, fullNote: md.trim(), autoNote: true, noteUpdatedAt: Date.now() } : n));
        solvedSinceOverviewRef.current = 0;
        // 总览是后台默默更新的，不在对话流里刷一行
      }
    } catch (e) {
      console.warn('[总览] 合成失败', e);
    } finally {
      overviewRefreshingRef.current = false;
    }
  }, [nodes, currentProject, researchFindings, knowledgeCards, updateNode, addNotification]);
  const refreshOverviewRef = useRef(refreshOverview);
  useEffect(() => { refreshOverviewRef.current = refreshOverview; }, [refreshOverview]);

  const cloudGateRef = useRef(false);
  const runExplorationCycle = useCallback(async () => {
    if (decision || isProcessingRef.current || !isLoopingRef.current) return;
    if (cloudGateRef.current) return;
    cloudGateRef.current = true;
    try {
      if (currentProject) await assertBrowserResearchAllowed(currentProject, 'root');
    } catch (e) {
      setIsLooping(false); addNotification('info', '浏览器探索已暂停', e instanceof Error ? e.message : '无法核对云端状态'); return;
    } finally { cloudGateRef.current = false; }
    if (!isLoopingRef.current) return;
    
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
    
    // 有路线时只允许跑当前段——这就是"到锚点自动暂停"：
    // 后面几段的节点还没被创建，当前段又探完了，循环自然没得跑。
    const route = routeRef.current;
    const allowed = explorableNodes(nodes, route);
    if (unexplored && route && !allowed.some(n => n.id === unexplored!.id)) unexplored = undefined;
    if (!unexplored) {
      // ① 用户刚点了某一篇的「▶ 写这一篇」——他的指定永远优先
      const forced = forceNodeRef.current;
      if (forced) {
        const hit = allowed.find(n => n.id === forced);
        if (hit) unexplored = hit;
        forceNodeRef.current = null;
      }
    }
    if (!unexplored) {
      // ② 有框架就按框架的顺序写：用户在框架阶段排过序、挑过「先写哪篇」，那个顺序必须算数，
      //    否则他确认完框架、AI 却从第四篇开始写，前面那一步的对齐就白做了。
      const wantId = outlineProgress(outlineRef.current, nodes).next?.nodeId;
      unexplored = (wantId ? allowed.find(n => n.id === wantId) : undefined) || allowed[0];
    }

    if (!unexplored) {
      if (!nodes.some(n => n.status === NodeStatus.EXPLORING)) {
        // ① 到路标了：这一段推理做完了，接下来必须由现实说话
        const cur = currentAnchor(route);
        if (cur && legReady(nodes, cur) && cur.status === 'pending') {
          reachAnchorRef.current?.(cur.id);
          setIsLooping(false);
          pushFeedItem(anchorAsk(cur.id, cur.title, cur.question, anchorBrief(cur)));
          trackEvent('anchor_reached');
          markMilestone('funnel_anchor_reached');
          return;
        }
        // ② 已经在等这个路标的结果了，别空转
        const waiting = isWaitingAtAnchor(route);
        if (waiting) {
          setIsLooping(false);
          if (anchorPromptedRef.current !== waiting.id) {
            anchorPromptedRef.current = waiting.id;
            pushFeedItem(anchorAsk(waiting.id, waiting.title, waiting.question, anchorBrief(waiting)));
          }
          return;
        }
        // 推理这条路走到头了：剩下的节点全都在等现实反馈 → 这时候才该叫人。
        // （单个节点命中触发器不停循环，见下面；只有"全员卡在现实"才值得打断用户）
        if (isBlockedOnReality(nodes)) {
          const queue = realityQueue(nodes);
          setIsLooping(false);
          if (!realityPromptedRef.current) {
            realityPromptedRef.current = true;
            pushFeedItem(realityAsk(queue));
          }
          trackEvent('explore_halted', { reason: 'awaiting_reality' });
          return;
        }
        // 连写一轮时没得写了：这一轮到此为止，给一张汇总卡。
        // （以前的 7×24 会在这里自己提新方向无限写下去——产出远超人能看的速度，已去掉；长期关注交给「醒来看一眼」）
        if (continuousModeRef.current) {
          endBatchRef.current?.('empty');
        } else {
          setIsLooping(false);
          pushFeedItem(feedStatus('🎉 这一轮的步骤都推进完了，可以生成阶段报告，或者拆下一轮', { tone: 'good' }));
        }
      }
      return;
    }
    
    // 无人看管预算：跑够额度就停下来问一句，避免整夜空跑烧钱
    if (unattendedRef.current >= UNATTENDED_BUDGET) {
      setIsLooping(false);
      pushFeedItem(unattendedAsk(UNATTENDED_BUDGET));
      trackEvent('explore_halted', { reason: 'unattended_budget' });
      return;
    }
    unattendedRef.current += 1;

    isProcessingRef.current = true;
    const cid = unexplored.id;
    const nodeTitle = unexplored.title;
    updateNode(cid, { status: NodeStatus.EXPLORING });
    // 开始写了 = 之前挂着的「下一篇？/ 还在看吗？/ 已暂停」都过时了，顺手收掉
    {
      const closed = (f: FeedItem[] | undefined) => closeAsks(closeAsks(closeAsks(f, 'step', '已继续'), 'unattended', '已继续'), 'halted', '已恢复');
      if (quietAuto()) patchFeed(closed);
      else patchFeed(f => pushFeed(closed(f),
        // 连写时对话流里只有一行进度（原地更新），不每篇刷一行
        batchRef.current ? batchProgress(batchRef.current, nodeTitle) : feedStatus(`🔧 正在做「${nodeTitle}」`, { key: `write:${cid}`, nodeId: cid }),
      ));
    }
    // 用户在对话流里补过一句要求 → 这一次带进提示词（走「已有背景」那一栏），写完清空
    // 再加上 AI 记忆里用户交代过的关键信息（预算、手上的资源、目标人群……），写的时候按用户原话来
    const memoProj = projectsRef.current.find(p => p.id === feedProjectRef.current);
    const memo = keyInfoContext(memoProj?.keyInfo, 1200);
    // 告诉模型它在服务广场真实能做什么，不然它会以为自己「登录不了、只能模拟」
    const marketNote = memoProj ? marketCapability(memoProj, (() => { try { return !!WAKE_API && !!localStorage.getItem('aae-auth-token'); } catch { return false; } })()) : '';
    // 研究型项目：先找几篇真论文给它引用（OpenAlex，免费），减少编造文献
    const logged = (() => { try { return !!WAKE_API && !!localStorage.getItem('aae-auth-token'); } catch { return false; } })();
    const papersNote = memoProj && logged && memoProj.explorationMode === 'research' && unexplored.noteType !== 'simulation'
      ? await meterFor(memoProj.id, () => paperNoteFor(memoProj.metaProblem || memoProj.name, unexplored.title, async m => (await callLLM(m as any, { maxTokens: 60, timeoutMs: 30000, task: 'simple' })).content))
      : '';
    const extra = [unexplored.userAsk ? `用户要求：${unexplored.userAsk}` : '', memo, marketNote, papersNote].filter(Boolean).join('\n');
    const target: ProblemNode = extra
      ? { ...unexplored, notes: `${unexplored.notes ? unexplored.notes + '\n' : ''}${extra}` }
      : unexplored;
    
    try {
      try { if (currentProject) await assertBrowserResearchAllowed(currentProject, cid); }
      catch (e) { setIsLooping(false); updateNode(cid, { status: NodeStatus.UNEXPLORED }); isProcessingRef.current = false; addNotification('info', '浏览器探索已暂停', e instanceof Error ? e.message : '无法核对云端状态'); return; }
      if (!isLoopingRef.current) { updateNode(cid, { status: NodeStatus.UNEXPLORED }); return; }
      const isResearch = currentProject?.explorationMode === 'research';
      
      // 添加超时控制
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('API调用超时')), 60000)
      );
      
      // 这一步有多难：岔路口自己拿主意、出过错在重做、拿现实结果重新推进 → 难的活，换强模型
      const stepLevel: TaskLevel = unexplored.autoDecided || (retryCountRef.current[cid] || 0) > 0 || /现实结果|岔路口/.test(unexplored.userAsk || '') ? 'hard' : 'normal';
      const explorationPromise = asTask(stepLevel, async () => isResearch 
        ? exploreResearchNode(target, nodes, (c: KnowledgeCard) => {
            // 知识卡片自己有地方看，不再逐条刷进对话流
            setKnowledgeCards(p => [...p, c]);
          }, (f: ResearchFinding) => {
            setResearchFindings(p => [...p, f]);
            if (f.importance === 'high') {
              addNotification('discovery', '🔥 重要发现', f.insight.slice(0, 50) + '...');
            }
          }, questionFactContext(currentProject?.inquiries, unexplored.id))
        : exploreNode(target, nodes, questionFactContext(currentProject?.inquiries, unexplored.id)));
      
      const result = await Promise.race([explorationPromise, timeoutPromise]) as any;
      
      if (!isLoopingRef.current) { 
        updateNode(cid, { status: NodeStatus.UNEXPLORED }); 
        isProcessingRef.current = false; 
        return; 
      }
      
      // 简化：不再单独调用 identifyNodeTask，直接使用结果中的 taskType
      const taskType = result.taskType || 'research';

      // ===== 验证触发器：这一轮到底有没有产生新信息？=====
      const newTitles: string[] = (result.subProblems || []).map((sp: any) => sp.title).filter(Boolean);
      if (newTitles.length === 0) emptyRoundsRef.current += 1;
      else emptyRoundsRef.current = 0;
      const recentTitles = recentTitlesRef.current.slice();
      // 记下本轮标题（含当前节点），供后续查重；只留最近 60 条，避免无限增长
      recentTitlesRef.current = [...recentTitles, nodeTitle, ...newTitles].slice(-60);

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
              // 子问题跟着父节点走同一段路，否则路线会漏掉它们
              anchorId: unexplored!.anchorId,
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
        if (batchRef.current) batchRef.current.newDirs += result.subProblems.length;
        else pushFeedItem(feedStatus(`🌿「${nodeTitle}」做的时候冒出 ${result.subProblems.length} 个新任务`, { detail: result.subProblems.map((sp: any) => sp.title).filter(Boolean).join('、') }));
      }
      
      if (result.triggerDecision) { 
        const pendingDecision: DecisionPoint = { 
          nodeId: cid, 
          context: result.decisionContext, 
          options: [
            { label: '方案A：继续', action: 'continue' }, 
            { label: '方案B：新子方向', action: 'add_subproblem' }, 
            { label: '方案C：终止', action: 'terminate' }
          ] 
        };
        updateNode(cid, { 
          status: NodeStatus.NEEDS_REVIEW, 
          confidence: result.confidence, 
          notes: result.notes, 
          taskType, 
          userAsk: undefined,
          ...(isStubNote(unexplored.fullNote) && result.notes ? { fullNote: fillStubNote(unexplored.fullNote!, result.notes) } : {}),
          pendingDecision,
        }); 
        setIsLooping(false);
        pushFeedItem(branchAsk({ ...unexplored, pendingDecision }));
      } else {
        // ===== 该标记「已完成」，还是「该去问现实了」？=====
        // research 模式的 exploreResearchNode 不产出假设 → 沿用节点上已有的（可能含人工回填的现实证据）
        const hypothesis = result.hypothesis || unexplored.hypothesis;
        const candidate: ProblemNode = { ...unexplored, hypothesis, noteUpdatedAt: Date.now() };
        const hits = checkTriggers(candidate, nodes, {
          recentTitles,
          newTitles,
          emptyRounds: emptyRoundsRef.current,
        });
        // 被现实反驳只可能由外部证据造成——AI 靠纯推理不能宣布自己错了，否则会来回横跳
        const contradicted = isContradictedByReality(hypothesis);
        // ⚠️ updateNode 是 {...n, ...u} 的浅合并：显式传 hypothesis: undefined 会把已有假设**抹掉**。
        // research 模式的 exploreResearchNode 不产出 hypothesis，若无条件带上这个 key，
        // 用户辛苦回填的现实证据会被一轮探索清空。所以只在真的有值时才写。
        // 框架里的空壳：写完把占位正文换成真内容，不然笔记页还显示「还没开始写」
        const filled = isStubNote(unexplored.fullNote) && result.notes ? { fullNote: fillStubNote(unexplored.fullNote!, result.notes) } : {};
        const withHyp = (u: Partial<ProblemNode>): Partial<ProblemNode> =>
          hypothesis ? { ...u, ...filled, hypothesis, userAsk: undefined } : { ...u, ...filled, userAsk: undefined };
        let finalStatus: NodeStatus = NodeStatus.SOLVED;

        if (contradicted) {
          updateNode(cid, withHyp({
            status: NodeStatus.CONTRADICTED, confidence: result.confidence, notes: result.notes, taskType,
            validationReason: '现实证据与假设冲突，需要转向',
            noteUpdatedAt: Date.now(),
          }));
          finalStatus = NodeStatus.CONTRADICTED;
          trackEvent('hypothesis_contradicted');
          // 转向是这个系统里最值得留痕的时刻：在对话流里问一句，记下来之后随时可以 fork 回到旧路线
          pushFeedItem(contradictedAsk({ ...unexplored, hypothesis }));
        } else if (hits.length || result.needsReality) {
          // 研究模式没有「假设」，靠模型自己说「这一步必须问真人」
          if (!hits.length) hits.push({ reason: 'weak_evidence', label: '要问真人才能确定', detail: result.needsReality.what || '这一步的判断要靠真实数据确认' } as any);
          // 注意：这里**不要** setIsLooping(false)。
          // 单个节点该验证了不代表整个探索该停——挂起它，循环继续跑别的节点，
          // 等到「剩下的全在等现实」时（见上面 isBlockedOnReality）才叫人。
          updateNode(cid, withHyp({
            status: NodeStatus.VALIDATING, confidence: result.confidence, notes: result.notes, taskType,
            validationReason: summarizeHits(hits),
            noteUpdatedAt: Date.now(),
          }));
          finalStatus = NodeStatus.VALIDATING;
          // 花钱权限内：AI 项目经理自己去服务广场找人 / 发需求（不等人点）
          realityRef.current?.({ ...unexplored, status: NodeStatus.VALIDATING, notes: result.notes, validationReason: summarizeHits(hits), hypothesis: withHyp({}).hypothesis ?? unexplored.hypothesis } as ProblemNode);
          if (!batchRef.current) pushFeedItem(feedStatus(`🟡「${nodeTitle}」要到现实里做：${hits[0].label}`, { key: `write:${cid}`, nodeId: cid, detail: hits[0].detail, tone: 'warn' }));
          trackEvent('validation_triggered', { reason: hits[0].reason });
        } else {
          updateNode(cid, withHyp({
            status: NodeStatus.SOLVED, confidence: result.confidence, notes: result.notes, taskType,
            validationReason: undefined, noteUpdatedAt: Date.now(),
          }));
        }
        /*
          ===== 一篇一停 =====
          写完一篇就把方向盘交回给人。
          用户跟不上，不是因为笔记写得不好，是因为**没有一个地方让他说「我看完了」**；
          没有这个动作，AI 只能按自己的节奏往下跑，两边的认知就此分叉。
          「连写一轮」是用户明确要求这一批不打扰，那时不停，写完一轮再汇总。
        */
        const stepping = !continuousModeRef.current;
        if (stepping) {
          setIsLooping(false);
          setJustWroteId(cid);
          trackEvent('step_pause');
          // 被推翻的那篇先回答「接下来怎么走」，答完再问「下一篇」，一次只问一件事
          if (finalStatus !== NodeStatus.CONTRADICTED) {
            const written: ProblemNode = { ...unexplored, status: finalStatus, notes: result.notes, hypothesis };
            const after = nodes.map(n => (n.id === cid ? written : n));
            let prog = outlineRef.current?.status === 'confirmed' ? outlineProgress(outlineRef.current, after) : plainProgress(after);
            // 框架里的篇目写完了，但探索中又长出了新方向（子问题 / 用户在岔路口给的方向）——也给一个「写下一篇」
            if (!prog.next) {
              const extra = after.find(n => n.status === NodeStatus.UNEXPLORED && n.noteType !== 'overview' && n.noteType !== 'readme' && n.noteType !== 'simulation');
              if (extra) prog = { ...prog, next: { nodeId: extra.id, title: extra.title, question: '' } };
            }
            pushFeedItem(stepAsk(written, prog));
          }
        } else if (batchRef.current) {
          const b = batchRef.current;
          b.done.push({ id: cid, title: nodeTitle, flag: finalStatus === NodeStatus.CONTRADICTED ? '🔴' : finalStatus === NodeStatus.VALIDATING ? '🟡' : '✅' });
          {
            const gist = (result.notes || '').replace(/^#{1,6}.*$/gm, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
            if (finalStatus === NodeStatus.VALIDATING) noteAuto('stuck', `「${nodeTitle}」要到现实里做：${hits[0]?.label || '需要真实数据 / 真人'}`, cid);
            else if (finalStatus === NodeStatus.CONTRADICTED) noteAuto('think', `「${nodeTitle}」原来的判断被现实推翻了，换个假设继续`, cid);
            noteAuto('did', `做完「${nodeTitle}」${gist ? `：${gist}` : ''}`, cid);
          }
          if (b.done.length >= b.target) setTimeout(() => endBatchRef.current?.('done'), 0);
          else if (!quietAuto()) pushFeedItem(batchProgress(b));
        }

        // 「总览优先」：每解决若干节点，自动刷新一次项目总览，让用户随时看到最新进展
        solvedSinceOverviewRef.current += 1;
        if (solvedSinceOverviewRef.current >= OVERVIEW_REFRESH_EVERY) {
          solvedSinceOverviewRef.current = 0;
          setTimeout(() => refreshOverviewRef.current?.('progress'), 300);
        }
      }

      // 成功后重置重试计数
      retryCountRef.current[cid] = 0;
      consecutiveFailRef.current = 0;

    } catch (e) {
      console.error('探索出错:', e);

      // ① 链路级故障（额度用尽 / 鉴权失败 / 网络不通 / 服务端 5xx）：重试没有意义，立刻停循环。
      //    不停的话会持续对着坏掉的后端空转，既刷爆调用量也烧钱。
      if (isInfraFailure(e)) {
        updateNode(cid, { status: NodeStatus.UNEXPLORED });
        setIsLooping(false);
        isProcessingRef.current = false;
        const isQuota = (e as any)?.name === 'TrialQuotaError';
        pushFeedItem(feedStatus(`⚠️ 没做成「${nodeTitle}」`, { key: `write:${cid}`, nodeId: cid, tone: 'warn' }));
        if (batchRef.current) endBatchRef.current?.('halted');
        pushFeedItem(haltedAsk(
          isQuota ? '⚠️ 体验额度用完了，已暂停' : '⚠️ 模型连不上，已暂停',
          isQuota
            ? '可以在设置里换成你自己的模型（Ollama / DeepSeek / 任何 OpenAI 兼容接口）继续。'
            : `错误：${(e as Error).message}`,
        ));
        trackEvent('explore_halted', { reason: isQuota ? 'quota' : 'infra' });
        return;
      }

      // ② 跨节点连续失败：单看每个节点都"只失败了一两次"，但整体已经连败多轮，同样判定为链路问题
      consecutiveFailRef.current += 1;
      if (consecutiveFailRef.current >= MAX_CONSECUTIVE_FAILS) {
        updateNode(cid, { status: NodeStatus.UNEXPLORED });
        setIsLooping(false);
        isProcessingRef.current = false;
        if (batchRef.current) endBatchRef.current?.('halted');
        pushFeedItem(haltedAsk(`⚠️ 连续 ${MAX_CONSECUTIVE_FAILS} 步都没做成，已暂停`, `最后一个错误：${(e as Error).message}`));
        trackEvent('explore_halted', { reason: 'consecutive' });
        return;
      }

      // ③ 单节点问题：按原逻辑重试
      const retryCount = (retryCountRef.current[cid] || 0) + 1;
      retryCountRef.current[cid] = retryCount;

      if (retryCount < MAX_RETRIES) {
        // 还可以重试，保持UNEXPLORED状态，继续探索
        updateNode(cid, { status: NodeStatus.UNEXPLORED });
        pushFeedItem(feedStatus(`↻「${nodeTitle}」出错了，自动重试 ${retryCount}/${MAX_RETRIES}`, { key: `write:${cid}`, nodeId: cid, tone: 'warn' }));
        // 不停止循环，让它继续
      } else {
        // 超过重试次数，标记为需要人工处理
        const pendingDecision: DecisionPoint = {
          nodeId: cid,
          context: '自动探索多次失败，需要人工干预',
          options: [
            { label: '重新探索', action: 'continue' },
            { label: '跳过此节点', action: 'terminate' }
          ]
        };
        updateNode(cid, { 
          status: NodeStatus.NEEDS_REVIEW, 
          notes: `自动探索失败，请手动处理。错误: ${(e as Error).message}`,
          pendingDecision,
        });
        pushFeedItem(branchAsk({ ...unexplored, pendingDecision }));
        // 继续探索其他节点，不停止
      }
    } finally { 
      isProcessingRef.current = false; 
    }
  }, [nodes, decision, updateNode, focusedNodeId, currentProject?.explorationMode, addNotification, pushFeedItem, patchFeed, proposeNewDirection]);

  // 让 ref 始终指向最新的探索循环（持续模式里用它自我重排，避免卡死）
  useEffect(() => { runExplorationCycleRef.current = runExplorationCycle; }, [runExplorationCycle]);

  // 优化探索间隔：成功后500ms，避免太快触发API限流
  useEffect(() => {
    if (isLooping && !decision) {
      const t = setTimeout(() => runExplorationCycle(), 500);
      return () => clearTimeout(t);
    }
  }, [isLooping, decision, runExplorationCycle]);

  // 「总览优先」：一开始探索，就第一时间把项目总览写出来（用户基本先看总览）
  useEffect(() => {
    if (isLooping) {
      markMilestone('funnel_exploration_started');
      // 重新开跑：允许再次提示「需要现实反馈」，并重置原地打转计数
      realityPromptedRef.current = false;
      emptyRoundsRef.current = 0;
      // 「一篇一停」每写一篇都会重新开跑一次；以前每次开跑都重写一遍总览（多一次模型调用）。
      // 现在同一个项目 6 小时内只在开跑时写一次，其余靠「每写完 3 篇刷新一次」。
      const pid = currentProjectId || '';
      const last = overviewStartAtRef.current[pid] || 0;
      if (Date.now() - last < 6 * 3600_000) return;
      const t = setTimeout(() => { overviewStartAtRef.current[pid] = Date.now(); refreshOverviewRef.current?.('start'); }, 200);
      return () => clearTimeout(t);
    }
  }, [isLooping]);

  const handleDecisionChoice = (action: 'continue' | 'add_subproblem' | 'terminate', subTitle?: string) => { if (!decision) return; closeFeedAsks('branch', '已在笔记里处理', decision.nodeId); if (action === 'terminate') updateNode(decision.nodeId, { status: NodeStatus.INVALID, pendingDecision: undefined }); else if (action === 'add_subproblem' && subTitle) addNode(subTitle, [decision.nodeId]); else if (action === 'continue') updateNode(decision.nodeId, { status: NodeStatus.SOLVED, pendingDecision: undefined }); setDecision(null); setIsLooping(true); };
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
    markMilestone('funnel_project_created');
    const name = (presetName || notesSearch || '').trim().slice(0, 40) || '新项目';
    const projId = uuidv4();
    const p: Project = { id: projId, name, metaProblem: name, createdAt: Date.now(), explorationMode: 'research', nodes: [] };
    // 漏斗关键一步：建项目 = 真正开始用了（区分"点进来看看"和"上手了"）
    trackEvent('project_created', { 已有项目数: projects.length });
    setProjects(prev => [...prev, ensureWorktree(ensureOverview(p))]);
    pendingSelectRef.current = null; // 新项目默认打开项目总览
    setCurrentProjectId(projId);
    setNotesSearch('');
  }, [notesSearch]);
  // 「新建项目」= 打开新探索任务输入框（搜索框里已经打的字带进去），而不是直接建一个空项目
  const openNewTask = useCallback(() => {
    const q = (notesSearch || '').trim();
    if (q) { setMetaInput(q); setNotesSearch(''); }
    setShowMetaModal(true);
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
    if (window.innerWidth < 768) setNotesPanelMode(0);
    if (projectId === currentProjectId) { setSelectedNodeId(nodeId); }
    else { pendingSelectRef.current = nodeId; setCurrentProjectId(projectId); }
  }, [currentProjectId]);

  const openProjectPage = useCallback((projectId: string, scopeId: string, page: ProjectPage) => {
    if (window.innerWidth < 768) setNotesPanelMode(0);
    setProjectPage({ projectId, scopeId: page === 'worktree' || page === 'wallet' ? 'root' : scopeId, page });
    pendingSelectRef.current = null;
    setSelectedNodeId(null);
    setFocusedNodeId(null);
    if (projectId !== currentProjectId) setCurrentProjectId(projectId);
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
    const goal = proj.metaProblem || proj.name;
    const context = projectOverviewContext({ ...proj, nodes: srcNodes });
    setTeamBusy(true);
    try {
      const plan = await buildTeamPlan(goal, context);
      const overviewId = overview?.id;
      const norm = (s: string) => (s || '').trim().replace(/[？?]+$/u, '').toLowerCase();
      const now = Date.now();
      // 生成「总览」正文：方向 / 分工 / 链接由上方仪表盘自动展示，这里只留机器算不出来的判断，保持极简
      const buildOverviewDoc = (): string => {
        const areas = Array.from(new Set(plan.directions.map(m => m.area || '未分组')));
        return `# ${proj.name} · 总览

> ${goal}

## 📌 这是什么
分 ${areas.length} 个板块（${areas.join(' / ')}）、${plan.directions.length} 个方向推进，由「${plan.lead.role}」总协调。
${plan.lead.duty}

## 🎯 成功标准
- 算成功：
- 不做：

## 🧩 当前卡点
暂无（刚组建团队）

## 🗺️ 下一步
- 近期：让各方向的 Agent 先跑一轮探索

## 💡 关键结论
待探索
`;
      };
      const apply = (list: ProblemNode[]): ProblemNode[] => {
        const next = list.map(n => n.id === overviewId ? { ...n, assignedAgent: plan.lead.role, ...(n.autoNote === false ? {} : { fullNote: buildOverviewDoc(), noteUpdatedAt: now }) } : n);
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
      trackEvent('team_built', { 方向数: plan.directions.length });
      const goExplore = window.confirm(`✅ AI 已组建团队：\n· 总协调：${plan.lead.role}\n· ${plan.directions.length} 个关键方向，各配一名 Agent\n\n现在让团队开始自动探索各自方向吗？`);
      if (goExplore) {
        trackEvent('auto_explore_start');
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
    exportVaultZip(currentProject ? overviewExportNodes({ ...currentProject, nodes }) : nodes, (currentProject?.name || 'AI-Explorer') + '-Vault', currentProject?.name);
    // 导出 = 产出对用户有价值到愿意带走，是最强的留存信号
    trackEvent('vault_exported', { 笔记数: nodes.length });
  }, [nodes, currentProject]);

  // 保存到本地文件夹（File System Access）
  const handleSaveToFolder = useCallback(async () => {
    if (!supportsDirectoryPicker()) { alert('当前浏览器不支持直接保存到本地文件夹，请用「导出」下载 .zip（推荐 Chrome / Edge）。'); return; }
    if (!nodes.length) { alert('当前没有笔记可保存。'); return; }
    try { const count = await saveVaultToDirectory(currentProject ? overviewExportNodes({ ...currentProject, nodes }) : nodes); alert(`已保存 ${count} 篇 .md 到所选文件夹。`); }
    catch (e: any) { if (e?.name !== 'AbortError') alert('保存失败：' + (e?.message || e)); }
  }, [nodes]);
  const handleDeleteNode = useCallback((id: string) => { setNodes(prev => prev.filter(n => n.id !== id).map(n => ({ ...n, dependencies: n.dependencies.filter(d => d !== id) }))); if (selectedNodeId === id) setSelectedNodeId(null); if (focusedNodeId === id) setFocusedNodeId(null); if (decision?.nodeId === id) setDecision(null); }, [selectedNodeId, focusedNodeId, decision]);

  // ===== 决策节点持久化（重点功能）=====
  const projectDecisions = useMemo(() => currentProject?.decisions || [], [currentProject]);

  // ===== 探针（现实验证）=====
  // 和 decisions 一样挂在 Project 上，走现有的 idbSet 自动持久化，不新增任何后端。
  const projectProbes = useMemo(() => currentProject?.probes || [], [currentProject]);
  const handleAddProbes = useCallback((ps: Probe[]) => {
    if (!currentProjectId || !ps.length) return;
    setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, probes: [...(p.probes || []), ...ps] } : p));
    trackEvent('design_probes', { count: ps.length });
  }, [currentProjectId]);
  // ===== 框架先行 + 一篇一停 =====
  /*
    要解决的是一个节奏问题：原来一按「开始探索」，AI 十分钟能生成七八篇笔记，
    用户根本来不及看，看完也不知道这些方向是怎么来的。
    **产出的速度一旦超过理解的速度，多出来的那部分就不是资产，是噪音。**

    改成两段：先只出目录跟用户对齐（一个字正文都不写），确认之后一篇一篇写、写完一篇停一下。
  */
  const projectOutline = currentProject?.outline;
  // 默认 step。老项目没存过 pace，也按一篇一停走——这正是要改掉的那个默认行为。
  const projectPace: ExplorationPace = currentProject?.pace || 'step';
  const [outlineBusy, setOutlineBusy] = useState(false);
  /** 框架草稿默认只在对话流里放精简版；点「我要改改」才在中间栏展开编辑器 */
  const [outlineEditing, setOutlineEditing] = useState(false);
  // 用户点开了别的笔记 = 先不改框架了；对话流里那张卡还在，随时能再点「我要改改」
  useEffect(() => { if (selectedNodeId) setOutlineEditing(false); }, [selectedNodeId]);
  useEffect(() => { setOutlineEditing(false); }, [currentProjectId]);
  // 用户点开了某篇笔记 / 项目页 / 要改框架 → 右侧笔记栏展开给他看
  useEffect(() => { if (selectedNodeId) setNoteOpen(true); }, [selectedNodeId]);
  useEffect(() => { if (projectPage) setNoteOpen(true); }, [projectPage]);
  useEffect(() => { if (outlineEditing) setNoteOpen(true); }, [outlineEditing]);
  /** 刚写完的那一篇（step 模式下循环停在这里等人） */
  const [justWroteId, setJustWroteId] = useState<string | null>(null);

  useEffect(() => { outlineRef.current = projectOutline; }, [projectOutline]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { paceRef.current = projectPace; }, [projectPace]);
  // 换项目时把上一篇的停顿清掉，免得张冠李戴
  useEffect(() => { setJustWroteId(null); }, [currentProjectId]);

  const patchProject = useCallback((id: string, patch: Partial<Project>) => {
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  /** 让 AI 拟一份目录。只出标题和「这篇要回答什么」，不写正文。 */
  const handleProposeOutline = useCallback(async (projId?: string, goal?: string, noteOverride?: string) => {
    const pid = projId || currentProjectId;
    if (!pid || outlineBusy) return;
    setOutlineBusy(true);
    try {
      const proj = projectsRef.current.find(p => p.id === pid);
      const g = goal || proj?.metaProblem || proj?.name || '';
      const existing = (proj?.nodes || [])
        .filter(n => n.noteType === 'direction' || !n.noteType)
        .map(n => n.title);
      const { outline, problems } = await asTask('hard', () => proposeOutline(g, proj?.explorationMode || 'research', {
        existingTitles: existing,
        userNote: noteOverride ?? proj?.outline?.userNote,
      }));
      if (!outline) {
        addNotification('warning', '🗺️ 这次没拆出步骤', problems.join('；') || '模型没给出可用的方向');
        return;
      }
      const withNote = noteOverride ? setUserNote(outline, noteOverride) : outline;
      patchProject(pid, { outline: withNote });
      trackEvent('outline_proposed', { items: outline.items.length });
      // 上一份没答的框架卡作废，换成新的这份
      const card = outlineAsk(withNote);
      // 自主运行中自己拆的下一阶段：自己确认、接着做（不来打扰你，卡片也不进对话流）
      const auto = isRunningAutonomously(projectsRef.current.find(p => p.id === pid)) && pid === feedProjectRef.current ? autoChoice('outline', card.ask!.options.map(o => o.id)) : null;
      patchFeed(f => auto ? closeAsks(f, 'outline', '已重拟') : pushFeed(closeAsks(f, 'outline', '已重拟'), card), pid);
      if (auto) setTimeout(() => answerFeedRef.current?.(card, auto.option, undefined, auto.why), 300);
      else setRightChatOpen(true);
      if (problems.length) addNotification('info', '🗺️ 有几条被丢掉了', problems.join('；'));
    } catch (e: any) {
      addNotification('warning', '🗺️ 拆步骤失败', e?.message || String(e));
    } finally {
      setOutlineBusy(false);
    }
  }, [currentProjectId, outlineBusy, addNotification, patchProject, patchFeed]);

  // 新建项目时要在 createProjectWithMode 里调它，而那个回调定义在前面，所以走 ref
  useEffect(() => { proposeOutlineRef.current = handleProposeOutline; }, [handleProposeOutline]);

  const handleOutlineChange = useCallback((o: Outline) => {
    if (currentProjectId) patchProject(currentProjectId, { outline: o });
  }, [currentProjectId, patchProject]);

  /**
   * 确认框架 → 建空壳节点。
   * 关键：**这一步不调模型，一篇正文都不生成。** 用户拿到的是一份目录，
   * 然后由他点「写这一篇」开始第一篇。
   */
  const handleConfirmOutline = useCallback((): string | undefined => {
    if (!currentProjectId || !projectOutline) return;
    const proj = projectsRef.current.find(p => p.id === currentProjectId);
    const rootId = (proj?.nodes || []).find(n => n.noteType === 'overview')?.id
      || (proj?.nodes || [])[0]?.id || '';
    const { outline, nodes: fresh } = confirmOutline(projectOutline, rootId);
    setNodes(prev => [...prev, ...fresh]);
    // 简报里「只有你知道」的问题排进待问队列（AI 记忆），开工前一个一个问
    patchProject(currentProjectId, { outline, pace: 'step', keyInfo: addPending(proj?.keyInfo, questionsFromBrief(outline.brief), 'brief') });
    // 把商量好的目录写进总览：「我们说好要写哪几篇」得有个固定的地方可查
    const md = outlineToMarkdown(outline, fresh) + (outline.brief ? `\n\n${briefMarkdown(outline.brief, proj?.charter)}` : '');
    setProjects(prev => prev.map(p => p.id === currentProjectId ? {
      ...p,
      nodes: (p.nodes || []).map(n => n.noteType === 'overview'
        ? { ...n, fullNote: `${n.fullNote || ''}\n\n${md}\n`, noteUpdatedAt: Date.now() }
        : n),
    } : p));
    const first = keptItems(outline).find(i => i.id === outline.startId) || keptItems(outline)[0];
    if (first?.nodeId) setSelectedNodeId(first.nodeId);
    trackEvent('outline_confirmed', { items: keptItems(outline).length });
    setOutlineEditing(false);
    closeFeedAsks('outline', '已确认');
    if (proj?.charter) addNotification('info', `🗺️ 步骤定了，一共 ${keptItems(outline).length} 步`, '每做完一步会停下来给你看结果。');
    return first?.nodeId;
  }, [currentProjectId, projectOutline, patchProject, addNotification, closeFeedAsks]);

  /**
   * 框架 / 简报定了之后：还没谈过花钱权限 → 先问清楚再开始写（等用户回话才往下走）；
   * 谈过了 → 直接写第一篇。
   */
  /**
   * AI 项目经理主动问下一件只有用户知道的事（一次只挂一张卡）。
   * kickoffNodeId：开工前问的，问完才写这一篇。返回 false = 没什么要问的。
   */
  const askNextInfo = useCallback((pid: string, kickoffNodeId?: string): boolean => {
    const proj = projectsRef.current.find(p => p.id === pid);
    const k = nextPending(proj?.keyInfo);
    if (!proj || !k) return false;
    // 自主运行中不来打扰：问题留着，回来汇报时一起问
    if (isRunningAutonomously(proj)) return false;
    if (!kickoffNodeId && openAsks(proj.feed).some(f => f.ask?.type === 'info')) return true; // 已经有一张在等了，不叠
    const list = markAsked(proj.keyInfo, k.id);
    projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, keyInfo: list } : p));
    patchProject(pid, { keyInfo: list });
    patchFeed(f => pushFeed(f, infoAsk(k, pendingCount(list) - 1, kickoffNodeId)), pid);
    if (pid === currentProjectId) setRightChatOpen(true);
    return true;
  }, [currentProjectId, patchProject, patchFeed]);

  /** 开始写第一篇（开工前该问的都问完了） */
  const kickoffWriting = useCallback((nodeId?: string) => {
    const ok = nodeId && nodesRef.current.some(n => n.id === nodeId && n.status === NodeStatus.UNEXPLORED);
    if (!ok) return;
    forceNodeRef.current = nodeId!; setJustWroteId(null);
    setTimeout(() => setIsLooping(true), 50);
  }, []);

  /**
   * 开工：该谈的都谈完了。
   * - 还没问过要不要自主运行 → 弹框请你授权（或者先一步一步来）；
   * - 已经授权 → 直接自主运行；
   * - 选过一步一步来 → 做第一步，做完停下来给你看。
   */
  const [autonomyFor, setAutonomyFor] = useState<{ pid: string; nodeId?: string } | null>(null);
  const startBatchRef = useRef<((target?: number) => void) | null>(null);
  const beginWorkRef = useRef<((nodeId?: string) => void) | null>(null);
  const beginWork = useCallback((nodeId?: string) => {
    const pid = feedProjectRef.current;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!pid || !proj) return;
    if (isRunningAutonomously(proj)) {
      if (nodeId) forceNodeRef.current = nodeId;
      setTimeout(() => startBatchRef.current?.(), 50);
      return;
    }
    if (!proj.autonomy) { setAutonomyFor({ pid, nodeId }); return; }
    kickoffWriting(nodeId);
  }, [kickoffWriting]);
  useEffect(() => { beginWorkRef.current = beginWork; }, [beginWork]);

  // ===== AI 项目经理在服务广场：买服务 / 发需求 / 接单 =====
  const pmBusyRef = useRef<Set<string>>(new Set());
  const loggedIn = () => { try { return !!WAKE_API && !!localStorage.getItem('aae-auth-token'); } catch { return false; } };
  /** 花钱权限 / 允许接单变了 → 换一个对应额度的 AI 授权（后端按授权卡额度） */
  const syncPm = useCallback(async (pid: string) => {
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!proj || !loggedIn()) return null;
    try { return await ensurePmToken(proj); } catch (e) { console.warn('[pm] 授权没建成', e); return null; }
  }, []);
  /** 卡在 AI 做不了的那一步：权限内就自己下单 / 发需求 */
  const pmAct = useCallback(async (node: ProblemNode) => {
    const pid = feedProjectRef.current;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!pid || !proj || pmBusyRef.current.has(node.id)) return;
    // 没去下单要说清楚为什么（自主运行时记进日志，汇报里如实说，不让模型去猜「登录不了」）
    const why = !proj.charter?.autoBuyCNY ? `「${node.title}」需要找人在现实里做，但花钱权限是 0，没去服务广场下单——要我自己下单，就在钱包页把「花钱权限」调上去`
      : !loggedIn() ? `「${node.title}」需要找人在现实里做，但这台电脑没登录正式网站，AI 进不了服务广场——登录后我会自己去下单`
      : '';
    if (why) { noteAuto('need', why, node.id, pid); return; }
    pmBusyRef.current.add(node.id);
    try {
      const pm = await syncPm(pid);
      if (!pm) { noteAuto('stuck', `「${node.title}」想去服务广场下单，但 AI 的服务广场授权没建成（网络或登录过期），下次再试`, node.id, pid); pmBusyRef.current.delete(node.id); return; }
      const r = await pmBuyOrPost(proj, node, pm);
      if (r.kind === 'order') pushFeedItem(feedStatus(`🤝 AI 项目经理为「${node.title}」下单了「${r.title}」${money(r.priceCents)}（${r.provider}）· 钱包担保，你验收后才付给对方`, { tone: 'good', nodeId: node.id }), pid);
      else if (r.kind === 'demand') pushFeedItem(feedStatus(`📢 没找到现成的服务，AI 项目经理发布了需求「${r.title}」，预算 ${money(r.budgetCents)}，等人接单`, { tone: 'good', nodeId: node.id }), pid);
      trackEvent('pm_market', { kind: r.kind });
    } catch (e: any) {
      const msg = e?.message || String(e);
      pushFeedItem(feedStatus(/余额不足/.test(msg) ? `💳 AI 想找人去做「${node.title}」，但 AI 钱包余额不够——去项目的「钱包」充值，再点「🤝 找人 / 服务去做」` : `⚠️ AI 项目经理没能下单：${msg}`, { tone: 'warn', nodeId: node.id }), pid);
      pmBusyRef.current.delete(node.id);
    }
  }, [syncPm, pushFeedItem, noteAuto]);
  useEffect(() => { pmActRef.current = pmAct; }, [pmAct]);
  /** 接一轮单：交付已中标的，再挑新的投标 */
  const workJobs = useCallback(async (pid: string): Promise<string> => {
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!proj?.charter?.allowJobs) return '还没允许 AI 接单';
    const pm = await syncPm(pid);
    if (!pm) return '需要先登录正式网站，AI 才能进服务广场';
    const llm = async (messages: { role: string; content: string }[], json?: boolean, task?: TaskLevel) => (await meterFor(pid, () => callLLM(messages, { jsonMode: !!json, maxTokens: 3000, timeoutMs: 120000, task }))).content;
    const r = await pmWorkJobs(pm, llm, profileSkills(proj));
    for (const d of r.delivered) pushFeedItem(feedStatus(`📦 AI 项目经理交付了接的单「${d.title}」（${money(d.priceCents)}），等对方验收后钱进${proj.pmProfile ? '项目钱包' : ' AI 钱包'}`, { tone: 'good' }), pid);
    for (const b of r.bids) pushFeedItem(feedStatus(`🙋 AI 项目经理在服务广场投了一个单，报价 ${money(b.priceCents)}，${b.deliveryDays} 天交付`, { detail: b.proposal }), pid);
    try { localStorage.setItem(`hx-pm-jobs:${pid}`, String(Date.now())); } catch { /* ignore */ }
    return r.delivered.length || r.bids.length ? `交付 ${r.delivered.length} 单，新投 ${r.bids.length} 单` : '这次没有合适的单（AI 只接自己能独立做完的调研 / 写作类需求）';
  }, [syncPm, pushFeedItem]);
  // ===== AI 项目经理简介：AI 自己起草 / 更新，用户确认后挂到服务广场 =====
  const [profileBusy, setProfileBusy] = useState(false);
  const profileBusyRef = useRef(false);
  const patchProfile = useCallback((pid: string, fn: (st: PmProfileState | undefined) => PmProfileState) => {
    projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, pmProfile: fn(p.pmProfile) } : p));
    setProjects(prev => prev.map(p => (p.id === pid ? { ...p, pmProfile: fn(p.pmProfile) } : p)));
  }, []);
  const refreshProfile = useCallback(async (pid: string, force = false): Promise<string> => {
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!proj || profileBusyRef.current) return '';
    if (!force && !profileDue(proj)) return '';
    profileBusyRef.current = true; setProfileBusy(true);
    try {
      const resp = await meterFor(pid, () => callLLM(buildProfileMessages(proj) as any, { jsonMode: true, maxTokens: 1200, timeoutMs: 90000, task: 'simple' }));
      const pr = parseProfile(resp.content, solvedCount(proj));
      if (!pr) return '这次没写成，过会儿再试';
      patchProfile(pid, st => ({ ...(st || {}), draft: pr }));
      pushFeedItem(feedStatus(proj.pmProfile?.published ? `📝 我又攒了些本事，更新了自己的简介草稿「${pr.title}」：在「钱包」页看一眼，确认后服务广场上的简介才会更新` : `📝 我给自己写了一份简介「${pr.title}」：能接什么活、攒下了什么、需要什么。在「钱包」页看一眼，确认后挂到服务广场接单，赚的钱进项目钱包`, { tone: 'good' }), pid);
      return '';
    } catch (e) { return e instanceof Error ? e.message : String(e); }
    finally { profileBusyRef.current = false; setProfileBusy(false); }
  }, [patchProfile, pushFeedItem]);
  /** 用户确认：用这个项目的 AI 授权把简介挂成服务（别人下单后这个 AI 接单交付，收入进项目钱包） */
  const publishProfile = useCallback(async (pid: string, on: boolean): Promise<string> => {
    const proj = projectsRef.current.find(p => p.id === pid);
    const st = proj?.pmProfile;
    const pr = on ? st?.draft || st?.published : st?.published;
    if (!proj || !pr) return '还没有简介';
    if (!loggedIn()) return '需要先登录正式网站';
    if (on && !proj.charter?.allowJobs) {
      // 挂出去就意味着要接单：顺手打开「允许接单」（授权在下面统一换，不重复建）
      const charter = { ...(proj.charter || { autoBuyCNY: 0, confirmedAt: Date.now() }), allowJobs: true };
      projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, charter } : p));
      patchProject(pid, { charter });
    }
    const fresh = projectsRef.current.find(p => p.id === pid)!;
    const pm = await ensurePmToken(fresh).catch(() => null);
    if (!pm?.permissions.includes('service_publish')) return 'AI 的服务广场授权没建成，稍后再试';
    try {
      const saved = await marketRequestAs(pm.token)<{ id: string; revision: number }>('/services', 'PUT', { ...profileToListing(pr, st, `AI 项目经理 · ${proj.name}`), published: on });
      patchProfile(pid, s0 => on ? { ...(s0 || {}), published: pr, draft: undefined, serviceId: saved.id, serviceRevision: saved.revision, publishedAt: Date.now(), hidden: false } : { ...(s0 || {}), serviceId: saved.id, serviceRevision: saved.revision, hidden: true });
      pushFeedItem(feedStatus(on ? `🏪 简介「${pr.title}」挂到服务广场了：全站都能看到，有人下单我就接单交付，收入进项目钱包` : '简介从服务广场撤下来了（已经接的单会做完）', { tone: 'good' }), pid);
      return on ? '已发布到服务广场' : '已撤下';
    } catch (e: any) {
      // 授权换过之后旧服务不归新授权管：当新服务重新挂
      if (on && e?.status === 404 && st?.serviceId) { patchProfile(pid, s0 => ({ ...(s0 || {}), serviceId: undefined, serviceRevision: undefined })); return publishProfile(pid, on); }
      return e?.message || String(e);
    }
  }, [patchProfile, pushFeedItem, patchProject]);
  /** 对话里说「先去接单赚钱」：打开接单、没简介就先写一份、去服务广场挑一轮单——真的做，再照实汇报 */
  const earnNow = useCallback(async (pid: string): Promise<string> => {
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!proj) return '';
    if (!loggedIn()) return '没去成：这台电脑没登录正式网站，AI 进不了服务广场。请用户先登录，再说一次「去接单」。';
    const did: string[] = [];
    if (!proj.charter?.allowJobs) {
      const charter = { ...(proj.charter || { autoBuyCNY: 0, confirmedAt: Date.now() }), allowJobs: true };
      projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, charter } : p));
      patchProject(pid, { charter });
      did.push('打开了「允许 AI 接单」（只接 AI 自己能独立做完的调研、整理、写作类需求）');
    }
    if (!proj.pmProfile?.draft && !proj.pmProfile?.published) {
      const err = await refreshProfile(pid, true);
      const now = projectsRef.current.find(p => p.id === pid)?.pmProfile?.draft;
      did.push(now ? `写好了一份 AI 项目经理简介草稿「${now.title}」，用户在「钱包」页确认后就挂到服务广场，别人能直接找我下单` : `简介没写成${err ? `（${err}）` : ''}`);
    }
    try { did.push(`去服务广场看了一轮：${await workJobs(pid)}`); }
    catch (e) { did.push(`去服务广场没看成：${e instanceof Error ? e.message : String(e)}`); }
    did.push('接单收入会在买方验收后进这个项目的钱包，之后可以直接拿来做研发（买服务、用模型）；钱只在平台内用，不能提现');
    return did.map(x => '- ' + x).join('\n');
  }, [patchProject, refreshProfile, workJobs]);
  // ===== 让 AI 碰到真人：问卷 / 预售页 / 企业信息 =====
  const platformCatRef = useRef<{ at: number; cat: PlatformCatalog } | null>(null);
  const pendingActionsRef = useRef<Record<string, { pid: string; node: ProblemNode; action: RealityAction }>>({});
  const realityBusyRef = useRef<Set<string>>(new Set());
  const loadPlatformCatalog = useCallback(async () => {
    if (platformCatRef.current && Date.now() - platformCatRef.current.at < 10 * 60_000) return platformCatRef.current.cat;
    const cat = await platformRequest<PlatformCatalog>('/catalog');
    platformCatRef.current = { at: Date.now(), cat };
    return cat;
  }, []);
  const patchChecks = useCallback((pid: string, fn: (l: RealityCheck[] | undefined) => RealityCheck[]) => {
    projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, realityChecks: fn(p.realityChecks) } : p));
    setProjects(prev => prev.map(p => (p.id === pid ? { ...p, realityChecks: fn(p.realityChecks) } : p)));
  }, []);
  /** 现实给了答案：记进事实看板（待核实），拿它重新推进那一步 */
  const applyReality = useCallback((pid: string, nodeId: string | undefined, claim: string, detail: string, source: string) => {
    const proj = projectsRef.current.find(p => p.id === pid);
    try { inquiryTeams.change(pid, 'root', proj?.metaProblem || proj?.name || '', w => addFact(w, { claim, source, excerpt: detail, scope: '' })); } catch (e) { console.warn('[reality] 没记进事实看板', e); }
    const node = nodeId ? proj?.nodes?.find(n => n.id === nodeId) : undefined;
    if (node && pid === feedProjectRef.current) {
      updateNode(node.id, { status: NodeStatus.UNEXPLORED, validationReason: undefined, noteUpdatedAt: Date.now(), userAsk: `现实给了答案（${source}）：${claim}。${detail} 按这个真实结果重新推进这一步：说明了什么、原来的判断要不要改、接下来做什么。` });
      if (isRunningAutonomously(projectsRef.current.find(p => p.id === pid))) setTimeout(() => resumeAutoRef.current?.(pid), 500);
    }
    noteAuto('did', `现实给了答案：${claim}`, nodeId, pid);
    pushFeedItem(feedStatus(`🧪 现实给了答案：${claim}`, { tone: 'good', detail: `${source}${detail ? ` · ${detail}` : ''}`, nodeId }), pid);
  }, [inquiryTeams, updateNode, noteAuto, pushFeedItem]);

  const executeReality = useCallback(async (pid: string, node: ProblemNode, a: RealityAction) => {
    const proj = projectsRef.current.find(p => p.id === pid);
    const llm = async (messages: { role: string; content: string }[]) => (await meterFor(pid, () => callLLM(messages as any, { jsonMode: true, maxTokens: 800, timeoutMs: 60000, task: 'simple' }))).content;
    const spent = (cents: number) => { if (cents && proj?.autonomy?.on) patchAutonomy(pid, { marketCents: (projectsRef.current.find(p => p.id === pid)?.autonomy?.marketCents || 0) + cents }); };
    try {
      if (a.type === 'survey') {
        const r = await platformRequest<{ id: string; url: string; title: string; chargedCents: number }>('/surveys', 'POST', { title: a.title, intro: a.intro, questions: a.questions, projectId: pid, nodeId: node.id, requestId: crypto.randomUUID() });
        spent(r.chargedCents);
        patchChecks(pid, l => addCheck(l, { id: r.id, kind: 'survey', nodeId: node.id, title: r.title, url: r.url, createdAt: Date.now(), target: a.target, count: 0, ingested: 0 }));
        noteAuto('did', `为「${node.title}」发了问卷「${r.title}」（${a.questions.length} 题）`, node.id, pid);
        noteAuto('need', `问卷链接要发到目标人群手里才有回答：${r.url}（目标 ${a.target} 份）`, node.id, pid);
        pushFeedItem(feedStatus(`📋 为「${node.title}」发了问卷：${r.url}`, { tone: 'good', nodeId: node.id, detail: `${a.why}。把链接发到目标人群（群聊、朋友圈、客户群），回收够 ${a.target} 份我会自动总结并接着推进。${r.chargedCents ? `花了 ¥${(r.chargedCents / 100).toFixed(2)}` : ''}` }), pid);
      } else if (a.type === 'page') {
        const r = await platformRequest<{ id: string; path: string; headline: string }>('/pages', 'POST', { projectId: pid, nodeId: node.id, headline: a.headline, sub: a.sub, bullets: a.bullets, price: a.price, cta: a.cta, maker: proj?.name, deposit: a.deposit ? Math.round(a.deposit * 100) : 0 });
        const url = pageUrl(r.path);
        patchChecks(pid, l => addCheck(l, { id: r.id, kind: 'page', nodeId: node.id, title: r.headline, url, createdAt: Date.now(), visitors: 0, clicks: 0, leads: 0, ingested: 0 }));
        noteAuto('did', `为「${node.title}」做了预售页「${r.headline}」`, node.id, pid);
        noteAuto('need', `预售页要发出去才有人看：${url}`, node.id, pid);
        pushFeedItem(feedStatus(`🧪 为「${node.title}」做了预售页：${url}`, { tone: 'good', nodeId: node.id, detail: `${a.why}。发到目标人群看多少人点「${a.cta}」、留联系方式——这比问卷里说「愿意买」更可信。` }), pid);
      } else if (a.type === 'company') {
        const s = await platformRequest<{ result: any; chargedCents: number }>('/company/search', 'POST', { keyword: a.keyword, requestId: crypto.randomUUID() });
        const items = s.result?.items || s.result?.data?.items || s.result?.result?.items || (Array.isArray(s.result) ? s.result : []);
        const top = items?.[0]?.name || items?.[0]?.companyName || a.keyword;
        const info = await platformRequest<{ chargedCents: number } & Record<string, unknown>>('/company/info', 'POST', { name: top, requestId: crypto.randomUUID() });
        spent((s.chargedCents || 0) + (info.chargedCents || 0));
        const raw = JSON.stringify({ search: items?.slice?.(0, 5), info }).slice(0, 8000);
        const check: RealityCheck = { id: crypto.randomUUID().slice(0, 12), kind: 'company', nodeId: node.id, title: `企业信息：${top}`, createdAt: Date.now(), ingested: 1, closed: true };
        const sum = parseIngest(await llm(buildIngestMessages(proj!, node, check, raw)));
        patchChecks(pid, l => addCheck(l, { ...check, summary: sum?.claim }));
        applyReality(pid, node.id, sum?.claim || `查到企业「${top}」的工商信息`, sum?.detail || '', '天眼查企业信息');
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      noteAuto('stuck', `「${node.title}」想${a.type === 'survey' ? '发问卷' : a.type === 'page' ? '做预售页' : '查企业信息'}没成功：${msg}`, node.id, pid);
      pushFeedItem(feedStatus(/余额不足/.test(msg) ? `💳 AI 想为「${node.title}」${a.type === 'survey' ? '发问卷' : '查企业信息'}，但 AI 钱包余额不够——去钱包充值` : `⚠️ 没能${a.type === 'survey' ? '发问卷' : a.type === 'page' ? '做预售页' : '查企业信息'}：${msg}`, { tone: 'warn', nodeId: node.id }), pid);
      if (/未开通|还没开通/.test(msg)) pmActRef.current?.(node);
    }
  }, [patchChecks, noteAuto, pushFeedItem, patchAutonomy, applyReality]);

  const realityAct = useCallback(async (node: ProblemNode, force?: RealityKind): Promise<string> => {
    const pid = feedProjectRef.current;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!pid || !proj || realityBusyRef.current.has(node.id)) return '这一步已经在准备现实验证了';
    if (!loggedIn()) { pmActRef.current?.(node); return '这台电脑没登录正式网站，平台服务用不了：请用户先登录'; }
    realityBusyRef.current.add(node.id);
    try {
      let cat: PlatformCatalog;
      try { cat = await loadPlatformCatalog(); } catch { pmActRef.current?.(node); return '平台服务暂时连不上，改去服务广场找人'; }
      const ready = Object.fromEntries(cat.services.map(s => [s.id, s.ready]));
      if (force && force !== 'market' && !ready[force]) { const m = `「${force === 'survey' ? '问卷' : force === 'page' ? '预售页' : '企业信息'}」服务还没开通（管理员要先在后台填密钥）`; pushFeedItem(feedStatus(m, { tone: 'warn' }), pid); return m; }
      const resp = await meterFor(pid, () => callLLM(buildActionMessages(proj, node, ready, cat.prices, force) as any, { jsonMode: true, maxTokens: 1500, timeoutMs: 90000 }));
      const a = parseAction(resp.content, ready) || { type: 'market' as const, why: '' };
      if (a.type === 'market') { pmActRef.current?.(node); return `这件事平台服务做不了，改去服务广场找人：${a.why}`; }
      if (a.type === 'none') { noteAuto('think', `「${node.title}」暂时不需要去现实里验证：${a.why}`, node.id, pid); return `判断现在还不用去现实里验证：${a.why}`; }
      const cost = actionCost(a, cat.prices);
      const auto = isRunningAutonomously(proj) && cost <= (proj.charter?.autoBuyCNY || 0) * 100 && budgetLeftCNY(proj, modelPricesRef.current) * 100 >= cost;
      const what = a.type === 'survey' ? `问卷「${a.title}」（${a.questions.length} 题，目标回收 ${a.target} 份）` : a.type === 'page' ? `预售页「${a.headline}」` : `「${a.keyword}」的企业信息查询`;
      if (auto) { await executeReality(pid, node, a); return `已经直接发出${what}（在自主运行的花钱权限内）`; }
      // 不在自主运行（或超出花钱权限）：把方案摆出来，你点头才做
      const card: FeedItem = {
        id: `rp${Date.now().toString(36)}`, ts: Date.now(), kind: 'ask', nodeId: node.id, key: `realityPlan:${node.id}`,
        text: a.type === 'survey' ? `📋 「${node.title}」要问真人：发一份问卷「${a.title}」？` : a.type === 'page' ? `🧪 「${node.title}」要看真需求：做一个预售页「${a.headline}」？` : `🔎 「${node.title}」要核实：查一下「${a.keyword}」的企业信息？`,
        detail: `${a.why}${cost ? ` · 花费 ¥${(cost / 100).toFixed(2)}（从 AI 钱包扣）` : ' · 免费'}`,
        list: a.type === 'survey' ? a.questions.map((q, i) => ({ title: `${i + 1}. ${q.title}`, sub: q.options?.join(' / ') })) : a.type === 'page' ? [{ title: a.headline, sub: a.sub }, ...a.bullets.map(b => ({ title: `· ${b}` })), ...(a.price ? [{ title: a.price }] : []), ...(a.deposit ? [{ title: `💰 开意向金 ¥${a.deposit}：访客真付钱表示想要，7 天后全额退回` }] : [])] : undefined,
        ask: { type: 'realityPlan', options: [{ id: 'go', label: a.type === 'survey' ? '发吧' : a.type === 'page' ? '做吧' : '查吧', primary: true }, { id: 'market', label: '改成去服务广场找人' }, { id: 'skip', label: '先不用' }] },
      };
      pendingActionsRef.current[card.id] = { pid, node, action: a };
      pushFeedItem(card, pid);
      return `设计好了${what}，确认卡已经放在对话里（${cost ? `花 ¥${(cost / 100).toFixed(2)}，从钱包扣` : '免费'}）：用户点「${a.type === 'survey' ? '发吧' : a.type === 'page' ? '做吧' : '查吧'}」就真的发出去，答卷会自动回收、够数后自动总结成证据`;
    } catch (e) { console.warn('[reality] 没想好怎么验证', e); pmActRef.current?.(node); return '没设计成，改去服务广场找人'; }
    finally { realityBusyRef.current.delete(node.id); }
  }, [loadPlatformCatalog, executeReality, noteAuto, pushFeedItem]);
  useEffect(() => { realityRef.current = (n, f) => void realityAct(n, f); }, [realityAct]);

  /** 对话里说「发问卷 / 做预售页 / 查企业」：挑当前这一步，把用户刚说的话带上，设计好方案放确认卡 */
  const realityFromChat = useCallback(async (kind: RealityKind, userText: string): Promise<string> => {
    const proj = projectsRef.current.find(p => p.id === feedProjectRef.current);
    const nodes0 = (proj?.nodes || []).filter(n => n.noteType !== 'simulation');
    const sel = selectedNodeId ? nodes0.find(n => n.id === selectedNodeId) : undefined;
    const node = (sel && sel.noteType !== 'readme' ? sel : undefined)
      || nodes0.find(n => n.status === NodeStatus.VALIDATING) || nodes0.find(n => n.status === NodeStatus.EXPLORING)
      || nodes0.find(n => n.status === NodeStatus.UNEXPLORED && n.noteType !== 'readme' && n.noteType !== 'overview')
      || nodes0.find(n => n.noteType === 'overview') || nodes0[0];
    if (!node) return '还没有可以验证的步骤：先说清楚问题，让我拆出步骤';
    return realityAct({ ...node, notes: `${node.notes || ''}\n用户在对话里刚说：${userText.slice(0, 600)}` }, kind);
  }, [realityAct, selectedNodeId]);
  /** 上传访谈 / 实验录音：后台转文字（几分钟），转好后自动提炼成证据、带回这一步 */
  const audioPollRef = useRef<Record<string, number>>({});
  const uploadRecording = useCallback(async (file: File) => {
    const pid = feedProjectRef.current;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!pid || !proj) return;
    const nodes0 = (proj.nodes || []).filter(n => n.noteType !== 'simulation' && n.noteType !== 'readme');
    const node = (selectedNodeId ? nodes0.find(n => n.id === selectedNodeId) : undefined) || nodes0.find(n => n.status === NodeStatus.VALIDATING) || nodes0.find(n => n.status === NodeStatus.EXPLORING) || nodes0.find(n => n.noteType === 'overview');
    const r = await uploadAudio(file, pid, node?.id);
    patchChecks(pid, l => addCheck(l, { id: r.id, kind: 'audio', nodeId: node?.id, title: r.name || file.name, createdAt: Date.now(), count: 0, ingested: 0, status: 'PENDING' }));
    pushFeedItem(feedStatus(`🎙 录音「${r.name || file.name}」传上来了，正在转文字（一般几分钟）。转好后我会提炼成证据${node ? `，带回「${node.title}」这一步` : ''}`, { nodeId: node?.id }), pid);
    // 转写一般几分钟：每 30 秒看一眼，最多看 40 分钟
    let n = 0; window.clearInterval(audioPollRef.current[pid]);
    audioPollRef.current[pid] = window.setInterval(() => {
      const still = projectsRef.current.find(p => p.id === pid)?.realityChecks?.some(c => c.kind === 'audio' && !c.closed);
      if (!still || ++n > 80) { window.clearInterval(audioPollRef.current[pid]); return; }
      void syncRealityRef.current?.(pid);
    }, 30000);
  }, [selectedNodeId, patchChecks, pushFeedItem]);
  const syncRealityRef = useRef<((pid: string) => Promise<void>) | null>(null);
  /** 去问卷星 / 预售页拿最新数字；新增够多就总结成证据、拿去推进 */
  const realitySyncRef = useRef(false);
  const syncReality = useCallback(async (pid: string) => {
    const proj = projectsRef.current.find(p => p.id === pid);
    const live = (proj?.realityChecks || []).filter(c => !c.closed && c.kind !== 'company');
    if (!proj || !live.length || !loggedIn() || realitySyncRef.current) return;
    realitySyncRef.current = true;
    try {
      for (const c of live) {
        try {
          let raw = '';
          if (c.kind === 'audio') {
            const r = await platformRequest<{ status: string; text?: string; durationSec?: number; error?: string }>(`/audio/${c.id}`);
            if (r.status === 'FAILED') { patchChecks(pid, l => patchCheck(l, c.id, { status: 'FAILED', closed: true, summary: r.error ? `没转成功：${r.error}` : undefined })); continue; }
            if (r.status !== 'SUCCEEDED') continue;
            patchChecks(pid, l => patchCheck(l, c.id, { status: 'SUCCEEDED', count: 1, durationSec: r.durationSec, checkedAt: Date.now() }));
            Object.assign(c, { status: 'SUCCEEDED', count: 1, durationSec: r.durationSec });
            raw = r.text || '';
            // 原文也存一份到这一步的笔记里（转写全文，方便回看）
            if (c.nodeId && raw) {
              const n = projectsRef.current.find(p => p.id === pid)?.nodes?.find(x => x.id === c.nodeId);
              if (n && pid === feedProjectRef.current) updateNode(c.nodeId, { fullNote: `${n.fullNote || n.notes || ''}\n\n## 🎙 录音转写：${c.title}\n\n${raw.slice(0, 20000)}`, noteUpdatedAt: Date.now() });
            }
          } else if (c.kind === 'survey') {
            const r = await platformRequest<{ count: number; report: string | null }>(`/surveys/${c.id}/results`);
            patchChecks(pid, l => patchCheck(l, c.id, { count: r.count, checkedAt: Date.now() }));
            raw = r.report || `有效答卷 ${r.count} 份（报告还没生成）`;
            c.count = r.count;
          } else {
            const r = await platformRequest<{ views: number; visitors: number; clicks: number; leads: { at: number; note: string }[]; closed: boolean; deposit?: number; deposits?: { count: number; cents: number } }>(`/pages/${c.id}`);
            const deps = r.deposits?.count || 0;
            patchChecks(pid, l => patchCheck(l, c.id, { visitors: r.visitors, clicks: r.clicks, leads: r.leads.length, deposits: deps, closed: r.closed, checkedAt: Date.now() }));
            raw = `浏览 ${r.views} 次，独立访客 ${r.visitors}，点按钮 ${r.clicks}，留联系方式 ${r.leads.length}${r.deposit ? `，真的付了 ¥${(r.deposit / 100).toFixed(2)} 意向金的 ${deps} 人（到期全额退回）` : ''}；留言：${r.leads.map(l => l.note).filter(Boolean).slice(0, 20).join(' | ')}`;
            Object.assign(c, { visitors: r.visitors, clicks: r.clicks, leads: r.leads.length, deposits: deps });
          }
          if (!shouldIngest(c)) continue;
          const node = proj.nodes?.find(n => n.id === c.nodeId);
          const resp = await meterFor(pid, () => callLLM(buildIngestMessages(proj, node, c, raw) as any, { jsonMode: true, maxTokens: 600, timeoutMs: 60000, task: 'simple' }));
          const sum = parseIngest(resp.content);
          const now = c.kind === 'survey' || c.kind === 'audio' ? c.count || 0 : (c.visitors || 0) + (c.leads || 0) * 10 + (c.deposits || 0) * 30;
          patchChecks(pid, l => patchCheck(l, c.id, { ingested: c.kind === 'audio' ? 1 : now, summary: sum?.claim, ...(c.kind === 'audio' ? { closed: true } : {}) }));
          if (sum) applyReality(pid, c.nodeId, sum.claim, sum.detail, c.kind === 'audio' ? `录音「${c.title}」里受访者的原话` : c.kind === 'survey' ? `问卷「${c.title}」${c.count} 份真实回答` : `预售页「${c.title}」的真实访问`);
        } catch (e) { console.warn('[reality] 同步失败', c.id, e); }
      }
    } finally { realitySyncRef.current = false; }
  }, [patchChecks, applyReality, updateNode]);
  useEffect(() => { syncRealityRef.current = syncReality; }, [syncReality]);

  const toggleJobs = useCallback((pid: string, on: boolean) => {
    const proj = projectsRef.current.find(p => p.id === pid); if (!proj) return;
    const charter = { ...(proj.charter || { autoBuyCNY: 0, confirmedAt: Date.now() }), allowJobs: on };
    projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, charter } : p));
    patchProject(pid, { charter });
    void syncPm(pid);
    pushFeedItem(feedStatus(on ? '🙋 允许 AI 项目经理接单了：它会挑自己能做完的调研 / 写作类需求报价，交付后对方验收，钱进 AI 钱包' : '不再让 AI 项目经理接新单（已经接了的会继续做完）'), pid);
  }, [patchProject, syncPm, pushFeedItem]);

  const startAfterOutline = useCallback((firstId?: string) => {
    const pid = currentProjectId;
    if (!pid) return;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!proj?.charter) {
      patchFeed(f => pushFeed(closeAsks(f, 'charter', '已重新问'), charterAsk(pid, firstId)), pid);
      setRightChatOpen(true);
      return;
    }
    if (askNextInfo(pid, firstId)) return;
    if (firstId) beginWorkRef.current?.(firstId);
  }, [currentProjectId, patchFeed, askNextInfo]);

  const handleDiscardOutline = useCallback(() => {
    if (currentProjectId) patchProject(currentProjectId, { outline: undefined });
    setOutlineEditing(false);
    closeFeedAsks('outline', '已放弃这份框架');
  }, [currentProjectId, patchProject, closeFeedAsks]);

  // 没走框架流程的项目也要能说出「还剩几篇、下一篇是谁」，
  // 否则一篇一停就退化成一个说不出下一步的空壳条
  const outlineDone = useMemo(
    () => (projectOutline?.status === 'confirmed' ? outlineProgress(projectOutline, nodes) : plainProgress(nodes)),
    [projectOutline, nodes],
  );
  const justWroteNode = useMemo(() => nodes.find(n => n.id === justWroteId), [nodes, justWroteId]);

  /** 「看完了，写下一篇」 */
  const handleStepNext = useCallback(() => {
    setJustWroteId(null);
    setIsLooping(true);
    closeFeedAsks('step', '继续做下一步');
  }, [closeFeedAsks]);

  /** 「这篇重写」——用户此刻的判断是方向不对，不是错别字，所以是清空重跑而不是打开编辑器 */
  /** 重写：框架里的那一篇恢复成占位正文（写出来的内容会再填回去） */
  const rewriteStub = (n: ProblemNode): string => {
    const it = projectOutline?.items.find(i => i.id === n.outlineItemId);
    return it ? stubNote(it) : n.fullNote || '';
  };
  const handleStepRewrite = useCallback(() => {
    if (!justWroteId) return;
    const n = nodes.find(x => x.id === justWroteId);
    updateNode(justWroteId, {
      status: NodeStatus.UNEXPLORED,
      notes: '',
      validationReason: undefined,
      noteUpdatedAt: Date.now(),
      ...(n?.outlineItemId ? { fullNote: rewriteStub(n) } : {}),
    });
    forceNodeRef.current = justWroteId;
    setJustWroteId(null);
    setIsLooping(true);
    closeFeedAsks('step', '这步重做');
    trackEvent('step_rewrite');
  }, [justWroteId, updateNode, closeFeedAsks, nodes, projectOutline]);

  const handleStepStop = useCallback(() => { setJustWroteId(null); setIsLooping(false); closeFeedAsks('step', '先停一下'); }, [closeFeedAsks]);

  /** 某一篇的「▶ 写这一篇」：指定下一轮就写它 */
  const handleWriteThis = useCallback((nodeId: string) => {
    forceNodeRef.current = nodeId;
    setJustWroteId(null);
    setSelectedNodeId(nodeId);
    setIsLooping(true);
    closeFeedAsks('step', '改做指定的一步');
    trackEvent('write_this_one');
  }, [closeFeedAsks]);

  /** 「剩下的一次写完」：用户明确说不用再停了 */
  // ===== 连写一轮 =====
  const remainingCount = (list: ProblemNode[]) => list.filter(n => n.status === NodeStatus.UNEXPLORED && n.noteType !== 'overview' && n.noteType !== 'readme' && n.noteType !== 'simulation').length;
  const startBatch = useCallback((target = BATCH_SIZE) => {
    batchRef.current = { id: uuidv4().slice(0, 8), target: Math.max(1, target), done: [], newDirs: 0 };
    setJustWroteId(null);
    setContinuousMode(true);
    setIsLooping(true);
    closeFeedAsks('step', '交给 AI 自主运行');
    if (!quietAuto()) pushFeedItem(batchProgress(batchRef.current));
    trackEvent('batch_start', { target });
  }, [closeFeedAsks, pushFeedItem]);
  useEffect(() => { startBatchRef.current = (t?: number) => startBatch(t ?? Math.min(BATCH_SIZE, Math.max(1, remainingCount(nodesRef.current)))); }, [startBatch]);

  /**
   * 自主运行时一轮做完了，自己决定接下来干什么（不弹汇总卡）：
   * 钱花完了 → 停下来等你；还有步骤 → 歇几秒接着做；这一阶段做完了 → 自己拆下一阶段（有节制），拆不了就等你回来。
   */
  const resumeAutoRef = useRef<((pid: string) => void) | null>(null);
  const autoNext = useCallback((pid: string, reason: 'done' | 'empty' | 'halted') => {
    const proj = projectsRef.current.find(p => p.id === pid);
    const a = proj?.autonomy;
    if (!proj || !a?.on || a.pausedFor || pid !== feedProjectRef.current) return;
    if (reason === 'halted') { patchAutonomy(pid, { pausedFor: 'important' }); return; }
    if (budgetLeftCNY(proj, modelPricesRef.current) <= 0) {
      patchAutonomy(pid, { pausedFor: 'budget' });
      noteAuto('need', `启动资金 ¥${a.budgetCNY} 用完了，停下来等你：要继续就再给我一笔`, undefined, pid);
      pushFeedItem(feedStatus(`⏸ 启动资金 ¥${a.budgetCNY} 用完了，我先停下。你回来时我把这段时间的情况汇报给你`, { tone: 'warn' }), pid);
      return;
    }
    const remaining = remainingCount(nodesRef.current);
    if (remaining > 0) { setTimeout(() => { const cur = projectsRef.current.find(p => p.id === pid); if (isRunningAutonomously(cur) && feedProjectRef.current === pid && !batchRef.current) startBatchRef.current?.(); }, 3000); return; }
    if (canPlanNextStage(a)) {
      patchAutonomy(pid, { stageRounds: (a.stageRounds || 0) + 1, lastStageAt: Date.now() });
      noteAuto('think', '这一阶段能推进的都推进了，我自己拆了下一阶段接着做', undefined, pid);
      proposeOutlineRef.current?.(pid);
      return;
    }
    patchAutonomy(pid, { pausedFor: 'stage' });
    noteAuto('need', '这一阶段做完了，下一阶段往哪走，想等你回来看一眼再定', undefined, pid);
  }, [patchAutonomy, noteAuto, pushFeedItem]);

  const endBatch = useCallback((reason: 'done' | 'empty' | 'stopped' | 'halted') => {
    const b = batchRef.current;
    batchRef.current = null;
    setContinuousMode(false);
    setIsLooping(false);
    if (!b) return;
    trackEvent('batch_end', { reason, done: b.done.length });
    const pid = feedProjectRef.current;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (pid && isRunningAutonomously(proj) && reason !== 'stopped') {
      // 自主运行：一轮做完不打扰你，进度行收个尾，自己决定接下来
      autoNext(pid, reason);
      return;
    }
    if (pid && reason === 'stopped' && proj?.autonomy?.on) patchAutonomy(pid, { pausedFor: 'user' });
    pushFeedItem(batchAsk(b, reason, remainingCount(nodes)));
  }, [nodes, pushFeedItem, autoNext, patchAutonomy]);
  useEffect(() => { endBatchRef.current = endBatch; }, [endBatch]);

  /** 接着自主运行：有步骤就做，没有就拆下一阶段 */
  const resumeAuto = useCallback((pid: string) => {
    if (pid !== feedProjectRef.current || batchRef.current) return;
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!isRunningAutonomously(proj)) return;
    if (budgetLeftCNY(proj!, modelPricesRef.current) <= 0) { autoNext(pid, 'done'); return; }
    if (remainingCount(nodesRef.current) > 0) startBatchRef.current?.();
    else autoNext(pid, 'empty');
  }, [autoNext]);
  useEffect(() => { resumeAutoRef.current = resumeAuto; }, [resumeAuto]);

  /** AI 用模型的策略：省钱 / 均衡 / 效果优先 */
  const setModelPolicy = useCallback((pid: string, p: ModelPolicy) => {
    projectsRef.current = projectsRef.current.map(x => (x.id === pid ? { ...x, modelPolicy: p } : x));
    patchProject(pid, { modelPolicy: p });
    pushFeedItem(feedStatus(p === 'best' ? '🔀 用模型改成「效果优先」：一般的活和难的活都用最强的模型（花钱更快）' : p === 'save' ? '🔀 用模型改成「省钱」：基本都用最便宜的模型，特别难的活才升级' : '🔀 用模型改成「均衡」：简单的活用便宜模型，难的活换最强的'), pid);
  }, [patchProject, pushFeedItem]);

  /** 允许自主运行（开工弹框里点的） */
  const allowAutonomy = useCallback((pid: string, o: { budgetCNY: number; checkInDays: number; allowJobs: boolean; modelPolicy?: ModelPolicy }, nodeId?: string) => {
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!proj) return;
    const prev = proj.autonomy?.on ? proj.autonomy : undefined;
    // 再次授权（比如钱花完了再给一笔）：预算在已花的基础上加，日志和阶段计数接着记
    const spent = prev ? autoSpentCNY(proj, modelPricesRef.current) : 0;
    const autonomy: Autonomy = prev
      ? { ...prev, budgetCNY: Math.round(spent + o.budgetCNY), checkInDays: o.checkInDays, pausedFor: undefined, stageRounds: 0 }
      : grantAutonomy(o.budgetCNY, o.checkInDays);
    patchAutonomy(pid, autonomy);
    if (!!proj.charter?.allowJobs !== o.allowJobs) toggleJobs(pid, o.allowJobs);
    if (o.modelPolicy && o.modelPolicy !== (proj.modelPolicy || 'balanced')) setModelPolicy(pid, o.modelPolicy);
    noteAuto('think', `你授权我自主运行：¥${o.budgetCNY} 以内，每 ${o.checkInDays} 天回来看一次`, undefined, pid);
    // 启动资金真的放进项目钱包：之后这个项目里 AI 花的钱都从这里出，赚的钱也进这里
    if (BILLING_API && loggedIn() && o.budgetCNY > 0) {
      transferProject(pid, Math.round(o.budgetCNY * 100), 'in', `自主运行启动资金 · ${proj.name}`.slice(0, 200))
        .then(() => pushFeedItem(feedStatus(`💰 已从你的用户钱包把 ¥${o.budgetCNY} 放进这个项目的钱包，我在这个项目里花钱、赚钱都走它；用不完随时能收回`, { tone: 'good' }), pid))
        .catch((e: Error) => pushFeedItem(feedStatus(/余额不足/.test(e.message) ? `💳 你的用户钱包不够 ¥${o.budgetCNY}，启动资金没能放进项目钱包：去「个人中心 → 我的钱包」充值，或在项目钱包里放一笔少一点的` : `⚠️ 启动资金没放进项目钱包：${e.message}`, { tone: 'warn' }), pid));
    }
    pushFeedItem(feedStatus(`⚡ 收到，我开始自主运行：¥${o.budgetCNY} 以内，小事我自己拿主意，不来打扰你。${o.checkInDays === 14 ? '两周' : '一周'}后回来看我，我把做了什么、怎么想的、卡在哪、需要你什么一起汇报给你`, { tone: 'good' }), pid);
    trackEvent('autonomy_granted', { budget: o.budgetCNY, days: o.checkInDays, jobs: o.allowJobs ? 1 : 0 });
    if (nodeId) forceNodeRef.current = nodeId;
    setTimeout(() => resumeAutoRef.current?.(pid), 50);
  }, [patchAutonomy, toggleJobs, setModelPolicy, noteAuto, pushFeedItem]);

  // ===== 用户回来了：汇报这段时间 =====
  const reportBusyRef = useRef(false);
  const giveReport = useCallback(async (pid: string, force = false) => {
    const proj = projectsRef.current.find(p => p.id === pid);
    const a = proj?.autonomy;
    if (!proj || !a?.on || reportBusyRef.current) return;
    if (!force && !reportDue(proj)) return;
    reportBusyRef.current = true;
    try {
      const entries = entriesSince(proj);
      const pending = (proj.keyInfo || []).filter(k => k.status === 'pending');
      const extra = [
        a.pausedFor === 'budget' ? `启动资金 ¥${a.budgetCNY} 用完了：觉得值得继续，就再给我一笔（点「⚡ 自主运行」）` : '',
        a.pausedFor === 'stage' ? '这一阶段做完了，下一阶段往哪走需要你看一眼' : '',
        a.pausedFor === 'important' ? '有件很重要的事要你拍板（见对话里的卡片）' : '',
      ].filter(Boolean);
      const spent = autoSpentCNY(proj, modelPricesRef.current);
      const statusLine = `已花 ¥${spent.toFixed(2)} / 启动资金 ¥${a.budgetCNY}；还有 ${remainingCount(proj.nodes || [])} 步没做${a.pausedFor ? `；现在停着（${a.pausedFor}）` : ''}`;
      let r = fallbackReport(entries, pending, extra);
      try {
        const cap = marketCapability(proj, loggedIn());
        const resp = await meterFor(pid, () => callLLM(buildReportMessages(proj, entries, pending, statusLine, cap) as any, { jsonMode: true, maxTokens: 1500, timeoutMs: 90000 }));
        const parsed = parseReport(resp.content);
        if (parsed) r = { ...parsed, needs: [...new Set([...extra, ...parsed.needs])].slice(0, 4) };
      } catch (e) { console.warn('[autonomy] 汇报没写成，用日志直接汇报', e); }
      const pausedLabel = a.pausedFor ? ({ budget: '启动资金用完了', stage: '这一阶段做完了，等你看', important: '有很重要的事等你拍板', user: '你让我先停着' } as Record<string, string>)[a.pausedFor] : undefined;
      const now = Date.now();
      pushFeedItem(reportAsk(r, { since: a.lastReportAt || a.grantedAt, paused: pausedLabel, nextCheck: nextCheckIn({ ...a, lastReportAt: now }, now), hasQuestions: pending.length > 0 }), pid);
      patchAutonomy(pid, { lastReportAt: now });
      trackEvent('autonomy_report', { entries: entries.length });
    } finally { reportBusyRef.current = false; }
  }, [pushFeedItem, patchAutonomy]);
  // ===== 成果播报：定期告诉用户做成了什么、心得、闭环、他自己的成长 =====
  const [digestBusy, setDigestBusy] = useState(false);
  const digestBusyRef = useRef(false);
  const giveDigest = useCallback(async (pid: string, force = false) => {
    const proj = projectsRef.current.find(p => p.id === pid);
    if (!proj || digestBusyRef.current) return;
    if (!force && !digestDue(proj)) return;
    // 自主运行的汇报刚给过，就不再叠一张
    if (!force && proj.autonomy?.lastReportAt && Date.now() - proj.autonomy.lastReportAt < 10 * 60_000 && proj.autonomy.lastReportAt > proj.autonomy.grantedAt) return;
    digestBusyRef.current = true; setDigestBusy(true);
    try {
      const since = lastDigestAt(proj);
      const facts = collectDigest(proj, since);
      let d = fallbackDigest(facts, since);
      if (facts.tasks.length || facts.loops.length) {
        try {
          const resp = await meterFor(pid, () => callLLM(buildDigestMessages(proj, facts, since) as any, { jsonMode: true, maxTokens: 1200, timeoutMs: 90000, task: 'simple' }));
          d = parseDigest(resp.content, since) || d;
        } catch (e) { console.warn('[digest] 播报没写成，按记录直接播报', e); }
      } else if (!force) return;
      if (!d.tasks.length && !d.loops.length && !d.growth.length) d = { ...d, headline: '这段时间没有新进展', tasks: ['还没有做完的事'] };
      projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, digests: addDigest(p.digests, d) } : p));
      setProjects(prev => prev.map(p => (p.id === pid ? { ...p, digests: addDigest(p.digests, d) } : p)));
      pushFeedItem(digestAsk(d, digestSections(d)), pid);
      trackEvent('digest', { tasks: d.tasks.length, loops: d.loops.length, growth: d.growth.length });
    } finally { digestBusyRef.current = false; setDigestBusy(false); }
  }, [pushFeedItem]);
  useEffect(() => {
    if (!currentProjectId) return;
    const t = setTimeout(() => { void syncReality(currentProjectId).finally(() => giveDigest(currentProjectId)).finally(() => refreshProfile(currentProjectId)); }, 5000);
    const iv = window.setInterval(() => { const pid = feedProjectRef.current; if (pid) void syncReality(pid).finally(() => giveDigest(pid)).finally(() => refreshProfile(pid)); }, 30 * 60_000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [currentProjectId, giveDigest, syncReality, refreshProfile]);

  // 打开项目 / 切回这个页面时：离上次汇报有一阵子、又做了些事，就先汇报
  useEffect(() => {
    if (!currentProjectId) return;
    const t = setTimeout(() => void giveReport(currentProjectId), 1500);
    const onVis = () => { if (document.visibilityState === 'visible' && feedProjectRef.current) void giveReport(feedProjectRef.current); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, [currentProjectId, giveReport]);

  const handleSwitchToAuto = useCallback(() => {
    setJustWroteId(null);
    closeFeedAsks('step', '剩下的交给 AI 自主运行');
    startBatch(Math.min(BATCH_SIZE, Math.max(1, remainingCount(nodes))));
  }, [closeFeedAsks, startBatch, nodes]);

  // ===== 仿真笔记 =====
  // 「先仿真、再探针」：仿真只回答「这个判断对哪个数最敏感」，
  // 探针再去把那一个数量出来。仿真本身**不产生任何证据**，节点状态一动不动。
  const [simBusy, setSimBusy] = useState<string>('');
  const handleDesignSim = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || simBusy) return;
    setSimBusy(nodeId);
    try {
      const { spec, problems } = await designSimulation(node, currentProject?.metaProblem || currentProject?.name);
      if (!spec) {
        // 不吞错：模型编了不存在的变量、写了不合法的公式，都要如实说，
        // 宁可没有仿真，也不要一条算错的曲线——曲线比文字更容易被当真。
        addNotification('warning', '🧪 这次没生成出来', problems.join('；') || '模型返回的仿真不合法');
        return;
      }
      const id = uuidv4();
      const simNode: ProblemNode = {
        id,
        title: `🧪 ${spec.title}`,
        status: NodeStatus.UNEXPLORED,
        confidence: 0,
        dependencies: [nodeId],
        notes: '',
        chatHistory: [],
        agentResults: [],
        noteType: 'simulation',
        sim: spec,
        simSourceId: nodeId,
        folder: node.folder,
        anchorId: node.anchorId,
        fullNote: `## 我拖出来的发现\n\n- \n\n> 相关：[[${node.title}]]`,
        noteUpdatedAt: Date.now(),
      };
      setNodes(prev => [...prev, simNode]);
      setSelectedNodeId(id);
      markMilestone('funnel_tried_sim');
      trackEvent('sim_generated', { params: spec.params.length, steps: spec.steps });
      if (problems.length) addNotification('info', '🧪 仿真已生成（有部分内容被丢弃）', problems.join('；'));
    } catch (e: any) {
      addNotification('warning', '🧪 生成仿真失败', e?.message || String(e));
    } finally {
      setSimBusy('');
    }
  }, [simBusy, nodes, currentProject, addNotification]);

  /** 仿真里点「去把这个数量出来」→ 在来源节点上建一个探针草稿 */
  const handleSimProbe = useCallback((nodeId: string, draft: { hypothesis: string; method: string; expectedSignal: string; effort: string }) => {
    if (!currentProjectId) return;
    const probe: Probe = {
      id: uuidv4(),
      nodeId,
      kind: 'manual',
      hypothesis: draft.hypothesis,
      method: draft.method,
      cost: 'low',
      effort: draft.effort,
      expectedSignal: draft.expectedSignal,
      status: 'draft',
      createdAt: Date.now(),
    };
    setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, probes: [...(p.probes || []), probe] } : p));
    trackEvent('sim_to_probe');
    addNotification('info', '🔬 已生成探针', '去那个节点的 🔬 面板里，量完把结果填回来');
    setSelectedNodeId(nodeId);
  }, [currentProjectId, addNotification]);

  const handleUpdateProbe = useCallback((probe: Probe) => {
    if (!currentProjectId) return;
    setProjects(prev => prev.map(p => p.id === currentProjectId
      ? { ...p, probes: (p.probes || []).map(x => x.id === probe.id ? probe : x) }
      : p));
    if (probe.status === 'done' && probe.result) {
      trackEvent('probe_result', { stance: probe.result.stance, layer: probe.result.layer });
      // 这个探针如果是挂在某个正在等结果的路标上的，直接把路标也结算了——
      // 用户跑完设备实验就不用再去路线图上手抄一遍结论。
      const anchor = routeRef.current?.anchors.find(a => a.status === 'waiting' && (a.probeIds || []).includes(probe.id));
      if (anchor) {
        const verdict = probe.result.stance === 'support' ? 'pass' : probe.result.stance === 'refute' ? 'fail' : 'unclear';
        setTimeout(() => settleAnchorRef.current?.(anchor.id, verdict, probe.result!.summary, 'probe'), 300);
      }
    }
  }, [currentProjectId]);

  // ===== 探索路线与锚点路标 =====
  const projectRoute = useMemo(() => currentProject?.route, [currentProject]);
  useEffect(() => { routeRef.current = projectRoute; }, [projectRoute]);

  const writeRoute = useCallback((updater: (r: ExplorationRoute) => ExplorationRoute) => {
    if (!currentProjectId) return;
    setProjects(prev => prev.map(p => (p.id === currentProjectId && p.route) ? { ...p, route: updater(p.route) } : p));
  }, [currentProjectId]);

  const [routeBusy, setRouteBusy] = useState('');

  /** 为当前锚点这一段规划方向并创建节点（每跨过一个路标就做一次） */
  const openLeg = useCallback(async (route: ExplorationRoute, anchor: RouteAnchor) => {
    const goal = currentProject?.metaProblem || currentProject?.name || route.goal;
    const overview = nodes.find(n => n.noteType === 'overview');
    const done = nodes.map(n => n.title);
    setRouteBusy(`正在规划「${anchor.title}」这一段…`);
    try {
      const dirs = await planLegDirections(goal, anchor, done);
      if (!dirs.length) return false;
      const now = Date.now();
      setNodes(prev => [...prev, ...dirs.map(d => ({
        id: uuidv4(), title: d.title, status: NodeStatus.UNEXPLORED, confidence: 0,
        dependencies: overview ? [overview.id] : [], notes: d.why, chatHistory: [], agentResults: [],
        noteType: 'direction' as const, anchorId: anchor.id,
        fullNote: `# ${d.title}\n\n> 为到达路标「${anchor.title}」而探索\n\n${d.why}\n\n## 探索现状\n（待探索）\n`,
        noteUpdatedAt: now,
      }))]);
      addNotification('info', `🧭 进入「${anchor.title}」这一段`, `新增 ${dirs.length} 个方向：${dirs.map(d => d.title).join('、')}`);
      return true;
    } finally {
      setRouteBusy('');
    }
  }, [nodes, currentProject, addNotification]);

  /** 规划一条新路线（总览里点「规划路线」） */
  const handlePlanRoute = useCallback(async () => {
    if (!currentProjectId || routeBusy) return;
    const goal = currentProject?.metaProblem || currentProject?.name || '';
    const overview = nodes.find(n => n.noteType === 'overview');
    setRouteBusy('正在规划探索路线…');
    try {
      const route = await planRoute(goal, currentProject?.name || '项目', currentProject ? projectOverviewContext({ ...currentProject, nodes }) : overview?.fullNote || overview?.notes);
      if (!route) { addNotification('warning', '路线规划失败', '模型没给出可用的路线，换个模型或稍后再试。'); return; }
      const first = route.anchors[0];
      // 已有的方向节点归到第一段，免得它们绕过闸门
      setNodes(prev => prev.map(n =>
        (n.noteType === 'direction' || !n.noteType) && !n.anchorId ? { ...n, anchorId: first.id } : n));
      setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, route } : p));
      routeRef.current = route;
      anchorPromptedRef.current = null;
      trackEvent('plan_route', { anchors: route.anchors.length });
      markMilestone('funnel_route_planned');
      addNotification('info', '🗺️ 路线已规划', `${route.anchors.length} 个路标，第一站：${first.title}`);
      // 第一段还没有节点的话，顺手规划出来
      if (!nodes.some(n => (n.noteType === 'direction' || !n.noteType))) await openLeg(route, first);
    } catch (e: any) {
      addNotification('warning', '路线规划失败', e?.message || '未知错误');
    } finally {
      setRouteBusy('');
    }
  }, [currentProjectId, currentProject, nodes, routeBusy, addNotification, openLeg]);

  /** 锚点到点：转成「等现实」 */
  const handleReachAnchor = useCallback((anchorId: string) => {
    writeRoute(r => reachAnchor(r, anchorId));
  }, [writeRoute]);
  useEffect(() => { reachAnchorRef.current = handleReachAnchor; }, [handleReachAnchor]);

  /**
   * 结算一个锚点：现实给了结果 → 写成证据 → 通过就往下走，不通过就留痕改线。
   * 这是整条路线上唯一由真实数据驱动的地方。
   */
  const handleSettleAnchor = useCallback(async (
    anchorId: string,
    verdict: 'pass' | 'fail' | 'unclear',
    summary: string,
    origin: 'human' | 'probe' = 'human',
  ) => {
    const route = routeRef.current;
    const anchor = route?.anchors.find(a => a.id === anchorId);
    if (!route || !anchor || routeBusy) return;

    const settled = settleAnchor(route, anchorId, { verdict, summary, origin });
    const newAnchor = settled.anchors.find(a => a.id === anchorId)!;
    setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, route: settled } : p));
    routeRef.current = settled;

    if (verdict === 'unclear') {
      addNotification('info', '结果还不明确', '路标继续等待更好的数据。');
      return;
    }

    // ① 结果落成证据，挂到这一段的所有节点上——跟探针结果走同一套统计
    const ev = anchorEvidence(newAnchor);
    if (ev) {
      // ★ 这是整个产品的 aha 时刻：有人真的把现实的答案填了回来
      markMilestone('funnel_reality_evidence');
      const legNodeIds = new Set(nodesOfAnchor(nodes, anchorId).map(n => n.id));
      setNodes(prev => prev.map(n => {
        if (!legNodeIds.has(n.id) || !n.hypothesis) return n;
        return {
          ...n,
          hypothesis: { ...n.hypothesis, evidence: [...n.hypothesis.evidence, { ...ev, id: uuidv4() }], updatedAt: Date.now() },
          noteUpdatedAt: Date.now(),
        };
      }));
    }
    trackEvent('anchor_settled', { verdict });

    // ② 没通过 = 现实把这条路否了，这是最值得留痕的时刻
    if (verdict === 'fail') {
      const legNodes = nodesOfAnchor(nodes, anchorId);
      if (legNodes.length) setTimeout(() => contradictedDecisionRef.current?.(legNodes[0].id), 400);
      addNotification('warning', `🔴 路标未通过：${anchor.title}`, `${summary.slice(0, 80)} —— 正在据此重规划后面的路`);
    } else {
      addNotification('info', `✅ 路标通过：${anchor.title}`, summary.slice(0, 80));
    }

    // ③ 用真实结果重规划后面的路（已走过的冻结）
    setRouteBusy('正在根据真实结果调整路线…');
    let next = settled;
    try {
      const revised = await reviseRoute(settled, newAnchor, nodes);
      if (revised) {
        next = mergeRevision(settled, anchorId, revised.anchors, {
          anchorId, anchorTitle: anchor.title,
          reason: `${verdict === 'pass' ? '通过' : '未通过'}：${summary.slice(0, 80)}`,
          note: revised.note,
        });
        setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, route: next } : p));
        routeRef.current = next;
        addNotification('info', '🗺️ 路线已调整', revised.note);
      }
    } catch { /* 改线失败就沿用原路线，不阻塞 */ }
    finally { setRouteBusy(''); }

    // ④ 进入下一段并续跑
    const nextAnchor = currentAnchor(next);
    anchorPromptedRef.current = null;
    if (nextAnchor) {
      const ok = await openLeg(next, nextAnchor);
      if (ok) setTimeout(() => setIsLooping(true), 500);
    } else {
      addNotification('info', '🏁 路线走完了', '所有路标都已结算，可以生成研究报告。');
    }
  }, [currentProjectId, nodes, routeBusy, addNotification, openLeg]);

  useEffect(() => { settleAnchorRef.current = handleSettleAnchor; }, [handleSettleAnchor]);

  // ===== 手机端「现实反馈」同步 =====
  //
  // 只同步当前项目的待办：路标、待执行的人工探针、被拦下的设备写操作。
  // 不传笔记正文、不传图谱——手机上要解决的只有"给现实答案"这一件事。
  //
  // ⚠️ 后端是 FC 内存态，冷启动会清空，所以这里**持续重推完整待办**（覆盖式），
  // 靠 inboxDigest 去重避免没变化也发。轮询间隔是自适应的：没待办时 10 分钟一次，
  // 避免像以前那样把 FC 调用量白白烧掉。
  const inboxItems = useMemo(
    () => (currentProject ? buildInbox([{ ...currentProject, nodes, probes: projectProbes, route: projectRoute }], loadPending()) : []),
    [currentProject, nodes, projectProbes, projectRoute],
  );

  useEffect(() => {
    if (!hasSyncBackend() || !user) return;
    const t = setTimeout(() => { pushInbox(inboxItems).catch(() => { /* 网络问题下次再推 */ }); }, 1500);
    return () => clearTimeout(t);
  }, [inboxItems, user]);

  /** 把手机上填的一条结果落到本地状态里 */
  const applyInboxReply = useCallback(async (r: InboxReply) => {
    const parsed = parseItemId(r.id);
    if (!parsed) return;
    const { kind, sourceId } = parsed;

    if (kind === 'anchor') {
      const v = r.verdict === 'pass' ? 'pass' : r.verdict === 'fail' ? 'fail' : 'unclear';
      markMilestone('funnel_reality_evidence');
      await handleSettleAnchor(sourceId, v as any, r.summary || '（手机端未填写说明）', 'human');
      addNotification('info', '📱 手机回填已生效', `路标结算：${r.summary.slice(0, 60)}`);
      return;
    }

    if (kind === 'probe') {
      const probe = projectProbes.find(p => p.id === sourceId);
      const node = probe && nodes.find(n => n.id === probe.nodeId);
      if (!probe || !node) return;
      const stance = r.verdict === 'pass' ? 'support' : r.verdict === 'fail' ? 'refute' : 'unclear';
      const applied = applyProbeResult(node, probe, {
        summary: r.summary || '（手机端未填写说明）',
        stance: stance as any,
        layer: 'behavior',           // 手机上人工回填的，按行为层算；设备实测走的是另一条路
        at: r.at,
      });
      if (stance !== 'unclear') markMilestone('funnel_reality_evidence');
      handleUpdateProbe(applied.probe);
      if (Object.keys(applied.updates).length) updateNode(node.id, applied.updates);
      // 走 ref：handleContradicted 定义在本函数之后（决策相关逻辑在文件更下面）
      if (applied.contradicted) contradictedDecisionRef.current?.(node.id);
      addNotification('info', '📱 手机回填已生效', `${node.title}：${r.summary.slice(0, 60)}`);
      return;
    }

    if (kind === 'device_call') {
      // 设备在电脑这一侧的局域网里，所以确认动作也必须在电脑上执行
      if (r.verdict === 'approve') {
        const out = await approvePending(sourceId);
        addNotification(out.ok ? 'info' : 'warning', out.ok ? '📱 手机确认，已执行' : '📱 手机确认，但执行失败', out.response.slice(0, 80));
      } else {
        dropPending(sourceId);
        addNotification('info', '📱 手机已拒绝该写操作', '未执行');
      }
    }
  }, [projectProbes, nodes, handleSettleAnchor, handleUpdateProbe, updateNode, addNotification]);

  const applyInboxReplyRef = useRef(applyInboxReply);
  useEffect(() => { applyInboxReplyRef.current = applyInboxReply; }, [applyInboxReply]);

  const inboxCountRef = useRef(0);
  useEffect(() => { inboxCountRef.current = inboxItems.length; }, [inboxItems.length]);

  useEffect(() => {
    if (!hasSyncBackend() || !user) return;
    let stopped = false;
    let empties = 0;
    let timer: any;

    const tick = async () => {
      if (stopped) return;
      try {
        const replies = await pullReplies();
        if (replies.length) {
          empties = 0;
          for (const r of replies) await applyInboxReplyRef.current(r);
          // 落地成功才 ack；ack 之前重复收到是预期行为，宁可重复也不要丢
          await ackReplies(replies.map(r => r.id));
        } else {
          empties += 1;
        }
      } catch { empties += 1; }
      if (!stopped) timer = setTimeout(tick, nextPollDelay(inboxCountRef.current, empties));
    };

    timer = setTimeout(tick, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [user]);

  /**
   * 为某个正在等结果的路标设计验证方案。
   * 探针挂到这一段的某个节点上，同时把 probeId 记到锚点里——
   * 探针一出结果，锚点自动结算（见 handleUpdateProbe）。
   */
  const handleDesignAnchorProbes = useCallback(async (anchorId: string) => {
    const route = routeRef.current;
    const anchor = route?.anchors.find(a => a.id === anchorId);
    if (!route || !anchor || !currentProjectId || routeBusy) return;
    const legNodes = nodesOfAnchor(nodes, anchorId);
    const host = legNodes[0] || nodes.find(n => n.noteType === 'overview');
    if (!host) return;

    setRouteBusy(`正在为「${anchor.title}」设计验证方案…`);
    try {
      // 把路标要验的东西塞进节点上下文，让 AI 直接照着这个路标设计
      const ctxNode: ProblemNode = {
        ...host,
        title: anchor.title,
        hypothesis: {
          statement: anchor.question,
          belief: 'medium',
          evidence: host.hypothesis?.evidence || [],
          unknown: anchor.needs,
          updatedAt: Date.now(),
        },
        validationReason: `路标判定标准：通过=${anchor.passIf}；不通过=${anchor.failIf}`,
      };
      const list = await designProbes(ctxNode, currentProject?.metaProblem || currentProject?.name);
      if (!list.length) { addNotification('warning', '没设计出方案', '换个模型或稍后再试。'); return; }
      const bound = list.map(p => ({ ...p, nodeId: host.id }));
      setProjects(prev => prev.map(p => p.id === currentProjectId
        ? {
          ...p,
          probes: [...(p.probes || []), ...bound],
          route: p.route ? {
            ...p.route,
            anchors: p.route.anchors.map(a => a.id === anchorId
              ? { ...a, probeIds: [...(a.probeIds || []), ...bound.map(b => b.id)] } : a),
          } : p.route,
        }
        : p));
      addNotification('info', `🔬 已为「${anchor.title}」设计 ${bound.length} 个方案`, `在笔记「${host.title}」的 🔬 面板里执行；出结果后路标会自动结算。`);
    } catch (e: any) {
      addNotification('warning', '设计失败', e?.message || '未知错误');
    } finally {
      setRouteBusy('');
    }
  }, [nodes, currentProject, currentProjectId, routeBusy, addNotification]);

  const handleSkipAnchor = useCallback(async (anchorId: string) => {
    const route = routeRef.current;
    if (!route) return;
    const next = skipAnchor(route, anchorId);
    setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, route: next } : p));
    routeRef.current = next;
    anchorPromptedRef.current = null;
    const na = currentAnchor(next);
    if (na) { const ok = await openLeg(next, na); if (ok) setTimeout(() => setIsLooping(true), 500); }
  }, [currentProjectId, currentProjectId, openLeg]);

  // ===== 对话流：问题卡的回答 =====
  const projectFeed = currentProject?.feed;
  // 「只看重要」：进度行里的普通信息不显示，问题卡和告警永远显示
  const visibleFeed = useMemo(
    () => (notificationMode === 'important' ? (projectFeed || []).filter(f => f.kind === 'ask' || f.tone !== 'info') : projectFeed || []),
    [projectFeed, notificationMode],
  );
  const pendingAskCount = useMemo(() => openAsks(projectFeed).length, [projectFeed]);

  /** 不经弹窗直接记一条决策（对话流里答的，快照在回答这一刻取） */
  const recordDecisionDirect = useCallback((nodeId: string, trigger: DecisionTrigger, question: string, options: DecisionOption[]) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !currentProjectId) return;
    const record = createDecision({ nodeId, nodeTitle: node.title, question, options, trigger, snapshot: captureSubtree(nodes, nodeId) });
    setProjects(prev => prev.map(p => p.id === currentProjectId ? saveStage({ ...p, nodes, decisions: [...(p.decisions || []), record] }, `决策：${question}`, '保留决策时的完整项目状态（后续操作执行前）', record.id) : p));
    trackEvent('record_decision', { trigger });
  }, [nodes, currentProjectId]);

  const handleAnswerFeed = useCallback((item: FeedItem, optionId: string, text?: string, aiWhy?: string) => {
    const ask = item.ask;
    if (!ask || ask.answer) return;
    const opt = ask.options.find(o => o.id === optionId);
    const typed = (text || '').trim();
    // 「我要改改」只是打开编辑器，不算拍板——卡片留着，改完在编辑器里确认
    if (ask.type === 'outline' && optionId === 'edit') {
      if (projectOutline?.status === 'draft' && projectOutline.id === item.ref) { setOutlineEditing(true); setSelectedNodeId(null); }
      else patchFeed(f => answerFeed(f, item.id, '已过期'));
      return;
    }
    const label = aiWhy ? `🤖 我自己决定：${aiWhy}` : typed ? (opt && opt.id !== ask.input?.optionId ? `${opt.label}：“${typed}”` : `“${typed}”`) : (opt?.label || optionId);
    patchFeed(f => answerFeed(f, item.id, label).map(x => (aiWhy && x.id === item.id && x.ask?.answer ? { ...x, ask: { ...x.ask, answer: { ...x.ask.answer, auto: true } } } : x)));
    if (aiWhy) noteAuto('think', `${item.text.replace(/\s+/g, ' ').slice(0, 60)} → ${aiWhy}`, item.nodeId);
    trackEvent('feed_answer', { type: ask.type, option: optionId, typed: typed ? 1 : 0 });
    const node = item.nodeId ? nodes.find(n => n.id === item.nodeId) : undefined;

    switch (ask.type) {
      case 'step': {
        if (aiWhy && currentProjectId) { setJustWroteId(null); resumeAutoRef.current?.(currentProjectId); break; }
        if (optionId === 'next') {
          const nextId = outlineDone.next?.nodeId;
          if (typed && nextId) updateNode(nextId, { userAsk: typed });
          setJustWroteId(null); setIsLooping(true);
        } else if (optionId === 'rewrite' && node) {
          updateNode(node.id, { status: NodeStatus.UNEXPLORED, notes: '', validationReason: undefined, userAsk: typed || undefined, noteUpdatedAt: Date.now(), ...(node.outlineItemId ? { fullNote: rewriteStub(node) } : {}) });
          forceNodeRef.current = node.id;
          setJustWroteId(null); setIsLooping(true);
          trackEvent('step_rewrite');
        } else if ((optionId === 'survey' || optionId === 'page') && node) {
          realityRef.current?.(node, optionId);
        } else if (optionId === 'seek' && node && currentProjectId) {
          // AI 做不了的那一件现实里的事 → 去服务广场找人 / Agent 做；没有合适的就帮你起草需求
          const need = node.hypothesis?.unknown || node.hypothesis?.statement || node.title;
          setMarketSeek({ factId: node.id, claim: need, scope: '', source: '', question: node.title, projectId: currentProjectId, task: true });
          setShowServiceMarket(true);
          setJustWroteId(null);
          trackEvent('step_seek_help');
        } else if (optionId === 'result' && node && typed && currentProjectId) {
          // 闭环：用户在现实里做了 → 结果先进事实看板（待核实），再拿真实结果把这一步重新推进一遍
          try {
            inquiryTeams.change(currentProjectId, 'root', currentProject?.metaProblem || currentProject?.name || '', w => addFact(w, { claim: `「${node.title}」现实结果：${typed}`, source: '你在现实里做的（你告诉 AI 的）', excerpt: typed, scope: node.hypothesis?.unknown || '' }));
          } catch (e) { console.warn('[step] 结果没能记进事实看板', e); }
          const base = node.outlineItemId ? rewriteStub(node) : '';
          updateNode(node.id, { status: NodeStatus.UNEXPLORED, validationReason: undefined, noteUpdatedAt: Date.now(),
            ...(base ? { fullNote: `${base}\n## 🧪 现实结果（${new Date().toLocaleDateString()} 你做完告诉我的）\n${typed}\n` } : {}),
            userAsk: `用户已经在现实里做了这件事，真实结果是：${typed}。按这个结果重新推进这一步：结果说明了什么、原来的判断要不要改、接下来具体做什么。` });
          pushFeedItem(feedStatus(`🧪 收到现实结果，按它重新推进「${node.title}」`, { tone: 'good', detail: typed }));
          markMilestone('funnel_reality_evidence');
          forceNodeRef.current = node.id;
          setJustWroteId(null); setIsLooping(true);
          trackEvent('step_reality_result');
        } else if (optionId === 'stop') {
          setJustWroteId(null); setIsLooping(false);
        } else if (optionId === 'auto') {
          setJustWroteId(null);
          startBatch(Math.min(BATCH_SIZE, Math.max(1, remainingCount(nodes))));
        }
        break;
      }
      case 'batch': {
        if (optionId === 'more') startBatch(Math.min(BATCH_SIZE, Math.max(1, remainingCount(nodes))));
        else if (optionId === 'step' && currentProjectId) patchProject(currentProjectId, { pace: 'step' });
        break;
      }
      case 'branch': {
        if (!node) break;
        // 自主运行走到岔路口：第一次不直接标完成（那样只留下草稿），而是自己选一个方向、把这一步按这个方向重新做出可验证的结果
        if (aiWhy && optionId === 'continue' && !node.autoDecided) {
          updateNode(node.id, { status: NodeStatus.UNEXPLORED, pendingDecision: undefined, autoDecided: true,
            userAsk: `你是自主运行的项目负责人，用户不在。这一步走到了岔路口${node.pendingDecision?.context ? `（${String(node.pendingDecision.context).slice(0, 200)}）` : ''}：自己选一个方向并写明理由，然后按这个方向把这一步做出能验证的结果；需要真人 / 现实里做的部分，写成要在服务广场找的服务（交付什么、验收标准、预算）。` });
          if (decision?.nodeId === node.id) setDecision(null);
          setIsLooping(true);
          break;
        }
        if (optionId === 'terminate') updateNode(node.id, { status: NodeStatus.INVALID, pendingDecision: undefined });
        else if (optionId === 'retry') updateNode(node.id, { status: NodeStatus.UNEXPLORED, pendingDecision: undefined });
        else if (optionId === 'add_subproblem' && typed) { addNode(typed, [node.id]); updateNode(node.id, { status: NodeStatus.SOLVED, pendingDecision: undefined }); }
        else updateNode(node.id, { status: NodeStatus.SOLVED, pendingDecision: undefined });
        if (decision?.nodeId === node.id) setDecision(null);
        setIsLooping(true);
        break;
      }
      case 'contradicted': {
        if (!node) break;
        if (optionId !== 'skip') {
          const st = node.hypothesis?.statement;
          const drop = optionId === 'drop';
          recordDecisionDirect(node.id, 'contradicted',
            st ? `「${st}」被现实推翻了，接下来怎么走？` : `「${node.title}」的假设被现实推翻了，接下来怎么走？`,
            [
              { label: '换一个假设，继续探索这个方向', chosen: !drop, reason: !drop && typed ? typed : undefined },
              { label: '这个方向作废，把力气转到别处', chosen: drop, reason: drop && typed ? typed : undefined },
            ]);
          if (drop) updateNode(node.id, { status: NodeStatus.INVALID });
        }
        // 一篇一停：转向的事答完了，再问「下一篇」
        if (justWroteId === node.id) pushFeedItem(stepAsk(node, outlineDone));
        break;
      }
      case 'reality': {
        if (optionId === 'open' && item.nodeId) setSelectedNodeId(item.nodeId);
        break;
      }
      case 'anchor': {
        if (optionId === 'skip' && item.ref) handleSkipAnchor(item.ref);
        else if (currentProject) openProjectPage(currentProject.id, 'root', 'research');
        break;
      }
      case 'unattended': {
        if (optionId === 'go') { unattendedRef.current = 0; setIsLooping(true); trackEvent('unattended_resume'); }
        break;
      }
      case 'halted': {
        if (optionId === 'settings') setShowSettingsModal(true);
        else {
          consecutiveFailRef.current = 0;
          const pa = currentProjectId ? projectsRef.current.find(p => p.id === currentProjectId)?.autonomy : undefined;
          if (currentProjectId && pa?.on && pa.pausedFor === 'important') { patchAutonomy(currentProjectId, { pausedFor: undefined }); resumeAutoRef.current?.(currentProjectId); }
          else setIsLooping(true);
        }
        break;
      }
      case 'charter': {
        if (!currentProjectId) break;
        const charter = optionId.startsWith('cny:')
          ? { autoBuyCNY: Number(optionId.slice(4)) || 0, confirmedAt: Date.now() }
          : charterFromText(typed);
        const kiAfterCharter = remember(projectsRef.current.find(p => p.id === currentProjectId)?.keyInfo, 'budget', '花钱权限', charterLabel(charter), 'charter');
        projectsRef.current = projectsRef.current.map(p => (p.id === currentProjectId ? { ...p, charter, keyInfo: kiAfterCharter } : p));
        patchProject(currentProjectId, { charter: { ...charter, allowJobs: projectsRef.current.find(p => p.id === currentProjectId)?.charter?.allowJobs }, keyInfo: kiAfterCharter });
        void syncPm(currentProjectId);
        // 记进项目总览，以后能查「当初说好的」
        setProjects(prev => prev.map(p => p.id === currentProjectId ? {
          ...p,
          nodes: (p.nodes || []).map(n => n.noteType === 'overview'
            ? { ...n, fullNote: `${n.fullNote || ''}\n\n**花钱权限**（${new Date().toLocaleDateString()}）：${charterLabel(charter)}\n`, noteUpdatedAt: Date.now() }
            : n),
        } : p));
        const startId = item.nodeId && nodes.some(n => n.id === item.nodeId && n.status === NodeStatus.UNEXPLORED) ? item.nodeId : undefined;
        const willAsk = !!startId && !!nextPending(kiAfterCharter);
        pushFeedItem(feedStatus(`📌 记进 AI 记忆：${charterLabel(charter)}`, { tone: 'good' }));
        void willAsk;
        trackEvent('charter_set', { autoBuy: charter.autoBuyCNY, monthly: charter.monthlyCNY || 0 });
        if (startId && !askNextInfo(currentProjectId, startId)) beginWork(startId);
        break;
      }
      case 'info': {
        if (!currentProjectId || !item.ref) break;
        const cur = projectsRef.current.find(p => p.id === currentProjectId)?.keyInfo;
        const k = cur?.find(x => x.id === item.ref);
        if (!k) break;
        let list = cur!;
        if (optionId === 'answer' && typed) {
          list = answerInfo(cur, k.id, typed);
          pushFeedItem(feedStatus(`📌 记进 AI 记忆：${k.question.replace(/[？?]$/, '')} → ${typed}`, { tone: 'good' }));
        } else if (optionId === 'skip') {
          list = skipInfo(cur, k.id);
        }
        projectsRef.current = projectsRef.current.map(p => (p.id === currentProjectId ? { ...p, keyInfo: list } : p));
        patchProject(currentProjectId, { keyInfo: list });
        trackEvent('key_info', { option: optionId, source: k.source });
        if (optionId === 'start') { pushFeedItem(feedStatus('好，剩下的以后再问')); beginWork(item.nodeId); break; }
        // 答了 / 跳过：趁你在，接着问下一个；开工前的问完就开始写
        const chain = optionId !== 'later' || !!item.nodeId;
        if (chain && askNextInfo(currentProjectId, item.nodeId)) break;
        if (item.nodeId) { pushFeedItem(feedStatus('问完了')); beginWork(item.nodeId); }
        else {
          const pa = projectsRef.current.find(p => p.id === currentProjectId)?.autonomy;
          if (pa?.on && pa.pausedFor === 'user' && chain) { patchAutonomy(currentProjectId, { pausedFor: undefined }); pushFeedItem(feedStatus('问完了，我接着自主运行')); resumeAutoRef.current?.(currentProjectId); }
        }
        break;
      }
      case 'report': {
        if (!currentProjectId) break;
        const pid = currentProjectId;
        if (typed) {
          // 你的调整记进 AI 记忆，之后照着做
          const ki = remember(projectsRef.current.find(p => p.id === pid)?.keyInfo, 'other', '自主运行时的要求', typed, 'user');
          projectsRef.current = projectsRef.current.map(p => (p.id === pid ? { ...p, keyInfo: ki } : p));
          patchProject(pid, { keyInfo: ki });
          noteAuto('think', `你要求：${typed}——记下了，照这个做`);
          pushFeedItem(feedStatus(`📌 记进 AI 记忆：${typed}`, { tone: 'good' }));
        }
        if (optionId === 'pause') {
          patchAutonomy(pid, { pausedFor: 'user' });
          if (continuousMode) endBatch('stopped');
          pushFeedItem(feedStatus('⏸ 好，我先停着。点「⚡ 自主运行」我就接着做'));
        } else if (optionId === 'questions') {
          patchAutonomy(pid, { pausedFor: 'user' });
          if (!askNextInfo(pid)) { patchAutonomy(pid, { pausedFor: undefined }); resumeAutoRef.current?.(pid); }
        } else {
          patchAutonomy(pid, { pausedFor: undefined });
          resumeAutoRef.current?.(pid);
        }
        break;
      }
      case 'realityPlan': {
        const pend = pendingActionsRef.current[item.id];
        delete pendingActionsRef.current[item.id];
        if (!pend) break;
        if (optionId === 'go') void executeReality(pend.pid, pend.node, pend.action);
        else if (optionId === 'market') pmActRef.current?.(pend.node);
        break;
      }
      case 'digest': {
        if (optionId === 'open' && currentProject) openProjectPage(currentProject.id, 'root', 'research');
        break;
      }
      case 'outline': {
        if (projectOutline?.status !== 'draft' || projectOutline.id !== item.ref) break;
        if (optionId === 'confirm') {
          const firstId = handleConfirmOutline();
          // 确认 + （谈过预算就）直接写第一篇；没谈过先问花钱权限
          startAfterOutline(firstId);
        } else if (optionId === 'redo') {
          handleProposeOutline(undefined, undefined, typed || undefined);
        }
        break;
      }
    }
  }, [nodes, projectOutline, outlineDone, justWroteId, decision, currentProject, currentProjectId, patchFeed, pushFeedItem, updateNode, addNode, patchProject, recordDecisionDirect, handleConfirmOutline, handleProposeOutline, handleSkipAnchor, openProjectPage, startAfterOutline, askNextInfo, kickoffWriting, beginWork, noteAuto, patchAutonomy, inquiryTeams, syncPm, executeReality]);
  useEffect(() => { answerFeedRef.current = handleAnswerFeed; }, [handleAnswerFeed]);

  /** 打开决策记录弹窗（打开时就对节点子树做快照，保证删除/失效前的状态被留存） */
  const openDecisionRecorder = useCallback((nodeId: string, trigger: DecisionTrigger, opts?: { pendingAction?: 'delete' | 'invalidate'; presetQuestion?: string; presetOptions?: { label: string; chosen: boolean }[]; skippable?: boolean }) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    if (!currentProjectId) return;
    setDecisionDraft({
      projectId: currentProjectId, nodeId, nodeTitle: node.title, trigger,
      snapshot: captureSubtree(nodes, nodeId),
      presetQuestion: opts?.presetQuestion,
      presetOptions: opts?.presetOptions,
      skippable: opts?.skippable,
      pendingAction: opts?.pendingAction,
    });
  }, [nodes, currentProjectId]);

  /** 执行关键时机弹窗附带的动作（删除 / 设为无效） */
  const runPendingDecisionAction = useCallback((draft: DecisionDraft & { pendingAction?: 'delete' | 'invalidate' }) => {
    if (draft.pendingAction === 'delete') handleDeleteNode(draft.nodeId);
    else if (draft.pendingAction === 'invalidate') updateNode(draft.nodeId, { status: NodeStatus.INVALID });
  }, [handleDeleteNode, updateNode]);

  /**
   * 假设被现实推翻 → 弹决策记录（可跳过）。
   * 这才是决策中心最该出现的时刻：现实打脸 → 留痕 → 以后能 fork 回到旧路线对比。
   */
  const handleContradicted = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const st = node.hypothesis?.statement;
    openDecisionRecorder(nodeId, 'contradicted', {
      presetQuestion: st ? `「${st}」被现实推翻了，接下来怎么走？` : `「${node.title}」的假设被现实推翻了，接下来怎么走？`,
      presetOptions: [
        { label: '换一个假设，继续探索这个方向', chosen: true },
        { label: '这个方向作废，把力气转到别处', chosen: false },
      ],
      skippable: true, // 跳过 = 不留记录，节点状态已经改了
    });
  }, [nodes, openDecisionRecorder]);
  // 自动发现的「被现实推翻」（路标没通过 / 手机回填）不再弹窗，在对话流里问一句；
  // 笔记里手动点的 onContradicted 仍走 handleContradicted 弹完整表单
  useEffect(() => {
    contradictedDecisionRef.current = (nodeId: string) => {
      const n = nodes.find(x => x.id === nodeId);
      if (n) pushFeedItem(contradictedAsk(n));
    };
  }, [nodes, pushFeedItem]);

  const handleSaveDecision = useCallback((question: string, options: DecisionOption[]) => {
    if (!decisionDraft || !currentProjectId || decisionDraft.projectId !== currentProjectId) return;
    const record = createDecision({ nodeId: decisionDraft.nodeId, nodeTitle: decisionDraft.nodeTitle, question, options, trigger: decisionDraft.trigger, snapshot: decisionDraft.snapshot });
    setProjects(prev => prev.map(p => p.id === currentProjectId ? saveStage({ ...p, nodes, decisions: [...(p.decisions || []), record] }, `决策：${question}`, '保留决策时的完整项目状态（后续操作执行前）', record.id) : p));
    runPendingDecisionAction(decisionDraft);
    setDecisionDraft(null);
    trackEvent('record_decision', { trigger: decisionDraft.trigger });
  }, [decisionDraft, currentProjectId, nodes, runPendingDecisionAction]);

  const handleSkipDecision = useCallback(() => {
    if (!decisionDraft) return;
    runPendingDecisionAction(decisionDraft);
    setDecisionDraft(null);
  }, [decisionDraft, runPendingDecisionAction]);

  /** 从决策点 fork：用当时的快照在同项目里复刻一条新分支，新旧路线并存 */
  const handleForkDecision = useCallback((decisionId: string) => {
    if (!currentProjectId) return;
    const record = projectDecisions.find(d => d.id === decisionId);
    if (!record) return;
    const { nodes: forked, rootId } = forkFromDecision(record, new Set(nodes.map(n => n.id)));
    setNodes(prev => [...prev, ...forked]);
    setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, decisions: (p.decisions || []).map(d => d.id === decisionId ? { ...d, forks: [...(d.forks || []), { rootNodeId: rootId, createdAt: Date.now() }] } : d) } : p));
    setSelectedNodeId(rootId);
    setShowDecisionTimeline(false);
    trackEvent('fork_decision');
  }, [currentProjectId, projectDecisions, nodes]);

  const handleDeleteDecision = useCallback((decisionId: string) => {
    if (!currentProjectId) return;
    setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, decisions: (p.decisions || []).filter(d => d.id !== decisionId) } : p));
  }, [currentProjectId]);
  const handleGenerateReport = async () => { if (!currentProject || isGeneratingReport) return; setIsGeneratingReport(true); try { setResearchReport(await generateResearchReport(currentProject.metaProblem, nodes, knowledgeCards)); } finally { setIsGeneratingReport(false); } };

  // 左侧项目树的小绿灯：自动写作循环在跑，或 AI 团队 / 项目经理在这个项目里干活
  const activeProjectIds = projects.filter(p => (p.id === currentProjectId && isLooping) || inquiryTeams.isProjectRunning(p.id) || inquiryTeams.isManaging(p.id)).map(p => p.id);
  const worktreeBusy = !!(isLooping || isProcessingRef.current || isGeneratingReport || teamBusy || outlineBusy || routeBusy || simBusy || overviewRefreshingRef.current || isProposingRef.current || (currentProjectId && inquiryTeams.isProjectRunning(currentProjectId)));
  // ===== 项目「活着」：长期关注、低频醒来看一眼 =====
  // 所有项目默认 watching；醒来看到的东西记进项目自己的关注日志，不刷对话框。
  const [wakingId, setWakingId] = useState<string | null>(null);
  /** 各项目云端长期关注的状态（来自项目总览里的云端面板）。开着云端的项目，浏览器里就不再自己醒，免得重复花钱 */
  const [cloudWatch, setCloudWatch] = useState<Record<string, { enabled: boolean; nextCheckAt?: number; lastSummary?: string; lastAt?: number }>>({});
  // （必须在 cloudWatch 声明之后：之前写在前面，碰到待机项目就会读到未初始化的变量）
  const aliveProjectIds = projects.filter((p, i) => lifeOf(p, Date.now(), i).state === 'watching' || cloudWatch[p.id]?.enabled).map(p => p.id);
  // 点亮：每个项目的灯（活跃 / 休眠 / 待机）
  const glowNow = Date.now();
  const projectGlow: Record<string, { glow: Glow; line: string }> = Object.fromEntries(projects.map((p, i) => {
    const life = lifeOf(p, glowNow, i);
    const g = glowOf(life, { active: activeProjectIds.includes(p.id) || wakingId === p.id, cloud: !!cloudWatch[p.id]?.enabled });
    return [p.id, { glow: g, line: glowLine(g, life, p.createdAt || glowNow, glowNow) }];
  }));
  const cloudWatchRef = useRef(cloudWatch);
  useEffect(() => { cloudWatchRef.current = cloudWatch; }, [cloudWatch]);
  const [openActivation, setOpenActivation] = useState(0);
  const pulseBusyRef = useRef(false);
  const patchLife = useCallback((projectId: string, fn: (life: NonNullable<Project['life']>) => NonNullable<Project['life']>) => {
    setProjects(prev => prev.map((p, i) => (p.id === projectId ? { ...p, life: fn(lifeOf(p, Date.now(), i)) } : p)));
  }, []);
  /**
   * 点亮 / 待机。点亮 = 这个项目一直活着：按节奏醒来找线索、找机会，遇到只有你知道的事会来问你。
   * 待机 = 用户叫它停：手上的事停下，不再自己醒（云端那份也一起停），随时可以再点亮。
   */
  const lightProject = useCallback(async (projectId: string, on: boolean) => {
    const p = projectsRef.current.find(x => x.id === projectId);
    if (!p) return;
    if (!on) {
      if (cloudWatchRef.current[projectId]?.enabled) {
        try { await pauseCloudProject(p); setCloudWatch(prev => ({ ...prev, [projectId]: { ...prev[projectId], enabled: false } })); }
        catch { addNotification('warning', '云端那份没停下来', '网络恢复后再试一次；本机这边已经待机。'); }
      }
      if (projectId === currentProjectId) { isLoopingRef.current = false; batchRef.current = null; setIsLooping(false); setContinuousMode(false); }
      inquiryTeams.stopProject(projectId);
    }
    patchLife(projectId, l => setWatching(l, on, Date.now()));
    pushFeedItem(on
      ? feedStatus('💡 点亮了。从现在起它一直活着：按节奏醒来找线索、找机会，遇到只有你知道的事会来问你。', { tone: 'good' })
      : feedStatus('🌙 待机了：手上的事先停下，不会自己醒来。想继续的时候，右键项目再点亮。'), projectId);
    trackEvent(on ? 'project_light' : 'project_standby');
  }, [currentProjectId, patchLife, pushFeedItem, addNotification, inquiryTeams]);

  // 老项目没有 life 字段：补上默认值（第一次醒来错开，不会一起醒）
  useEffect(() => {
    if (!loadedOwner || !projects.some(p => !p.life)) return;
    const now = Date.now();
    let k = 0;
    setProjects(prev => prev.map(p => (p.life ? p : { ...p, life: defaultLife(now, k++) })));
  }, [loadedOwner, projects.length]);
  // 用户打开项目 = 他还在关注它；很久没来看导致放慢的节奏，拉回来
  useEffect(() => { if (currentProjectId) patchLife(currentProjectId, l => touchViewed(l, Date.now())); }, [currentProjectId, patchLife]);

  const readPulseBudget = (): PulseBudget | null => { try { return JSON.parse(localStorage.getItem('aae-pulse-budget') || 'null'); } catch { return null; } };
  const writePulseBudget = (b: PulseBudget) => { try { localStorage.setItem('aae-pulse-budget', JSON.stringify(b)); } catch {} };

  /** 找一个能联网搜索的共享模型（百炼/千问，额度够一次搜索的预留） */
  const pickSearchModel = async (): Promise<string | null> => {
    if (!SHARED_API) return null;
    try { if (!localStorage.getItem('aae-auth-token')) return null; } catch { return null; }
    try {
      const c = await sharedRequest<SharedCatalog>('/shared/catalog');
      const m = c.models.find(x => x.enabled && x.hasKey && /dashscope(-intl)?\.aliyuncs\.com/.test(x.baseUrl) && ((c.balances[x.id]?.available || 0) >= 20000 || (!!x.priceCentsPerM && (c.walletCents || 0) >= 100)));
      return m?.id || null;
    } catch { return null; }
  };

  /** 让一个项目醒来看一眼：一次小模型调用，结果写进关注日志 */
  const wakeProject = useCallback(async (projectId: string, manual = false) => {
    if (pulseBusyRef.current) return;
    const idx = projectsRef.current.findIndex(p => p.id === projectId);
    const project = projectsRef.current[idx];
    if (!project) return;
    pulseBusyRef.current = true;
    setWakingId(projectId);
    const now = Date.now();
    writePulseBudget(spendBudget(readPulseBudget(), now));
    try {
      // 能联网就联网：登录了、后台有开放的千问共享模型且额度够，就走联网搜索（带出处）；否则退回只靠推理
      let parsed: ReturnType<typeof parsePulse> | null = null;
      const searchModel = await pickSearchModel();
      if (searchModel) {
        try {
          const r = await sharedRequest<{ content: string; sources?: { index: number; title: string; url: string; site?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }>('/shared/chat', 'POST', {
            modelId: searchModel, requestId: crypto.randomUUID(), messages: buildPulseMessages(project, now, { web: true }), maxTokens: 700, webSearch: true,
          }, 90000);
          if (r.usage) await meterFor(projectId, async () => reportModelUsage({ model: searchModel, provider: 'platform', input: r.usage!.prompt_tokens || 0, output: r.usage!.completion_tokens || 0 }));
          parsed = parsePulse(r.content, r.sources || []);
        } catch (e) { console.warn('[pulse] 联网搜索不可用，退回推理', e); }
      }
      if (!parsed) {
        const res = await meterFor(projectId, () => callLLM(buildPulseMessages(project, now), { jsonMode: true, maxTokens: 700, timeoutMs: 60000, task: 'simple' }));
        parsed = parsePulse(res.content);
      }
      const before = lifeOf(project, now, idx);
      const { life, added } = applyPulse(before, parsed, Date.now());
      const show = notableToShow(before, added, Date.now());
      patchLife(projectId, () => (show ? { ...life, lastNotifiedAt: Date.now() } : life));
      // 只有真正值得打扰的才在对话流里出一行，而且每个项目一天最多一行
      if (show) pushFeedItem(feedStatus(`🌱 关注到：${show.title}`, { detail: show.detail || undefined, tone: 'good' }), projectId);
      // 醒来时想到一件只有用户知道的事 → 记进待问，主动问（同一时间只挂一张）
      if (parsed.askUser) {
        const ki = addPending(projectsRef.current.find(p => p.id === projectId)?.keyInfo, [parsed.askUser], 'pulse');
        projectsRef.current = projectsRef.current.map(p => (p.id === projectId ? { ...p, keyInfo: ki } : p));
        patchProject(projectId, { keyInfo: ki });
      }
      askNextInfo(projectId);
      // 允许接单的项目：醒来时顺便去服务广场看看有没有能接的单（每 6 小时最多一次）
      const pj = projectsRef.current.find(p => p.id === projectId);
      let lastJobs = 0; try { lastJobs = Number(localStorage.getItem(`hx-pm-jobs:${projectId}`) || 0); } catch { /* ignore */ }
      if (pj?.charter?.allowJobs && Date.now() - lastJobs > 6 * 3600_000) void workJobs(projectId).catch(e => console.warn('[pm] 接单失败', e));
      trackEvent('pulse_wake', { added: added.length, manual: manual ? 1 : 0 });
    } catch (e) {
      patchLife(projectId, l => failPulse(l, Date.now(), e instanceof Error ? e.message : String(e)));
    } finally {
      pulseBusyRef.current = false;
      setWakingId(null);
    }
  }, [patchLife, pushFeedItem, patchProject, askNextInfo, workJobs]);

  // 调度：每 5 分钟看一次有没有该醒的项目；一次只醒一个；全局每天最多 6 次、两次之间至少隔 20 分钟
  useEffect(() => {
    if (!user || !loadedOwner) return;
    const tick = () => {
      if (pulseBusyRef.current) return;
      // 免配置体验额度很少（匿名一天 5 次），不能让后台醒来把新用户的额度吃掉：体验模式下只在用户点「现在看一眼」时醒
      if (isTrialMode()) return;
      const now = Date.now();
      if (!budgetAllows(readPulseBudget(), now)) return;
      const due = pickDue(projectsRef.current, now, id =>
        (id === feedProjectRef.current && isLoopingRef.current) || inquiryTeams.isProjectRunning(id) || !!cloudWatchRef.current[id]?.enabled);
      if (due) void wakeProject(due.id);
    };
    const first = setTimeout(tick, 60_000);
    const timer = setInterval(tick, 5 * 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [user, loadedOwner, wakeProject]);

  const keyInfoPanel = currentProject ? (
    <KeyInfoPanel items={currentProject.keyInfo} onChange={fn => {
      const pid = currentProject.id;
      setProjects(prev => prev.map(p => {
        if (p.id !== pid) return p;
        const keyInfo = fn(p.keyInfo || []);
        // 在面板里答了 / 删了的问题，聊天里那张卡就收起来
        const stillPending = new Set(keyInfo.filter(k => k.status === 'pending').map(k => k.id));
        const feed = (p.feed || []).map(f => (f.ask?.type === 'info' && !f.ask.answer && f.ref && !stillPending.has(f.ref)
          ? { ...f, ask: { ...f.ask, answer: { label: '已在 AI 记忆里处理', at: Date.now(), auto: true } } } : f));
        return { ...p, keyInfo, feed };
      }));
    }} />
  ) : null;

  const walletPanel = currentProject ? (
    <ProjectWallet project={currentProject}
      onEditCharter={() => { patchFeed(f => pushFeed(closeAsks(f, 'charter', '已重新问'), charterAsk(currentProject.id)), currentProject.id); setRightChatOpen(true); }}
      onOpenMarket={() => { setMarketSeek(null); setShowServiceMarket(true); }}
      onToggleJobs={on => toggleJobs(currentProject.id, on)}
      onWorkJobs={() => workJobs(currentProject.id)}
      onModelPolicy={p => setModelPolicy(currentProject.id, p)}
      profileBusy={profileBusy}
      onRefreshProfile={() => refreshProfile(currentProject.id, true)}
      onPublishProfile={on => publishProfile(currentProject.id, on)} />
  ) : null;

  const pulsePanel = currentProject ? (<div className="space-y-3">
    <DigestPanel digests={currentProject.digests} busy={digestBusy} onNow={() => void giveDigest(currentProject.id, true)} />
    <RealityPanel checks={currentProject.realityChecks} onUpload={loggedIn() ? uploadRecording : undefined} onSync={() => syncReality(currentProject.id)} onClose={async (id: string) => { try { await platformRequest(`/pages/${id}/close`, 'POST'); patchChecks(currentProject.id, l => patchCheck(l, id, { closed: true })); } catch (e) { addNotification('warning', '没能关闭页面', e instanceof Error ? e.message : String(e)); } }} onOpenNode={(id: string) => setSelectedNodeId(id)} />
    <ProjectPulse
      life={lifeOf(currentProject, Date.now(), projects.indexOf(currentProject))}
      waking={wakingId === currentProject.id}
      autoOff={isTrialMode()}
      charter={currentProject.charter ? charterLabel(currentProject.charter) : undefined}
      onEditCharter={() => { patchFeed(f => pushFeed(closeAsks(f, 'charter', '已重新问'), charterAsk(currentProject.id)), currentProject.id); setRightChatOpen(true); }}
      cloud={WAKE_API ? { ...(cloudWatch[currentProject.id] || { enabled: false }), onSetup: () => setOpenActivation(n => n + 1) } : undefined}
      onWakeNow={() => void wakeProject(currentProject.id, true)}
      onCadence={h => patchLife(currentProject.id, l => setCadence(l, h, Date.now()))}
      onToggle={on => void lightProject(currentProject.id, on)}
      glow={{ glow: projectGlow[currentProject.id]?.glow || 'dormant', days: litDays(lifeOf(currentProject, Date.now(), projects.indexOf(currentProject)), currentProject.createdAt || Date.now(), Date.now()) }}
      onToFact={note => {
        try {
          inquiryTeams.change(currentProject.id, 'root', currentProject.metaProblem || currentProject.name, w => addFact(w, { claim: note.title + (note.detail ? `：${note.detail}` : ''), source: note.url || 'AI 项目经理的关注日志（待核实）', excerpt: '', scope: '' }));
          patchLife(currentProject.id, l => ({ ...l, journal: l.journal.map(j => (j.id === note.id ? { ...j, handled: 'fact' as const } : j)) }));
        } catch (e) { addNotification('warning', '没能记进事实看板', e instanceof Error ? e.message : String(e)); }
      }}
      onDismiss={note => patchLife(currentProject.id, l => ({ ...l, journal: l.journal.map(j => (j.id === note.id ? { ...j, handled: 'dismissed' as const } : j)) }))}
      onOpenNote={title => { const n = resolveNodeByTitle(nodes, title); if (n) setSelectedNodeId(n.id); }}
    />
    {keyInfoPanel}
  </div>
  ) : null;

  const stopProjectWork = () => {
    isLoopingRef.current = false;
    batchRef.current = null; setIsLooping(false); setContinuousMode(false);
    if (currentProjectId) inquiryTeams.stopProject(currentProjectId);
  };
  const restoreProjectStage = (next: Project) => {
    if (worktreeBusy) throw new Error('请先暂停任务并等待当前请求结束');
    workspaceEpochRef.current++;
    stopProjectWork();
    setProjects(prev => prev.map(p => p.id === next.id ? next : p));
    projectsRef.current = projectsRef.current.map(p => p.id === next.id ? next : p);
    setNodes(next.nodes);
    setKnowledgeCards(next.knowledgeCards || []); setResearchFindings(next.researchFindings || []);
    setResearchReport(null); setDecision(null); setDecisionDraft(null); setJustWroteId(null);
    forceNodeRef.current = null; pendingSelectRef.current = null;
    routeRef.current = next.route; outlineRef.current = next.outline; anchorPromptedRef.current = null;
    openProjectPage(next.id, 'root', 'research');
  };
  const worktreeActions = {
    save: (label: string, reason: string) => {
      if (!currentProject) return;
      const next = saveStage({ ...currentProject, nodes }, label, reason);
      setProjects(prev => prev.map(p => p.id === next.id ? { ...p, worktree: next.worktree } : p));
    },
    branch: (stageId: string, name: string) => {
      if (currentProject) restoreProjectStage(branchFromStage({ ...currentProject, nodes }, stageId, name));
    },
    switchBranch: (branchId: string) => {
      if (currentProject) restoreProjectStage(switchExplorationBranch({ ...currentProject, nodes }, branchId));
    },
    recordDecision: () => {
      const node = nodes.find(n => n.noteType === 'overview') || nodes[0];
      if (node) openDecisionRecorder(node.id, 'manual', { presetQuestion: `「${currentProject?.name || '项目'}」接下来选择哪条探索路线？` });
    },
    legacyFork: handleForkDecision,
  };

  if (routeInfo.type === 'delegate' && routeInfo.nodeId) return <DelegationView nodeId={routeInfo.nodeId} taskTitle={routeInfo.taskTitle} />;

  /** 落地页是否展示仿真区块：管理员入口和验证码环节要专注，不塞东西 */
  const showLandingSim = !isLoginAsAdmin && !isOtpSent && !landingLogin;

  if (!user) return (
    <div className="h-[100dvh] w-full overflow-y-auto bg-slate-950 text-slate-200">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <span className="font-semibold">HiExplore</span>
          <div className="flex items-center gap-2">
            <select aria-label="Language" className="bg-slate-800 text-slate-200 rounded-lg p-2 text-xs" value={language} onChange={e => setLanguage(e.target.value as 'zh-CN' | 'en')}><option value="zh-CN">简体中文</option><option value="en">English</option></select>
            <button type="button" onClick={() => setShowServiceMarket(true)} className="shrink-0 rounded-lg border border-slate-700 hover:bg-slate-800 px-3 py-2 text-sm text-slate-200" title={ui('全站公开：不用登录也能看大家挂的服务和需求', 'Browse public services and needs')}>{ui('服务广场', 'Marketplace')}</button>
            <button type="button" onClick={() => { setLandingLogin(true); setIsLoginAsAdmin(false); setLoginMethod('email'); document.getElementById('landing-content')?.scrollIntoView({ block: 'start' }); }} className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold text-white">{ui('登录 / 注册', 'Log in / Sign up')}</button>
          </div>
        </div>
      </header>
      {showLandingSim && <LandingHero
        onTrial={hasTrialBackend() ? () => { trackEvent('trial_start'); setUser(auth.loginAsGuest()); } : undefined}
        onLogin={() => { setLandingLogin(true); setIsLoginAsAdmin(false); setLoginMethod('email'); setTimeout(() => document.getElementById('landing-content')?.scrollIntoView({ block: 'start' }), 0); }}
        onMarket={() => setShowServiceMarket(true)} />}
      {!showLandingSim && (
      <main id="landing-content" className="scroll-mt-20 flex justify-center p-4 sm:py-8">
      <div className="w-full max-w-md">
        {landingLogin && !isOtpSent && <button onClick={() => setLandingLogin(false)} className="mb-3 text-[13px] text-slate-400 hover:text-white">← {ui('返回首页', 'Back')}</button>}
      <div id="landing-card" className="max-w-md w-full mx-auto bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 to-emerald-600"></div>
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-xl">🧭</div>
          <h2 className="text-xl sm:text-2xl font-bold">{landingLogin ? ui('邮箱登录 / 注册', 'Email login / sign up') : 'HiExplore'}</h2>
          {isLoginAsAdmin ? (
            <p className="text-slate-500 text-xs sm:text-sm mt-2">{ui("管理员验证")}</p>
          ) : (
            /*
              首屏必须先回答「这是什么」再要东西。
              数据依据：上线首 12 天 40 访客只有 3 次登录、跳出率 86%、平均停留 47 秒——
              访客落地看到的是一个要邮箱的表单，没有任何信息告诉他为什么要填。
            */
            <p className="text-slate-400 text-[13px] leading-6 mt-3">{ui("带一个你真想弄明白的问题来，", "Bring a question you really want answered — ")}<br className="sm:hidden" />{ui("剩下的交给它", "and let it take over")}</p>
          )}
        </div>

        {!isLoginAsAdmin && !isOtpSent && !landingLogin && (
          <div className="mb-6 space-y-2 text-[12px] text-slate-400 leading-6">
            <div className="flex gap-2"><span className="text-blue-400">01</span><span>{ui("说出问题，一起定好目标和启动资金", "Describe the question; agree on the goal and a starting budget")}</span></div>
            <div className="flex gap-2"><span className="text-blue-400">02</span><span>{ui("它自己拆步骤、找证据、改方向，你关掉网页也在跑", "It plans, gathers evidence and changes course — even when you close the tab")}</span></div>
            <div className="flex gap-2"><span className="text-blue-400">03</span><span>{ui("做不到的事去服务广场找人；定期告诉你做成了什么", "What AI can't do, it hires out; it reports results on a schedule")}</span></div>
          </div>
        )}

        {/*
          免注册体验提到主按钮位置。原来它排在邮箱表单和「管理员入口」之后、
          用的还是次级灰色样式——等于把转化率最高的入口藏在了最不显眼的地方。
        */}
        {!isLoginAsAdmin && !isOtpSent && !landingLogin && hasTrialBackend() && (
          <div className="mb-5">
            <button
              onClick={() => { trackEvent('trial_start'); setUser(auth.loginAsGuest()); }}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-colors"
            >{ui("🎁 免注册，直接开始")}</button>
            <p className="text-center text-[11px] text-slate-500 mt-2.5 leading-5">{ui("不用填任何信息 · 笔记只存在你自己的浏览器里", "No sign-up · notes stay in your browser")}<br />{ui("你提的问题会匿名记录，用来改进产品", "Your questions are logged anonymously to improve the product")}</p>
          </div>
        )}

        {!isLoginAsAdmin && !isOtpSent && !landingLogin && hasTrialBackend() && (
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-[11px] text-slate-600">{ui("或登录以长期保存")}</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>
        )}

        {(!isLoginAsAdmin || hasAuthBackend()) ? (
          <div className="space-y-4">
            {isLoginAsAdmin && <p className="text-sm text-slate-400">{ui("使用管理员邮箱接收验证码。登录后由后台确认权限，可管理模型 Key、用户额度、统计和留言。")}</p>}
            {/* 登录方式切换。托管版只有邮箱是真登录，此时这个切换条只剩一个「邮箱」按钮，
                纯属噪音，直接整条隐藏（loginMethod 默认就是 email）。 */}
            {!isOtpSent && !hasAuthBackend() && (
              <div className="flex gap-2 p-1 bg-slate-800 rounded-xl">
                {/* 托管版当前只有邮箱是真登录，微信/短信暂隐藏（需后端+资质） */}
                {!hasAuthBackend() && (
                <button
                  onClick={() => setLoginMethod('wechat')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'wechat' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg>{ui("微信")}</button>
                )}
                {!hasAuthBackend() && (
                <button
                  onClick={() => setLoginMethod('phone')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'phone' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>{ui("短信")}</button>
                )}
                <button
                  onClick={() => setLoginMethod('email')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${loginMethod === 'email' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>{ui("邮箱")}</button>
              </div>
            )}
            
            {/* 微信扫码登录 */}
            {loginMethod === 'wechat' && !isOtpSent && (
              <div className="text-center py-6">
                <div className="w-48 h-48 mx-auto bg-white rounded-2xl p-3 mb-4">
                  <div className="w-full h-full bg-slate-100 rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" className="mx-auto mb-2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01M7 12h.01M12 7h.01M17 7h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01M17 17h.01"/></svg>
                      <p className="text-xs text-slate-500">{ui("微信扫码区域")}</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-500">{ui("请使用微信扫一扫登录")}</p>
                <button onClick={() => setUser(auth.loginWithEmail('wechat_user@demo.com'))} className="mt-4 text-xs text-blue-400 hover:text-blue-300">{ui("模拟扫码成功")}</button>
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
                  <input type="tel" placeholder={ui("手机号码")} value={loginPhone} onChange={e => setLoginPhone(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none" />
                </div>
                <button onClick={() => { if (loginPhone.length >= 11) { setIsOtpSent(true); setOtpCode('123456'); } }} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl">{ui("获取短信验证码")}</button>
              </>
            )}
            
            {/* 验证码 / 密码 切换（密码要登录后在个人中心设置过） */}
            {loginMethod === 'email' && !isOtpSent && hasPasswordLogin() && (
              <div className="flex gap-1 p-1 bg-slate-800 rounded-xl text-xs" role="tablist" aria-label={ui('登录方式', 'Sign-in method')}>
                {[[false, ui('验证码登录', 'Email code')], [true, ui('密码登录', 'Password')]].map(([v, label]) => (
                  <button key={String(v)} role="tab" aria-selected={pwMode === v} onClick={() => { setPwMode(v as boolean); try { localStorage.setItem('hx-login-mode', v ? 'password' : 'code'); } catch {} }}
                    className={`flex-1 py-2 rounded-lg font-medium ${pwMode === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{label as string}</button>
                ))}
              </div>
            )}
            {loginMethod === 'email' && !isOtpSent && pwMode && hasPasswordLogin() && (
              <form className="space-y-3" onSubmit={async e => {
                e.preventDefault(); if (pwBusy) return;
                setPwBusy(true);
                try {
                  const loggedIn = await auth.loginWithPassword(loginEmail, loginPassword);
                  setLoginPassword(''); setUser(loggedIn); trackEvent('login', { via: 'password' });
                  if (isLoginAsAdmin) {
                    try { const session = await sharedRequest<{ isAdmin: boolean }>('/shared/session'); if (session.isAdmin) { setIsBackendAdmin(true); setAdminInitialTab('models'); setShowAdminDashboard(true); } else alert('已登录，但此账号尚未获得后台管理员授权。'); }
                    catch (err: any) { alert('已登录，管理员权限暂时无法确认：' + err.message); }
                  }
                } catch (err: any) { alert(err.message || '登录失败'); }
                finally { setPwBusy(false); }
              }}>
                <input aria-label={ui("电子邮箱")} type="email" autoComplete="username" placeholder={ui("电子邮箱")} value={loginEmail} onChange={e => setLoginEmail(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none" />
                <input aria-label={ui("密码", "Password")} type="password" autoComplete="current-password" placeholder={ui("密码", "Password")} value={loginPassword} onChange={e => setLoginPassword(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none" />
                <button type="submit" disabled={pwBusy || !loginEmail.includes('@') || !loginPassword} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-4 rounded-xl">{pwBusy ? ui('正在登录…', 'Signing in…') : ui("登录", "Sign in")}</button>
                <p className="text-center text-[11px] text-slate-500 leading-5">{ui('还没设过密码、或者忘了密码：先用验证码登录，再到「个人中心」设置', 'No password yet or forgot it? Sign in with an email code, then set one in Personal center')}</p>
              </form>
            )}

            {/* 邮箱验证码登录 */}
            {loginMethod === 'email' && !isOtpSent && !(pwMode && hasPasswordLogin()) && (
              <>
                <input key={landingLogin ? "login" : "landing"} autoFocus={landingLogin} aria-label={ui("电子邮箱")} type="email" autoComplete="email" placeholder={ui("电子邮箱")} value={loginEmail} onChange={e => setLoginEmail(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3.5 text-sm text-white outline-none" />
                <button onClick={async () => {
                  if (!loginEmail.includes('@')) { alert('请输入正确的邮箱'); return; }
                  if (hasAuthBackend()) {
                    try { const d = await auth.sendEmailCode(loginEmail); setIsOtpSent(true); setOtpCode(''); if (d.devCode) alert('开发模式验证码：' + d.devCode); }
                    catch (e: any) { alert(e.message || '发送失败'); }
                  } else { setIsOtpSent(true); setOtpCode('123456'); }
                }} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl">{ui("获取邮箱验证码")}</button>
              </>
            )}
            
            {/* 验证码输入 */}
            {isOtpSent && (
              <>
                <div className="text-center text-xs text-slate-500 mb-2">{ui("验证码已发送至")}{loginMethod === 'phone' ? loginPhone : loginEmail}
                </div>
                <input type="text" placeholder={ui("输入验证码")} value={otpCode} onChange={e => setOtpCode(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-4 text-center text-xl tracking-[0.5em] font-mono text-white outline-none" />
                <button onClick={async () => {
                  if (hasAuthBackend() && loginMethod === 'email') {
                    try {
                      const loggedIn = await auth.verifyEmailCode(loginEmail, otpCode);
                      setUser(loggedIn);
                      if (isLoginAsAdmin) {
                        try {
                          const session = await sharedRequest<{ isAdmin: boolean }>('/shared/session');
                          if (session.isAdmin) { setIsBackendAdmin(true); setAdminInitialTab('models'); setShowAdminDashboard(true); }
                          else alert('邮箱已登录，但此账号尚未获得后台管理员授权。');
                        } catch (e: any) { alert('邮箱已登录，管理员权限暂时无法确认：' + e.message); }
                      }
                    }
                    catch (e: any) { alert(e.message || '验证失败'); }
                  } else { setUser(auth.loginWithEmail(loginMethod === 'phone' ? loginPhone : loginEmail)); }
                }} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl">{ui("确认登录")}</button>
                <button onClick={() => { setIsOtpSent(false); setOtpCode(''); }} className="w-full text-xs text-slate-500 hover:text-slate-300 py-2">{ui("返回重新获取")}</button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">{ui("管理员后台需要接入邮箱登录服务和共享模型后台。完成部署后，使用已授权邮箱登录。")}</p>
            <button onClick={() => setIsLoginAsAdmin(false)} className="w-full bg-slate-800 text-white py-3 rounded-xl">{ui("返回")}</button>
          </div>
        )}
        
        {/* 没有体验后端时（自部署场景），免注册入口无法提供，此处不渲染 */}

        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-center gap-4">
          <a href="https://github.com/chenhaiyan123/ai-auto-explorer" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white text-xs font-medium">{ui("开源代码")}</a>
          <span className="text-slate-700">·</span>
          <button onClick={() => { setIsLoginAsAdmin(!isLoginAsAdmin); setLoginMethod('email'); setOtpCode(''); setIsOtpSent(false); }} className="text-slate-500 hover:text-white text-xs font-medium">{isLoginAsAdmin ? ui("返回普通登录") : ui("管理员入口")}</button>
        </div>

        {/*
          ICP 备案信息。《互联网信息服务备案承诺书》第二条要求：上线时在网站主页底部
          规范标明备案编号并链接至 https://beian.miit.gov.cn。此前站点未标注，属合规缺口，
          也是微信安全审核会核对的一项，故补上。
        */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-center text-[11px] leading-6 text-slate-500">
          <div>深圳市海探科技有限公司</div>
          <a
            href="https://beian.miit.gov.cn"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300 underline decoration-dotted"
          >
            粤ICP备2023000583号-1
          </a>
        </div>
      </div>
      </div>
      </main>
      )}
      {showLandingSim && (
        <footer className="border-t border-slate-800/80 py-8 text-center text-[12px] leading-6 text-slate-500">
          <div className="flex items-center justify-center gap-4">
            <a href="https://github.com/chenhaiyan123/ai-auto-explorer" target="_blank" rel="noopener noreferrer" className="hover:text-white">{ui("开源代码")}</a>
            <span className="text-slate-700">·</span>
            <button onClick={() => { setIsLoginAsAdmin(true); setLoginMethod('email'); setOtpCode(''); setIsOtpSent(false); }} className="hover:text-white">{ui("管理员入口")}</button>
          </div>
          {/* ICP 备案：首页底部必须标明备案号并链接到工信部（备案承诺书第二条） */}
          <div className="mt-3">深圳市海探科技有限公司</div>
          <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 underline decoration-dotted">粤ICP备2023000583号-1</a>
        </footer>
      )}
      {showServiceMarket && <ServiceMarket projects={[]} currentProjectId={null} onClose={() => setShowServiceMarket(false)} />}
    </div>
  );

  return (
    <div
      className="app-shell flex flex-col h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden"
      onClick={() => { setContextMenu(null); unattendedRef.current = 0; }}
      onKeyDown={() => { unattendedRef.current = 0; }}
    >
      <header className="relative h-14 border-b border-slate-800 flex items-center justify-between px-3 sm:px-6 bg-slate-900/50 backdrop-blur-md z-50">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <div className="hidden sm:flex items-center gap-2 min-w-fit"><div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">A</div><h1 className="text-lg font-semibold hidden lg:block">Explorer</h1></div>
          
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
                className="hidden sm:block p-1.5 text-slate-500 hover:text-blue-400 hover:bg-slate-800 rounded transition-colors"
                title={ui("重命名项目")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            )}
          </div>
          
          {currentProject?.explorationMode && <div className={`hidden sm:flex px-2 py-1 rounded-full text-[10px] font-bold items-center gap-1 ${currentProject.explorationMode === 'research' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'}`}>{currentProject.explorationMode === 'research' ? ui("🔬研究") : ui("🔧构建")}</div>}
          <button onClick={() => setShowMetaModal(true)} className="hidden sm:block p-2 text-slate-400 hover:text-blue-400"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg></button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* 设备安全：待确认的写操作 + 急停（没注册设备时整条不渲染） */}
          <DeviceGuard />

          {/* 问题广场：筛选有价值的问题 */}
          <button
            onClick={() => setShowQuestionBoard(true)}
            className="flex px-2.5 py-1.5 bg-slate-800 hover:bg-amber-600 hover:text-white border border-slate-700 rounded-full transition-colors text-[11px] font-bold text-amber-400 flex items-center gap-1"
            title={ui("问题广场：筛选有价值的问题")}
          >{ui("问题广场", "Questions")}</button>

          <button onClick={() => { setMarketSeek(null); setShowServiceMarket(true); }} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-[11px] font-medium text-slate-200">{ui('服务广场', 'Services')}</button>
          {/* 个人中心 */}
          <div className="relative">
            <button 
              aria-label={ui("个人中心", "Personal center")} aria-haspopup="dialog" aria-expanded={showUserMenu}
              onClick={() => setShowUserMenu(!showUserMenu)} 
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full transition-colors"
            >
              <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white">
                {user.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <span className="text-xs text-slate-300 hidden sm:inline max-w-[80px] truncate">{user.username || user.email?.split('@')[0]}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-slate-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            

          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* 可调整大小的侧边栏 */}
        <aside 
          className={`app-notes h-full bg-slate-900 border-r border-slate-800 flex flex-col z-20 overflow-hidden ${notesPanelMode === 0 ? 'w-0 border-none' : ''}`}
          style={{ width: notesPanelMode === 0 ? 0 : sidebarWidth }}
        >
          {notesPanelMode !== 0 && <>
          <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
            <h3 className="text-xs font-bold text-slate-400">EXPLORER</h3>
            <div className="flex gap-1">
              <button onClick={() => setSidebarWidth(sidebarWidth === 320 ? 480 : 320)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400" title={ui("切换宽度")}>
                {sidebarWidth > 400 ? <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>}
              </button>
              <button onClick={() => setNotesPanelMode(0)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <NotesPanel glow={projectGlow} onLight={(id, on) => void lightProject(id, on)} onWake={id => void wakeProject(id, true)} onDelete={id => void handleDeleteProject(id, true)} activeProjectIds={activeProjectIds} aliveProjectIds={aliveProjectIds} projects={projectsView} currentProjectId={currentProjectId} selectedNodeId={selectedNodeId} search={notesSearch} onSearch={setNotesSearch} onOpenNode={openNode} onCreateProject={openNewTask} onCreateDirection={handleCreateDirection} onAddChild={handleCreateChild} onBuildTeam={handleBuildTeam} onCleanup={handleCleanupProject} onImport={handleImportMd} onExportVault={handleExportVault} onSaveToFolder={handleSaveToFolder} onOpenPage={openProjectPage} selectedPage={activeProjectPage} />
          </div>
          </>}
        </aside>
        
        {/* 拖拽调整宽度的把手 */}
        {notesPanelMode !== 0 && (
          <div 
            className={`w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-30 ${isResizingSidebar ? 'bg-blue-500' : 'bg-transparent'}`}
            onMouseDown={handleSidebarMouseDown}
          />
        )}
        
        {notesPanelMode === 0 && <div className="app-notes-handle w-8 h-full bg-slate-900 border-r border-slate-800 flex items-center justify-center cursor-pointer hover:bg-slate-800 z-20 group" onClick={() => setNotesPanelMode(1)}><div className="rotate-90 whitespace-nowrap text-[10px] font-bold text-slate-500 group-hover:text-blue-400">{ui("展开面板")}</div></div>}

        {/* ===== 中间：对话（主战场：AI 的进度、需要你拍板的问题、和团队说话都在这里） ===== */}
        <div className="app-team-chat flex-1 min-w-0 h-full flex flex-col bg-slate-900 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-900/80">
            <h3 className="text-xs font-bold text-blue-400 flex items-center gap-1.5 flex-shrink-0"><span>💬</span>{ui("对话")}{isLooping && <span className="text-[10px] font-normal text-slate-500 animate-pulse">{ui("· AI 正在做")}</span>}</h3>
            <div className="flex items-center gap-1.5 flex-shrink-0 overflow-x-auto scroll-hide">
              <button
                onClick={() => {
                  if (continuousMode) { endBatch('stopped'); return; }
                  if (!currentProjectId) return;
                  const a = currentProject?.autonomy;
                  if (!a?.on || a.pausedFor === 'budget') { setAutonomyFor({ pid: currentProjectId }); return; }
                  patchAutonomy(currentProjectId, { pausedFor: undefined });
                  resumeAuto(currentProjectId);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1.5 ${continuousMode ? 'bg-emerald-600 text-white' : 'bg-gradient-to-r from-emerald-600/80 to-teal-600/80 text-white hover:from-emerald-500 hover:to-teal-500'}`}
                title={continuousMode ? ui("AI 正在自主推进，点一下把方向盘收回来") : ui("交给 AI 自主运行：它自己一步一步往下做，只在需要你的时候来叫你；一轮最多 5 步，做完给你一张汇总，随时可以收回")}
              >{continuousMode
                  ? <><span className="w-1.5 h-1.5 rounded-full bg-white hx-breathe" />{ui("自主运行中 · 收回")}</>
                  : <>⚡ {ui("自主运行")}{currentProject?.autonomy?.on && currentProject.autonomy.pausedFor ? <span className="font-normal opacity-80">{ui(" · 已暂停")}</span> : null}</>}</button>
              {currentProject?.autonomy?.on && <button onClick={() => currentProjectId && void giveReport(currentProjectId, true)} className="px-2.5 py-1 bg-slate-700/70 hover:bg-slate-600 text-slate-200 rounded-lg text-[11px] font-bold" title={ui(`让 AI 汇报这段时间做了什么、怎么想的、卡在哪、需要你什么。下次来看：${new Date(nextCheckIn(currentProject.autonomy)).toLocaleDateString()}`)}>{ui("📋 汇报")}</button>}
              <button onClick={() => setShowGraphModal(true)} className="px-2.5 py-1 bg-slate-700/70 hover:bg-purple-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1.5" title={ui("打开关系图谱")}>{ui("🕸️ 图谱")}</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <TeamChat key={`${currentProjectId || 'none'}:${currentProject?.worktree?.activeBranchId || 'main'}`} project={currentProject} nodes={nodes} selectedNode={selectedNode} onAppendToNote={(nodeId, text) => { const nn = nodes.find(n => n.id === nodeId); updateNode(nodeId, { fullNote: ((nn?.fullNote || nn?.notes || '') + text), noteUpdatedAt: Date.now() }); setSelectedNodeId(nodeId); }} onOpenNode={(id) => setSelectedNodeId(id)} chatHistory={((currentProject as any)?.butlerChatHistory) || []} onUpdateChatHistory={handleUpdateButlerChat} prefill={chatPrefill} feed={visibleFeed} onAnswerFeed={handleAnswerFeed} feedBusy={outlineBusy}
              capability={currentProject ? `${marketCapability(currentProject, loggedIn())}\n【钱包】这个项目有自己的项目钱包：AI 用平台模型、在服务广场下单花的钱从这里出，接单赚的钱进这里；用户可以随时往里放钱或收回。钱只在平台内流转，不能提现、不能转给外部的人。\n【平台直连服务】不用找人代发，你能直接调用：问卷星发问卷（每份几元，从钱包扣，答卷自动回收、够数自动总结成证据）、做预售 / 报名页（免费，统计访客、点击、留联系方式）、查企业工商信息。用户说要发问卷、做预售页时，系统会直接把问卷 / 页面设计好，放一张确认卡，用户点一下就发出去——不要说「没有问卷星的操作能力、要去服务广场找人代发」。\n【接单】用户允许后，你可以在服务广场挑自己能独立做完的需求（调研、整理、写作、方案）报价、交付，买方验收后收入进项目钱包；也可以把你的「AI 项目经理简介」挂成服务，等人下单。用户说「先接单赚钱」时，系统会真的去做，你照实汇报结果。` : ''}
              onEarn={currentProject ? () => earnNow(currentProject.id) : undefined}
              onReality={currentProject ? (k, txt) => realityFromChat(k, txt) : undefined} />
          </div>
        </div>

        {/* ===== 右侧：笔记 / 项目总览（看内容的地方；交互和决策都在中间的对话里） ===== */}
        {noteOpen && (
          <div className="app-note-panel fixed inset-x-0 top-14 bottom-0 z-40 md:static md:z-0 h-full flex flex-col bg-slate-800 border-l border-slate-700/60 min-w-0 flex-shrink-0" style={{ width: isMobileWidth ? undefined : noteWidth }}>
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-700/60 bg-slate-800/80 flex-shrink-0">
              <div className="text-[11px] text-slate-500 min-w-0 truncate">{currentProject && selectedNode ? <button onClick={() => openProjectPage(currentProject.id, 'root', 'research')} className="hover:text-blue-300">{ui("← 回到项目总览")}</button> : <span className="text-slate-600">{currentProject?.name || ''}</span>}</div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setNoteWidth(w => (w > 600 ? 560 : 820))} className="hidden md:block p-1.5 hover:bg-slate-700 rounded text-slate-400" title={ui("切换宽度")}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
                <button onClick={() => setNoteOpen(false)} className="p-1.5 hover:bg-slate-700 rounded text-slate-400" title={ui("收起")}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 17 5-5-5-5M13 17l5-5-5-5"/></svg></button>
              </div>
            </div>
          <div className="flex-1 flex flex-col min-h-0">
            {/* 点了对话流里的「我要改改」：右栏整个让给框架编辑器 */}
            {projectOutline?.status === 'draft' && outlineEditing ? (
              <div className="flex-1 min-h-0 overflow-y-auto px-5 md:px-8 py-6 scroll-hide">
                <OutlinePlanner
                  outline={projectOutline}
                  onChange={handleOutlineChange}
                  onConfirm={() => startAfterOutline(handleConfirmOutline())}
                  onRegenerate={() => handleProposeOutline()}
                  onDiscard={handleDiscardOutline}
                  busy={outlineBusy}
                />
              </div>
            ) : (
            <>
            <div className="flex-1 min-h-0">
            {selectedNode ? (
              <NodeDetails node={selectedNode} variant="center" isFocused={focusedNodeId === selectedNodeId} isWide={isDetailsWide} onToggleWide={() => setIsDetailsWide(!isDetailsWide)} onClose={() => setSelectedNodeId(null)} onSendMessage={async (id, text) => { const node = nodes.find(n => n.id === id); if (!node) return; const updated = [...(node.chatHistory || []), { role: 'user', text } as ChatMessage]; updateNode(id, { chatHistory: updated }); const epoch = workspaceEpochRef.current; const resp = await chatWithNode(node, text, updated, questionFactContext(currentProject?.inquiries, node.id)); if (epoch !== workspaceEpochRef.current) return; updateNode(id, { chatHistory: [...updated, { role: 'model', text: resp } as ChatMessage] }); }} onUpdateNotes={(id, notes) => updateNode(id, { notes })} onUpdateNodeData={(id, updates) => updateNode(id, updates)} onAddChildNode={(parentId, title) => { const id = uuidv4(); const dir: ProblemNode = { id, title, status: NodeStatus.UNEXPLORED, confidence: 0, dependencies: [parentId], notes: '', chatHistory: [], agentResults: [], noteType: 'direction', fullNote: directionTemplate(title), noteUpdatedAt: Date.now() }; setNodes(prev => [...prev, dir]); setSelectedNodeId(id); }} allNodes={nodes} onNavigate={(id) => setSelectedNodeId(id)} onWikiLink={handleWikiLink} decisions={projectDecisions} onRecordDecision={(id) => openDecisionRecorder(id, 'manual')} onForkDecision={(id) => { const stage = currentProject?.worktree?.stages.find(s => s.decisionId === id); if (stage) openProjectPage(currentProject!.id, 'root', 'worktree'); else handleForkDecision(id); }} onMentionAgent={mentionAgentInChat} probes={projectProbes} onAddProbes={handleAddProbes} onUpdateProbe={handleUpdateProbe} onContradicted={handleContradicted} projectGoal={currentProject?.metaProblem || currentProject?.name} route={projectRoute} routeBusy={routeBusy} onPlanRoute={handlePlanRoute} onSettleAnchor={handleSettleAnchor} onSkipAnchor={handleSkipAnchor} onDesignAnchorProbes={handleDesignAnchorProbes} onDesignSim={handleDesignSim} simBusy={simBusy} onSimProbe={handleSimProbe} onWriteThis={handleWriteThis} isWriting={isLooping} onAppendToSummary={(text) => { if (!currentProjectId) return; setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, summaryNote: (p.summaryNote || '') + text } : p)); }} />
            ) : currentProject ? (
              <ProjectWorkspace project={{ ...currentProject, nodes }} scopeId={activeProjectPage.scopeId} page={activeProjectPage.page} teams={inquiryTeams}
                onPage={(page, scopeId = activeProjectPage.scopeId) => openProjectPage(currentProject.id, scopeId, page)} onNote={id => openNode(currentProject.id, id)}
                routePanel={<RouteMap route={projectRoute} nodes={nodes} busy={routeBusy} onPlan={handlePlanRoute} onSettle={handleSettleAnchor} onSkip={handleSkipAnchor} onDesignProbes={handleDesignAnchorProbes} onNavigate={id => openNode(currentProject.id, id)} />}
                onSaveSuccess={text => setProjects(prev => prev.map(p => p.id === currentProject.id ? { ...p, overviewSuccessCriteria: text } : p))}
                onSaveBrief={text => setProjects(prev => prev.map(p => p.id === currentProject.id ? { ...migrateProjectOverview(p), overviewBrief: text } : p))}
                onSaveSummary={(id, text) => updateNode(id, { fullNote: text, autoNote: false, noteUpdatedAt: Date.now() })}
                worktree={worktreeActions} busy={worktreeBusy} onStop={stopProjectWork} onGenerateReport={handleGenerateReport} generating={isGeneratingReport}
                pulsePanel={pulsePanel} memoryPanel={keyInfoPanel} walletPanel={walletPanel}
                onCloudState={st => setCloudWatch(prev => (JSON.stringify(prev[currentProject.id]) === JSON.stringify(st) ? prev : { ...prev, [currentProject.id]: st }))}
                openActivation={openActivation}
                onSeekHelp={(fact, question) => { setMarketSeek(seekFromFact(fact, question, currentProject.id)); setShowServiceMarket(true); trackEvent('fact_seek_help'); addNotification('info', `🤝 去服务广场为「${fact.claim.slice(0, 24)}${fact.claim.length > 24 ? '…' : ''}」找人验证`, ''); }} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-4">
                <div className="text-5xl opacity-40">📂</div>
                <div className="text-slate-400 text-sm font-bold">{ui("说一件你想做成的事，或者从左侧选一个项目")}</div>
                <div className="text-slate-600 text-[11px] max-w-sm leading-relaxed">{ui("AI 项目经理先把事情拆成几步、说清楚需要你什么，然后一步一步去做、看结果、再调整；AI 做不了的去服务广场找人，没有就发布需求。")}</div>
                <button onClick={openNewTask} className="mt-2 px-4 py-2 bg-purple-600/80 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-colors">{ui("＋ 新建项目")}</button>
              </div>
            )}
            </div>
            </>
            )}
          </div>
          </div>
        )}

        {/* 笔记栏收起时的展开把手 */}
        {!noteOpen && (
          <div className="hidden md:flex w-8 h-full bg-slate-900 border-l border-slate-800 items-center justify-center cursor-pointer hover:bg-slate-800 z-20 group" onClick={() => setNoteOpen(true)} title={ui("展开笔记")}>
            <div className="rotate-90 whitespace-nowrap text-[10px] font-bold text-slate-500 group-hover:text-blue-400">{ui("笔记")}</div>
          </div>
        )}

        {/* ===== 关系图谱弹出层 ===== */}
        {showGraphModal && (
          <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/95 backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80">
              <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2"><span>🕸️</span>{ui("关系图谱")}{currentProject?.name ? ` · ${currentProject.name}` : ''}</h3>
              <button onClick={() => setShowGraphModal(false)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors" title={ui("关闭")}><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 relative">
              <GraphVisualization nodes={filteredNodes} onNodeClick={(node) => { handleNodeClick(node); setShowGraphModal(false); }} onNodeContextMenu={(node, x, y) => setContextMenu({ x, y, nodeId: node.id })} onToggleCollapse={(nodeId) => { const n = nodes.find(x => x.id === nodeId); if (n) updateNode(n.id, { isCollapsed: !n.isCollapsed }); }} onBatchUpdateNodes={(updates) => { setNodes(prev => prev.map(n => { const u = updates.find(x => x.id === n.id); return u ? { ...n, ...u.changes } : n; })); }} />
            </div>
          </div>
        )}
      </main>
      {nativeIOS && <nav aria-label={ui('主要导航', 'Main navigation')} className="ios-navigation grid grid-cols-4 shrink-0 border-t border-slate-800 bg-slate-950 md:hidden">
        <button className="py-3 text-xs" onClick={() => { setNotesPanelMode(0); setNoteOpen(true); if (currentProject) openProjectPage(currentProject.id, 'root', 'research'); }}>{ui('◈ 总览', '◈ Overview')}</button>
        <button className="py-3 text-xs" onClick={() => { setNoteOpen(false); setNotesPanelMode(v => v ? 0 : 1); }}>{ui('▤ 项目与笔记', '▤ Notes')}</button>
        <button className="py-3 text-xs" onClick={() => { setNotesPanelMode(0); setNoteOpen(false); }}>{ui('◎ AI 团队', '◎ AI team')}</button>
        <button className="py-3 text-xs" onClick={() => setShowUserMenu(true)}>{ui('◉ 我的', '◉ Account')}</button>
      </nav>}

      {contextMenu && <div className="fixed z-[100] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 w-48" style={{ top: Math.min(contextMenu.y, window.innerHeight - 350), left: Math.min(contextMenu.x, window.innerWidth - 200) }} onClick={e => e.stopPropagation()}>
        {/* 在团队群聊里讨论这个节点（选中它 + 打开右侧群聊，群聊会自动把当前笔记带进上下文） */}
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2 text-blue-400" onClick={() => { setSelectedNodeId(contextMenu.nodeId); setRightChatOpen(true); setContextMenu(null); }}>{ui("💬 在团队群聊里讨论")}</button>
        <div className="h-px bg-slate-700 my-1"></div>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { setFocusedNodeId(focusedNodeId === contextMenu.nodeId ? null : contextMenu.nodeId); setContextMenu(null); }}>🎯 {focusedNodeId === contextMenu.nodeId ? ui("取消聚焦") : ui("聚焦节点")}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isCritical: !n.isCritical }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isCritical ? ui("⭐ 取消关键") : ui("⭐ 设为关键")}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isPinned: !n.isPinned }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isPinned ? ui("📍 取消固定") : ui("📌 固定节点")}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); if (n) updateNode(n.id, { isCollapsed: !n.isCollapsed }); setContextMenu(null); }}>{nodes.find(n => n.id === contextMenu.nodeId)?.isCollapsed ? ui("📂 展开节点") : ui("📁 折叠节点")}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-600 flex items-center gap-2" onClick={() => { const title = prompt('标题:'); if (title) addNode(title, [contextMenu.nodeId]); setContextMenu(null); }}>{ui("➕ 增加子节点")}</button>
        <div className="h-px bg-slate-700 my-1"></div>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-amber-600 text-amber-400 hover:text-white flex items-center gap-2" onClick={() => { openDecisionRecorder(contextMenu.nodeId, 'manual'); setContextMenu(null); }}>{ui("⚖️ 记录决策")}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-red-600 text-red-400 hover:text-white flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); openDecisionRecorder(contextMenu.nodeId, 'invalidate', { pendingAction: 'invalidate', skippable: true, presetQuestion: `是否放弃「${n?.title || ''}」这个方向？`, presetOptions: [{ label: '放弃这个方向（设为无效）', chosen: true }, { label: '继续探索', chosen: false }] }); setContextMenu(null); }}>{ui("🚫 设为无效")}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-emerald-600 flex items-center gap-2" onClick={() => { updateNode(contextMenu.nodeId, { status: NodeStatus.SOLVED }); setContextMenu(null); }}>{ui("✅ 标记完成")}</button>
        <button className="w-full text-left px-4 py-2.5 text-xs hover:bg-red-600 text-red-400 hover:text-white flex items-center gap-2" onClick={() => { const n = nodes.find(x => x.id === contextMenu.nodeId); openDecisionRecorder(contextMenu.nodeId, 'delete_node', { pendingAction: 'delete', skippable: true, presetQuestion: `是否删除「${n?.title || ''}」？`, presetOptions: [{ label: `删除「${(n?.title || '').slice(0, 12)}」`, chosen: true }, { label: '保留', chosen: false }] }); setContextMenu(null); }}>{ui("🗑️ 删除节点")}</button>
      </div>}

      {/* 决策记录弹窗（手动 + 关键时机） */}
      {/* 客服入口：可拖动、可关闭（关掉后在设置里能找回） */}
      <ChatLauncher />

      {decisionDraft && (
        <DecisionRecordModal
          draft={decisionDraft}
          onSave={handleSaveDecision}
          onSkip={decisionDraft.skippable ? handleSkipDecision : undefined}
          onCancel={() => setDecisionDraft(null)}
        />
      )}
      {/* 决策时间线（项目级，可从任意决策点 fork） */}
      {showDecisionTimeline && (
        <DecisionTimelineModal
          decisions={projectDecisions}
          onFork={handleForkDecision}
          onDelete={handleDeleteDecision}
          onNavigate={(id) => setSelectedNodeId(id)}
          onClose={() => setShowDecisionTimeline(false)}
        />
      )}

      {showAdminDashboard && isBackendAdmin && <AdminDashboard initialTab={adminInitialTab} onClose={() => setShowAdminDashboard(false)}
        stats={<><div className="grid grid-cols-3 gap-6 mb-6">{Object.entries(monitor.getSystemSummary()).map(([k, v]) => <div key={k} className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700 text-center"><div className="text-[10px] uppercase text-slate-500 font-bold mb-1">{k}</div><div className="text-2xl font-bold text-white">{v}</div></div>)}</div><div className="flex-1 overflow-auto border border-slate-800 rounded-2xl"><table className="w-full text-left text-sm"><thead className="bg-slate-800 text-slate-400"><tr><th className="px-4 py-4 text-[10px] uppercase">{ui("用户")}</th><th className="px-4 py-4 text-[10px] uppercase">{ui("会话")}</th><th className="px-4 py-4 text-[10px] uppercase">{ui("时长(m)")}</th><th className="px-4 py-4 text-[10px] uppercase">Token</th><th className="px-4 py-4 text-[10px] uppercase">{ui("最后活跃")}</th></tr></thead><tbody className="divide-y divide-slate-800">{cloudStats.map((s, i) => <tr key={i} className="hover:bg-slate-800/30"><td className="px-4 py-4 text-blue-400">{s.username}</td><td className="px-4 py-4">{s.sessionCount}</td><td className="px-4 py-4">{(s.totalActiveSeconds / 60).toFixed(1)}</td><td className="px-4 py-4 text-emerald-400">{(s.totalPromptTokens + s.totalCompletionTokens).toLocaleString()}</td><td className="px-4 py-4 text-slate-500 text-xs">{new Date(s.lastActiveTimestamp).toLocaleString()}</td></tr>)}</tbody></table></div></>}
        messages={<div className="flex-1 overflow-auto space-y-3">{adminMessages.length === 0 ? <div className="text-center py-12 text-slate-500">{ui("暂无留言")}</div> : adminMessages.map((msg, i) => <div key={i} className="p-4 bg-slate-800/50 rounded-xl border border-slate-700"><div className="flex justify-between mb-2"><span className="text-sm font-bold text-blue-400">{msg.username}</span><span className="text-[10px] text-slate-500">{new Date(msg.createdAt).toLocaleString()}</span></div><p className="text-sm text-slate-300">{msg.content}</p></div>)}</div>}
      />}

      {autonomyFor && (() => { const ap = projects.find(p => p.id === autonomyFor.pid); if (!ap) return null; return (
        <AutonomyModal project={ap}
          onAllow={o => { setAutonomyFor(null); allowAutonomy(ap.id, o, autonomyFor.nodeId); }}
          onStepByStep={() => { setAutonomyFor(null); if (!ap.autonomy?.on) patchAutonomy(ap.id, { on: false, grantedAt: 0, budgetCNY: 0, checkInDays: 7 }); pushFeedItem(feedStatus('好，先一步一步来：每做完一步停下来给你看结果。想放手了随时点「⚡ 自主运行」'), ap.id); if (autonomyFor.nodeId) kickoffWriting(autonomyFor.nodeId); }}
          onClose={() => { setAutonomyFor(null); if (autonomyFor.nodeId) pushFeedItem(feedStatus('准备好了。点「⚡ 自主运行」交给我，或者在步骤上点「▶」一步一步来'), ap.id); }}
          onEditCharter={() => { setAutonomyFor(null); patchFeed(f => pushFeed(closeAsks(f, 'charter', '已重新问'), charterAsk(ap.id, autonomyFor.nodeId)), ap.id); setRightChatOpen(true); }} />
      ); })()}
      {showMetaModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-8 shadow-2xl"><h2 className="text-2xl font-bold">{ui("新探索任务")}</h2><textarea value={metaInput} onChange={e => setMetaInput(e.target.value)} placeholder={ui("描述你想探索的问题...")} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-5 mt-6 min-h-[100px] outline-none text-slate-200 resize-none" /><button disabled={!metaInput.trim()} onClick={() => { setShowMetaModal(false); setShowQVSModal(true); }} className="w-full mt-4 py-3 bg-gradient-to-r from-violet-600/20 to-blue-600/20 border border-violet-500/30 text-violet-300 rounded-xl font-bold text-sm hover:from-violet-600/30 hover:to-blue-600/30 transition-all disabled:opacity-40 flex items-center justify-center gap-2"><span>📊</span>{ui("先评估问题价值（推荐）")}</button><div className="flex gap-4 mt-4"><button onClick={() => setShowMetaModal(false)} className="flex-1 py-4 bg-slate-800 rounded-xl font-bold">{ui("取消")}</button><button disabled={isAnalyzingIntent || !metaInput.trim()} onClick={async () => { if (!metaInput.trim()) return; setIsAnalyzingIntent(true); try { const { analysis, needsConfirmation } = await analyzeIntentWithAutoConfirm(metaInput); if (needsConfirmation) { setPendingIntent({ input: metaInput, analysis }); setShowMetaModal(false); } else createProjectWithMode(metaInput, analysis.mode, analysis); } catch { createProjectWithMode(metaInput, 'research'); } finally { setIsAnalyzingIntent(false); } }} className="flex-[2] py-4 bg-blue-600 rounded-xl font-bold disabled:opacity-50">{isAnalyzingIntent ? ui("分析中...") : ui("直接开启探索")}</button></div></div></div>}

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
          <span className="text-xs font-bold text-blue-300">{ui("🤝 AI 正在读懂目标、拆解方向、组建团队…")}</span>
        </div>
      )}

      {/* 下载客户端 */}
      {showDownloadModal && <DownloadModal onClose={() => setShowDownloadModal(false)} />}

      {showServiceMarket && <ServiceMarket seek={marketSeek} projects={projectsView} currentProjectId={currentProjectId} onClose={() => { setShowServiceMarket(false); setMarketSeek(null); }} onProject={c => { const p = projectsView.find(p => p.id === c.projectId); if (!p) return; openProjectPage(c.projectId, c.branchId === (p.worktree?.activeBranchId || 'main') ? c.scopeId : 'root', c.branchId === (p.worktree?.activeBranchId || 'main') ? 'research' : 'worktree'); setShowServiceMarket(false); }} />}
      {/* 问题广场 */}
      {showQuestionBoard && <QuestionBoard userKey={user?.username || 'guest'} onClose={() => setShowQuestionBoard(false)} onStartProject={(text) => handleCreateProject(text)} />}

      {/* 反馈弹窗：带上业务上下文，方便复现用户遇到的问题 */}
      {showFeedback && (
        <FeedbackModal
          onClose={() => setShowFeedback(false)}
          onTrack={trackEvent}
          extraContext={{
            项目数: projects.length,
            当前项目节点数: nodes.length,
            模型: activeModel || '(未设置)',
            接入方式: isTrialMode() ? '体验额度' : '自带模型',
            身份: user ? (user.role || 'user') : '未登录',
          }}
        />
      )}

      {/* 设置：模型接入 / IoT 设备 */}
      {showUserMenu && user && <PersonalCenter name={user.username || ui('用户', 'User')} email={user.email} pro={isPremiumUser} model={activeModel} trial={trialQuota} projectNames={Object.fromEntries(projects.map(p => [p.id, p.name]))}
        onSync={user.email ? () => setShowProjectSync(true) : undefined} syncStatus={projectSyncStatus}
        onClose={() => setShowUserMenu(false)} onBilling={() => setShowPremiumModal(true)} onUsage={() => setShowSharedModels(true)} onSettings={() => setShowSettingsModal(true)}
        onProjects={() => setShowProjectManager(true)} onHelp={() => setShowHelpModal(true)} onFeedback={() => { setShowFeedback(true); trackEvent('feedback_open'); }}
        onDownload={IS_DESKTOP ? undefined : () => setShowDownloadModal(true)} onAdmin={isBackendAdmin ? () => { setAdminInitialTab('users'); setShowAdminDashboard(true); } : undefined}
        onLogout={() => { auth.logout(); setUser(null); }} />}
      {user?.email && loadedOwner === user.username && <ProjectSyncPanel key={user.username} owner={user.username} projects={projects} busy={worktreeBusy} open={showProjectSync} onClose={() => setShowProjectSync(false)} onStatus={setProjectSyncStatus} />}
      {showSharedModels && <SharedModelsPanel personalOnly onClose={() => setShowSharedModels(false)} />}
      {showSettingsModal && <SettingsModal theme={theme} onThemeChange={setTheme} notificationMode={notificationMode} onNotificationModeChange={setNotificationMode} onClose={() => { setShowSettingsModal(false); try { setActiveModel(loadLLMSettings().model || ''); } catch {} }} />}

      {showHelpModal && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" onClick={() => setShowHelpModal(false)}><div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-10 shadow-2xl flex flex-col items-center max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}><h3 className="text-xl font-bold text-white mb-8">{ui("有问题请联系")}</h3><div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 w-full text-center mb-8"><p className="text-slate-500 text-xs mb-3 uppercase tracking-widest font-bold">{ui("联系微信号")}</p><p className="text-2xl font-mono font-bold text-blue-400 select-all tracking-wider">seabird36</p></div><MessageBoard /><button onClick={() => setShowHelpModal(false)} className="mt-6 w-full py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl border border-slate-700">{ui("关闭")}</button></div></div>}

      {/* 项目管理弹窗 */}
      {showProjectManager && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" onClick={() => setShowProjectManager(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-8 shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">{ui("📁 项目管理")}</h3>
              <button onClick={() => setShowProjectManager(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            
            <div className="text-xs text-slate-500 mb-4">{ui("共")}{projects.length}{ui("个项目")}</div>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {projects.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <div className="text-4xl mb-4">📭</div>
                  <p>{ui("暂无项目")}</p>
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
                            <span className="px-1.5 py-0.5 bg-blue-600/20 text-blue-400 text-[9px] font-bold rounded">{ui("当前")}</span>
                          )}
                          {p.explorationMode && (
                            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                              p.explorationMode === 'research' 
                                ? 'bg-purple-600/20 text-purple-400' 
                                : 'bg-emerald-600/20 text-emerald-400'
                            }`}>
                              {p.explorationMode === 'research' ? ui("研究") : ui("构建")}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2 mb-2">{p.metaProblem}</p>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          <span>📊 {p.nodes?.length || 0}{ui("节点")}</span>
                          <span>✅ {p.nodes?.filter(n => n.status === NodeStatus.SOLVED).length || 0}{ui("完成")}</span>
                          <span>📅 {new Date(p.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.id !== currentProjectId && (
                          <button 
                            onClick={() => { setCurrentProjectId(p.id); setShowProjectManager(false); }}
                            className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-[10px] font-bold rounded-lg transition-colors"
                          >{ui("切换")}</button>
                        )}
                        <button 
                          onClick={() => handleDeleteProject(p.id)}
                          className="p-1.5 hover:bg-red-600/20 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                          title={ui("删除项目")}
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
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg>{ui("创建新项目")}</button>
            </div>
          </div>
        </div>
      )}

      {decision && decisionNode && <DecisionModal decision={decision} node={decisionNode} onChoice={handleDecisionChoice} onClose={() => setDecision(null)} />}
      {pendingIntent && <IntentConfirmModal analysis={pendingIntent.analysis} onConfirm={(mode, analysis) => createProjectWithMode(pendingIntent.input, mode, analysis)} onCancel={() => { setPendingIntent(null); setShowMetaModal(true); }} />}
      {researchReport && <ResearchReport report={researchReport} onClose={() => setResearchReport(null)} />}

      {showPremiumModal && <BillingModal onClose={() => setShowPremiumModal(false)} />}
    </div>
  );
};

export default App;
