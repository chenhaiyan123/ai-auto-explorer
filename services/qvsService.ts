/**
 * QVS — Question Value Score 问题价值评估服务
 *
 * 公式：QVS = w₁×稀缺性 + w₂×深度 + w₃×可验证性 + w₄×社会价值 + w₅×创新性 + w₆×可执行性
 *
 * 调用 AI 对用户输入的问题进行 6 维度打分，返回结构化报告。
 */

import { callGemini } from './geminiService';

// ─── 类型定义 ─────────────────────────────────────────────

export interface QVSDimension {
  key: 'scarcity' | 'depth' | 'verifiability' | 'socialValue' | 'innovation' | 'feasibility';
  label: string;          // 中文名
  labelEn: string;        // 英文简称（雷达图用）
  score: number;          // 0–100
  weight: number;         // 权重（0–1，6 个维度相加 = 1）
  level: 'excellent' | 'good' | 'fair' | 'weak'; // 评级
  comment: string;        // 单维度 AI 点评
}

export interface QVSReport {
  question: string;       // 原始问题文本
  totalScore: number;     // 综合得分 0–100
  grade: 'S' | 'A' | 'B' | 'C' | 'D'; // 等级
  gradeLabel: string;     // 等级文字说明
  dimensions: QVSDimension[];
  highlights: string[];   // 亮点（score >= 80 的维度的点评）
  suggestions: string[];  // 优化建议（3 条以内）
  estimatedCredits: number; // 预估消耗积分
  canStart: boolean;      // 是否可以直接开始探索（总分 >= 60）
  reasoning: string;      // AI 总评
  evaluatedAt: number;    // 时间戳
}

// ─── 维度元数据 ─────────────────────────────────────────────

const DIMENSION_META: Omit<QVSDimension, 'score' | 'level' | 'comment'>[] = [
  {
    key: 'scarcity',
    label: '稀缺性',
    labelEn: 'Scarcity',
    weight: 0.15,
  },
  {
    key: 'depth',
    label: '深度',
    labelEn: 'Depth',
    weight: 0.20,
  },
  {
    key: 'verifiability',
    label: '可验证性',
    labelEn: 'Verifiability',
    weight: 0.20,
  },
  {
    key: 'socialValue',
    label: '社会价值',
    labelEn: 'Social Value',
    weight: 0.15,
  },
  {
    key: 'innovation',
    label: '创新性',
    labelEn: 'Innovation',
    weight: 0.15,
  },
  {
    key: 'feasibility',
    label: '可执行性',
    labelEn: 'Feasibility',
    weight: 0.15,
  },
];

// ─── 等级工具 ─────────────────────────────────────────────

function scoreToLevel(score: number): QVSDimension['level'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'weak';
}

function totalToGrade(score: number): QVSReport['grade'] {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

const GRADE_LABEL: Record<QVSReport['grade'], string> = {
  S: '卓越问题，强烈推荐探索',
  A: '高价值问题，值得深入研究',
  B: '良好问题，有探索空间',
  C: '普通问题，建议优化后再探索',
  D: '价值偏低，需要大幅改写',
};

// ─── Prompt ─────────────────────────────────────────────────

const QVS_PROMPT = `你是一个"问题价值评估专家"。你的任务是对用户提出的问题进行专业评估，输出结构化 JSON 报告。

## 评估维度（6 个，各有权重）

1. **稀缺性（scarcity）** 权重 15%
   - 这个问题有多新颖、独特？相似问题在网上已有多少答案？
   - 越少人问过、越难搜索到答案 → 稀缺性越高

2. **深度（depth）** 权重 20%
   - 问题涉及多少知识领域？有多少层因果关系？
   - 跨学科、多因果链、需要综合推理 → 深度越高

3. **可验证性（verifiability）** 权重 20%
   - 这个问题的答案能否被实验、数据、逻辑推导所验证？
   - 有明确验证路径 → 可验证性越高；纯主观/哲学 → 低

4. **社会价值（socialValue）** 权重 15%
   - 解决这个问题后，能惠及多少人？影响有多深？
   - 受益人群广、影响持久 → 社会价值越高

5. **创新性（innovation）** 权重 15%
   - 问题是否提出了新视角？是否挑战了现有假设？
   - 反常识、跨界视角、提出了新框架 → 创新性越高

6. **可执行性（feasibility）** 权重 15%
   - 当前的 AI 技术和信息环境能否在合理成本内探索这个问题？
   - 信息可获取、技术可支撑、成本合理 → 可执行性越高

## 用户输入的问题
"{question}"

## 输出要求（严格 JSON，不要其他内容）
{
  "dimensions": {
    "scarcity":      { "score": 0-100, "comment": "一句话点评（15字以内）" },
    "depth":         { "score": 0-100, "comment": "一句话点评（15字以内）" },
    "verifiability": { "score": 0-100, "comment": "一句话点评（15字以内）" },
    "socialValue":   { "score": 0-100, "comment": "一句话点评（15字以内）" },
    "innovation":    { "score": 0-100, "comment": "一句话点评（15字以内）" },
    "feasibility":   { "score": 0-100, "comment": "一句话点评（15字以内）" }
  },
  "suggestions": ["优化建议1（25字以内）", "优化建议2（25字以内）"],
  "reasoning": "总评，说明这个问题的核心价值或主要不足（50字以内）"
}

评分标准：
- 90-100：卓越，这个维度的顶级水准
- 70-89：良好，超过平均水平
- 50-69：一般，还有提升空间
- 0-49：偏弱，明显不足

只返回 JSON，不要 Markdown 代码块，不要其他文字。`;

// ─── 核心函数 ─────────────────────────────────────────────

/**
 * 对问题进行 QVS 评估，返回完整报告
 */
export async function evaluateQuestion(question: string): Promise<QVSReport> {
  const prompt = QVS_PROMPT.replace('{question}', question.trim());

  let rawDimensions: Record<string, { score: number; comment: string }> = {};
  let suggestions: string[] = [];
  let reasoning = '';

  try {
    const response = await callGemini(
      [{ role: 'user', content: prompt }],
      'qwen-max',
      'application/json'
    );

    // 兜底：有时模型会包 ```json ... ``` 外壳
    const cleaned = (response as string)
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    rawDimensions = parsed.dimensions || {};
    suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [];
    reasoning = parsed.reasoning || '';
  } catch (err) {
    console.warn('[QVS] AI 调用或解析失败，使用默认分数', err);
    // 降级：给出中等分数，提示用户 AI 暂时不可用
    DIMENSION_META.forEach(d => {
      rawDimensions[d.key] = { score: 60, comment: 'AI 评估暂时不可用' };
    });
    suggestions = ['请检查网络后重试评估'];
    reasoning = 'AI 评估服务暂时不可用，已使用默认分数。';
  }

  // ─ 组装维度数组 ─
  const dimensions: QVSDimension[] = DIMENSION_META.map(meta => {
    const raw = rawDimensions[meta.key] || { score: 60, comment: '' };
    const score = Math.max(0, Math.min(100, Math.round(raw.score)));
    return {
      ...meta,
      score,
      level: scoreToLevel(score),
      comment: raw.comment || '',
    };
  });

  // ─ 计算加权总分 ─
  const totalScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  const grade = totalToGrade(totalScore);

  // ─ 提取亮点（score >= 80 的维度） ─
  const highlights = dimensions
    .filter(d => d.score >= 80)
    .map(d => `${d.label}突出：${d.comment}`);

  // ─ 预估积分（总分越高、消耗越多，体现价值匹配） ─
  const estimatedCredits = Math.round(totalScore * 1.5 + 20);

  return {
    question: question.trim(),
    totalScore,
    grade,
    gradeLabel: GRADE_LABEL[grade],
    dimensions,
    highlights,
    suggestions,
    estimatedCredits,
    canStart: totalScore >= 50,
    reasoning,
    evaluatedAt: Date.now(),
  };
}

/**
 * 快速本地预估（不调用 AI，用于输入时的即时反馈）
 * 基于文本特征给出粗略的分值区间提示
 */
export function quickEstimate(question: string): {
  lengthOk: boolean;
  hasContext: boolean;
  hasCausalWords: boolean;
  hint: string;
} {
  const q = question.trim();
  const lengthOk = q.length >= 15;
  const hasContext = /因为|原因|背景|条件|假设|如果|当|在.*情况下/.test(q);
  const hasCausalWords = /为什么|如何|怎么|影响|导致|产生|解决|探索|研究/.test(q);

  let hint = '';
  if (!lengthOk) hint = '问题太短，请描述得更具体一些';
  else if (!hasCausalWords && !hasContext) hint = '试着加入"为什么""如何"或背景条件，会更有探索价值';
  else if (q.length >= 40 && (hasContext || hasCausalWords)) hint = '问题有一定深度，可以继续评估';
  else hint = '问题已具备基本结构，点击评估获取详细报告';

  return { lengthOk, hasContext, hasCausalWords, hint };
}
