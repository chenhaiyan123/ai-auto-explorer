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

/**
 * 做完一步的停顿：给结果，问下一步。
 * 这个产品的关键字是「做」——每一步都要落到结果上；
 * AI 做不了、必须去现实里做的（拿数据、找人、做实验），就在这里接上闭环：
 * 找人 / 服务去做，或者你自己去做、把结果告诉我，我按真实结果接着推进。
 */
export const stepAsk = (node: ProblemNode, progress: OutlineProgress): FeedItem => {
  const stuck = node.status === NodeStatus.VALIDATING;
  const flag = node.status === NodeStatus.CONTRADICTED ? '🔴 被现实推翻'
    : stuck ? '🟡 推进到要动真格的地方了'
    : '✅ 做完';
  const options: FeedOption[] = [];
  if (stuck) {
    options.push({ id: 'seek', label: '🤝 找人 / 服务去做', primary: !progress.next });
    if (progress.next) options.push({ id: 'next', label: `先做下一步「${clip(progress.next.title, 12)}」`, primary: true });
    options.push({ id: 'stop', label: '先停一下' });
  } else {
    if (progress.next) options.push({ id: 'next', label: `做下一步「${clip(progress.next.title, 14)}」`, primary: true });
    options.push({ id: 'rewrite', label: '这步重做' });
    options.push({ id: 'stop', label: '先停一下' });
    if (progress.next) options.push({ id: 'auto', label: '剩下的交给 AI 自主运行' });
  }
  const need = node.hypothesis?.unknown;
  return ask('step', `${flag}「${node.title}」 · 第 ${progress.written}/${progress.total} 步`, options, {
    nodeId: node.id,
    key: `write:${node.id}`,
    detail: (stuck && need ? `要在现实里做：${clip(need, 90)}` : clip(node.hypothesis?.statement || node.notes, 90)) || undefined,
    input: stuck
      ? { placeholder: '你自己去做了？把结果告诉我，我按真实结果重新推进这一步…', optionId: 'result' }
      : { placeholder: progress.next ? '补一句要求，带进下一步…' : '说说哪里不对，按这个重做…', optionId: progress.next ? 'next' : 'rewrite' },
  });
};

/** 推进时遇到分支点 / 多次失败（原来的 DecisionModal，只有点进节点才会弹） */
export const branchAsk = (node: ProblemNode): FeedItem => {
  const failed = (node.pendingDecision?.context || '').includes('失败');
  if (failed) {
    return ask('branch', `⚠️「${node.title}」自动做了几次都失败了`, [
      { id: 'retry', label: '再试一次', primary: true },
      { id: 'terminate', label: '跳过这一步' },
    ], { nodeId: node.id, key: `branch:${node.id}` });
  }
  return ask('branch', `⚠️「${node.title}」走到岔路口了`, [
    { id: 'continue', label: '这步算完成，继续', primary: true },
    { id: 'terminate', label: '放弃这条路' },
  ], {
    nodeId: node.id,
    key: `branch:${node.id}`,
    detail: clip(node.pendingDecision?.context, 120) || undefined,
    input: { placeholder: '或者给一个新的子任务…', optionId: 'add_subproblem' },
  });
};

/** 假设被现实推翻（原来自动弹 DecisionRecordModal） */
export const contradictedAsk = (node: ProblemNode): FeedItem =>
  ask('contradicted', `🔴「${node.title}」的判断被现实推翻了，接下来？`, [
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
  ask('reality', `🟡 光靠 AI 推不动了，${queue.length} 步要到现实里去做`, [
    { id: 'open', label: `去「${clip(queue[0]?.title, 12)}」安排怎么做`, primary: true },
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
  ask('unattended', `☕ 已经连着做了 ${rounds} 步，你还在看吗？`, [
    { id: 'go', label: '继续', primary: true },
    { id: 'stop', label: '先停着' },
  ], { key: 'unattended', detail: '每一步都会真实调用模型、产生费用，所以先停下来确认一次。' });

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
      { id: 'edit', label: '我要改改步骤' },
      { id: 'redo', label: '重想一份' },
    ], {
      key: `outline:${outline.id}`,
      ref: outline.id,
      sections: briefSections(b, items),
      foot: briefFoot(b),
      input: { placeholder: '哪里不对就直接说，比如「目标用户是成人，不是小孩」，我按这个重想…', optionId: 'redo' },
    });
  }
  return ask('outline', `🗺️ 先拆成了 ${items.length} 步，你看行不行`, [
    { id: 'confirm', label: '就这样，开始做', primary: true },
    { id: 'edit', label: '我要改改' },
    { id: 'redo', label: '重拟一份' },
  ], {
    key: `outline:${outline.id}`,
    ref: outline.id,
    list: items.map(i => ({ title: i.title, sub: i.question })),
    input: { placeholder: '补充要求，比如「加一步：先做个定价测试」，会按这个重拆…', optionId: 'redo' },
  });
};

/**
 * 花钱权限：AI 自己做不了的事（真实数据、访谈、实验、测量）要去服务广场找人。
 * 先问清楚多少钱以内它可以自己下单——答完才开始写。
 */
export const charterAsk = (projectId: string, firstNodeId?: string): FeedItem =>
  ask('charter', '💰 最后一件事：遇到 AI 自己做不了的，要花钱找人吗？', [
    { id: 'cny:0', label: '花钱都先问我，开始做', primary: true },
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
  if (kickoffNodeId) options.push({ id: 'start', label: '先不问了，开始做' });
  return ask('info', `🙋 ${k.question}`, options, {
    key: `info:${k.id}`,
    ref: k.id,
    nodeId: kickoffNodeId,
    detail: `${TOPIC_LABEL[k.topic]} · 你的回答会记进 AI 记忆，之后做事、团队讨论都按这个来${remaining > 0 ? `（之后还有 ${remaining} 个问题）` : ''}`,
    input: { placeholder: '直接回答…', optionId: 'answer' },
  });
};

// ===== 连着做一轮（原来的「持续探索」）=====
// 连着做时对话流里只占一行（原地更新进度），一轮做完给一张汇总卡；不再每步刷一行、也不再无限做下去。
export interface Batch { id: string; target: number; done: { id: string; title: string; flag?: string }[]; newDirs: number }
export const BATCH_SIZE = 5;

export const batchProgress = (b: Batch, writing?: string): FeedItem =>
  status(`⚡ 自主运行中 ${Math.min(b.done.length + (writing ? 1 : 0), b.target)}/${b.target}${writing ? `：「${clip(writing, 18)}」` : ''}`, {
    key: `batch:${b.id}`,
    detail: b.done.length ? `已做：${b.done.map(d => `「${d.title}」`).join('、')}` : undefined,
  });

export const batchAsk = (b: Batch, reason: 'done' | 'empty' | 'stopped' | 'halted', remaining: number): FeedItem => {
  const head = b.done.length === 0 ? '⏹ 自主运行这一轮还没做完任何一步' : `⚡ 自主运行了一轮，做了 ${b.done.length} 步`;
  const why = reason === 'empty' ? '，能推进的都推进了' : reason === 'stopped' ? '（你收回了）' : reason === 'halted' ? '（中途暂停了）' : '';
  const options: FeedOption[] = [];
  if (remaining > 0) options.push({ id: 'more', label: `继续自主运行（${Math.min(BATCH_SIZE, remaining)} 步）`, primary: true });
  if (remaining > 0) options.push({ id: 'step', label: '改成一步一停' });
  options.push({ id: 'done', label: remaining > 0 ? '先这样' : '好的', primary: remaining === 0 });
  return ask('batch', head + why, options, {
    key: `batch:${b.id}`,
    list: b.done.map(d => ({ title: `${d.flag || '✅'} ${d.title}` })),
    detail: [b.newDirs ? `途中新长出 ${b.newDirs} 个方向` : '', remaining ? `还有 ${remaining} 步没做` : '没有待做的了'].filter(Boolean).join('；'),
  });
};

// ===== 自主运行：用户回来时的汇报 =====
/**
 * 用户授权自主运行后回来了：一张汇报卡说清楚四件事——
 * 做了什么、我是怎么想的、遇到什么困难、需要你什么支持。
 */
export const reportAsk = (
  r: { headline: string; did: string[]; thinking: string[]; difficulties: string[]; needs: string[] },
  opts: { since: number; paused?: string; nextCheck?: number; hasQuestions?: boolean } = { since: 0 },
): FeedItem => {
  const days = Math.max(0, Math.round((Date.now() - opts.since) / 86400000));
  const span = days >= 1 ? `这 ${days} 天` : '刚才这段时间';
  const options: FeedOption[] = [
    { id: 'continue', label: opts.paused ? '好，继续自主运行' : '好，你继续', primary: true },
    ...(opts.hasQuestions ? [{ id: 'questions', label: '回答你的问题' }] : []),
    { id: 'pause', label: '先停一下' },
  ];
  return ask('report', `📋 ${span}的汇报：${r.headline || '我继续在做'}`, options, {
    key: 'report',
    sections: [
      { label: '这段时间我做了什么', items: r.did.length ? r.did : ['没做成什么'] },
      ...(r.thinking.length ? [{ label: '我的思考', items: r.thinking }] : []),
      { label: '遇到的困难', items: r.difficulties.length ? r.difficulties : ['没有卡住的地方'] },
      { label: '需要你的支持', items: r.needs.length ? r.needs : ['暂时不需要，我继续'] },
    ],
    foot: [opts.paused ? `现在停着：${opts.paused}` : '', opts.nextCheck ? `下次来看我：${new Date(opts.nextCheck).toLocaleDateString()}` : ''].filter(Boolean).join(' · ') || undefined,
    input: { placeholder: '有什么要调整的直接说，比如「先别花钱找人，先把资料做扎实」，我记进 AI 记忆照着做…', optionId: 'adjust' },
  });
};

// ===== 成果播报 =====
/** 定期的成果播报卡：做了什么 · 心得 · 闭环 · 你的成长 · 接下来 */
export const digestAsk = (d: { id: string; headline: string; since: number; at: number }, sections: { label: string; items: string[] }[]): FeedItem => {
  const days = Math.max(1, Math.round((d.at - d.since) / 86400000));
  return ask('digest', `📣 最近 ${days} 天的成果：${d.headline || '有新进展'}`, [
    { id: 'ok', label: '👍 知道了', primary: true },
    { id: 'open', label: '去项目总览看' },
  ], { key: `digest:${d.id}`, ref: d.id, sections });
};
