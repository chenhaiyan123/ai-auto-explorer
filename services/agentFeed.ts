import { FeedItem, FeedAskType, FeedOption, ProblemNode, NodeStatus, Outline } from '../types';
import { OutlineProgress, keptItems } from './outline';
import { briefSections, briefFoot, CHARTER_PRESETS } from './projectBrief';
import { TOPIC_LABEL } from './keyInfo';
import type { KeyInfo } from '../types';

/**
 * 对话流（Agent Feed）——像 Codex 一样，把「AI 在干什么」和「需要你拍板的地方」
 * 都收进右侧同一条聊天记录里。
 *
 * 两种条目：
 * - status：一行字的进度（✍️ 正在写《x》→ ✅ 写完《x》），默认不展开；
 * - ask：问题卡。一句话问题 + 2~4 个选项 + 可选的一行输入框。
 *   答完收成一行「你选了：xxx」留在记录里，以后翻得到当时怎么选的。
 *
 * 这里全是纯函数，方便单测；App 只负责把它们接到状态上。
 */

export const FEED_LIMIT = 200;

let seq = 0;
export const feedId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * 追加一条。带 key 的条目会**替换**同 key 的最后一条（比如「正在写」→「写完了」），
 * 这样一篇只占一行，不会刷屏。
 */
export const pushFeed = (feed: FeedItem[] | undefined, item: FeedItem): FeedItem[] => {
  const list = feed ? feed.slice() : [];
  if (item.key) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].key === item.key) {
        // 已经答过的问题卡不能被覆盖——那是用户的决策记录
        if (list[i].ask?.answer) break;
        list.splice(i, 1);
        break;
      }
    }
  }
  list.push(item);
  return list.length > FEED_LIMIT ? list.slice(list.length - FEED_LIMIT) : list;
};

/** 记下用户的回答（卡片收成一行） */
export const answerFeed = (feed: FeedItem[] | undefined, id: string, label: string, at = Date.now()): FeedItem[] =>
  (feed || []).map(f => (f.id === id && f.ask && !f.ask.answer ? { ...f, ask: { ...f.ask, answer: { label, at } } } : f));

/**
 * 关掉还没答的同类问题卡。
 * 用户可能在别处（笔记里、编辑器里）已经做了同一个决定，聊天里那张卡就不该再挂着。
 */
export const closeAsks = (
  feed: FeedItem[] | undefined, type: FeedAskType, label = '已在别处处理', nodeId?: string, at = Date.now(),
): FeedItem[] =>
  (feed || []).map(f =>
    f.ask && !f.ask.answer && f.ask.type === type && (nodeId === undefined || f.nodeId === nodeId)
      ? { ...f, ask: { ...f.ask, answer: { label, at, auto: true } } }
      : f,
  );

export const openAsks = (feed: FeedItem[] | undefined): FeedItem[] => (feed || []).filter(f => f.ask && !f.ask.answer);

const clip = (s: string | undefined, n: number) => {
  // 摘要里不要出现 Markdown 记号（## / ** / - 列表），读起来像乱码
  const t = (s || '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/^\s*[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export const status = (text: string, opts: Partial<FeedItem> = {}): FeedItem => ({
  id: feedId(), ts: Date.now(), kind: 'status', text, ...opts,
});

const ask = (type: FeedAskType, text: string, options: FeedOption[], opts: Partial<FeedItem> & { input?: { placeholder: string; optionId: string } } = {}): FeedItem => {
  const { input, ...rest } = opts;
  return { id: feedId(), ts: Date.now(), kind: 'ask', text, ask: { type, options, input }, ...rest };
};

// ===== 各个决策点的问题卡 =====

/** 一篇写完的停顿（原来中间栏顶部的 StepBar） */
export const stepAsk = (node: ProblemNode, progress: OutlineProgress): FeedItem => {
  const flag = node.status === NodeStatus.CONTRADICTED ? '🔴 被现实推翻'
    : node.status === NodeStatus.VALIDATING ? '🟡 写到头了，要问现实'
    : '✅ 写完';
  const options: FeedOption[] = [];
  if (progress.next) options.push({ id: 'next', label: `写下一篇《${clip(progress.next.title, 14)}》`, primary: true });
  options.push({ id: 'rewrite', label: '这篇重写' });
  options.push({ id: 'stop', label: '先停一下' });
  if (progress.next) options.push({ id: 'auto', label: '剩下的一次写完' });
  return ask('step', `${flag}《${node.title}》 · ${progress.written}/${progress.total}`, options, {
    nodeId: node.id,
    key: `write:${node.id}`,
    detail: clip(node.hypothesis?.statement || node.notes, 90) || undefined,
    input: { placeholder: progress.next ? '补一句要求，带进下一篇…' : '说说哪里不对，按这个重写…', optionId: progress.next ? 'next' : 'rewrite' },
  });
};

/** 探索遇到分支点 / 多次失败（原来的 DecisionModal，只有点进节点才会弹） */
export const branchAsk = (node: ProblemNode): FeedItem => {
  const failed = (node.pendingDecision?.context || '').includes('失败');
  if (failed) {
    return ask('branch', `⚠️《${node.title}》自动写了几次都失败了`, [
      { id: 'retry', label: '再试一次', primary: true },
      { id: 'terminate', label: '跳过这篇' },
    ], { nodeId: node.id, key: `branch:${node.id}` });
  }
  return ask('branch', `⚠️《${node.title}》走到岔路口了`, [
    { id: 'continue', label: '这篇算写完，继续', primary: true },
    { id: 'terminate', label: '放弃这个方向' },
  ], {
    nodeId: node.id,
    key: `branch:${node.id}`,
    detail: clip(node.pendingDecision?.context, 120) || undefined,
    input: { placeholder: '或者给一个新的子方向…', optionId: 'add_subproblem' },
  });
};

/** 假设被现实推翻（原来自动弹 DecisionRecordModal） */
export const contradictedAsk = (node: ProblemNode): FeedItem =>
  ask('contradicted', `🔴《${node.title}》的判断被现实推翻了，接下来？`, [
    { id: 'pivot', label: '换个假设继续', primary: true },
    { id: 'drop', label: '这个方向作废' },
    { id: 'skip', label: '不记录' },
  ], {
    nodeId: node.id,
    key: `contradicted:${node.id}`,
    detail: clip(node.hypothesis?.statement, 90) || undefined,
    input: { placeholder: '补一句理由（会记进决策记录）…', optionId: 'pivot' },
  });

/** 推理到头了，剩下的全在等现实 */
export const realityAsk = (queue: { id: string; title: string }[]): FeedItem =>
  ask('reality', `🟡 推理到头了，${queue.length} 篇在等现实验证`, [
    { id: 'open', label: `去《${clip(queue[0]?.title, 12)}》设计验证`, primary: true },
    { id: 'later', label: '先放着' },
  ], {
    nodeId: queue[0]?.id,
    key: 'reality',
    detail: queue.slice(0, 4).map(q => q.title).join('、') + (queue.length > 4 ? ' 等' : ''),
  });

/** 到达路标 */
export const anchorAsk = (anchorId: string, title: string, question: string, need: string): FeedItem =>
  ask('anchor', `📍 到路标了：${title}`, [
    { id: 'open', label: '去回填结果', primary: true },
    { id: 'skip', label: '跳过这个路标' },
  ], { key: `anchor:${anchorId}`, ref: anchorId, detail: clip(`${question} · 需要：${need}`, 140) });

/** 无人值守预算用完 */
export const unattendedAsk = (rounds: number): FeedItem =>
  ask('unattended', `☕ 已经连着写了 ${rounds} 篇，你还在看吗？`, [
    { id: 'go', label: '继续', primary: true },
    { id: 'stop', label: '先停着' },
  ], { key: 'unattended', detail: '每一篇都会真实调用模型、产生费用，所以先停下来确认一次。' });

/** 模型连不上 / 额度用完 */
export const haltedAsk = (title: string, detail: string): FeedItem =>
  ask('halted', title, [
    { id: 'settings', label: '打开模型设置', primary: true },
    { id: 'retry', label: '重试' },
  ], { key: 'halted', detail: clip(detail, 140) });

/**
 * 框架草稿：在聊天里放精简版，要细改再展开编辑器。
 * 有简报时，这张卡就是「项目简报」：像一个人那样先把事说清楚——
 * 怎么拆、大概怎么做、难在哪、需要你什么，以及短期 / 长期的实话。
 */
export const outlineAsk = (outline: Outline): FeedItem => {
  const items = keptItems(outline);
  const b = outline.brief;
  if (b) {
    return ask('outline', '🧭 开工前，我先把这件事想了一遍', [
      { id: 'confirm', label: '思路没问题，往下谈预算', primary: true },
      { id: 'edit', label: '我要改改目录' },
      { id: 'redo', label: '重想一份' },
    ], {
      key: `outline:${outline.id}`,
      ref: outline.id,
      sections: briefSections(b, items),
      foot: briefFoot(b),
      input: { placeholder: '哪里不对就直接说，比如「目标用户是成人，不是小孩」，我按这个重想…', optionId: 'redo' },
    });
  }
  return ask('outline', `🗺️ 先拟了 ${items.length} 篇的目录，你看行不行`, [
    { id: 'confirm', label: '就这样，开始写', primary: true },
    { id: 'edit', label: '我要改改' },
    { id: 'redo', label: '重拟一份' },
  ], {
    key: `outline:${outline.id}`,
    ref: outline.id,
    list: items.map(i => ({ title: i.title, sub: i.question })),
    input: { placeholder: '补充要求，比如「加一篇讲定价」，会按这个重拟…', optionId: 'redo' },
  });
};

/**
 * 花钱权限：AI 自己做不了的事（真实数据、访谈、实验、测量）要去服务广场找人。
 * 先问清楚多少钱以内它可以自己下单——答完才开始写。
 */
export const charterAsk = (projectId: string, firstNodeId?: string): FeedItem =>
  ask('charter', '💰 最后一件事：遇到 AI 自己做不了的，要花钱找人吗？', [
    { id: 'cny:0', label: '花钱都先问我，开始写', primary: true },
    ...CHARTER_PRESETS.filter(n => n > 0).map(n => ({ id: `cny:${n}`, label: `单笔 ≤ ¥${n} 可以自己下单` })),
  ], {
    key: `charter:${projectId}`,
    nodeId: firstNodeId,
    detail: '比如要真实的业务数据、找用户访谈、做一次实验或测量——这些光靠推理做不出来，得去服务广场找人或 Agent 做；找不到就发布需求。超过额度的照样先问你。以后可以在项目总览里改。',
    input: { placeholder: '或者直接说，比如「每月最多 300，单笔不超过 100」…', optionId: 'text' },
  });

/**
 * AI 项目经理主动问一件只有用户知道的事。一次只问一个，答完再问下一个。
 * kickoff（带 nodeId）= 开工前问的：答完 / 跳过之后才开始写第一篇。
 */
export const infoAsk = (k: KeyInfo, remaining: number, kickoffNodeId?: string): FeedItem => {
  const options: FeedOption[] = [
    { id: 'skip', label: '不确定，你先按常理假设' },
    { id: 'later', label: '以后再说' },
  ];
  if (kickoffNodeId) options.push({ id: 'start', label: '先不问了，开始写' });
  return ask('info', `🙋 ${k.question}`, options, {
    key: `info:${k.id}`,
    ref: k.id,
    nodeId: kickoffNodeId,
    detail: `${TOPIC_LABEL[k.topic]} · 你的回答会记进 AI 记忆，之后写笔记、团队讨论都按这个来${remaining > 0 ? `（之后还有 ${remaining} 个问题）` : ''}`,
    input: { placeholder: '直接回答…', optionId: 'answer' },
  });
};

// ===== 连写一轮（原来的「持续探索」）=====
// 连写时对话流里只占一行（原地更新进度），写完一轮给一张汇总卡；不再每篇刷一行、也不再无限写下去。
export interface Batch { id: string; target: number; done: { id: string; title: string; flag?: string }[]; newDirs: number }
export const BATCH_SIZE = 5;

export const batchProgress = (b: Batch, writing?: string): FeedItem =>
  status(`⏩ 连写中 ${Math.min(b.done.length + (writing ? 1 : 0), b.target)}/${b.target}${writing ? `：《${clip(writing, 18)}》` : ''}`, {
    key: `batch:${b.id}`,
    detail: b.done.length ? `已写：${b.done.map(d => `《${d.title}》`).join('、')}` : undefined,
  });

export const batchAsk = (b: Batch, reason: 'done' | 'empty' | 'stopped' | 'halted', remaining: number): FeedItem => {
  const head = b.done.length === 0 ? '⏹ 这一轮还没写完任何一篇' : `📦 这一轮写了 ${b.done.length} 篇`;
  const why = reason === 'empty' ? '，能写的都写完了' : reason === 'stopped' ? '（你叫停了）' : reason === 'halted' ? '（中途暂停了）' : '';
  const options: FeedOption[] = [];
  if (remaining > 0) options.push({ id: 'more', label: `再写一轮（${Math.min(BATCH_SIZE, remaining)} 篇）`, primary: true });
  if (remaining > 0) options.push({ id: 'step', label: '改成一篇一停' });
  options.push({ id: 'done', label: remaining > 0 ? '先这样' : '好的', primary: remaining === 0 });
  return ask('batch', head + why, options, {
    key: `batch:${b.id}`,
    list: b.done.map(d => ({ title: `${d.flag || '✅'} ${d.title}` })),
    detail: [b.newDirs ? `途中新长出 ${b.newDirs} 个方向` : '', remaining ? `还有 ${remaining} 篇没写` : '没有待写的了'].filter(Boolean).join('；'),
  });
};
