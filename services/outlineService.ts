import { ExplorationMode } from '../types';
import { callGemini } from './geminiService';
import { parseOutline, OutlineParse, MAX_ITEMS } from './outline';
import { BRIEF_PROMPT, parseBrief } from './projectBrief';

/**
 * 让 AI 拟一份**框架**：只出标题和「这篇要回答什么」，不写正文。
 *
 * 提示词里最要紧的一条是「不要写正文」。模型的默认行为是能多写就多写，
 * 而这一步的全部价值在于**便宜到用户愿意读完并动手改**。
 * 一旦它把框架也写成七八段，这一步就白设了——用户还是来不及看。
 *
 * 第二要紧的是「拆出来的每一篇必须能独立成篇」。
 * 模型很容易给出「背景介绍 / 现状分析 / 未来展望」这种谁都能套的目录，
 * 那种框架用户没法改，因为它根本没说什么。
 */

/** 一次拟框架的结果。失败时 problems 里是给用户看的原因。 */
export type OutlineDesign = OutlineParse;

export async function proposeOutline(
  goal: string,
  mode: ExplorationMode = 'research',
  opts: { existingTitles?: string[]; userNote?: string } = {},
): Promise<OutlineDesign> {
  const { existingTitles = [], userNote } = opts;

  const modeLine = mode === 'build'
    ? '这是一个**要做出来**的项目：沿着「要把它做成，得先做成哪几件事」来拆。'
    : '这是一个**要搞明白、再据此行动**的问题：沿着「要拿到答案并用起来，得先做成哪几件事」来拆。';

  const prompt = `帮我把下面这件事拆成几个**要做的步骤**——这是行动计划，不是文章目录，现在只列步骤，不要展开做。

要做成的事：${goal}
${modeLine}
${userNote ? `用户补充：${userNote}\n` : ''}${existingTitles.length ? `已经有的步骤（不要重复）：${existingTitles.slice(0, 20).join('、')}\n` : ''}
返回 JSON：
{
  "items": [
    { "title": "这一步要做的事，动词开头，不超过 12 字", "question": "做成什么算完成——一个能检验的结果，不超过 25 字", "why": "为什么先做这一步，不超过 25 字" }
  ],
  "brief": { "approach": "", "hard": [], "support": [], "resources": [], "permissions": [], "budget": "", "shortTerm": "", "longTerm": "", "stages": [{ "title": "", "goal": "", "weeks": 2 }], "startCNY": 20, "runEstimate": "", "checkInDays": 7, "asks": [{ "topic": "support", "question": "" }] }
}

要求：
1. **只给 3-5 步**（最多 ${MAX_ITEMS}）。宁可少，做完一步看了结果再加。
2. 每一步都是**动作**，不是话题：
   ✗「市场分析」「技术可行性」「用户研究」——这是写报告的目录，谁的项目都能套
   ✓「找出流失最多的那类家长」「做一版 1 页的续费方案给 3 位家长看」「算出每单的获客成本」
3. question 写**做成什么算完成**，要能检验：✓「拿到 5 位家长的真实回答」✓「得出一个能拿去试的价格」✗「深入了解用户」
4. 按**先做哪个最能推进、最快看到结果**排序；能尽早碰到现实（拿到数据、见到真人、跑一次小测试）的往前放。
5. 各步之间不要重叠。
6. 不确定的地方宁可拆得粗一点：做完一步再细拆。

${BRIEF_PROMPT}`;

  let raw = '';
  try {
    raw = await callGemini([{ role: 'user', content: prompt }], undefined, 'application/json');
  } catch (e: any) {
    return { problems: [`模型调用失败：${e?.message || e}`] };
  }

  let clean = raw.replace(/```json\n?|\n?```/g, '').trim();
  const a = clean.indexOf('{');
  const b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) clean = clean.slice(a, b + 1);

  try {
    const json = JSON.parse(clean);
    const parsed = parseOutline(json, goal);
    const brief = parseBrief(json?.brief);
    return parsed.outline && brief ? { ...parsed, outline: { ...parsed.outline, brief } } : parsed;
  } catch {
    return { problems: ['模型返回的不是合法 JSON，这次没拟出框架'] };
  }
}
