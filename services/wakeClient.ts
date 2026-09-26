import { getLanguage } from './language';
import type { Project } from '../types';
import { managerScope } from './projectManager';
import { profilesOf } from './agentProfiles';
import type { Awakening, WakeContext } from './awakening';

// Operator-controlled endpoint only. A user-entered endpoint must never receive the site's login token.
const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean> }).env;
export const WAKE_API = String(env?.VITE_WAKE_API || '').replace(/\/+$/, '');
export type WakeReply = { state: Awakening | null; models: Record<string, { provider: string; model: string; baseUrl: string }>; testMode: boolean; starterTokens?: number; notifications?: { ready: boolean; enabled: boolean; recipient: string; lastSentAt?: number; error?: string; minIntervalHours: number; maxPerDay: number } };
export function projectWakeContext(project: Project, scopeId: string): WakeContext {
  const { question, background, workspace } = managerScope(project, scopeId);
  return { projectId: project.id, branchId: project.worktree?.activeBranchId || 'main', scopeId, question, background, language: getLanguage(),
    facts: workspace.facts.map(({ id, claim, source, excerpt, scope, status, reviews }) => ({ id, claim, source, excerpt, scope, status: status === 'confirmed' && !reviews.some(r => r.actor === 'human' && r.decision === 'confirmed') ? 'pending' : status })),
    agents: Object.fromEntries(Object.entries(profilesOf(workspace)).map(([role, agent]) => [role, { name: agent.name, description: agent.description, model: { provider: 'default', baseUrl: '', model: '' } }])) };
}
export async function wakeRequest<T = WakeReply>(context: Pick<WakeContext, 'projectId' | 'branchId' | 'scopeId'>, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  if (!WAKE_API) throw new Error('云端执行器尚未部署接入');
  const url = new URL(WAKE_API);
  const local = env?.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('云端执行器必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('云端地址配置无效');
  const token = local ? env?.VITE_WAKE_DEV_TOKEN : localStorage.getItem('aae-auth-token');
  if (!token) throw new Error(local ? '本机测试需要独立开发令牌' : '请先登录后连接云端研究');
  const query = new URLSearchParams({ projectId: context.projectId, branchId: context.branchId, scopeId: context.scopeId });
  const response = await fetch(`${WAKE_API}${path}?${query}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal || AbortSignal.timeout(20000), redirect: 'error' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `云端请求失败 HTTP ${response.status}`);
  return data;
}
export async function assertBrowserResearchAllowed(project: Project, scopeId: string) {
  if (!WAKE_API || (!env?.VITE_WAKE_DEV_TOKEN && !localStorage.getItem('aae-auth-token'))) return;
  const { state } = await wakeRequest(projectWakeContext(project, scopeId), '/state');
  if (state?.policy.enabled || state?.activeRunId) throw new Error('此问题已交给云端研究，请先在项目总览暂停云端并等待当前步骤结束，再启动浏览器团队');
}
export async function pauseCloudProject(project: Project) {
  if (!WAKE_API || (!env?.VITE_WAKE_DEV_TOKEN && !localStorage.getItem('aae-auth-token'))) return;
  await wakeRequest(projectWakeContext(project, 'root'), '/pause-project', 'POST', {});
}
