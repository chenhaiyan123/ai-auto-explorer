
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
  isCritical?: boolean; // 新增：关键节点标记
  isPinned?: boolean;   // 新增：固定节点标记
  chatHistory?: ChatMessage[];
  agentResults?: AgentResult[];
  manualResults?: string;
  fullNote?: string;
  taskType?: 'image' | 'code' | 'web' | 'research' | 'none'; // 识别出的任务类型
  pendingDecision?: DecisionPoint; // 存储待处理的决策
  x?: number;
  y?: number;
}

export interface Project {
  id: string;
  name: string;
  metaProblem: string;
  nodes: ProblemNode[];
  createdAt: number;
  summaryNote?: string; // 全局生成的项目总览笔记
}

export interface DecisionPoint {
  nodeId: string;
  context?: string; // AI 提供的决策背景，例如“方向 A 与方向 B 的取舍”
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
