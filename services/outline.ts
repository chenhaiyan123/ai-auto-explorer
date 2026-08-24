import { ProblemNode, NodeStatus, Outline, OutlineItem } from '../types';

/**
 * 框架先行（Outline）。
 *
 * 要解决的问题：原来一按「开始探索」，AI 就自顾自地一篇接一篇往下写，
 * 十分钟能生成七八篇笔记。用户根本来不及看，看完也不知道这些方向是怎么来的——
 * **产出的速度超过了理解的速度，多出来的那部分就不是资产，是噪音。**
 *
 * 改成两段：
 *   ① 先只出**框架**：每篇一个标题 + 一句「这篇要回答什么」，不写正文。
 *      用户在这一步改标题、删掉不关心的、补一句自己的想法、挑从哪篇开始。
 *   ② 确认之后**一篇一篇**填，写完一篇停一次，等用户说继续。
 *
 * 为什么框架阶段必须便宜：它的全部意义是让用户能在三十秒内看完并改掉。
 * 一旦框架本身也变成七八段正文，这一步就白设了。所以这里只允许标题和一句话，
 * 长度上限写死在解析里。
 *
 * 纯函数，不碰 DOM、不调模型，可单测。
 */

// ---------- 上限 ----------

/** 一个框架最多几篇。超过这个数，人就开始"扫"而不是"读"了。 */
export const MAX_ITEMS = 8;
/** 少于这个数说明拆得太粗，不值得走框架流程 */
export const MIN_ITEMS = 2;
export const MAX_TITLE = 24;
export const MAX_QUESTION = 60;
export const MAX_WHY = 60;

// ---------- 小工具 ----------

const str = (v: any, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** 归一化标题用于查重：去标点空白、统一小写 */
export function normTitle(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[·・、，,。.？?！!：:；;"'“”‘’（）()【】\[\]《》<>\-—_/\\|]/g, '');
}

let seq = 0;
/** 稳定的本地 id（不用 uuid，保持这个文件零依赖、可直接单测） */
const nextId = (now: number) => `o${now.toString(36)}${(seq++).toString(36)}`;

// ---------- 解析模型返回 ----------

export interface OutlineParse {
  outline?: Outline;
  /** 哪些被丢掉了、为什么。要给用户看，不能吞。 */
  problems: string[];
}

/**
 * 把模型给的框架 JSON 变成 Outline。
 *
 * 这里**故意不做严格拒收**（和 parseSimSpec 不同）：框架是给人改的草稿，
 * 少一条多一条都不影响正确性，用户当场就能补。仿真那边拒收是因为一条算错的曲线
 * 会被当成事实，框架不会。
 */
export function parseOutline(raw: any, goal: string, now = Date.now()): OutlineParse {
  const problems: string[] = [];
  const list = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  if (!list.length) return { problems: ['模型没有给出任何方向'] };

  const items: OutlineItem[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (items.length >= MAX_ITEMS) { problems.push(`只保留了前 ${MAX_ITEMS} 篇，多出来的先不管`); break; }
    const title = str(r?.title, MAX_TITLE);
    const question = str(r?.question, MAX_QUESTION);
    if (!title) { problems.push('有一条没有标题，已跳过'); continue; }
    const key = normTitle(title);
    if (!key || seen.has(key)) { problems.push(`「${title}」和前面重复，已跳过`); continue; }
    seen.add(key);
    items.push({
      id: nextId(now),
      title,
      // 没写"要回答什么"就用标题兜底——这一条不值得为它整篇作废
      question: question || `把「${title}」说清楚`,
      why: str(r?.why, MAX_WHY) || undefined,
      state: 'keep',
    });
  }
  if (items.length < MIN_ITEMS) return { problems: [...problems, '有效方向少于两条，这次没拟出可用的框架'] };

  return {
    outline: {
      id: nextId(now),
      goal,
      createdAt: now,
      status: 'draft',
      items,
      startId: items[0].id,
    },
    problems,
  };
}

// ---------- 用户在框架阶段的操作 ----------

const map = (o: Outline, id: string, f: (i: OutlineItem) => OutlineItem): Outline =>
  ({ ...o, items: o.items.map(i => (i.id === id ? f(i) : i)) });

/** 改标题 / 改「要回答什么」。改过的会打标记，后面填充时提示词会照用户的说法走。 */
export function editItem(o: Outline, id: string, patch: { title?: string; question?: string }): Outline {
  return map(o, id, i => ({
    ...i,
    title: patch.title !== undefined ? str(patch.title, MAX_TITLE) || i.title : i.title,
    question: patch.question !== undefined ? str(patch.question, MAX_QUESTION) || i.question : i.question,
    edited: true,
  }));
}

/** 不关心这条。不是删除——留着可以撤销，也留了"用户明确说过不要"这个信息。 */
export const dropItem = (o: Outline, id: string): Outline => {
  const next = map(o, id, i => ({ ...i, state: 'drop' as const }));
  return next.startId === id ? { ...next, startId: firstKeptId(next) } : next;
};

export const restoreItem = (o: Outline, id: string): Outline => map(o, id, i => ({ ...i, state: 'keep' as const }));

/** 自己加一条。用户加的一律排在末尾，且默认就是 keep。 */
export function addItem(o: Outline, title: string, question = '', now = Date.now()): Outline {
  const t = str(title, MAX_TITLE);
  if (!t) return o;
  if (o.items.some(i => normTitle(i.title) === normTitle(t))) return o;
  if (keptItems(o).length >= MAX_ITEMS) return o;
  const item: OutlineItem = {
    id: nextId(now),
    title: t,
    question: str(question, MAX_QUESTION) || `把「${t}」说清楚`,
    state: 'keep',
    byUser: true,
  };
  const next = { ...o, items: [...o.items, item] };
  return next.startId ? next : { ...next, startId: item.id };
}

/** 上移 / 下移。只在保留的条目之间移动，被丢掉的不参与排序。 */
export function moveItem(o: Outline, id: string, dir: -1 | 1): Outline {
  const kept = keptItems(o);
  const at = kept.findIndex(i => i.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= kept.length) return o;
  const reordered = [...kept];
  [reordered[at], reordered[to]] = [reordered[to], reordered[at]];
  // 把重排后的保留项按原来的"保留位置"填回去，丢掉的原地不动
  const slots = o.items.map((i, idx) => (i.state === 'keep' ? idx : -1)).filter(idx => idx >= 0);
  const items = [...o.items];
  slots.forEach((slot, k) => { items[slot] = reordered[k]; });
  return { ...o, items };
}

/** 从哪一篇开始写。这是框架阶段最后一个决定，也是"一篇一篇"的起点。 */
export const setStart = (o: Outline, id: string): Outline =>
  (o.items.some(i => i.id === id && i.state === 'keep') ? { ...o, startId: id } : o);

/** 用户在框架阶段补的一句话，会带进后面每一篇的提示词 */
export const setUserNote = (o: Outline, note: string): Outline => ({ ...o, userNote: str(note, 200) || undefined });

export const keptItems = (o: Outline): OutlineItem[] => (o?.items || []).filter(i => i.state === 'keep');
export const droppedItems = (o: Outline): OutlineItem[] => (o?.items || []).filter(i => i.state === 'drop');
const firstKeptId = (o: Outline): string | undefined => keptItems(o)[0]?.id;

// ---------- 确认 → 落成节点 ----------

/** 一篇还没写正文时的占位正文。要能一眼看出"这是待写的"，不能像已经写完了。 */
export const stubNote = (i: OutlineItem): string =>
  `# ${i.title}\n\n> 这一篇要回答：${i.question}\n\n_还没开始写。点上面的「▶ 写这一篇」让 AI 填充，或者直接自己写。_\n`;

/**
 * 确认框架 → 生成待写的节点（只有标题和问题，没有正文）。
 *
 * 关键点：**这一步不调模型，一篇正文都不生成。** 节点是空壳，
 * 用户看到的是一份目录，然后由他决定先写哪一篇。
 */
export function confirmOutline(
  o: Outline,
  rootId: string,
  now = Date.now(),
): { outline: Outline; nodes: ProblemNode[] } {
  const kept = keptItems(o);
  const nodes: ProblemNode[] = [];
  const items = o.items.map(i => ({ ...i }));

  kept.forEach((item, idx) => {
    const id = `${o.id}-n${idx}`;
    nodes.push({
      id,
      title: item.title,
      status: NodeStatus.UNEXPLORED,
      confidence: 0,
      dependencies: [rootId],
      notes: '',
      chatHistory: [],
      agentResults: [],
      noteType: 'direction',
      fullNote: stubNote(item),
      outlineItemId: item.id,
      noteUpdatedAt: now,
    });
    const slot = items.find(x => x.id === item.id);
    if (slot) slot.nodeId = id;
  });

  return {
    outline: { ...o, items, status: 'confirmed', confirmedAt: now },
    nodes,
  };
}

// ---------- 进度 ----------

export interface OutlineProgress {
  total: number;
  /** 已经写过正文的（不再是空壳） */
  written: number;
  /** 下一篇该写谁 */
  next?: { nodeId: string; title: string; question: string };
}

/** 一篇是不是还没写（空壳）。判据是「没有探索产出」，不是「正文为空」——用户自己写的也算写过。 */
export const isStub = (n: ProblemNode): boolean =>
  n.status === NodeStatus.UNEXPLORED && !(n.notes && n.notes.trim());

/**
 * 框架走到哪了。
 * 下一篇的顺序 = 框架里的顺序，但**从 startId 那一篇开始轮**，
 * 因为用户在框架阶段挑的就是"先写这篇"。
 */
export function outlineProgress(o: Outline | undefined, nodes: ProblemNode[]): OutlineProgress {
  if (!o) return { total: 0, written: 0 };
  const kept = keptItems(o);
  const byItem = new Map(nodes.map(n => [n.outlineItemId, n] as const));

  const startAt = Math.max(0, kept.findIndex(i => i.id === o.startId));
  const ordered = [...kept.slice(startAt), ...kept.slice(0, startAt)];

  let written = 0;
  let next: OutlineProgress['next'];
  for (const item of ordered) {
    const n = byItem.get(item.id);
    if (!n) continue;
    if (isStub(n)) { if (!next) next = { nodeId: n.id, title: item.title, question: item.question }; }
    else written += 1;
  }
  return { total: kept.filter(i => byItem.has(i.id)).length, written, next };
}

/**
 * 没有框架的项目（老项目，或者用户点了「不用框架」）也要有进度。
 *
 * 不能因为没走框架流程就让「一篇一停」退化成一个说不出下一篇是什么的空壳条——
 * 那样用户按了「先停一下」之后就再也不知道还剩什么了。
 */
export function plainProgress(nodes: ProblemNode[]): OutlineProgress {
  const dirs = (nodes || []).filter(n => (n.noteType === 'direction' || !n.noteType));
  const pending = dirs.filter(isStub);
  const first = pending[0];
  return {
    total: dirs.length,
    written: dirs.length - pending.length,
    next: first ? { nodeId: first.id, title: first.title, question: '' } : undefined,
  };
}

// ---------- 导出成总览正文 ----------

/** 框架写进项目总览：让"我们商量好要写哪几篇"这件事有个固定的地方可查 */
export function outlineToMarkdown(o: Outline, nodes: ProblemNode[] = []): string {
  const byItem = new Map(nodes.map(n => [n.outlineItemId, n] as const));
  const L: string[] = ['## 🗺️ 这个项目打算写哪几篇', ''];
  if (o.userNote) { L.push(`> 你的补充：${o.userNote}`, ''); }
  keptItems(o).forEach((i, idx) => {
    const n = byItem.get(i.id);
    const mark = !n ? '·' : isStub(n) ? '○' : '●';
    L.push(`${idx + 1}. ${mark} **[[${i.title}]]** —— ${i.question}${i.byUser ? '（你加的）' : ''}`);
  });
  const dropped = droppedItems(o);
  if (dropped.length) {
    L.push('', '商量下来先不写的：' + dropped.map(i => `~~${i.title}~~`).join('、'));
  }
  L.push('', '> ● 已写 · ○ 待写。一篇一篇来，写完一篇再决定下一篇。');
  return L.join('\n');
}
