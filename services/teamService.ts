import { callGemini } from './geminiService';

/**
 * AI 组建团队：把一个项目目标交给「总协调 Agent」，
 * 由它读懂目标后拆解成 5–10 个关键方向（像公司不同部门分工），
 * 并为每个方向指派最合适的专门 Agent + 一句话职责，形成分层团队。
 */

export interface TeamMember {
  title: string;  // 关键节点名称
  agent: string;  // 负责的 Agent 角色
  duty: string;   // 一句话职责
  area: string;   // 所属工作板块/文件夹（按成员分工，如 市场调研 / 工程制作）
}

export interface TeamPlan {
  lead: { role: string; duty: string }; // 项目负责人 / 总协调
  directions: TeamMember[];
}

const stripFence = (s: string): string =>
  s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

const extractJson = (raw: string): any => {
  const text = stripFence(raw);
  try { return JSON.parse(text); } catch {}
  // 容错：截取第一个 { 到最后一个 }
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  throw new Error('无法解析 AI 返回的团队方案');
};

/**
 * 让 AI 读懂项目目标，给出团队方案（拆解方向 + 指派 Agent）。
 * @param goal    项目目标 / 名称
 * @param context 补充背景（README / 项目总览正文等）
 */
export const buildTeamPlan = async (goal: string, context = ''): Promise<TeamPlan> => {
  const system = `你是一个 AI 研究/开发项目的总协调官（项目负责人）。
根据用户给出的项目目标，设计一支 AI 团队来长期推进它：
1. 把项目拆解成 5–8 个「关键节点」，像公司里不同部门各负责一块，彼此尽量不重叠、合起来能覆盖目标。标题要简练（不超过 12 字），不要分太多层级。
2. 把这些节点归到 2–4 个「工作板块」(area)里，按成员/工种分工，例如「市场调研」「工程制作」「数据分析」——每个板块就是一个文件夹，名称高度概括、不超过 8 个字，由一个成员(Agent)主要负责。
3. 为每个节点指派一个最合适的专门 Agent 角色（例如：全栈工程师、数据分析师、研究分析员、实验工程师、增长运营官、UI/UX 设计师、商业分析师、法务顾问 等，可自拟更贴切的角色），同一板块内的节点尽量用同一个 Agent。
4. 每个节点给一句话职责说明。
5. 另外给出「项目负责人/总协调」这个统筹角色的职责。
项目不一定是代码开发，可能是研究、产品或其它类型，请据目标判断。
只输出 JSON，不要任何多余文字。格式：
{"lead":{"role":"项目负责人","duty":"……"},"directions":[{"title":"节点名(简洁,不超过12字)","area":"所属工作板块","agent":"负责Agent角色","duty":"一句话职责"}]}`;

  const user = `项目目标：${goal}\n\n补充背景：\n${(context || '（无）').slice(0, 1200)}`;

  const raw = await callGemini(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    undefined,
    'application/json'
  );

  const data = extractJson(raw);
  const directions: TeamMember[] = Array.isArray(data.directions) ? data.directions
    .filter((d: any) => d && (d.title || d.name))
    .map((d: any) => ({ title: String(d.title || d.name).trim().replace(/[？?。.！!]+$/u, '').slice(0, 10), agent: String(d.agent || d.role || '通用研究员').trim().slice(0, 12), duty: String(d.duty || d.responsibility || '').trim().slice(0, 120), area: String(d.area || d.group || '').trim().slice(0, 8) }))
    .slice(0, 8) : [];
  if (directions.length === 0) throw new Error('AI 没有给出有效的方向');
  const lead = { role: String(data.lead?.role || '项目负责人').slice(0, 20), duty: String(data.lead?.duty || '统筹各方向、对齐目标、整合成果').slice(0, 120) };
  return { lead, directions };
};
