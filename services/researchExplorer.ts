import { ProblemNode, KnowledgeCard, ResearchFinding, ResearchProgress, NodeStatus } from '../types';
import { callGemini } from './geminiService';
import { GEMINI_MODEL } from '../constants';
import { v4 as uuidv4 } from 'uuid';

// 计算研究进度
export function calculateResearchProgress(
  nodes: ProblemNode[],
  knowledgeCards: KnowledgeCard[],
  findings: ResearchFinding[]
): ResearchProgress {
  const totalNodes = nodes.length;
  const exploredNodes = nodes.filter(n => n.status === NodeStatus.SOLVED).length;
  const coveragePercent = totalNodes > 0 ? Math.round((exploredNodes / totalNodes) * 100) : 0;

  // 计算探索深度（基于节点层级）
  const explorationDepth = Math.min(
    Math.floor(Math.log2(totalNodes + 1)) + 1,
    5
  );

  return {
    totalNodes,
    exploredNodes,
    knowledgeCardsCount: knowledgeCards.length,
    findingsCount: findings.length,
    coveragePercent,
    // ResearchPanel组件需要的属性
    coverageScore: coveragePercent,
    answeredQuestions: exploredNodes,
    totalQuestions: totalNodes,
    knowledgeCards: knowledgeCards.length,
    findings: findings.length,
    explorationDepth
  };
}

export async function exploreResearchNode(
  node: ProblemNode,
  allNodes: ProblemNode[],
  onKnowledgeCard?: (card: KnowledgeCard) => void,
  onFinding?: (finding: ResearchFinding) => void
): Promise<{
  notes: string;
  confidence: number;
  subProblems?: { title: string; initialNotes?: string }[];
  triggerDecision?: boolean;
  decisionContext?: string;
  taskType?: string;
}> {
  const context = allNodes
    .filter(n => node.dependencies.includes(n.id))
    .map(n => `- ${n.title}: ${n.notes?.slice(0, 200) || '未探索'}`)
    .join('\n');

  const prompt = `作为研究助手，深入研究以下问题：

**研究主题**: ${node.title}

**相关背景**:
${context || '无'}

请进行系统性研究，返回JSON格式：
{
  "notes": "详细的研究笔记（300-500字）",
  "confidence": 0.8,
  "keyInsights": ["关键发现1", "关键发现2"],
  "knowledgeCards": [
    {"title": "知识点标题", "content": "知识点内容", "importance": "high/medium/low", "tags": ["标签1"]}
  ],
  "subProblems": [{"title": "需要进一步研究的子问题"}],
  "needsDecision": false,
  "decisionContext": "如果需要决策，说明原因"
}`;

  try {
    const response = await callGemini([
      { role: 'system', content: '你是专业的研究助手，擅长系统性分析和知识整理。返回纯JSON，不要markdown代码块。' },
      { role: 'user', content: prompt }
    ], undefined);

    const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(cleanJson);

    // 生成知识卡片
    if (result.knowledgeCards && onKnowledgeCard) {
      for (const kc of result.knowledgeCards) {
        const card: KnowledgeCard = {
          id: uuidv4(),
          title: kc.title,
          content: kc.content,
          sourceNodeId: node.id,
          sourceNodeTitle: node.title,
          tags: kc.tags || [],
          createdAt: Date.now(),
          importance: kc.importance || 'medium',
          category: kc.category || 'insight',
          confidence: kc.confidence || 0.7
        };
        onKnowledgeCard(card);
      }
    }

    // 生成研究发现
    if (result.keyInsights && onFinding) {
      for (const insight of result.keyInsights) {
        const finding: ResearchFinding = {
          id: uuidv4(),
          insight: insight,
          title: insight.slice(0, 30),
          description: insight,
          sourceNodeId: node.id,
          sourceNodeTitle: node.title,
          evidence: [],
          importance: 'medium',
          significance: 'medium',
          type: 'discovery',
          createdAt: Date.now()
        };
        onFinding(finding);
      }
    }

    return {
      notes: result.notes || '研究完成',
      confidence: result.confidence || 0.7,
      subProblems: result.subProblems,
      triggerDecision: result.needsDecision,
      decisionContext: result.decisionContext,
      taskType: 'research'
    };
  } catch (e) {
    console.error('Research exploration error:', e);
    return {
      notes: '研究过程中遇到问题，请重试',
      confidence: 0.3,
      taskType: 'research'
    };
  }
}

export async function generateResearchReport(
  metaProblem: string,
  nodes: ProblemNode[],
  knowledgeCards: KnowledgeCard[]
): Promise<{
  title: string;
  summary: string;
  sections: { title: string; content: string }[];
  conclusions: string[];
  recommendations: string[];
}> {
  const solvedNodes = nodes.filter(n => n.status === 'solved');
  const nodesContext = solvedNodes.map(n => `## ${n.title}\n${n.notes}`).join('\n\n');
  const cardsContext = knowledgeCards.map(c => `- **${c.title}**: ${c.content}`).join('\n');

  const prompt = `基于以下研究内容，生成完整的研究报告：

**研究主题**: ${metaProblem}

**已完成的研究节点**:
${nodesContext}

**知识卡片**:
${cardsContext}

请生成结构化的研究报告，返回JSON格式：
{
  "title": "报告标题",
  "summary": "研究摘要（100-200字）",
  "sections": [
    {"title": "章节标题", "content": "章节内容"}
  ],
  "conclusions": ["结论1", "结论2"],
  "recommendations": ["建议1", "建议2"]
}`;

  try {
    const response = await callGemini([
      { role: 'system', content: '你是专业的研究报告撰写专家。返回纯JSON，不要markdown代码块。' },
      { role: 'user', content: prompt }
    ], undefined);

    const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error('Report generation error:', e);
    return {
      title: metaProblem,
      summary: '报告生成失败，请重试',
      sections: [],
      conclusions: [],
      recommendations: []
    };
  }
}

// 重新导出类型以保持兼容性
export type { KnowledgeCard, ResearchFinding, ResearchProgress } from '../types';
