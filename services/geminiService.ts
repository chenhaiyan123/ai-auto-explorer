import { ProblemNode, ChatMessage, Project } from "../types";
import { monitor } from "./monitoringService";

/**
 * 通义千问 API 代理地址
 */
const API_PROXY_URL = 'https://aliyun-ai-proxy-mvyxjrfpcu.cn-hangzhou.fcapp.run';

// 配置
const API_TIMEOUT = 120000; // 120秒超时
const MAX_RETRIES = 2;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 调用AI API（带超时和重试）
 */
export const callGemini = async (
  messages: any[], 
  model: string = "qwen-turbo",  // 默认使用最快的模型
  responseMimeType?: string
): Promise<string> => {
  // 统一使用 qwen-turbo（最快）
  const targetModel = 'qwen-turbo';

  // 格式化消息并限制长度
  const formattedMessages = messages.map(m => ({
    role: m.role === 'system' ? 'system' : (m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user'),
    content: ((m.content || m.text) || '').slice(0, 1500)
  }));

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
      console.log(`[AI] 调用中... (尝试${attempt})`);
      const startTime = Date.now();

      const response = await fetch(API_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: formattedMessages,
          max_tokens: 1000,
          temperature: 0.7,
          response_format: responseMimeType === 'application/json' ? { type: "json_object" } : undefined
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`HTTP ${response.status}: ${err.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || data.content || "";
      
      console.log(`[AI] 成功 (${Date.now() - startTime}ms)`);
      
      if (data.usage) {
        monitor.recordTokenUsage(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
      }

      return content;

    } catch (error: any) {
      clearTimeout(timeoutId);
      lastError = error;
      
      if (error.name === 'AbortError') {
        console.error(`[AI] 超时 (尝试${attempt})`);
      } else {
        console.error(`[AI] 错误 (尝试${attempt}):`, error.message);
      }

      if (attempt < MAX_RETRIES) {
        await delay(3000);
      }
    }
  }

  throw lastError || new Error('AI调用失败');
};

/**
 * 任务类型识别（本地关键词，不调API）
 */
export const identifyNodeTask = async (node: ProblemNode): Promise<'image' | 'code' | 'web' | 'research' | 'none'> => {
  const text = `${node.title} ${node.notes || ''}`.toLowerCase();
  if (/图片|图像|设计|视觉|ui|logo|icon|插画|海报|banner/.test(text)) return 'image';
  if (/代码|编程|开发|算法|函数|api|程序|脚本|python|java/.test(text)) return 'code';
  if (/网站|网页|前端|界面|图表|dashboard|h5|app/.test(text)) return 'web';
  return 'research';
};

/**
 * 探索节点（简化prompt）
 */
export const exploreNode = async (node: ProblemNode, contextNodes: ProblemNode[]) => {
  const deps = node.dependencies || [];
  const context = contextNodes
    .filter(n => deps.includes(n.id) && n.notes)
    .slice(0, 2)
    .map(n => `${n.title}:${(n.notes||'').slice(0,50)}`)
    .join(';');

  const prompt = `分析问题："${node.title}"
${node.notes ? `背景：${node.notes.slice(0,150)}` : ''}
${context ? `相关：${context}` : ''}

请返回JSON格式：
{
  "notes": "分析内容（100-150字）",
  "confidence": 0.8,
  "subProblems": [
    {"title": "具体的子问题标题1"},
    {"title": "具体的子问题标题2"}
  ],
  "taskType": "research"
}

要求：
1. notes要有实质内容
2. subProblems的title必须是具体的问题，不能为空
3. subProblems最多2个`;

  try {
    const result = await callGemini([{ role: "user", content: prompt }], "qwen-turbo", "application/json");
    const clean = result.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(clean);
    
    // 过滤掉没有有效title的子问题
    const validSubProblems = (parsed.subProblems || [])
      .filter((sp: any) => sp && sp.title && sp.title.trim())
      .slice(0, 2)
      .map((sp: any) => ({
        title: sp.title.trim(),
        initialNotes: sp.initialNotes || ''
      }));
    
    return {
      notes: parsed.notes || '分析完成',
      confidence: parsed.confidence || 0.7,
      triggerDecision: false,
      decisionContext: '',
      subProblems: validSubProblems,
      taskType: parsed.taskType || 'research'
    };
  } catch (e: any) {
    console.error("解析失败:", e.message);
    return { notes: `待分析: ${node.title}`, confidence: 0.3, triggerDecision: false, decisionContext: "", subProblems: [], taskType: 'research' };
  }
};

export const runAgentTask = async (node: ProblemNode, agentType: string): Promise<string> => {
  return await callGemini([{ role: "user", content: `作为${agentType}，简要分析:${node.title}` }]);
};

export const generateProjectSummary = async (project: Project): Promise<string> => {
  const nodes = project.nodes.filter((n: ProblemNode) => n.notes).slice(0,5).map((n: ProblemNode) => `${n.title}:${(n.notes||'').slice(0,40)}`).join('\n');
  return await callGemini([{ role: "user", content: `总结(80字):\n目标:${project.metaProblem}\n${nodes}` }]);
};

export const chatWithNode = async (node: ProblemNode, message: string, history: ChatMessage[]): Promise<string> => {
  const recent = history.slice(-3);
  return await callGemini([
    { role: "system", content: `背景:${node.title}` },
    ...recent.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text.slice(0,300) })),
    { role: "user", content: message.slice(0,500) }
  ]);
};
