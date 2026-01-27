/**
 * 意图识别服务
 * 
 * 核心功能：分析用户输入的问题，判断属于哪种探索模式
 * - 研究模式 (Research)：好奇心驱动，理解世界
 * - 构建模式 (Build)：想象力驱动，改变世界
 */

import { callGemini } from './geminiService';
import { GEMINI_MODEL } from '../constants';

// ============ 类型定义 ============

export type ExplorationMode = 'research' | 'build';

export interface IntentAnalysis {
  mode: ExplorationMode;
  confidence: number;           // 0-1，识别置信度
  reasoning: string;            // AI 的判断理由
  suggestedTitle: string;       // 建议的项目标题
  keywords: string[];           // 提取的关键词
  
  // 研究模式特有
  researchFocus?: {
    mainQuestion: string;       // 核心研究问题
    subQuestions: string[];     // 初步的子问题
    knowledgeDomains: string[]; // 涉及的知识领域
  };
  
  // 构建模式特有
  buildSpec?: {
    targetProduct: string;      // 要构建的目标产品
    coreFeatures: string[];     // 核心功能点
    possibleTechStack: string[];// 可能的技术栈
    mvpScope: string;           // MVP 范围描述
  };
}

export interface IntentSignals {
  researchSignals: string[];    // 检测到的研究信号
  buildSignals: string[];       // 检测到的构建信号
  ambiguousSignals: string[];   // 模糊信号
}

// ============ 关键词库 ============

const RESEARCH_KEYWORDS = [
  // 疑问型
  '为什么', '是什么', '如何理解', '怎么解释', '什么原因',
  'why', 'what is', 'how to understand', 'explain',
  
  // 探索型
  '研究', '探索', '调查', '分析', '了解', '学习',
  'research', 'explore', 'investigate', 'analyze', 'study',
  
  // 知识型
  '原理', '机制', '理论', '历史', '发展', '趋势', '现状',
  'principle', 'mechanism', 'theory', 'history', 'trend',
  
  // 比较型
  '区别', '比较', '对比', '优劣', '异同',
  'difference', 'compare', 'contrast',
  
  // 开放型
  '可能性', '影响', '意义', '价值', '未来',
  'possibility', 'impact', 'significance', 'future'
];

const BUILD_KEYWORDS = [
  // 创造型
  '我想要', '帮我做', '帮我建', '创建', '制作', '开发', '设计',
  'i want', 'create', 'build', 'make', 'develop', 'design',
  
  // 实现型
  '实现', '搭建', '写一个', '做一个', '生成',
  'implement', 'generate', 'write a', 'make a',
  
  // 产品型
  '应用', 'app', '网站', '工具', '系统', '程序', '软件',
  'application', 'website', 'tool', 'system', 'program', 'software',
  
  // 功能型
  '功能', '特性', '能够', '可以', '支持',
  'feature', 'can', 'support', 'able to',
  
  // 具体物
  '原型', 'demo', '样品', '界面', 'UI', '代码',
  'prototype', 'interface', 'code'
];

// ============ 本地预分析 ============

/**
 * 快速本地分析，检测明显的信号
 * 用于：1) 提供给 AI 作为参考 2) 在 AI 不可用时降级使用
 */
export function analyzeSignalsLocally(input: string): IntentSignals {
  const lowerInput = input.toLowerCase();
  
  const researchSignals: string[] = [];
  const buildSignals: string[] = [];
  const ambiguousSignals: string[] = [];
  
  // 检测研究关键词
  RESEARCH_KEYWORDS.forEach(keyword => {
    if (lowerInput.includes(keyword.toLowerCase())) {
      researchSignals.push(keyword);
    }
  });
  
  // 检测构建关键词
  BUILD_KEYWORDS.forEach(keyword => {
    if (lowerInput.includes(keyword.toLowerCase())) {
      buildSignals.push(keyword);
    }
  });
  
  // 检测模糊信号
  const ambiguousPatterns = [
    { pattern: /怎么|how to/i, signal: '方法询问（可研究可构建）' },
    { pattern: /最好的|best/i, signal: '最优选择（可研究可构建）' },
    { pattern: /方案|solution/i, signal: '方案（可研究可构建）' },
  ];
  
  ambiguousPatterns.forEach(({ pattern, signal }) => {
    if (pattern.test(input)) {
      ambiguousSignals.push(signal);
    }
  });
  
  return { researchSignals, buildSignals, ambiguousSignals };
}

/**
 * 基于本地信号的快速判断（不调用 AI）
 */
export function quickClassify(input: string): { mode: ExplorationMode; confidence: number } {
  const signals = analyzeSignalsLocally(input);
  
  const researchScore = signals.researchSignals.length;
  const buildScore = signals.buildSignals.length;
  const totalSignals = researchScore + buildScore;
  
  if (totalSignals === 0) {
    // 没有明确信号，默认研究模式（更安全）
    return { mode: 'research', confidence: 0.3 };
  }
  
  if (researchScore > buildScore) {
    return { 
      mode: 'research', 
      confidence: Math.min(0.9, 0.5 + (researchScore - buildScore) * 0.1) 
    };
  } else if (buildScore > researchScore) {
    return { 
      mode: 'build', 
      confidence: Math.min(0.9, 0.5 + (buildScore - researchScore) * 0.1) 
    };
  } else {
    // 信号相等，看哪边更强
    return { mode: 'research', confidence: 0.5 };
  }
}

// ============ AI 深度分析 ============

const INTENT_ANALYSIS_PROMPT = `你是一个意图识别专家。用户将输入一个问题或想法，你需要判断它属于哪种探索模式：

## 两种模式

### 🔬 研究模式 (research)
- **驱动力**：好奇心，想理解世界
- **特点**：开放性问题，没有明确终点，追求知识和洞察
- **例子**：
  - "为什么宇宙会膨胀？"
  - "研究外星生命存在的可能性"
  - "人工智能会取代人类吗？"
  - "量子计算的原理是什么？"

### 🔧 构建模式 (build)  
- **驱动力**：想象力，想改变世界
- **特点**：有明确目标，要造出可用的东西
- **例子**：
  - "我想要一个能翻译狗语言的项圈"
  - "帮我做一个番茄钟应用"
  - "设计一个智能家居控制系统"
  - "创建一个个人知识管理工具"

## 你的任务

分析用户输入，返回 JSON 格式的判断结果。

## 本地预分析信号（供参考）
{localSignals}

## 用户输入
{userInput}

## 返回格式（严格 JSON）
\`\`\`json
{
  "mode": "research" 或 "build",
  "confidence": 0.0-1.0 的置信度,
  "reasoning": "你的判断理由（简洁）",
  "suggestedTitle": "建议的项目标题",
  "keywords": ["关键词1", "关键词2"],
  
  // 如果是 research 模式，填写：
  "researchFocus": {
    "mainQuestion": "核心研究问题",
    "subQuestions": ["子问题1", "子问题2", "子问题3"],
    "knowledgeDomains": ["领域1", "领域2"]
  },
  
  // 如果是 build 模式，填写：
  "buildSpec": {
    "targetProduct": "要构建的产品描述",
    "coreFeatures": ["功能1", "功能2", "功能3"],
    "possibleTechStack": ["技术1", "技术2"],
    "mvpScope": "最小可行产品的范围"
  }
}
\`\`\`

只返回 JSON，不要其他内容。`;

/**
 * 调用 AI 进行深度意图分析
 */
export async function analyzeIntent(userInput: string): Promise<IntentAnalysis> {
  // 1. 先做本地预分析
  const localSignals = analyzeSignalsLocally(userInput);
  const quickResult = quickClassify(userInput);
  
  // 2. 构建 prompt
  const signalsText = `
研究信号: ${localSignals.researchSignals.join(', ') || '无'}
构建信号: ${localSignals.buildSignals.join(', ') || '无'}
模糊信号: ${localSignals.ambiguousSignals.join(', ') || '无'}
本地快速判断: ${quickResult.mode} (置信度: ${quickResult.confidence.toFixed(2)})
  `.trim();
  
  const prompt = INTENT_ANALYSIS_PROMPT
    .replace('{localSignals}', signalsText)
    .replace('{userInput}', userInput);
  
  try {
    // 3. 调用 AI
    const response = await callGemini(
      [{ role: 'user', content: prompt }],
      GEMINI_MODEL
    );
    
    // 4. 解析响应
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                      response.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.warn('AI 响应格式异常，使用本地判断');
      return fallbackAnalysis(userInput, quickResult);
    }
    
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr) as IntentAnalysis;
    
    // 5. 验证和补全
    return validateAndComplete(parsed, userInput, quickResult);
    
  } catch (error) {
    console.error('意图识别 AI 调用失败:', error);
    return fallbackAnalysis(userInput, quickResult);
  }
}

/**
 * 降级方案：基于本地分析生成结果
 */
function fallbackAnalysis(
  userInput: string, 
  quickResult: { mode: ExplorationMode; confidence: number }
): IntentAnalysis {
  const signals = analyzeSignalsLocally(userInput);
  
  const base: IntentAnalysis = {
    mode: quickResult.mode,
    confidence: quickResult.confidence,
    reasoning: `基于关键词检测：研究信号 ${signals.researchSignals.length} 个，构建信号 ${signals.buildSignals.length} 个`,
    suggestedTitle: userInput.slice(0, 30) + (userInput.length > 30 ? '...' : ''),
    keywords: [...signals.researchSignals, ...signals.buildSignals].slice(0, 5),
  };
  
  if (quickResult.mode === 'research') {
    base.researchFocus = {
      mainQuestion: userInput,
      subQuestions: ['需要进一步分解'],
      knowledgeDomains: ['待识别'],
    };
  } else {
    base.buildSpec = {
      targetProduct: userInput,
      coreFeatures: ['需要进一步明确'],
      possibleTechStack: ['待确定'],
      mvpScope: '待定义',
    };
  }
  
  return base;
}

/**
 * 验证 AI 返回结果，补全缺失字段
 */
function validateAndComplete(
  parsed: Partial<IntentAnalysis>,
  userInput: string,
  quickResult: { mode: ExplorationMode; confidence: number }
): IntentAnalysis {
  // 确保必填字段存在
  const mode = parsed.mode === 'build' ? 'build' : 'research';
  
  const result: IntentAnalysis = {
    mode,
    confidence: typeof parsed.confidence === 'number' 
      ? Math.max(0, Math.min(1, parsed.confidence)) 
      : quickResult.confidence,
    reasoning: parsed.reasoning || '基于 AI 分析',
    suggestedTitle: parsed.suggestedTitle || userInput.slice(0, 30),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
  };
  
  // 补全模式特有字段
  if (mode === 'research') {
    result.researchFocus = {
      mainQuestion: parsed.researchFocus?.mainQuestion || userInput,
      subQuestions: parsed.researchFocus?.subQuestions || [],
      knowledgeDomains: parsed.researchFocus?.knowledgeDomains || [],
    };
  } else {
    result.buildSpec = {
      targetProduct: parsed.buildSpec?.targetProduct || userInput,
      coreFeatures: parsed.buildSpec?.coreFeatures || [],
      possibleTechStack: parsed.buildSpec?.possibleTechStack || [],
      mvpScope: parsed.buildSpec?.mvpScope || '待定义',
    };
  }
  
  return result;
}

// ============ 交互式确认 ============

/**
 * 生成用户确认所需的数据
 */
export function generateConfirmationData(analysis: IntentAnalysis) {
  return {
    detected: {
      mode: analysis.mode,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
    },
    suggestion: {
      title: analysis.suggestedTitle,
      keywords: analysis.keywords,
    },
    modeDetails: analysis.mode === 'research' 
      ? {
          type: 'research' as const,
          icon: '🔬',
          label: '研究模式',
          description: '深度探索，理解问题本质，输出研究报告和知识图谱',
          focus: analysis.researchFocus,
        }
      : {
          type: 'build' as const,
          icon: '🔧',
          label: '构建模式',
          description: '迭代开发，造出可用的东西，输出 Demo 和设计文档',
          spec: analysis.buildSpec,
        },
    alternativeMode: analysis.mode === 'research'
      ? {
          type: 'build' as const,
          icon: '🔧',
          label: '构建模式',
          description: '如果你其实想造出具体的东西，选择这个',
        }
      : {
          type: 'research' as const,
          icon: '🔬',
          label: '研究模式',
          description: '如果你其实想深入理解这个领域，选择这个',
        },
  };
}

// ============ 自动确认逻辑 ============

/**
 * 置信度阈值：高于此值时自动确认，不需要用户手动选择
 */
export const AUTO_CONFIRM_THRESHOLD = 0.75;

/**
 * 判断是否需要用户确认
 * - 置信度 >= 0.75：意图明确，自动确认
 * - 置信度 < 0.75：模棱两可，需要用户确认
 */
export function needsUserConfirmation(analysis: IntentAnalysis): boolean {
  return analysis.confidence < AUTO_CONFIRM_THRESHOLD;
}

/**
 * 完整的意图识别流程（包含自动确认判断）
 * 返回：{ analysis, needsConfirmation }
 */
export async function analyzeIntentWithAutoConfirm(userInput: string): Promise<{
  analysis: IntentAnalysis;
  needsConfirmation: boolean;
}> {
  const analysis = await analyzeIntent(userInput);
  const needsConfirmation = needsUserConfirmation(analysis);
  
  return { analysis, needsConfirmation };
}

// ============ 导出汇总 ============

export default {
  analyzeIntent,
  analyzeIntentWithAutoConfirm,
  analyzeSignalsLocally,
  quickClassify,
  generateConfirmationData,
  needsUserConfirmation,
  AUTO_CONFIRM_THRESHOLD,
};
