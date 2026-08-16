import { v4 as uuidv4 } from 'uuid';
import {
  ProblemNode, NodeStatus, ExplorationRoute, RouteAnchor, RouteRevision,
  Probe, Evidence, Hypothesis, ANCHOR_METHOD_LABEL,
} from '../types';
import { callGemini } from './geminiService';
import { loadDevices, actionMode } from './iotService';

/**
 * 探索路线（Route）与锚点路标（Anchor）。
 *
 * 要解决的问题：AI 一路推下去没有停顿，越推越自洽。给它一条**事先画好的路**，
 * 路上放几个必须拿到真实数据才能跨过去的点——到点就停，等现实说话，再决定后面怎么走。
 *
 * 三条贯穿整个文件的规矩：
 * 1. **只有当前锚点是确定的**，后面的一律 tentative。AI 一次性把 7 个锚点全定死，
 *    后面那几个本身就是一大段没根据的推理——正是这套东西要治的病，不能在治它的功能里再犯一次。
 * 2. **已结算的锚点冻结**。改线只能动当前锚点之后的，历史不可改写，否则事后看不出"为什么会走到这"。
 * 3. **判定标准事前写死**（passIf / failIf），到点之后不许改。
 *
 * 纯函数放前面（可单测），调模型的放后面。
 */

// ============ 纯逻辑 ============

/** 已经结算完、不能再改的状态 */
export const isSettled = (a: RouteAnchor) =>
  a.status === 'passed' || a.status === 'failed' || a.status === 'skipped';

/** 当前锚点 = 第一个还没结算的。全部结算完则返回 undefined（路线走完了） */
export function currentAnchor(route?: ExplorationRoute): RouteAnchor | undefined {
  if (!route) return undefined;
  return [...route.anchors].sort((a, b) => a.order - b.order).find(a => !isSettled(a));
}

/** 某个锚点这一段上挂着的节点 */
export const nodesOfAnchor = (nodes: ProblemNode[], anchorId: string) =>
  (nodes || []).filter(n => n.anchorId === anchorId && (n.noteType === 'direction' || !n.noteType));

/**
 * 这一段探完了没有。
 * "探完" = 没有待探索 / 探索中的节点了——节点自己进 VALIDATING 或被推翻都算这一段推理到头。
 */
export function legReady(nodes: ProblemNode[], anchor?: RouteAnchor): boolean {
  if (!anchor) return false;
  const own = nodesOfAnchor(nodes, anchor.id);
  if (!own.length) return false;  // 一个节点都没有：还没规划这一段，不算到点
  return !own.some(n => n.status === NodeStatus.UNEXPLORED || n.status === NodeStatus.EXPLORING);
}

/**
 * 探索循环现在可以跑哪个节点。
 * 有路线时**只跑当前段**——这就是"到锚点自动暂停"的实现：
 * 后面几段的节点还没被创建，当前段又探完了，循环自然就没得跑了。
 */
export function explorableNodes(nodes: ProblemNode[], route?: ExplorationRoute): ProblemNode[] {
  const pending = (nodes || []).filter(n => n.status === NodeStatus.UNEXPLORED);
  if (!route) return pending;
  const cur = currentAnchor(route);
  if (!cur) return [];                       // 路线走完了，不再自己往下跑
  if (cur.status === 'waiting' && !cur.soft) return [];  // 硬锚点等结果时，整段停住
  return pending.filter(n => n.anchorId === cur.id);
}

/** 路线进度：结算过的 / 总数 */
export function routeProgress(route?: ExplorationRoute): { done: number; total: number; percent: number } {
  const total = route?.anchors.length || 0;
  const done = (route?.anchors || []).filter(isSettled).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** 把一个锚点标成"到了，等现实" */
export function reachAnchor(route: ExplorationRoute, anchorId: string, now = Date.now()): ExplorationRoute {
  return {
    ...route,
    anchors: route.anchors.map(a =>
      a.id === anchorId && a.status === 'pending' ? { ...a, status: 'waiting', reachedAt: now } : a),
  };
}

/**
 * 结算一个锚点：把现实给的结果记上，决定通过还是没通过。
 *
 * 只结算未结算的锚点——已经 passed/failed 的冻结，重复调用是空操作（防重放）。
 */
export function settleAnchor(
  route: ExplorationRoute,
  anchorId: string,
  result: { verdict: 'pass' | 'fail' | 'unclear'; summary: string; origin: 'human' | 'probe' },
  now = Date.now(),
): ExplorationRoute {
  const target = route.anchors.find(a => a.id === anchorId);
  if (!target || isSettled(target)) return route;

  // unclear 不算结果：留在 waiting，继续等更好的数据。硬凑一个"通过"比没结果更糟。
  if (result.verdict === 'unclear') {
    return {
      ...route,
      anchors: route.anchors.map(a => a.id === anchorId
        ? { ...a, status: 'waiting', reachedAt: a.reachedAt || now, result: { ...result, at: now } }
        : a),
    };
  }

  return {
    ...route,
    anchors: route.anchors.map(a => a.id === anchorId
      ? {
        ...a,
        status: result.verdict === 'pass' ? 'passed' : 'failed',
        result: { ...result, at: now },
        settledAt: now,
      }
      : a),
  };
}

/** 跳过一个锚点（用户判断这里不必等数据了）。留痕，不假装它通过了。 */
export function skipAnchor(route: ExplorationRoute, anchorId: string, now = Date.now()): ExplorationRoute {
  return {
    ...route,
    anchors: route.anchors.map(a =>
      a.id === anchorId && !isSettled(a) ? { ...a, status: 'skipped', settledAt: now } : a),
  };
}

/**
 * 把改线结果并回路线：**已结算的锚点原样保留**，只替换后面的。
 * 新锚点全部标 tentative（只有当前那个会在推进时被确定下来）。
 */
export function mergeRevision(
  route: ExplorationRoute,
  fromAnchorId: string,
  newAnchors: Omit<RouteAnchor, 'id' | 'order' | 'status'>[],
  revision: Omit<RouteRevision, 'at' | 'before' | 'after'>,
  now = Date.now(),
): ExplorationRoute {
  const sorted = [...route.anchors].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex(a => a.id === fromAnchorId);
  // 保留：触发改线的那个锚点及它之前的全部（不管结算与否，历史不动）
  const kept = idx >= 0 ? sorted.slice(0, idx + 1) : sorted.filter(isSettled);
  const before = sorted.slice(kept.length).map(a => a.title);

  const added: RouteAnchor[] = newAnchors.slice(0, 6).map((a, i) => ({
    ...a,
    id: uuidv4(),
    order: kept.length + i + 1,
    status: 'pending' as const,
    tentative: i > 0,           // 紧接着的那个是确定的，再往后都是暂定
  }));

  return {
    ...route,
    version: route.version + 1,
    anchors: [...kept, ...added],
    revisions: [
      ...route.revisions,
      { ...revision, at: now, before, after: added.map(a => a.title) },
    ],
  };
}

/** 锚点结果 → 一条证据，挂到这一段相关节点的假设上（跟探针结果同一套统计） */
export function anchorEvidence(anchor: RouteAnchor, now = Date.now()): Evidence | null {
  if (!anchor.result || anchor.result.verdict === 'unclear') return null;
  return {
    id: uuidv4(),
    stance: anchor.result.verdict === 'pass' ? 'support' : 'refute',
    // 锚点数据来自真实用户 / 真实设备，至少是行为层；设备实测按环境层算
    layer: anchor.method === 'device' || anchor.method === 'experiment' ? 'environment' : 'behavior',
    claim: anchor.result.summary.slice(0, 200),
    source: `路标：${anchor.title}`,
    origin: anchor.result.origin,
    createdAt: now,
  };
}

/** 一句话说清这个锚点在等什么，通知和界面共用 */
export function anchorBrief(a: RouteAnchor): string {
  return `${a.needs}（${ANCHOR_METHOD_LABEL[a.method]}：${a.methodDetail}）`;
}

/** 路线是不是卡在某个硬锚点上等人 */
export function isWaitingAtAnchor(route?: ExplorationRoute): RouteAnchor | undefined {
  const cur = currentAnchor(route);
  return cur && cur.status === 'waiting' && !cur.soft ? cur : undefined;
}

// ============ 调模型的部分 ============

const parseJson = (raw: string): any => {
  let clean = raw.replace(/```json\n?|\n?```/g, '').trim();
  const a = clean.indexOf('{'); const b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) clean = clean.slice(a, b + 1);
  return JSON.parse(clean);
};

const METHODS: RouteAnchor['method'][] = ['user', 'device', 'experiment', 'data', 'mixed'];

/** 把模型给的一条锚点收成合法结构。缺判定标准的会被明确标出来，不放过去。 */
export function normalizeAnchor(raw: any, order: number): Omit<RouteAnchor, 'id'> | null {
  const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 24) : '';
  if (!title) return null;
  const str = (v: any, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    order,
    title,
    question: str(raw.question) || `「${title}」这一步要向现实问什么？`,
    needs: str(raw.needs) || '（未写明需要什么数据——补上再往下走）',
    method: METHODS.includes(raw.method) ? raw.method : 'user',
    methodDetail: str(raw.method_detail || raw.methodDetail) || '（未写明怎么验）',
    passIf: str(raw.pass_if || raw.passIf) || '（未写明通过标准——不补上，拿到数据只会顺着想要的方向解释）',
    failIf: str(raw.fail_if || raw.failIf) || '（未写明不通过标准）',
    status: 'pending',
    tentative: order > 1,
    soft: raw.soft === true,
  };
}

/** 规划一条新路线：3-5 个锚点，第一个确定，后面暂定 */
export async function planRoute(goal: string, projectName: string, context?: string): Promise<ExplorationRoute | null> {
  const devices = loadDevices().filter(d => d.enabled && d.actions.some(a => actionMode(a) === 'read'));
  const deviceHint = devices.length
    ? `\n可用的实测设备（能自动采数据的锚点优先用它们）：${devices.map(d => `${d.name}（${d.description || '无说明'}）`).join('；')}`
    : '';

  const prompt = `为下面这个长期问题规划一条**探索路线**。

项目：${projectName}
目标 / 元问题：${goal}
${context ? `已知背景：${context.slice(0, 800)}` : ''}${deviceHint}

路线由若干「锚点路标」串成。每个锚点是一个**必须拿到真实数据才能跨过去的点**——
到了那里就停下来，等真实用户反馈或真实实验数据，再决定后面怎么走。

请返回 JSON：
{
  "anchors": [
    {
      "title": "路标名，不超过 12 字",
      "question": "这一步要向现实问的那个问题",
      "needs": "需要什么真实信息或数据，要具体（谁的、多少个、哪个指标）",
      "method": "user|device|experiment|data|mixed",
      "method_detail": "具体怎么拿到：找谁、用哪台设备、看哪个数",
      "pass_if": "什么结果算通过——给可判定的界线，不要含糊",
      "fail_if": "什么结果算不通过（意味着路线要改）",
      "soft": false
    }
  ]
}

要求：
1. **3-5 个锚点**，按时间先后排。少而关键，不要把每个小步骤都设成锚点——锚点多了就变成频繁打扰。
2. 每个锚点必须是"靠推理得不出来、只能问现实"的东西。凡是查资料想一想就能知道的，**不配当锚点**。
3. needs 要具体到可执行："20 个 18-25 岁用户的实际选择"，不要写"用户需求调研"。
4. pass_if / fail_if 必须给可判定的界线（数量、比例、阈值），这是事前写死的判定标准。
5. 第一个锚点应该是**最快能拿到、且最能推翻整个方向**的那个。如果第一个锚点就没过，后面全白做——这样最省时间。
6. 只用给路线，不要写分析。`;

  try {
    const raw = await callGemini([{ role: 'user', content: prompt }], undefined, 'application/json');
    const parsed = parseJson(raw);
    const list = Array.isArray(parsed?.anchors) ? parsed.anchors : [];
    const anchors = list
      .slice(0, 6)
      .map((a: any, i: number) => normalizeAnchor(a, i + 1))
      .filter(Boolean)
      .map((a: any) => ({ ...a, id: uuidv4() })) as RouteAnchor[];
    if (!anchors.length) return null;
    return { id: uuidv4(), goal, createdAt: Date.now(), version: 1, anchors, revisions: [] };
  } catch {
    return null;
  }
}

/** 为某个锚点这一段规划 2-4 个探索方向（会被创建成节点并 stamp anchorId） */
export async function planLegDirections(
  goal: string, anchor: RouteAnchor, doneSoFar: string[] = [],
): Promise<{ title: string; why: string }[]> {
  const prompt = `项目目标：${goal}

现在要推进到路标「${anchor.title}」。
这个路标要回答：${anchor.question}
到点时需要拿到：${anchor.needs}
${doneSoFar.length ? `之前已经探过：${doneSoFar.slice(0, 12).join('、')}` : ''}

请给出到达这个路标**之前**需要先想清楚的 2-4 个方向。

返回 JSON：{"directions": [{"title": "不超过 10 字的名词短语", "why": "为什么这个方向对到达该路标是必要的，一句话"}]}

要求：
1. 只给**推理阶段能做**的方向。需要真实数据才能回答的，那正是路标本身的事，不要放进来。
2. 和已探过的不要重复。
3. 宁少勿多，2-4 个。`;

  try {
    const raw = await callGemini([{ role: 'user', content: prompt }], undefined, 'application/json');
    const parsed = parseJson(raw);
    const list = Array.isArray(parsed?.directions) ? parsed.directions : [];
    return list
      .filter((d: any) => d && typeof d.title === 'string' && d.title.trim())
      .slice(0, 4)
      .map((d: any) => ({
        title: d.title.trim().replace(/[？?。.！!，,]+$/u, '').slice(0, 12),
        why: typeof d.why === 'string' ? d.why.trim().slice(0, 120) : '',
      }));
  } catch {
    return [];
  }
}

/**
 * 拿到真实数据后重规划后面的路。
 * 只产出"当前锚点之后"的新锚点——已经走过的不动。
 */
export async function reviseRoute(
  route: ExplorationRoute,
  anchor: RouteAnchor,
  nodes: ProblemNode[] = [],
): Promise<{ anchors: Omit<RouteAnchor, 'id' | 'order' | 'status'>[]; note: string } | null> {
  const passed = route.anchors.filter(a => a.status === 'passed').map(a => `${a.title}：通过（${a.result?.summary || ''}）`);
  const remaining = route.anchors.filter(a => a.order > anchor.order && !isSettled(a)).map(a => a.title);
  const findings = nodes
    .filter(n => n.anchorId === anchor.id && n.hypothesis?.statement)
    .slice(0, 6)
    .map(n => `${n.title}：${n.hypothesis!.statement}`);

  const verdict = anchor.result?.verdict === 'pass' ? '通过' : '没通过';

  const prompt = `一条探索路线刚在某个路标上拿到了真实反馈，需要据此重新规划后面的路。

项目目标：${route.goal}

刚结算的路标：「${anchor.title}」
  要验证的：${anchor.question}
  判定标准：通过=${anchor.passIf}；不通过=${anchor.failIf}
  **现实给出的结果：${verdict} —— ${anchor.result?.summary || '（无说明）'}**

${passed.length ? `此前已通过的路标：\n${passed.join('\n')}\n` : ''}${findings.length ? `这一段探索得到的判断：\n${findings.join('\n')}\n` : ''}${remaining.length ? `原本计划的后续路标（都是没有真实数据时先占的位，可以整体推翻）：${remaining.join('、')}` : '原本后面没有路标了'}

请返回 JSON：
{
  "note": "一句话说清后面的路为什么这样改（要提到现实给的那个结果）",
  "anchors": [ { "title": "...", "question": "...", "needs": "...", "method": "user|device|experiment|data|mixed", "method_detail": "...", "pass_if": "...", "fail_if": "...", "soft": false } ]
}

要求：
1. 只给**后面还没走的**路标，2-4 个。
2. 如果刚才那个路标**没通过**，说明原来的方向判断错了——请认真考虑换方向，而不是把原计划照抄一遍。
3. 每个路标仍然必须是"只能问现实"的东西，pass_if / fail_if 要有可判定的界线。
4. 如果现实结果表明这个问题已经不值得继续探了，anchors 给空数组，在 note 里说清楚为什么。`;

  try {
    const raw = await callGemini([{ role: 'user', content: prompt }], undefined, 'application/json');
    const parsed = parseJson(raw);
    const list = Array.isArray(parsed?.anchors) ? parsed.anchors : [];
    const anchors = list
      .slice(0, 5)
      .map((a: any, i: number) => normalizeAnchor(a, i + 1))
      .filter(Boolean)
      .map(({ order, status, ...rest }: any) => rest);
    return { anchors, note: typeof parsed?.note === 'string' ? parsed.note.trim().slice(0, 200) : '根据真实结果调整了后续路线' };
  } catch {
    return null;
  }
}
