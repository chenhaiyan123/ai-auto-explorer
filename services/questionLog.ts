import { WAKE_API } from './wakeClient';
import { getDeviceId } from './llmProvider';

/**
 * 把每个项目的问题记到后台（运营看「大家在研究什么」）。登录用户带上令牌，免注册体验用户只带设备编号。
 * 每个项目、每个问题只报一次（本机记住报过的）；失败了下次打开再报，不影响使用。
 */
const KEY = 'hx-question-logged';
const read = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
let busy = false;

export async function logQuestions(projects: { id: string; name: string; metaProblem?: string }[]) {
  if (!WAKE_API || busy) return;
  const done = read();
  const todo = projects.map(p => ({ id: p.id, q: (p.metaProblem || p.name || '').trim() })).filter(p => p.q.length >= 4 && p.q !== '新项目' && done[p.id] !== p.q).slice(0, 10);
  if (!todo.length) return;
  busy = true;
  try {
    let token = ''; try { token = localStorage.getItem('aae-auth-token') || ''; } catch { /* 隐私模式 */ }
    for (const p of todo) {
      const r = await fetch(`${WAKE_API}/questions/log`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ question: p.q, projectId: p.id }), signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!r?.ok) break;
      done[p.id] = p.q;
    }
    try { localStorage.setItem(KEY, JSON.stringify(done)); } catch { /* ignore */ }
  } finally { busy = false; }
}
