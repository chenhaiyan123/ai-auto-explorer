import { ProblemNode } from '../types';

/**
 * Obsidian 式双向链接工具。
 *
 * 在本项目中，每个 ProblemNode 既是「问题树节点」也是「一篇笔记」：
 *  - dependencies  → 纵向（层级 / 父子）连接
 *  - [[wikilink]]  → 横向（关联）连接，写在 fullNote / notes 文本里
 *
 * 这个模块负责把散落在笔记正文里的 [[标题]] 解析成真实的、可导航的连接，
 * 并据此计算反向链接（backlinks）、出链（outgoing）以及关联边（用于知识图谱）。
 */

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;

/** 标题归一化：去首尾空格、去末尾问号、小写，便于宽松匹配。 */
export const normalizeTitle = (s: string): string =>
  (s || '').trim().replace(/[？?]+$/u, '').toLowerCase();

/** 一段笔记里某个节点会用到的全部正文（笔记 + 背景笔记）。 */
const nodeText = (n: ProblemNode): string =>
  `${n.fullNote || ''}\n${n.notes || ''}`;

/** 从文本中提取所有 [[wikilink]] 的目标标题（保留原始书写，去重）。 */
export const extractWikiLinks = (text: string): string[] => {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    // 支持 [[标题|别名]]，取竖线前的目标
    const target = m[1].split('|')[0].trim();
    const key = normalizeTitle(target);
    if (target && !seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
  return out;
};

/** 按标题在节点集合中查找（宽松匹配，找不到返回 undefined）。 */
export const resolveNodeByTitle = (
  nodes: ProblemNode[],
  title: string
): ProblemNode | undefined => {
  const key = normalizeTitle(title);
  return nodes.find(n => normalizeTitle(n.title) === key);
};

export interface OutgoingLink {
  /** 链接里书写的目标标题 */
  title: string;
  /** 解析到的节点（若存在） */
  node?: ProblemNode;
  /** 是否还未对应到任何笔记（Obsidian 中的「未创建链接」） */
  unresolved: boolean;
}

/** 某个节点的出链：它在正文里链接到的其它笔记。 */
export const getOutgoingLinks = (
  node: ProblemNode,
  allNodes: ProblemNode[]
): OutgoingLink[] => {
  const selfKey = normalizeTitle(node.title);
  return extractWikiLinks(nodeText(node))
    .filter(t => normalizeTitle(t) !== selfKey)
    .map(title => {
      const target = resolveNodeByTitle(allNodes, title);
      return { title, node: target, unresolved: !target };
    });
};

export interface Backlink {
  node: ProblemNode;
  /** 链接出现处的一小段上下文，便于预览 */
  snippet: string;
}

/** 截取包含 [[目标]] 的一行作为预览片段。 */
const snippetFor = (text: string, targetKey: string): string => {
  const lines = (text || '').split('\n');
  for (const line of lines) {
    const links = extractWikiLinks(line).map(normalizeTitle);
    if (links.includes(targetKey)) {
      const clean = line.replace(/\[\[([^\]\n]+?)\]\]/g, (_a, b) => b.split('|')[0]).trim();
      return clean.length > 120 ? clean.slice(0, 117) + '…' : clean;
    }
  }
  return '';
};

/** 某个节点的反向链接：哪些笔记在正文里链接到了它。 */
export const getBacklinks = (
  node: ProblemNode,
  allNodes: ProblemNode[]
): Backlink[] => {
  const targetKey = normalizeTitle(node.title);
  const out: Backlink[] = [];
  for (const other of allNodes) {
    if (other.id === node.id) continue;
    const links = extractWikiLinks(nodeText(other)).map(normalizeTitle);
    if (links.includes(targetKey)) {
      out.push({ node: other, snippet: snippetFor(nodeText(other), targetKey) });
    }
  }
  return out;
};

export interface AssocEdge {
  source: string; // node id
  target: string; // node id
}

/**
 * 全图的关联（wikilink）边：source 笔记链接到 target 笔记。
 * 只保留两端都已存在的连接；自环忽略。
 */
export const buildAssocEdges = (nodes: ProblemNode[]): AssocEdge[] => {
  const edges: AssocEdge[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    for (const link of extractWikiLinks(nodeText(n))) {
      const target = resolveNodeByTitle(nodes, link);
      if (!target || target.id === n.id) continue;
      const key = `${n.id}->${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: n.id, target: target.id });
    }
  }
  return edges;
};

/** 每个节点的链接总数（出链 + 反链），用于列表里展示热度。 */
export const computeLinkCounts = (
  nodes: ProblemNode[]
): Map<string, number> => {
  const counts = new Map<string, number>();
  nodes.forEach(n => counts.set(n.id, 0));
  for (const e of buildAssocEdges(nodes)) {
    counts.set(e.source, (counts.get(e.source) || 0) + 1);
    counts.set(e.target, (counts.get(e.target) || 0) + 1);
  }
  return counts;
};
