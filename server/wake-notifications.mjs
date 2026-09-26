import { createHash, randomBytes } from 'node:crypto';
import { judgmentSupported } from './.wake-build/runner.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
const STORE = hash('hiexplore-wake-notifications-v1');
const HOUR = 3600000;
const emailOK = value => typeof value === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && value.length <= 254;
const httpsBase = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash ? u.origin : ''; } catch { return ''; } };

// No research body, user token or credential is sent to an analytics service.
export function importantUpdates(state, since = 0) {
  if (!state || state.problemHeartbeat?.preference === 'quiet' || state.problemHeartbeat?.lifecycle === 'resolved') return [];
  const h = state.problemHeartbeat;
  const updates = (h?.updates || []).filter(u => !u.readAt && u.createdAt >= since && (
    u.category === 'action' ? h.waits.some(w => w.id === u.targetId && w.status === 'waiting' && w.contextVersion === state.contextVersion) :
    u.category === 'knowledge' ? h.judgments.some(j => j.id === u.targetId && j.status !== 'rejected' && judgmentSupported(state, j)) : false
  )).map(u => ({ id: u.id, title: u.title, body: u.body, category: u.category }));
  if (state.status === 'blocked' && state.updatedAt >= since) updates.push({ id: `blocked:${state.runs.at(-1)?.id || 'setup'}:${hash(state.reason)}`, title: '研究需要处理 / Research needs attention', body: state.reason, category: 'blocked' });
  return updates;
}

export class WakeNotifications {
  constructor(storage, env, fetcher = fetch, now = Date.now) {
    this.storage = storage; this.env = env; this.fetch = fetcher; this.now = now; this.queue = Promise.resolve();
    this.publicURL = httpsBase(env.WAKE_PUBLIC_URL || env.BILLING_PUBLIC_URL);
    this.appURL = httpsBase(env.WAKE_APP_URL || 'https://www.hiexplore.com');
    this.ready = !!(env.RESEND_API_KEY && env.MAIL_FROM && this.publicURL && this.appURL);
  }
  transaction(fn) {
    const next = this.queue.catch(() => {}).then(async () => {
      const data = await this.storage.credentials(STORE);
      data.subscriptions ||= {}; data.deliveries ||= [];
      const result = await fn(data); await this.storage.credentials(STORE, data); return result;
    });
    this.queue = next; return next;
  }
  view(owner, key) { return this.transaction(s => {
    const sub = s.subscriptions[key];
    return { ready: this.ready, enabled: !!sub?.enabled && sub.owner === owner, recipient: emailOK(owner) ? owner : '',
      lastSentAt: sub?.owner === owner ? sub.lastSentAt : undefined, error: sub?.owner === owner ? sub.error : undefined,
      minIntervalHours: 12, maxPerDay: 2 };
  }); }
  async subscribe(owner, key, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('邮件订阅选项无效');
    if (enabled && (!this.ready || !emailOK(owner))) throw new Error('邮件尚未配置，或当前登录身份不是已验证邮箱');
    return this.transaction(s => {
      const old = s.subscriptions[key];
      if (old && old.owner !== owner) throw new Error('订阅身份不匹配');
      if (!old && !enabled) return { saved: true };
      const sub = old || { owner, enabled: false, token: randomBytes(32).toString('hex'), seen: [] };
      if (enabled && !sub.enabled) { sub.since = this.now(); sub.pending = undefined; sub.error = undefined; }
      sub.enabled = enabled; if (!enabled) sub.pending = undefined;
      s.subscriptions[key] = sub; return { saved: true };
    });
  }
  unsubscribe(token) { return this.transaction(s => {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return false;
    const sub = Object.values(s.subscriptions).find(x => hash(x.token) === hash(token));
    if (!sub) return false; sub.enabled = false; sub.pending = undefined; return true;
  }); }
  async process() {
    if (!this.ready) return;
    return this.transaction(async s => {
      const now = this.now(); s.deliveries = s.deliveries.filter(d => now - d.at < 24 * HOUR);
      for (const [key, sub] of Object.entries(s.subscriptions)) {
        if (!sub.enabled) continue;
        const state = await this.storage.read(key);
        const relevant = importantUpdates(state, sub.since);
        if (sub.pending && !sub.pending.ids.every(id => relevant.some(u => u.id === id))) { sub.pending = undefined; }
        if (!sub.pending) {
          const updates = relevant.filter(u => !sub.seen.includes(u.id)).slice(0, 5);
          if (!updates.length || s.deliveries.length >= 50) continue;
          const previous = s.deliveries.filter(d => d.owner === sub.owner);
          if (previous.length >= 2 || previous.some(d => now - d.at < 12 * HOUR)) continue;
          const ids = updates.map(u => u.id); const id = hash(`${key}:${sub.token}:${ids.join(':')}`);
          const en = state.context.language === 'en';
          const unsubscribe = `${this.publicURL}/notifications/unsubscribe?token=${sub.token}`;
          const body = { from: this.env.MAIL_FROM, to: [sub.owner],
            subject: en ? 'HiExplore · Your research needs attention' : 'HiExplore · 你关注的问题有重要变化',
            text: `${state.context.question.slice(0, 300)}\n\n${updates.map(u => `${u.title}\n${u.body.slice(0, 1000)}`).join('\n\n')}\n\n${en ? 'Interpretations may still need review. Open Project overview to inspect evidence and respond.' : '判断可能仍待审核。请进入项目总览核对证据、查看前后变化或回复待办。'}\n${this.appURL}\n\n${en ? 'You opted in to important updates. Unsubscribe:' : '你已订阅此问题的重要变化。退订：'}\n${unsubscribe}`,
            headers: { 'List-Unsubscribe': `<${unsubscribe}>` } };
          sub.pending = { id, ids, body, createdAt: now, attempts: 0, nextAttemptAt: now };
          sub.seen.push(...ids); s.deliveries.push({ owner: sub.owner, at: now, id });
          // Persist both the fixed payload and delivery key BEFORE contacting the provider.
          await this.storage.credentials(STORE, s);
        }
        const job = sub.pending;
        if (job.nextAttemptAt > now) continue;
        if (now - job.createdAt > 20 * HOUR || job.attempts >= 3) {
          sub.error = '邮件结果待核对；为避免重复发送，已停止重试。'; sub.pending = undefined; continue;
        }
        job.attempts++; job.nextAttemptAt = now + 15 * 60000;
        await this.storage.credentials(STORE, s);
        try {
          const r = await this.fetch('https://api.resend.com/emails', { method: 'POST',
            headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `wake/${job.id}` },
            body: JSON.stringify(job.body), signal: AbortSignal.timeout(10000), redirect: 'error' });
          if (!r.ok) { if (r.status >= 400 && r.status < 500 && ![408, 409, 429].includes(r.status)) job.attempts = 3; throw new Error('provider'); }
          const result = await r.json(); if (typeof result.id !== 'string' || !result.id) throw new Error('missing receipt');
          sub.lastSentAt = now; sub.error = undefined; sub.pending = undefined;
        } catch { sub.error = '邮件未确认发送；将在限额内重试，站内记录不受影响。'; }
        await this.storage.credentials(STORE, s);
      }
    });
  }
}
