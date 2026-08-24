import { ExplorationMode } from '../types';
import { callGemini } from './geminiService';
import { parseOutline, OutlineParse, MAX_ITEMS } from './outline';

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
    ? '这是一个**要做出来**的项目，框架应该沿着「做成它需要先想清楚哪几件事」来拆。'
    : '这是一个**要搞明白**的问题，框架应该沿着「回答它需要先回答哪几个子问题」来拆。';

  const prompt = `帮我把下面这个问题拆成一份**目录**——只列要写哪几篇，不要写正文。

问题：${goal}
${modeLine}
${userNote ? `用户补充：${userNote}\n` : ''}${existingTitles.length ? `已经有的篇目（不要重复）：${existingTitles.slice(0, 20).join('、')}\n` : ''}
返回 JSON：
{
  "items": [
    { "title": "不超过 12 字的标题", "question": "这一篇要回答的那一个问题，不超过 25 字", "why": "为什么值得单独成一篇，不超过 25 字" }
  ]
}

要求：
1. **只给 3-5 篇**（最多 ${MAX_ITEMS}）。宁可少，用户看完可以再加。
2. **一个字正文都不要写。** 这一步是给人过目的目录，不是内容。
3. 每一篇的 question 必须是**一个具体的、能被回答的问题**，不是一个话题。
   ✗「市场分析」「技术可行性」——这种谁的项目都能套，用户没法改，等于没说
   ✓「愿意为这个每月付 30 块的是哪一类人」「现有方案慢在哪一步」
4. 按**该先想清楚哪个**排序，第一篇放最该先弄明白的那个。
5. 各篇之间不要重叠——两篇写的是同一件事，用户读第二篇时会觉得被浪费了时间。
6. 不确定的地方宁可拆得粗一点：用户会自己往下拆，但删掉一篇多余的对他是纯负担。`;

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
    return parseOutline(JSON.parse(clean), goal);
  } catch {
    return { problems: ['模型返回的不是合法 JSON，这次没拟出框架'] };
  }
}
