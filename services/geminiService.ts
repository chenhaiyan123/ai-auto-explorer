import { ProblemNode, ChatMessage, AgentResult, Project } from "../types";
import { monitor } from "./monitoringService";

/**
 * 通义千问 API 代理地址（阿里云函数计算 FC）
 * 已更新为用户提供的真实触发地址
 */
const API_PROXY_URL = 'https://aliyun-ai-proxy-mvyxjrfpcu.cn-hangzhou.fcapp.run';

export const callGemini = async (messages: any[], model: string = "qwen-plus", responseMimeType?: string, responseSchema?: any) => {
  // 模型名称映射：确保调用的是通义千问模型
  let targetModel = model;
  if (model.includes('gemini')) {
    targetModel = model.includes('pro') ? 'qwen-max' : 'qwen-plus';
  }

  // 格式化消息为 OpenAI/DashScope 兼容格式
  const formattedMessages = messages.map(m => ({
    role: m.role === 'system' ? 'system' : (m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user'),
    content: m.content || m.text
  }));

  try {
    const response = await fetch(API_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        // 如果需要 JSON 格式输出，透传给云函数
        response_format: responseMimeType === 'application/json' ? { type: "json_object" } : undefined
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`AI 服务异常: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    
    // 追踪 Token 消耗
    if (data.usage) {
      monitor.recordTokenUsage(
        data.usage.prompt_tokens || 0,
        data.usage.completion_tokens || 0
      );
    }

    // 处理通义千问/OpenAI 兼容的返回结构
    const content = data.choices?.[0]?.message?.content || data.content || "";
    return content;
  } catch (error) {
    console.error("AI 接口调用失败:", error);
    throw error;
  }
};

/**
 * 识别节点任务类型
 */
export const identifyNodeTask = async (node: ProblemNode): Promise<'image' | 'code' | 'web' | 'research' | 'none'> => {
  const prompt = `分析以下问题节点，判断它是否包含具体的执行任务。
  节点标题: "${node.title}"
  笔记内容: "${node.notes}"
  
  请分类为：
  - image: 需要生成图片、视觉设计
  - code: 需要编程、开发、算法实现
  - web: 需要建立网站、生成图表、UI展示
  - research: 需要大量资料调研、深度分析
  - none: 纯逻辑拆解，无具体执行工具需求
  
  仅返回分类词（英文）。`;

  const result = await callGemini([{ role: "user", content: prompt }], "qwen-plus");
  const text = result.toLowerCase().trim();
  if (text.includes('image')) return 'image';
  if (text.includes('code')) return 'code';
  if (text.includes('web')) return 'web';
  if (text.includes('research')) return 'research';
  return 'none';
};

/**
 * 拆解探索节点
 */
export const exploreNode = async (node: ProblemNode, contextNodes: ProblemNode[]) => {
  const prompt = `你是一个深度拆解问题的专家。
  请分析并拆解问题： "${node.title}"。背景：${node.notes}。
  请必须以 JSON 格式输出，结构如下：
  {
    "notes": "详细分析内容",
    "confidence": 0.9,
    "triggerDecision": boolean, 
    "decisionContext": "如果 triggerDecision 为 true，请在此处详细说明为什么需要用户决策（例如：方向 A 偏向效率，方向 B 偏向质量，请用户二选一；或者当前信息不足以支持后续拆解，需要人工介入确定方向）",
    "subProblems": [
      { "title": "子问题标题", "initialNotes": "初始背景" }
    ]
  }
  
  重要指示：
  - 当出现多条可选路径、执行风险、或需要用户偏好（如 A 方案或 B 方案）时，务必设 "triggerDecision": true。
  - 在 "decisionContext" 中清晰描述待决策的具体冲突点。`;

  const result = await callGemini(
    [{ role: "user", content: prompt }], 
    "qwen-max", 
    "application/json"
  );

  try {
    return JSON.parse(result || "{}");
  } catch (e) {
    console.error("JSON 解析失败:", result);
    return { 
      notes: result || "分析完成，格式解析异常。", 
      confidence: 0.5, 
      triggerDecision: true, 
      decisionContext: "分析结果格式异常，需要人工检查。",
      subProblems: [] 
    };
  }
};

/**
 * 执行 Agent 任务
 */
export const runAgentTask = async (node: ProblemNode, agentType: string): Promise<string> => {
  const systemInstruction = `你是一名专业的${agentType}。请基于你的专业知识协助用户完成节点任务。`;
  const messages = [
    { role: "system", content: systemInstruction },
    { role: "user", content: `任务：执行节点任务。当前节点：${node.title}。背景：${node.notes}。` }
  ];
  return await callGemini(messages, "qwen-plus");
};

/**
 * 生成项目总结
 */
export const generateProjectSummary = async (project: Project): Promise<string> => {
  const nodesContent = project.nodes.map(n => `节点: ${n.title}\n结论: ${n.notes}`).join('\n---\n');
  const prompt = `请为项目生成全案探索笔记：\n项目元问题: ${project.metaProblem}\n\n节点数据：\n${nodesContent}`;
  return await callGemini([{ role: "user", content: prompt }], "qwen-max");
};

/**
 * 节点咨询对话
 */
export const chatWithNode = async (node: ProblemNode, message: string, history: ChatMessage[]): Promise<string> => {
  const messages = [
    { role: "system", content: `当前背景：${node.title}。笔记：${node.notes}。` },
    ...history.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text })),
    { role: "user", content: message }
  ];
  return await callGemini(messages, "qwen-plus");
};