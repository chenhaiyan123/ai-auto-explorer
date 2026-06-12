import { ProblemNode, ChatMessage, Project } from "../types";
import { monitor } from "./monitoringService";
import { callLLM } from "./llmProvider";
import { buildIoTSystemPrompt, executeIoTCommandsInText, formatIoTResults } from "./iotService";

// 配置
const MAX_RETRIES = 2;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 调用AI API（带重试）
 *
 * 注：函数名 callGemini 为历史遗留，实际后端由「设置 → 模型接入」决定，
 * 可以是云端代理，也可以是本地 Ollama / LM Studio / vLLM 等 OpenAI 兼容 API。
 */
export const callGemini = async (
  messages: any[],
  model?: string,          // 可选覆盖模型名；默认使用设置中的模型
  responseMimeType?: string
): Promise<string> => {
  // 格式化消息并限制长度
  const formattedMessages = messages.map(m => ({
    role: m.role === 'system' ? 'system' : (m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user'),
    content: ((m.content || m.text) || '').slice(0, m.role === 'system' ? 4000 : 1500)
  }));

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[AI] 调用中... (尝试${attempt})`);
      const startTime = Date.now();

      const result = await callLLM(formattedMessages, {
        jsonMode: responseMimeType === 'application/json',
      });

      console.log(`[AI] 成功 (${Date.now() - startTime}ms)`);

      if (result.usage) {
        monitor.recordTokenUsage(result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
      }

      return result.content;

    } catch (error: any) {
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
  const iotPrompt = buildIoTSystemPrompt(); // 已注册 IoT 设备时，告知 AI 可调用
  let reply = await callGemini([
    { role: "system", content: `背景:${node.title}${iotPrompt}` },
    ...recent.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text.slice(0,300) })),
    { role: "user", content: message.slice(0,500) }
  ]);

  // 执行 AI 输出中的 IoT 指令块，并把结果附加到回复
  try {
    const results = await executeIoTCommandsInText(reply);
    if (results.length > 0) reply += `\n\n${formatIoTResults(results)}`;
  } catch (e) {
    console.warn('[IoT] 指令执行异常', e);
  }
  return reply;
};
