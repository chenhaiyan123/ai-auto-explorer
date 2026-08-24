import { ProblemNode } from '../types';
import { callGemini } from './geminiService';
import { parseSimSpec, ParseResult, SimSpec, FUNC_LIST } from './simSpec';

/**
 * 让 AI 为一个节点设计一个可拖动的仿真实验。
 *
 * 提示词里最关键的不是"生成一个仿真"，而是三条约束：
 *
 * 1. **只能写公式，不能写代码。** 输出的是递推式字符串，由 `services/expr.ts` 解释执行。
 *    这不是风格偏好——用户的模型 API Key 存在 localStorage 里，一段能跑的 JS 就是一条泄漏路径。
 *
 * 2. **必须自曝其短。** `reality_check` 和 `probe_hint` 是必填的，解析器会拒收没写的。
 *    一个不肯说自己哪里靠不住的仿真，比没有仿真更糟——它长得像证据。
 *
 * 3. **不许编经验系数。** 只做算术能算清的结构（复利、衰减、存量流量、几何级数）。
 *    需要拟合真实数据才能定的系数，一律做成"你猜的参数"（soft），让用户自己去量。
 */

/** 一次生成的结果。失败时 problems 里是给用户看的原因，不吞错。 */
export interface SimDesign extends ParseResult {
  spec?: SimSpec;
  problems: string[];
}

const RULES = `
【只能写公式，不能写代码】
所有算式都是**字符串表达式**，由一个很小的求值器解释，语法只有：
  数字、参数名、状态变量名、t（第几步，从 1 开始）
  + - * / % ^  括号  比较(< <= > >= == !=)  && || !  三元 a ? b : c
  函数：${FUNC_LIST}
  常量：PI、E
不支持也不要写：赋值、a.b、a[i]、字符串、function、random。
写了不支持的东西，整个仿真会被丢弃。

【结构】
- params：3-5 个可拖的参数。每个都要有明确的现实含义和单位。
  真实世界里**只能靠猜**的参数必须标 "soft": true，并在 "why" 里写清为什么只能猜。
  至少要有一个 soft 参数——如果一个都没有，说明你在假装这个模型是确定的。
- init：状态变量的初值，只能用参数。
- step：每一步怎么变。可以用参数、t、以及**上一步**的各状态变量。
- series：画哪 1-2 条曲线（必须是状态变量名）。
- readouts：2-4 个关键读数。可用的量：参数、以及每个状态变量的
  last_x（末值，直接写 x 也是末值）、max_x、min_x、sum_x（累计）、cross_x（第一次由负转正的步数，从未转正是 -1）。
- headline：一句话结论，用 {读数key} 插值。

【不许编系数】
只做算术能算清的结构：复利、衰减、存量流量、几何级数、线性叠加。
不要写需要拟合真实数据才能定的经验系数（如"效率因子 0.73"）。
真要用这种量，就把它做成一个 soft 参数，让人自己去量。
`;

const SCHEMA = `{
  "title": "不超过 12 字，如「留存衰减」",
  "question": "这个仿真在回答的那一个问题，不超过 25 字",
  "steps": 24,
  "x_label": "月",
  "y_label": "累计毛利（元）",
  "params": [
    {"key": "cac", "label": "获客成本", "min": 5, "max": 1000, "step": 5, "value": 120, "unit": "元", "soft": false},
    {"key": "churn", "label": "月流失率", "min": 1, "max": 40, "step": 1, "value": 12, "unit": "%", "soft": true, "why": "没有三个月以上的付费名单，这个数只能拍"}
  ],
  "init": {"cum": "-cac"},
  "step": {"cum": "cum + arpu * (1 - churn/100)^(t-1)"},
  "series": [{"key": "cum", "label": "单个用户累计贡献"}],
  "readouts": [
    {"key": "payback", "label": "回本时间", "expr": "cross_cum", "unit": "个月", "digits": 0, "bad_if": "cross_cum < 0"}
  ],
  "headline": "第 {payback} 回本",
  "bad_if": "cross_cum < 0",
  "reality_check": "这个模型哪一步在猜、猜错会怎样。要具体，不要写「仅供参考」。",
  "probe_hint": "花一天之内怎么把那个数量出来。要具体到能照着做。"
}`;

/**
 * 为某个节点设计仿真。
 *
 * 注意这里不产生任何 Evidence，也不改节点状态——仿真跑出什么都不算现实证据。
 */
export async function designSimulation(node: ProblemNode, goal?: string): Promise<SimDesign> {
  const h = node.hypothesis;
  const statement = h?.statement || node.title;

  const prompt = `你在为一个正在探索的问题设计一个**可交互的仿真实验**，像 PhET 那种拖滑块看曲线的东西。

${goal ? `项目目标：${goal}\n` : ''}节点：${node.title}
当前假设：${statement}
${h?.unknown ? `最大未知量：${h.unknown}\n` : ''}${node.validationReason ? `为什么需要验证：${node.validationReason}\n` : ''}
这个仿真的用途**不是**给出答案，而是回答一个更小的问题：
**「这个判断对哪个数字最敏感？」** 用户拖动滑块，应该能亲眼看到某个他其实不知道的数
一变，结论就翻盘——然后他就知道该去量什么了。
${RULES}
只返回 JSON，格式如下（这是个示例，请按上面的节点重新设计）：
${SCHEMA}`;

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

  let json: any;
  try {
    json = JSON.parse(clean);
  } catch {
    return { problems: ['模型返回的不是合法 JSON，这次没生成出来'] };
  }

  const res = parseSimSpec(json, Date.now());
  if (res.spec && !res.spec.hypothesis) res.spec.hypothesis = statement;
  return res;
}
