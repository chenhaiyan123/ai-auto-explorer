import {
  Project, ProblemNode, Probe, RouteAnchor, ANCHOR_METHOD_LABEL, PROBE_COST_LABEL,
} from '../types';
import { PendingCall } from './iotService';
import { currentAnchor } from './routeService';

/**
 * 「现实反馈收件箱」——手机端 App 的全部内容。
 *
 * 产品判断：手机上跑不了长时探索（iOS/Android 会挂起后台 JS），
 * 但**现实反馈恰恰发生在手机上**：你在设备旁边、在跟用户聊天的现场、在外面走着。
 * 所以手机端只做一件事——把「等你给现实答案」的那几条推到你面前，回填完传回去。
 *
 * 这样同步的量极小：不传笔记全文、不传图谱、不传证据历史，
 * 只传当前卡住的那几条待办 + 回填结果。
 *
 * 本文件全是纯函数，可单测；网络部分在 inboxSync.ts。
 */

export type InboxKind = 'anchor' | 'probe' | 'device_call';

export interface InboxItem {
  /** 稳定 id：`${kind}:${sourceId}`。重复推送同一条不会产生新条目 */
  id: string;
  kind: InboxKind;
  sourceId: string;
  projectId: string;
  projectName: string;
  title: string;
  /** 要向现实问的那个问题 */
  question?: string;
  /** 需要什么数据 */
  needs?: string;
  /** 判定标准——**事前写死的那一份**，手机上也要原样显示 */
  criteria: string;
  /** 补充说明：怎么拿、设备参数等 */
  detail?: string;
  createdAt: number;
}

export type Verdict = 'pass' | 'fail' | 'unclear' | 'approve' | 'reject';

export interface InboxReply {
  /** 对应 InboxItem.id */
  id: string;
  verdict: Verdict;
  summary: string;
  at: number;
}

/** 每种待办允许的判定选项（手机端按这个渲染按钮，别的一律拒绝） */
export const VERDICTS: Record<InboxKind, { value: Verdict; label: string; tone: 'good' | 'bad' | 'muted' }[]> = {
  anchor: [
    { value: 'pass', label: '通过', tone: 'good' },
    { value: 'fail', label: '未通过', tone: 'bad' },
    { value: 'unclear', label: '还判不了', tone: 'muted' },
  ],
  probe: [
    { value: 'pass', label: '支持假设', tone: 'good' },
    { value: 'fail', label: '反对假设', tone: 'bad' },
    { value: 'unclear', label: '没测出来', tone: 'muted' },
  ],
  device_call: [
    { value: 'approve', label: '确认执行', tone: 'good' },
    { value: 'reject', label: '拒绝', tone: 'bad' },
  ],
};

export const KIND_LABEL: Record<InboxKind, string> = {
  anchor: '路标待验证',
  probe: '待执行验证',
  device_call: '设备写操作待确认',
};

const trim = (s: unknown, n = 300) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

/**
 * 从当前状态算出「该推到手机上的待办」。
 *
 * 只收三类，因为只有这三类是**离开电脑才能解决**的：
 * 1. 卡在等现实的路标；
 * 2. 还没执行的探针（人工型；设备型在电脑上自动跑，不占用手机）；
 * 3. 被拦下等人确认的设备写操作。
 */
export function buildInbox(
  projects: Project[],
  pendingCalls: PendingCall[] = [],
  now = Date.now(),
): InboxItem[] {
  const items: InboxItem[] = [];

  for (const p of projects || []) {
    const nodes: ProblemNode[] = p.nodes || [];

    // ① 卡在等现实的路标（只推当前那个，后面的还没到，推了只会干扰）
    const cur = currentAnchor(p.route);
    if (cur && cur.status === 'waiting') {
      items.push({
        id: `anchor:${cur.id}`,
        kind: 'anchor',
        sourceId: cur.id,
        projectId: p.id,
        projectName: p.name,
        title: cur.title,
        question: cur.question,
        needs: cur.needs,
        criteria: `通过：${cur.passIf}\n不通过：${cur.failIf}`,
        detail: `${ANCHOR_METHOD_LABEL[cur.method]}：${cur.methodDetail}`,
        createdAt: cur.reachedAt || now,
      });
    }

    // ② 待执行的人工探针（设备型在电脑上自动跑，不用麻烦人）
    for (const pr of (p.probes || []) as Probe[]) {
      if (pr.status !== 'draft' && pr.status !== 'running') continue;
      if (pr.kind === 'device') continue;
      const node = nodes.find(n => n.id === pr.nodeId);
      items.push({
        id: `probe:${pr.id}`,
        kind: 'probe',
        sourceId: pr.id,
        projectId: p.id,
        projectName: p.name,
        title: node?.title || pr.hypothesis.slice(0, 20) || '验证方案',
        question: pr.hypothesis,
        needs: pr.method,
        criteria: pr.expectedSignal,
        detail: `成本${PROBE_COST_LABEL[pr.cost]}${pr.effort ? ` · ${pr.effort}` : ''}`,
        createdAt: pr.createdAt,
      });
    }
  }

  // ③ 被安全闸拦下、等人确认的设备写操作
  for (const pc of pendingCalls || []) {
    const params = Object.entries(pc.params || {}).map(([k, v]) => `${k}=${v}`).join('  ');
    items.push({
      id: `device_call:${pc.id}`,
      kind: 'device_call',
      sourceId: pc.id,
      projectId: '',
      projectName: pc.deviceName,
      title: `${pc.deviceName} · ${pc.actionName}`,
      question: '这个操作会真的改变物理世界，确认执行吗？',
      needs: params || '（无参数）',
      criteria: pc.reason,
      detail: `由 ${pc.source === 'ai' ? 'AI 探索' : pc.source === 'probe' ? '设备实验' : pc.source} 发起`,
      createdAt: pc.createdAt,
    });
  }

  // 最近的排前面：手机上第一屏就该是最新卡住的那条
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

/** 判定值对这种待办是否合法（手机端和电脑端都要校验，别信传过来的字符串） */
export const isValidVerdict = (kind: InboxKind, v: unknown): v is Verdict =>
  (VERDICTS[kind] || []).some(o => o.value === v);

/** 从 id 反解出类型与源 id */
export function parseItemId(id: string): { kind: InboxKind; sourceId: string } | null {
  const i = String(id || '').indexOf(':');
  if (i <= 0) return null;
  const kind = id.slice(0, i) as InboxKind;
  const sourceId = id.slice(i + 1);
  if (!sourceId || !(kind in KIND_LABEL)) return null;
  return { kind, sourceId };
}

/**
 * 清洗一批回填：丢掉认不出的、判定非法的、正文为空的；同一条只保留最新的一份。
 *
 * 为什么要去重：后端是内存态，客户端会**重复发送直到收到 ack**，
 * 所以同一条回填到达多次是常态，不是异常。
 */
export function normalizeReplies(raw: any[], now = Date.now()): InboxReply[] {
  const byId = new Map<string, InboxReply>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const parsed = parseItemId(r?.id);
    if (!parsed) continue;
    if (!isValidVerdict(parsed.kind, r?.verdict)) continue;
    // device_call 的拒绝不需要写理由，其余必须有正文——没有正文的"通过"等于没验证
    const summary = trim(r?.summary, 500);
    if (!summary && !(parsed.kind === 'device_call')) continue;
    const at = Number.isFinite(r?.at) ? Number(r.at) : now;
    const prev = byId.get(r.id);
    if (!prev || at >= prev.at) byId.set(r.id, { id: r.id, verdict: r.verdict, summary, at });
  }
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

/** 待办有没有实质变化（避免没变化也一直往后端推，白烧 FC 调用） */
export function inboxDigest(items: InboxItem[]): string {
  return items.map(i => `${i.id}@${i.createdAt}`).sort().join('|');
}
