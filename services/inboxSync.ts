import { InboxItem, InboxReply, normalizeReplies, inboxDigest } from './inbox';

/**
 * 电脑 ↔ 手机 的最小同步层。
 *
 * ⚠️ 后端（auth-fc.mjs）跑在阿里云 FC 上，是**内存态**——冷启动会把数据清空。
 * 所以这里不假设服务端可靠，改成两条规矩来对冲：
 *
 * 1. **电脑端持续重推完整待办**（覆盖式，不是增量）。服务端被清空了，下一次推送就恢复。
 * 2. **手机端回填后本地留底，收到 ack 才删**。服务端丢了，客户端会一直重发到成功。
 *
 * 这样不需要给 FC 加任何持久化存储（也就不新增成本），代价是两端都得偶尔在线。
 *
 * 另一条硬约束：FC 按调用计费，而且这个项目吃过"客户端疯狂重试把账单打爆"的亏。
 * 所以轮询必须是自适应的——**没有待办时几乎不轮询**，见 nextPollDelay()。
 */

const API = ((import.meta as any).env?.VITE_AUTH_API || '').replace(/\/+$/, '');
const TOKEN_KEY = 'aae-auth-token';
const DEVICE_KEY = 'aae-device-id';
const OUTBOX_KEY = 'hiexplore_inbox_outbox';   // 手机端：还没被确认的回填
const LAST_PUSH_KEY = 'hiexplore_inbox_digest'; // 电脑端：上次推上去的待办指纹

export const hasSyncBackend = (): boolean => !!API;

/** 匿名设备 id：没登录时也能把手机和电脑配成一对 */
export function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) {
      d = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_KEY, d);
    }
    return d;
  } catch {
    return 'nodev';
  }
}

/** 配对码：手机上输入它就能连到同一个收件箱（没登录时用） */
export const pairCode = (): string => deviceId().slice(-8).toUpperCase();

export function setPairedDevice(code: string): boolean {
  const c = String(code || '').trim().toLowerCase();
  if (c.length < 6) return false;
  try { localStorage.setItem(DEVICE_KEY, `dev-${c}`); return true; } catch { return false; }
}

const headers = (): Record<string, string> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() };
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) h.Authorization = `Bearer ${t}`;
  } catch { /* 忽略 */ }
  return h;
};

const req = async (path: string, init?: RequestInit): Promise<any> => {
  if (!API) throw new Error('未配置同步后端');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${API}${path}`, { ...init, headers: headers(), signal: ctrl.signal });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
    return d;
  } finally {
    clearTimeout(timer);
  }
};

// ================= 电脑端 =================

/**
 * 推送待办。指纹没变就不发——这是省 FC 调用最有效的一招，
 * 因为绝大多数时间待办是不动的。
 */
export async function pushInbox(items: InboxItem[], force = false): Promise<boolean> {
  if (!API) return false;
  const digest = inboxDigest(items);
  try {
    if (!force && localStorage.getItem(LAST_PUSH_KEY) === digest) return false;
  } catch { /* 忽略 */ }
  await req('/api/inbox/push', { method: 'POST', body: JSON.stringify({ items }) });
  try { localStorage.setItem(LAST_PUSH_KEY, digest); } catch { /* 忽略 */ }
  return true;
}

/** 拉取手机回填的结果。消费完必须 ack，否则会一直重复收到。 */
export async function pullReplies(): Promise<InboxReply[]> {
  if (!API) return [];
  const d = await req('/api/inbox/replies');
  return normalizeReplies(d?.replies || []);
}

export async function ackReplies(ids: string[]): Promise<void> {
  if (!API || !ids.length) return;
  await req('/api/inbox/ack', { method: 'POST', body: JSON.stringify({ ids }) });
}

/**
 * 下一次轮询间隔。
 * 有待办才值得频繁看（手机可能随时回填）；没待办时几乎不轮询，避免空烧调用。
 */
export function nextPollDelay(pendingCount: number, consecutiveEmpty: number): number {
  if (pendingCount === 0) return 10 * 60_000;                 // 没人会回填，10 分钟看一次就够
  const base = 20_000;                                        // 有待办：20 秒
  return Math.min(base * Math.pow(2, Math.min(consecutiveEmpty, 4)), 5 * 60_000); // 一直没动静就退到 5 分钟
}

// ================= 手机端 =================

export async function fetchInbox(): Promise<InboxItem[]> {
  if (!API) return [];
  const d = await req('/api/inbox');
  return Array.isArray(d?.items) ? d.items : [];
}

const loadOutbox = (): InboxReply[] => {
  try { return normalizeReplies(JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]')); } catch { return []; }
};
const saveOutbox = (list: InboxReply[]) => {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch { /* 忽略 */ }
};

export const pendingOutbox = (): InboxReply[] => loadOutbox();

/**
 * 回填一条。先落本地再发网络——**发送失败也不丢**，
 * 下次 flushOutbox() 会重发，直到服务端确认收下。
 */
export async function submitReply(reply: InboxReply): Promise<{ sent: boolean; error?: string }> {
  const box = loadOutbox().filter(r => r.id !== reply.id);
  box.push(reply);
  saveOutbox(box);
  return flushOutbox();
}

/** 把本地攒着的回填全部发出去；服务端确认了才从本地删掉 */
export async function flushOutbox(): Promise<{ sent: boolean; error?: string }> {
  const box = loadOutbox();
  if (!box.length) return { sent: true };
  if (!API) return { sent: false, error: '未配置同步后端' };
  try {
    const d = await req('/api/inbox/reply', { method: 'POST', body: JSON.stringify({ replies: box }) });
    const accepted: string[] = Array.isArray(d?.accepted) ? d.accepted : box.map(r => r.id);
    saveOutbox(box.filter(r => !accepted.includes(r.id)));
    return { sent: true };
  } catch (e: any) {
    return { sent: false, error: e?.message || '发送失败' };
  }
}
