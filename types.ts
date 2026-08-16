
export enum NodeStatus {
  UNEXPLORED = 'unexplored',
  EXPLORING = 'exploring',
  SOLVED = 'solved',
  INVALID = 'invalid',
  NEEDS_REVIEW = 'needs_review',
  /** 推理已到头，需要现实反馈才能继续（验证触发器命中后进入） */
  VALIDATING = 'validating',
  /** 现实反馈与假设冲突，该转向了 */
  CONTRADICTED = 'contradicted'
}

// ========== 假设与证据（现实反馈闭环的地基）==========
/**
 * 证据层级，越往下越接近现实、权重越高：
 * stated      语言：有人这么说 / AI 这么推理
 * behavior    行为：真实用户做了什么（点击、留资、复用）
 * outcome     结果：预测 vs 实际的可量化差距
 * environment 环境：测试、实验、系统给出的客观反驳
 * market      市场：付费、续费、推荐——最强信号
 */
export type EvidenceLayer = 'stated' | 'behavior' | 'outcome' | 'environment' | 'market';

/** 证据由谁产生。ai = 模型自己推理出来的，永远只能算 stated 层。 */
export type EvidenceOrigin = 'ai' | 'human' | 'probe';

export interface Evidence {
  id: string;
  /** 支持还是反对该假设 */
  stance: 'support' | 'refute';
  layer: EvidenceLayer;
  /** 一句话说清这条证据是什么 */
  claim: string;
  /** 来源：网页 / 访谈 / 实验 / 用户行为…… */
  source?: string;
  origin: EvidenceOrigin;
  /** 若来自探针 */
  probeId?: string;
  createdAt: number;
}

/**
 * 一个节点当前「赌」的东西。
 * 只做三档 belief，不做 0-1 假精度——数字如果是模型拍的，比没有更糟。
 */
export interface Hypothesis {
  /** 可证伪的一句话 */
  statement: string;
  belief: 'low' | 'medium' | 'high';
  evidence: Evidence[];
  /** 最大未知量：没法靠推理知道、必须问现实的那件事 */
  unknown?: string;
  updatedAt: number;
}

/** 证据层级权重：语言层几乎不值钱，市场层最重 */
export const LAYER_WEIGHT: Record<EvidenceLayer, number> = {
  stated: 1,
  behavior: 3,
  outcome: 4,
  environment: 4,
  market: 6,
};

export const LAYER_LABEL: Record<EvidenceLayer, string> = {
  stated: '语言',
  behavior: '行为',
  outcome: '结果',
  environment: '环境',
  market: '市场',
};

// ========== 探针（Probe）：向现实伸出去的小触角 ==========
/** 做这个验证的代价 */
export type ProbeCost = 'low' | 'medium' | 'high';

export interface ProbeResult {
  /** 现实回答了什么 */
  summary: string;
  /** 结果指向哪边。unclear = 没测出来，不产生证据 */
  stance: 'support' | 'refute' | 'unclear';
  /** 这次拿到的是哪一层的信号 */
  layer: EvidenceLayer;
  at: number;
  /** 设备探针的原始采样序列（时间序列，可回溯、可出图） */
  samples?: ProbeSample[];
  /** 按 metric 聚合后的那个数 */
  metricValue?: number;
}

/**
 * 一次低成本的现实验证。
 * AI 负责**设计**（它做这个够用），人负责**执行和回填**（卡点从来在这一步）。
 */
export interface Probe {
  id: string;
  nodeId: string;
  /** manual = 人去执行并回填；device = 绑定 IoT 设备自动跑 */
  kind?: 'manual' | 'device';
  /** kind==='device' 时的设备实验配置 */
  device?: DeviceProbeSpec;
  /** 设计这个探针时要验的那句话（快照——假设后来改了也能追溯当时在验什么） */
  hypothesis: string;
  /** 怎么验：找谁、做什么、看什么 */
  method: string;
  cost: ProbeCost;
  /** 预计投入，如「半天」「20 个用户」 */
  effort?: string;
  /**
   * 什么结果算支持、什么算反对——**必须事前写死**。
   * 否则拿到数据后人会顺着自己想要的方向解释，验证就白做了。
   */
  expectedSignal: string;
  status: 'draft' | 'running' | 'done' | 'skipped';
  createdAt: number;
  result?: ProbeResult;
}

export const PROBE_COST_LABEL: Record<ProbeCost, string> = { low: '低', medium: '中', high: '高' };

/** 一次采样 */
export interface ProbeSample {
  at: number;
  value: number;
  /** 原始响应片段，出问题时能回溯 */
  raw?: string;
}

/** 对聚合读数的数值判定条件 */
export interface NumericCondition {
  op: '>' | '>=' | '<' | '<=' | 'between' | 'outside';
  value: number;
  /** between / outside 用的上界 */
  value2?: number;
}

/** 多次采样怎么聚合成一个数 */
export type ProbeMetric = 'avg' | 'max' | 'min' | 'last';

/**
 * 设备探针：绑定一台已注册的 IoT 设备，自动采样并按**事前定好的阈值**判定。
 *
 * 这是整个现实反馈闭环里唯一不需要人动手的证据来源——
 * 其它四层（语言/行为/结果/市场）都绕不开人或市场，只有环境层可以由机器直接给出。
 */
export interface DeviceProbeSpec {
  deviceId: string;
  /** 设备名快照：设备以后被删了，这条实验记录也还看得懂 */
  deviceName: string;
  actionId: string;
  actionName: string;
  params?: Record<string, string>;
  /** 从返回 JSON 里取哪个字段，如 "data.temperature"；留空则把整个响应当数值解析 */
  readPath?: string;
  unit?: string;
  /** 采样次数 */
  samples: number;
  /** 采样间隔（秒） */
  intervalSec: number;
  metric: ProbeMetric;
  /** 聚合值满足它 = 支持假设 */
  supportIf?: NumericCondition;
  /** 聚合值满足它 = 反对假设。判定时**先看反对**，宁可发现自己错 */
  refuteIf?: NumericCondition;
}

// ========== 探索路线与锚点路标 ==========
/**
 * 锚点路标：路线上一个必须拿到真实数据才能跨过去的点。
 *
 * 它和「验证触发器」的分工：
 * - 触发器是**临时发现**该问现实了（AI 自己越推越飘时兜底）；
 * - 锚点是**事先计划好**的验证点（从一开始就知道这里必须停）。
 * 两者并存，一个兜底一个定调。
 */
export interface RouteAnchor {
  id: string;
  /** 在路线上的序号，从 1 开始 */
  order: number;
  title: string;
  /** 这个路标要向现实问的那个问题 */
  question: string;
  /** 需要什么真实信息 / 数据 */
  needs: string;
  /** 验证方式 */
  method: 'user' | 'device' | 'experiment' | 'data' | 'mixed';
  /** 具体怎么验：找谁、用哪台设备、看哪个数 */
  methodDetail: string;
  /** 什么结果算通过——**必须事前写死** */
  passIf: string;
  /** 什么结果算不通过（触发改线） */
  failIf: string;
  /**
   * 暂定 = 这个锚点是 AI 在没有真实数据的情况下先占的位，
   * 等前面的锚点拿到数据后会被重新规划。只有当前锚点是确定的。
   */
  tentative?: boolean;
  /** 软锚点：有数据就用，没有也不阻塞探索。默认（false）是硬闸，必须拿到结果才能往下走。 */
  soft?: boolean;
  status: 'pending' | 'waiting' | 'passed' | 'failed' | 'skipped';
  /** 挂在这一段上的探针（AI 设计或用户配的），结果回来自动结算这个锚点 */
  probeIds?: string[];
  result?: {
    verdict: 'pass' | 'fail' | 'unclear';
    summary: string;
    /** 数据来自哪：人回填 / 设备探针 */
    origin: 'human' | 'probe';
    at: number;
  };
  /** 到达（转入 waiting）的时间 */
  reachedAt?: number;
  settledAt?: number;
}

/** 一次改线：真实数据把后面的路改了，记下来是为了能回看"为什么会走到这" */
export interface RouteRevision {
  at: number;
  /** 触发改线的锚点 */
  anchorId: string;
  anchorTitle: string;
  /** 现实说了什么 */
  reason: string;
  /** 路线怎么变了 */
  note: string;
  /** 改线前后的剩余锚点标题，便于对比 */
  before: string[];
  after: string[];
}

/**
 * 探索路线：针对长期问题先规划一条路，路上放几个必须拿真实数据才能跨过的锚点。
 *
 * 关键约束（见 routeService）：
 * 1. 只有当前锚点是确定的，后面的一律 tentative——AI 一次性把 7 个锚点全定死，
 *    后面那几个本身就是一大段没根据的推理，正是这套东西要治的病。
 * 2. 已经 passed / failed 的锚点**冻结**，改线只能动后面的。
 */
export interface ExplorationRoute {
  id: string;
  goal: string;
  createdAt: number;
  version: number;
  anchors: RouteAnchor[];
  revisions: RouteRevision[];
}

export const ANCHOR_METHOD_LABEL: Record<RouteAnchor['method'], string> = {
  user: '问真实用户',
  device: '设备实测',
  experiment: '做实验',
  data: '查真实数据',
  mixed: '组合验证',
};

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
  /** 该笔记正文是否由 AI 自动维护（如总览）。用户一旦手动编辑即置 false，AI 不再覆盖 */
  autoNote?: boolean;
  taskType?: 'image' | 'code' | 'web' | 'research' | 'none';
  /**
   * 该节点当前的假设与证据。
   * 注意：与上面的 `confidence` 不是一回事——confidence 是模型自评的分数（自证），
   * hypothesis.belief 才是「有多少外部证据撑着」。两者不要混用。
   */
  hypothesis?: Hypothesis;
  /** 最近一次验证触发器命中的原因（用于界面提示，探索循环写入） */
  validationReason?: string;
  /** 属于路线上的哪一段（哪个锚点之前）。有路线时，探索循环只跑当前段的节点 */
  anchorId?: string;
  /** 该节点是从某条决策记录 fork（复刻）出来的 */
  forkOfDecisionId?: string;
  pendingDecision?: DecisionPoint;
  x?: number;
  y?: number;
}

// ========== 决策节点持久化（重点功能）==========
/** 决策的一个候选项：选中或放弃，理由可选填 */
export interface DecisionOption {
  label: string;
  chosen: boolean;
  /** 选择理由（chosen=true）或放弃理由（chosen=false），可不填 */
  reason?: string;
}

export type DecisionTrigger = 'manual' | 'delete_node' | 'invalidate' | 'explore' | 'fork' | 'contradicted';

/** 一条持久化的决策记录：过程 + 当时的节点子树快照（可随时 fork 复刻） */
export interface DecisionRecord {
  id: string;
  /** 决策发生的节点 */
  nodeId: string;
  nodeTitle: string;
  /** 决策问题 / 背景 */
  question: string;
  options: DecisionOption[];
  trigger: DecisionTrigger;
  /** 决策当时该节点及其子树的完整快照（深拷贝），fork 的依据 */
  snapshot: ProblemNode[];
  createdAt: number;
  /** 从此决策 fork 出的分支记录 */
  forks?: { rootNodeId: string; createdAt: number }[];
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
  /** 决策记录（持久化，随项目保存） */
  decisions?: DecisionRecord[];
  /** 探针（现实验证），与 decisions 一样随项目自动持久化，零新增基础设施 */
  probes?: Probe[];
  /** 探索路线（含锚点路标），随项目自动持久化 */
  route?: ExplorationRoute;
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
