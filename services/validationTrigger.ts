import { ProblemNode, NodeStatus, Hypothesis, Evidence, LAYER_WEIGHT } from '../types';

/**
 * 验证触发器（Validation Trigger）
 *
 * 解决的问题：AI 一直在自己的世界里验证自己——推理产生结论，结论又成为下一轮推理的前提，
 * 跑得越久越自洽，但离真相不一定越近。
 *
 * 这里回答一个问题：**什么时候应该停止推理，去问现实？**
 *
 * 设计原则：
 * 1. 纯函数、不调模型、可单测（和 dashboardService 同一路子）。
 * 2. 命中触发器 ≠ 停掉整个循环。该节点挂成 VALIDATING，循环继续跑别的节点；
 *    只有当「剩下的全在等现实」时才停下来叫人。否则无人值守跑一夜就废了。
 * 3. CONTRADICTED 只可能由**外部证据**造成。AI 靠纯推理永远不能宣布自己被推翻，
 *    否则它会自己跟自己吵架、来回横跳。
 */

export type TriggerReason =
  /** 很自信，但一条外部证据都没有 */
  | 'weak_evidence'
  /** 支持与反对的证据势均力敌，推理无法裁决 */
  | 'contradiction'
  /** 连续几轮没产出新信息，再想下去边际收益趋零 */
  | 'no_new_info'
  /** 长期没动静 */
  | 'stalled';

export interface TriggerHit {
  reason: TriggerReason;
  /** 极简标签，UI 直接显示 */
  label: string;
  /** 一句话说明为什么命中 */
  detail: string;
}

export interface TriggerContext {
  /** 此前已经出现过的节点标题（用于查重） */
  recentTitles?: string[];
  /** 本轮新产出的子问题标题 */
  newTitles?: string[];
  /** 已经连续多少轮没有产出新子问题 */
  emptyRounds?: number;
  now?: number;
}

/** 连续这么多轮没有新信息就该去问现实了 */
export const NO_NEW_INFO_ROUNDS = 3;
/** 新产出标题与已有标题的重复率超过这个比例，视为原地打转 */
export const DUP_RATIO = 0.6;
/** 停滞天数阈值（与 dashboardService.STALE_DAYS 保持一致） */
export const STALE_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

export const REASON_LABEL: Record<TriggerReason, string> = {
  weak_evidence: '缺外部证据',
  contradiction: '证据打架',
  no_new_info: '原地打转',
  stalled: '长期停滞',
};

// ---------- 证据统计 ----------

export interface EvidenceStat {
  support: number;
  refute: number;
  /** 非 AI 推理的证据条数（人工回填 / 探针结果） */
  real: number;
  /** 支持方的证据权重合计 */
  supportWeight: number;
  /** 反对方的证据权重合计 */
  refuteWeight: number;
  /** 反对方里来自现实的权重合计 */
  realRefuteWeight: number;
  /** 支持方里来自现实的权重合计 */
  realSupportWeight: number;
  /** 触达到的最高证据层级权重 */
  topLayer: number;
}

const weightOf = (e: Evidence) => LAYER_WEIGHT[e.layer] ?? 1;

export function statEvidence(h?: Hypothesis): EvidenceStat {
  const list = h?.evidence || [];
  const stat: EvidenceStat = {
    support: 0, refute: 0, real: 0,
    supportWeight: 0, refuteWeight: 0,
    realRefuteWeight: 0, realSupportWeight: 0,
    topLayer: 0,
  };
  for (const e of list) {
    const w = weightOf(e);
    const isReal = e.origin !== 'ai';
    if (isReal) stat.real += 1;
    if (w > stat.topLayer) stat.topLayer = w;
    if (e.stance === 'refute') {
      stat.refute += 1;
      stat.refuteWeight += w;
      if (isReal) stat.realRefuteWeight += w;
    } else {
      stat.support += 1;
      stat.supportWeight += w;
      if (isReal) stat.realSupportWeight += w;
    }
  }
  return stat;
}

/**
 * 是否已被现实反驳。
 * 必须同时满足：① 有来自现实（人工/探针）的反证 ② 反证的分量压过现实里的支持证据。
 * 纯 AI 推理无论怎么自我怀疑，都不会让节点进入 CONTRADICTED。
 */
export function isContradictedByReality(h?: Hypothesis): boolean {
  const s = statEvidence(h);
  return s.realRefuteWeight > 0 && s.realRefuteWeight > s.realSupportWeight;
}

// ---------- 标题查重（判断有没有原地打转）----------

/** 归一化标题：去标点空白、统一小写，便于比较 */
export function normalizeTitle(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[·・、，,。.？?！!：:；;"'“”‘’（）()【】\[\]《》<>\-—_/\\|]/g, '');
}

/** 新标题里有多大比例是老调重弹（0–1）。没有新标题时返回 0。 */
export function duplicateRatio(newTitles: string[] = [], recentTitles: string[] = []): number {
  const fresh = newTitles.map(normalizeTitle).filter(Boolean);
  if (!fresh.length) return 0;
  const seen = new Set(recentTitles.map(normalizeTitle).filter(Boolean));
  let dup = 0;
  for (const t of fresh) {
    // 完全相同，或一方包含另一方（"用户需求" vs "用户需求分析"）都算重复
    if (seen.has(t) || Array.from(seen).some(s => s.includes(t) || t.includes(s))) dup += 1;
  }
  return dup / fresh.length;
}

// ---------- 主入口 ----------

/**
 * 检查一个刚探索完的节点，是否到了「该去问现实」的时候。
 * 返回空数组 = 可以照常标记为已完成。
 */
export function checkTriggers(
  node: ProblemNode,
  _nodes: ProblemNode[] = [],
  ctx: TriggerContext = {},
): TriggerHit[] {
  const now = ctx.now ?? Date.now();
  const hits: TriggerHit[] = [];
  const h = node.hypothesis;
  const s = statEvidence(h);

  // ① 很自信，但没有任何外部证据 —— 最常见、也最危险的一种自证
  if (h && h.belief !== 'low' && s.real === 0) {
    hits.push({
      reason: 'weak_evidence',
      label: REASON_LABEL.weak_evidence,
      detail: `「${h.statement.slice(0, 40)}」目前只有 ${s.support + s.refute} 条推理层依据，没有任何现实证据`,
    });
  }

  // ② 证据打架，靠继续推理裁决不了
  if (h && s.support >= 2 && s.refute >= 2) {
    hits.push({
      reason: 'contradiction',
      label: REASON_LABEL.contradiction,
      detail: `支持 ${s.support} 条 / 反对 ${s.refute} 条，推理无法裁决`,
    });
  }

  // ③ 原地打转：连续几轮没有新信息，或新子问题基本是老调重弹
  const emptyRounds = ctx.emptyRounds ?? 0;
  const dup = duplicateRatio(ctx.newTitles, ctx.recentTitles);
  if (emptyRounds >= NO_NEW_INFO_ROUNDS) {
    hits.push({
      reason: 'no_new_info',
      label: REASON_LABEL.no_new_info,
      detail: `连续 ${emptyRounds} 轮没有产出新方向，再推理下去收益很低`,
    });
  } else if (dup >= DUP_RATIO) {
    hits.push({
      reason: 'no_new_info',
      label: REASON_LABEL.no_new_info,
      detail: `新提出的方向有 ${Math.round(dup * 100)}% 与已有节点重复`,
    });
  }

  // ④ 停滞
  const updatedAt = node.noteUpdatedAt || 0;
  if (
    (node.status === NodeStatus.EXPLORING || node.status === NodeStatus.VALIDATING) &&
    updatedAt > 0 && now - updatedAt > STALE_DAYS * DAY
  ) {
    hits.push({
      reason: 'stalled',
      label: REASON_LABEL.stalled,
      detail: `已经 ${Math.floor((now - updatedAt) / DAY)} 天没有进展`,
    });
  }

  return hits;
}

/** 把命中的触发器压成一句话，写进 node.validationReason */
export function summarizeHits(hits: TriggerHit[]): string {
  if (!hits.length) return '';
  return hits.map(h => `${h.label}：${h.detail}`).join('；').slice(0, 300);
}

/** 正在等现实反馈 / 已被现实反驳的节点 */
export const isAwaitingReality = (n: ProblemNode) =>
  n.status === NodeStatus.VALIDATING || n.status === NodeStatus.CONTRADICTED;

/**
 * 剩下的活是不是全都在等现实。
 * true = 推理这条路已经走到头了，该叫人了（探索循环据此停下）。
 */
export function isBlockedOnReality(nodes: ProblemNode[]): boolean {
  const pending = (nodes || []).filter(
    n => n.status === NodeStatus.UNEXPLORED || n.status === NodeStatus.EXPLORING,
  );
  if (pending.length > 0) return false;
  return (nodes || []).some(isAwaitingReality);
}

/** 等待现实反馈的队列（叫人时展示用，最近在前） */
export function realityQueue(nodes: ProblemNode[]): { id: string; title: string; reason: string; unknown?: string }[] {
  return (nodes || [])
    .filter(isAwaitingReality)
    .sort((a, b) => (b.noteUpdatedAt || 0) - (a.noteUpdatedAt || 0))
    .map(n => ({
      id: n.id,
      title: n.title,
      reason: n.validationReason || '',
      unknown: n.hypothesis?.unknown,
    }));
}
