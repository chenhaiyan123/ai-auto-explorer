
export enum NodeStatus {
  UNEXPLORED = 'unexplored',
  EXPLORING = 'exploring',
  SOLVED = 'solved',
  INVALID = 'invalid',
  NEEDS_REVIEW = 'needs_review'
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AgentResult {
  agentType: string;
  timestamp: number;
  output: string;
  score?: number;
}

export interface ProblemNode {
  id: string;
  title: string;
  status: NodeStatus;
  confidence: number;
  dependencies: string[];
  notes: string;
  isCollapsed?: boolean;
  isCritical?: boolean;
  isPinned?: boolean;
  chatHistory?: ChatMessage[];
  agentResults?: AgentResult[];
  manualResults?: string;
  /** 节点笔记正文（Markdown）——每个节点是一篇可编辑的笔记 */
  fullNote?: string;
  /** 用户标签 */
  tags?: string[];
  /** 所属文件夹路径（Obsidian 式层级，用 / 分隔，如 "研究方向/材料"） */
  folder?: string;
  /** 笔记类型：readme=项目说明，overview=项目总览主文件，direction=关键方向子节点（默认） */
  noteType?: 'readme' | 'overview' | 'direction';
  /** 负责这个子任务的 Agent（AI 团队分工，类似公司部门负责人） */
  assignedAgent?: string;
  /** 人工核验：AI 探索的结论由人确认后置 true（人机分工 + 可信溯源的核心） */
  verified?: boolean;
  /** 核验时间 */
  verifiedAt?: number;
  /** 笔记最后编辑时间 */
  noteUpdatedAt?: number;
  taskType?: 'image' | 'code' | 'web' | 'research' | 'none';
  pendingDecision?: DecisionPoint;
  x?: number;
  y?: number;
}

export interface DecisionPoint {
  nodeId: string;
  context?: string;
  options: {
    label: string;
    action: 'continue' | 'add_subproblem' | 'terminate';
    description?: string;
  }[];
}

export interface User {
  username: string;
  role: 'admin' | 'user';
  email?: string;
}

export interface UserStats {
  username: string;
  sessionCount: number;
  totalActiveSeconds: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  lastActiveTimestamp: number;
}

// ========== 研究相关类型 ==========
export interface KnowledgeCard {
  id: string;
  title: string;
  content: string;
  sourceNodeId: string;
  sourceNodeTitle: string;
  tags: string[];
  createdAt: number;
  importance: 'high' | 'medium' | 'low';
  category?: 'fact' | 'theory' | 'insight' | 'question' | 'method';
  confidence?: number;
}

export interface ResearchFinding {
  id: string;
  insight: string;
  sourceNodeId: string;
  sourceNodeTitle: string;
  evidence: string[];
  importance: 'high' | 'medium' | 'low';
  createdAt: number;
  title?: string;
  description?: string;
  type?: 'discovery' | 'contradiction' | 'gap' | 'connection';
  significance?: 'high' | 'medium' | 'low';
}

export interface ResearchProgress {
  totalNodes: number;
  exploredNodes: number;
  knowledgeCardsCount: number;
  findingsCount: number;
  coveragePercent: number;
  // 扩展属性 - ResearchPanel组件需要
  coverageScore: number;
  answeredQuestions: number;
  totalQuestions: number;
  knowledgeCards: number;
  findings: number;
  explorationDepth: number;
}

// ========== 意图分析类型 ==========
export type ExplorationMode = 'research' | 'build';

export interface IntentAnalysis {
  mode: ExplorationMode;
  confidence: number;
  suggestedTitle: string;
  reasoning: string;
  subTasks?: string[];
  keyQuestions?: string[];
}

// ========== 项目类型（扩展版）==========
export interface Project {
  id: string;
  name: string;
  metaProblem: string;
  nodes: ProblemNode[];
  createdAt: number;
  summaryNote?: string;
  explorationMode?: ExplorationMode;
  intentAnalysis?: IntentAnalysis;
  knowledgeCards?: KnowledgeCard[];
  researchFindings?: ResearchFinding[];
  butlerChatHistory?: ChatMessage[];
}

// ========== Artifact 类型 ==========
export interface Artifact {
  id: string;
  type: 'code' | 'image' | 'document' | 'chart' | 'other' | 'component' | 'style';
  title: string;
  content: string;
  language?: string;
  createdAt: number;
  nodeId?: string;
  version?: number;
  description?: string;
}

// ========== 用户反馈类型 ==========
export interface UserFeedback {
  id: string;
  artifactId?: string;
  rating?: number;
  comment?: string;
  createdAt: number;
  type?: 'bug' | 'feature' | 'improvement';
  content?: string;
  status?: 'pending' | 'in-progress' | 'resolved';
}

// ========== 消息类型 ==========
export interface Message {
  id: string;
  content: string;
  username: string;
  author?: string;
  createdAt: number;
}

// ========== Discovery 类型（用于长期探索）==========
export interface Discovery {
  id: string;
  type: 'breakthrough' | 'significant' | 'minor' | 'pending';
  title: string;
  description: string;
  evidence: string[];
  nodeId: string;
  timestamp: number;
  importance: number;
  summary?: string;
  content?: string;
  relatedNodeIds?: string[];
  confidence?: number;
  verifiedAt?: number;
}

export interface ExplorationConfig {
  intensity: ExplorationIntensity;
  maxConcurrent?: number;
  autoSave?: boolean;
}

export interface ExplorationSession {
  id: string;
  projectId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'paused' | 'completed' | 'error';
  discoveries: Discovery[];
  nodesExplored: number;
  totalNodes: number;
  config?: ExplorationConfig;
}

export type ExplorationIntensity = 'low' | 'medium' | 'high' | 'light' | 'moderate' | 'intensive';
