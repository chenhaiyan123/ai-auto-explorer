/**
 * 研究模式探索服务 (Research Explorer)
 * 
 * 核心理念：好奇心驱动，理解世界
 * 目标：构建知识体系，生成研究报告
 * 
 * 探索流程：
 * 1. 问题拆解 → 将大问题分解为可探索的子问题
 * 2. 知识检索 → 搜集相关信息和已有研究
 * 3. 深度分析 → 整合信息形成见解
 * 4. 发现记录 → 沉淀为知识卡片
 * 5. 延伸探索 → 发现新的研究方向
 */

import { ProblemNode, NodeStatus, Project } from '../types';
import { callGemini } from './geminiService';
import { GEMINI_MODEL } from '../constants';

// ============ 类型定义 ============

/** 知识卡片 - 研究模式的核心输出单元 */
export interface KnowledgeCard {
  id: string;
  title: string;
  content: string;
  category: 'fact' | 'theory' | 'insight' | 'question' | 'reference';
  confidence: number;      // 0-1，信息可信度
  sources: string[];       // 信息来源
  relatedCards: string[];  // 关联的卡片ID
  tags: string[];
  createdAt: number;
}

/** 研究发现 */
export interface ResearchFinding {
  type: 'discovery' | 'contradiction' | 'gap' | 'connection';
  title: string;
  description: string;
  significance: 'low' | 'medium' | 'high';
  relatedNodes: string[];
}

/** 研究进度追踪 */
export interface ResearchProgress {
  totalQuestions: number;
  answeredQuestions: number;
  knowledgeCards: number;
  findings: number;
  explorationDepth: number;  // 探索深度层级
  coverageScore: number;     // 0-100，问题覆盖度
}

/** 研究节点扩展属性 */
export interface ResearchNodeData {
  questionType: 'what' | 'why' | 'how' | 'when' | 'where' | 'who' | 'compare' | 'predict';
  knowledgeDomain: string;
  researchDepth: number;     // 当前深度
  maxDepth: number;          // 建议最大深度
  knowledgeCards: KnowledgeCard[];
  findings: ResearchFinding[];
  references: string[];
  childQuestions: string[];  // 衍生出的子问题
}

// ============ 核心探索函数 ============

/**
 * 研究模式：分析问题并生成探索计划
 */
export async function analyzeResearchQuestion(
  question: string,
  context?: string
): Promise<{
  analysis: {
    questionType: ResearchNodeData['questionType'];
    knowledgeDomain: string;
    complexity: 'simple' | 'moderate' | 'complex';
    suggestedDepth: number;
  };
  subQuestions: {
    question: string;
    type: ResearchNodeData['questionType'];
    priority: number;
    rationale: string;
  }[];
  initialInsights: string[];
  relatedDomains: string[];
}> {
  const prompt = `你是一位资深的研究方法论专家。请分析以下研究问题：

**研究问题**: ${question}
${context ? `**背景信息**: ${context}` : ''}

请完成以下分析任务：

## 1. 问题分类
判断这是什么类型的问题：
- what: 是什么（定义、概念）
- why: 为什么（原因、机制）
- how: 如何（方法、过程）
- when: 何时（时间、阶段）
- where: 何处（范围、领域）
- who: 谁（主体、参与者）
- compare: 比较（异同、优劣）
- predict: 预测（趋势、未来）

## 2. 知识领域
这个问题属于哪个知识领域？（如：物理学、心理学、计算机科学等）

## 3. 复杂度评估
- simple: 可以直接回答
- moderate: 需要多角度分析
- complex: 需要深入研究和大量子问题

## 4. 子问题拆解
将这个问题拆解为 3-5 个可独立研究的子问题，每个子问题需要：
- 问题本身
- 问题类型
- 优先级 (1-5，5最高)
- 为什么需要研究这个子问题

## 5. 初步见解
基于常识，可以提出的 2-3 个初步假设或见解

## 6. 相关领域
可能需要跨越哪些相关知识领域

请严格按以下 JSON 格式返回：
{
  "analysis": {
    "questionType": "why",
    "knowledgeDomain": "领域名称",
    "complexity": "moderate",
    "suggestedDepth": 3
  },
  "subQuestions": [
    {
      "question": "子问题1",
      "type": "what",
      "priority": 5,
      "rationale": "为什么需要研究这个"
    }
  ],
  "initialInsights": [
    "初步见解1",
    "初步见解2"
  ],
  "relatedDomains": ["相关领域1", "相关领域2"]
}`;

  try {
    const response = await callGemini([
      { role: 'system', content: '你是一位严谨的研究方法论专家，擅长问题分析和研究设计。请返回有效的 JSON。' },
      { role: 'user', content: prompt }
    ], 'qwen-max');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('JSON 解析失败');
  } catch (error) {
    console.error('研究问题分析失败:', error);
    // 返回默认结构
    return {
      analysis: {
        questionType: 'what',
        knowledgeDomain: '通用',
        complexity: 'moderate',
        suggestedDepth: 2
      },
      subQuestions: [{
        question: `${question} 的基本概念是什么？`,
        type: 'what',
        priority: 5,
        rationale: '需要先理解基本概念'
      }],
      initialInsights: ['需要进一步研究'],
      relatedDomains: []
    };
  }
}

/**
 * 研究模式：深度探索单个问题节点
 */
export async function exploreResearchNode(
  node: ProblemNode,
  allNodes: ProblemNode[],
  currentDepth: number = 1,
  maxDepth: number = 3
): Promise<{
  notes: string;
  confidence: number;
  knowledgeCards: KnowledgeCard[];
  findings: ResearchFinding[];
  subProblems: { title: string; initialNotes: string; questionType: string }[];
  shouldContinue: boolean;
  triggerDecision: boolean;
  decisionContext?: string;
}> {
  // 获取上下文
  const parentNodes = allNodes.filter(n => node.dependencies.includes(n.id));
  const siblingNodes = allNodes.filter(n => 
    n.id !== node.id && 
    n.dependencies.some(d => node.dependencies.includes(d))
  );

  const contextInfo = parentNodes.length > 0 
    ? `\n**上游研究结论**:\n${parentNodes.map(n => `- ${n.title}: ${n.notes || '待研究'}`).join('\n')}`
    : '';

  const siblingInfo = siblingNodes.length > 0
    ? `\n**同级研究参考**:\n${siblingNodes.map(n => `- ${n.title} [${n.status}]`).join('\n')}`
    : '';

  const prompt = `你是一位专注而严谨的研究者。请深入研究以下问题：

**研究问题**: ${node.title}
**已有笔记**: ${node.notes || '无'}
**当前深度**: 第 ${currentDepth} 层（最大 ${maxDepth} 层）
${contextInfo}
${siblingInfo}

请完成以下研究任务：

## 1. 深度分析
对这个问题进行全面、深入的分析，包括：
- 核心概念解释
- 关键因素识别
- 重要关联发现
- 现有研究/观点总结

## 2. 知识卡片
将发现的知识点整理为结构化的卡片，每张卡片包含：
- 标题
- 内容（简明扼要）
- 类型：fact(事实)/theory(理论)/insight(见解)/question(新问题)/reference(引用)
- 可信度 (0-1)
- 标签

## 3. 研究发现
识别重要的发现，包括：
- discovery: 新发现
- contradiction: 矛盾点
- gap: 知识空白
- connection: 意外关联

## 4. 子问题延伸
如果当前深度 < 最大深度，且有值得继续探索的方向，列出 1-3 个子问题。
如果问题已经足够清晰，可以不产生子问题。

## 5. 是否需要人工决策
当遇到以下情况时设为 true：
- 发现多个互斥的研究方向
- 遇到重大知识空白需要用户确认方向
- 研究结论与常识有重大冲突

请严格按以下 JSON 格式返回：
{
  "notes": "详细的研究分析（300-500字）",
  "confidence": 0.8,
  "knowledgeCards": [
    {
      "id": "kc_1",
      "title": "卡片标题",
      "content": "卡片内容",
      "category": "fact",
      "confidence": 0.9,
      "sources": [],
      "relatedCards": [],
      "tags": ["标签1"]
    }
  ],
  "findings": [
    {
      "type": "discovery",
      "title": "发现标题",
      "description": "发现描述",
      "significance": "medium",
      "relatedNodes": []
    }
  ],
  "subProblems": [
    {
      "title": "子问题",
      "initialNotes": "研究方向说明",
      "questionType": "why"
    }
  ],
  "shouldContinue": true,
  "triggerDecision": false,
  "decisionContext": ""
}`;

  try {
    const response = await callGemini([
      { role: 'system', content: '你是一位追求真理的研究者，善于发现知识间的联系，严谨而富有洞察力。' },
      { role: 'user', content: prompt }
    ], 'qwen-max');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      
      // 为知识卡片添加时间戳
      result.knowledgeCards = (result.knowledgeCards || []).map((card: any, idx: number) => ({
        ...card,
        id: card.id || `kc_${Date.now()}_${idx}`,
        createdAt: Date.now()
      }));

      // 深度控制：如果到达最大深度，不再产生子问题
      if (currentDepth >= maxDepth) {
        result.subProblems = [];
        result.shouldContinue = false;
      }

      return result;
    }
    throw new Error('JSON 解析失败');
  } catch (error) {
    console.error('研究节点探索失败:', error);
    return {
      notes: `研究分析进行中，遇到技术问题：${error instanceof Error ? error.message : '未知错误'}`,
      confidence: 0.3,
      knowledgeCards: [],
      findings: [],
      subProblems: [],
      shouldContinue: false,
      triggerDecision: true,
      decisionContext: '研究过程遇到问题，需要人工检查'
    };
  }
}

/**
 * 生成知识关联图谱
 */
export async function generateKnowledgeGraph(
  nodes: ProblemNode[],
  knowledgeCards: KnowledgeCard[]
): Promise<{
  nodes: { id: string; label: string; type: string; size: number }[];
  edges: { source: string; target: string; relation: string }[];
  clusters: { id: string; label: string; nodes: string[] }[];
}> {
  const nodesInfo = nodes.map(n => ({
    id: n.id,
    title: n.title,
    notes: n.notes?.slice(0, 200)
  }));

  const cardsInfo = knowledgeCards.map(c => ({
    id: c.id,
    title: c.title,
    category: c.category,
    tags: c.tags
  }));

  const prompt = `请分析以下研究节点和知识卡片，生成知识关联图谱：

**研究节点**:
${JSON.stringify(nodesInfo, null, 2)}

**知识卡片**:
${JSON.stringify(cardsInfo, null, 2)}

请识别：
1. 节点之间的关联关系
2. 知识卡片之间的关联
3. 节点与卡片的关联
4. 可以聚类的知识群组

返回 JSON 格式：
{
  "nodes": [
    {"id": "id", "label": "显示名", "type": "research|card", "size": 1-10}
  ],
  "edges": [
    {"source": "id1", "target": "id2", "relation": "关系描述"}
  ],
  "clusters": [
    {"id": "cluster1", "label": "聚类名", "nodes": ["id1", "id2"]}
  ]
}`;

  try {
    const response = await callGemini([
      { role: 'user', content: prompt }
    ], 'qwen-plus');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('知识图谱生成失败:', error);
  }

  // 返回基础图谱
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.title,
      type: 'research',
      size: n.status === NodeStatus.SOLVED ? 8 : 5
    })),
    edges: nodes.flatMap(n => 
      n.dependencies.map(d => ({
        source: d,
        target: n.id,
        relation: '派生'
      }))
    ),
    clusters: []
  };
}

/**
 * 生成研究报告
 */
export async function generateResearchReport(
  project: Project,
  knowledgeCards: KnowledgeCard[],
  findings: ResearchFinding[]
): Promise<{
  title: string;
  abstract: string;
  sections: {
    title: string;
    content: string;
  }[];
  conclusions: string[];
  openQuestions: string[];
  references: string[];
}> {
  const nodesContent = project.nodes
    .filter(n => n.status === NodeStatus.SOLVED)
    .map(n => `## ${n.title}\n${n.notes}`)
    .join('\n\n');

  const cardsContent = knowledgeCards
    .map(c => `- [${c.category}] ${c.title}: ${c.content}`)
    .join('\n');

  const findingsContent = findings
    .map(f => `- [${f.type}/${f.significance}] ${f.title}: ${f.description}`)
    .join('\n');

  const prompt = `请基于以下研究内容，生成一份专业的研究报告：

**研究主题**: ${project.metaProblem}

**研究节点内容**:
${nodesContent}

**知识卡片**:
${cardsContent}

**研究发现**:
${findingsContent}

请生成包含以下部分的研究报告：
1. 标题 - 简洁有力
2. 摘要 - 200字以内概述
3. 章节 - 3-5个主要章节，每章有标题和内容
4. 结论 - 3-5条核心结论
5. 开放问题 - 值得进一步研究的问题
6. 参考来源 - 如果有的话

返回 JSON 格式：
{
  "title": "报告标题",
  "abstract": "摘要内容",
  "sections": [
    {"title": "章节标题", "content": "章节内容"}
  ],
  "conclusions": ["结论1", "结论2"],
  "openQuestions": ["开放问题1"],
  "references": []
}`;

  try {
    const response = await callGemini([
      { role: 'system', content: '你是一位专业的学术报告撰写专家。' },
      { role: 'user', content: prompt }
    ], 'qwen-max');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('研究报告生成失败:', error);
  }

  return {
    title: `${project.name} 研究报告`,
    abstract: '报告生成中遇到问题',
    sections: [],
    conclusions: [],
    openQuestions: [],
    references: []
  };
}

/**
 * 计算研究进度
 */
export function calculateResearchProgress(
  nodes: ProblemNode[],
  knowledgeCards: KnowledgeCard[],
  findings: ResearchFinding[]
): ResearchProgress {
  const totalQuestions = nodes.length;
  const answeredQuestions = nodes.filter(n => n.status === NodeStatus.SOLVED).length;
  
  // 计算探索深度
  const getDepth = (nodeId: string, visited: Set<string> = new Set()): number => {
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    if (!node || node.dependencies.length === 0) return 1;
    return 1 + Math.max(...node.dependencies.map(d => getDepth(d, visited)));
  };
  
  const depths = nodes.map(n => getDepth(n.id));
  const explorationDepth = Math.max(...depths, 0);

  // 计算覆盖度
  const coverageScore = totalQuestions > 0 
    ? Math.round((answeredQuestions / totalQuestions) * 100)
    : 0;

  return {
    totalQuestions,
    answeredQuestions,
    knowledgeCards: knowledgeCards.length,
    findings: findings.length,
    explorationDepth,
    coverageScore
  };
}

/**
 * 获取研究建议
 */
export async function getResearchSuggestions(
  nodes: ProblemNode[],
  progress: ResearchProgress
): Promise<{
  nextSteps: string[];
  focusAreas: string[];
  warnings: string[];
}> {
  const unexploredNodes = nodes.filter(n => n.status === NodeStatus.UNEXPLORED);
  const exploringNodes = nodes.filter(n => n.status === NodeStatus.EXPLORING);

  const prompt = `作为研究顾问，请基于当前研究进度给出建议：

**研究进度**:
- 总问题数: ${progress.totalQuestions}
- 已解答: ${progress.answeredQuestions}
- 知识卡片: ${progress.knowledgeCards}
- 探索深度: ${progress.explorationDepth}
- 覆盖率: ${progress.coverageScore}%

**待探索节点**:
${unexploredNodes.map(n => `- ${n.title}`).join('\n') || '无'}

**进行中节点**:
${exploringNodes.map(n => `- ${n.title}`).join('\n') || '无'}

请给出：
1. 下一步建议 (2-3条)
2. 重点关注领域
3. 潜在风险提醒

返回 JSON：
{
  "nextSteps": ["建议1", "建议2"],
  "focusAreas": ["领域1"],
  "warnings": ["提醒1"]
}`;

  try {
    const response = await callGemini([
      { role: 'user', content: prompt }
    ], 'qwen-plus');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('研究建议生成失败:', error);
  }

  return {
    nextSteps: unexploredNodes.length > 0 
      ? [`继续探索: ${unexploredNodes[0].title}`]
      : ['研究已完成，可以生成报告'],
    focusAreas: [],
    warnings: []
  };
}
