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
    content: ((m.content || m.text) || '').slice(0, m.role === 'system' ? 8000 : 6000)
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

  const prompt = `你是一位资深研究员，正在深入探索下面这个关键节点。请给出有深度、可落地的分析。

节点问题："${node.title}"
${node.notes ? `已有背景：${node.notes.slice(0,400)}` : ''}
${context ? `相关节点：${context}` : ''}

请返回 JSON：
{
  "notes": "结构化的探索笔记（Markdown，400-800字）。请包含这几部分：\\n## 探索现状（目前了解到什么、关键事实）\\n## 关键发现 / 洞见（2-4 条，尽量具体）\\n## 方法与思路（怎么继续推进、可用的方法或实验）\\n## 后续探索方向（列出要继续追的点）",
  "confidence": 0.8,
  "subProblems": [
    {"title": "子问题1"},
    {"title": "子问题2"}
  ],
  "taskType": "research"
}

要求：
1. notes 要言之有物、具体（避免空泛套话），用 Markdown 小标题分段，400-800 字。
2. subProblems 是这个节点下最值得继续深入的 0-3 个子问题（宁缺毋滥，没有就给空数组）；标题必须极简，是名词短语、不超过 10 个字，不要写成一整句问句。
3. taskType 从 research/code/web/image 中选最贴切的一个。`;

  try {
    const result = await callGemini([{ role: "user", content: prompt }], undefined, "application/json");
    // 稳健解析：去 ```fence```，并截取第一个 { 到最后一个 }（兼容会在 JSON 外带说明文字的模型，如 Claude 兼容层）
    let clean = result.replace(/```json\n?|\n?```/g, '').trim();
    const a = clean.indexOf('{'); const b = clean.lastIndexOf('}');
    if (a > 0 || b < clean.length - 1) { if (a >= 0 && b > a) clean = clean.slice(a, b + 1); }
    const parsed = JSON.parse(clean);
    
    // 过滤掉没有有效title的子问题
    const validSubProblems = (parsed.subProblems || [])
      .filter((sp: any) => sp && sp.title && sp.title.trim())
      .slice(0, 3)
      .map((sp: any) => ({
        title: sp.title.trim().replace(/^(如何|怎么|怎样|为什么|什么是|关于)/u, '').replace(/[？?。.！!，,]+$/u, '').slice(0, 12),
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
  const bg = (node.fullNote || node.notes || '').slice(0, 600);
  return await callGemini([
    { role: 'system', content: `你是「${agentType}」，请以该角色的专业视角，给出详尽、结构化、可执行的成果，而不是泛泛而谈。用 Markdown 分点呈现，不少于 400 字；如涉及代码/方案，请给出具体内容。` },
    { role: 'user', content: `任务节点：${node.title}\n${bg ? `背景：\n${bg}` : ''}\n\n请产出你负责的部分的具体成果。` }
  ]);
};

export const generateProjectSummary = async (project: Project): Promise<string> => {
  const nodes = project.nodes.filter((n: ProblemNode) => n.notes).slice(0,5).map((n: ProblemNode) => `${n.title}:${(n.notes||'').slice(0,40)}`).join('\n');
  return await callGemini([{ role: "user", content: `总结(80字):\n目标:${project.metaProblem}\n${nodes}` }]);
};

/**
 * 合成「项目总览」正文（结构化 Markdown）。
 * 用户第一时间看的是总览，所以探索一开始就先把它写全、并随进度持续刷新。
 * 只依据当前已探索到的内容如实汇总，未知的写「待探索」，不编造。
 *
 * @param goal       项目目标/元问题
 * @param name       项目名
 * @param directions 关键方向节点（标题 + 状态 + 已有笔记摘要）
 * @param findings   已产出的研究发现（insight 文本）
 * @param cards      已产出的知识卡片标题
 */
export const synthesizeOverview = async (
  name: string,
  goal: string,
  directions: { title: string; status: string; note?: string }[],
  findings: string[] = [],
  cards: string[] = []
): Promise<string> => {
  const dirLines = directions.length
    ? directions.map(d => `- ${d.title}（状态:${d.status}）${d.note ? '：' + d.note.slice(0, 80) : ''}`).join('\n')
    : '（暂无，AI 正在拆解方向）';
  const findLines = findings.length ? findings.slice(0, 12).map(f => `- ${f.slice(0, 120)}`).join('\n') : '（尚无）';
  const cardLines = cards.length ? cards.slice(0, 12).join('、') : '（尚无）';

  const sys = `你是项目的「总览编辑」。任务：把已探索到的内容，汇总成一篇极简的「项目总览」正文。
重要：方向列表、进度、负责 Agent、笔记链接都由界面上方的仪表盘自动展示，**你不要重复这些**。
你只写机器算不出来的判断：这是什么、算什么成功、卡在哪、下一步、关键结论。
要求：
1. 严格按给定的 Markdown 标题结构输出，不要新增或删除章节标题。
2. 只依据我提供的材料如实总结；不知道的写「待探索」，绝不编造事实或数据。
3. **字数要少**：整篇不超过 350 字，每个要点一行且不超过 40 字，禁止空话套话。
4. 需要指向某个方向时，用 [[方向标题]] 双链格式，标题必须与我给的完全一致。
5. 直接输出正文，不要解释、不要用代码块包裹。`;

  const user = `项目名：${name}
核心目标 / 元问题：${goal}

已拆解的关键方向：
${dirLines}

已产出的研究发现：
${findLines}

已产出的知识卡片：${cardLines}

请按以下结构输出总览正文（保留这些标题）：

# ${name} · 总览

> 一句话说清这个项目在做什么。

## 📌 这是什么
（背景 + 要解决的问题，三句以内）

## 🎯 成功标准
- 算成功：
- 不做：

## 🧩 当前卡点
（卡在哪 → 影响什么 → 目前的思路；没有就写「暂无」。可用 [[方向标题]] 指向具体方向）

## 🗺️ 下一步
- 近期：
- 中期：

## 💡 关键结论
（已经能下定论的判断，每条一行；还没有就写「待探索」）

---
*本总览由 AI 随探索进度自动维护，可手动编辑（编辑后不再自动覆盖）*`;

  return await callGemini([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]);
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
