import type { Project } from '../types';
import { getWithMigration, idbSet } from './storage';

export interface CloudWorkspace { revision: number; projects: Project[]; updatedAt: number | null }
type LocalWorkspace = { version: 1; projects: Project[]; base: Record<string, string>; enabled: boolean; lastSyncedAt: number | null };
export type SyncPlan = { remote: CloudWorkspace; projects: Project[]; conflicts: string[]; local: Project[]; localDigest: string };
const records = new Map<string, LocalWorkspace>();
const queues = new Map<string, Promise<void>>();
const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean> }).env;
const key = (owner: string) => `exploration_workspace_${owner}`;
const privateField = /^(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|private[_-]?key|credentialId|credentials|__proto__|constructor|prototype)$/i;

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().filter(k => !privateField.test(k)).map(k => [k, v[k]])) : v);
}
async function hashes(projects: Project[]) {
  return Object.fromEntries(await Promise.all(projects.map(async p => [p.id, Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(p))))).map(x => x.toString(16).padStart(2, '0')).join('')])));
}
export async function mergeWorkspace(base: Record<string, string>, local: Project[], remote: Project[]) {
  const [lh, rh] = await Promise.all([hashes(local), hashes(remote)]);
  const lm = new Map(local.map(p => [p.id, p])), rm = new Map(remote.map(p => [p.id, p]));
  const projects: Project[] = [], conflicts: string[] = [];
  for (const id of new Set([...local.map(p => p.id), ...remote.map(p => p.id)])) {
    let chosen: Project | undefined;
    if (lh[id] === rh[id] || rh[id] === base[id]) chosen = lm.get(id);
    else if (lh[id] === base[id]) chosen = rm.get(id);
    else { conflicts.push(id); chosen = lm.get(id); }
    if (chosen) projects.push(chosen);
  }
  return { projects, conflicts };
}
export async function loadWorkspace(owner: string): Promise<Project[]> {
  const saved = await getWithMigration<LocalWorkspace>(key(owner));
  const record: LocalWorkspace = saved?.version === 1 && Array.isArray(saved.projects) ? saved : {
    version: 1, projects: await getWithMigration<Project[]>(`exploration_projects_${owner}`) || [], base: {}, enabled: false, lastSyncedAt: null,
  };
  records.set(owner, record);
  return record.projects;
}
export function syncSettings(owner: string) { const r = records.get(owner); return { enabled: r?.enabled || false, lastSyncedAt: r?.lastSyncedAt || null }; }
export function saveWorkspace(owner: string, projects: Project[]): Promise<void> {
  const r = records.get(owner);
  if (!r) return Promise.reject(new Error('项目尚未加载，暂不覆盖本地数据'));
  r.projects = projects;
  // Capture metadata and projects together, then serialize local commits.
  const snapshot = { ...r };
  const next = (queues.get(owner) || Promise.resolve()).catch(() => {}).then(() => idbSet(key(owner), snapshot));
  queues.set(owner, next);
  return next;
}
export async function setSyncEnabled(owner: string, enabled: boolean, projects: Project[]) {
  const r = records.get(owner); if (!r) throw new Error('项目尚未加载');
  r.enabled = enabled; await saveWorkspace(owner, projects);
}
export async function acknowledgeSync(owner: string, cloud: CloudWorkspace, projects: Project[]) {
  const r = records.get(owner); if (!r) throw new Error('项目尚未加载');
  const base = await hashes(cloud.projects);
  Object.assign(r, { base, enabled: true, lastSyncedAt: Date.now() });
  await saveWorkspace(owner, projects);
}
async function request(method: 'GET' | 'PUT', body?: unknown): Promise<CloudWorkspace> {
  const endpoint = String(env?.VITE_WAKE_API || '').trim().replace(/\/+$/, '');
  if (!endpoint) throw new Error('此版本尚未配置云同步服务');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(env?.DEV && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('同步地址必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('同步地址无效');
  const token = localStorage.getItem('aae-auth-token');
  if (!token) throw new Error('请使用邮箱验证码登录后同步');
  const response = await fetch(`${endpoint}/projects/workspace`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: canonical(body) } : {}), signal: AbortSignal.timeout(30000), redirect: 'error' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? '登录已过期，请重新登录后同步' : data.error || `同步失败 (${response.status})`);
  if (!Number.isSafeInteger(data.revision) || !Array.isArray(data.projects)) throw new Error('云端返回的项目数据无效');
  return data;
}
export async function prepareSync(owner: string, local: Project[]): Promise<SyncPlan> {
  const r = records.get(owner); if (!r) throw new Error('项目尚未加载');
  const remote = await request('GET');
  const result = await mergeWorkspace(r.base, local, remote.projects);
  return { ...result, remote, local, localDigest: canonical(local) };
}
export function resolveSync(plan: SyncPlan, choices: Record<string, 'local' | 'cloud'>): Project[] {
  const result = plan.projects.filter(p => !plan.conflicts.includes(p.id));
  for (const id of plan.conflicts) {
    if (!choices[id]) throw new Error('请为每个冲突选择保留的版本');
    const chosen = (choices[id] === 'local' ? plan.local : plan.remote.projects).find(p => p.id === id);
    if (chosen) result.push(chosen);
  }
  return result;
}
export async function publishSync(plan: SyncPlan, projects: Project[]): Promise<CloudWorkspace> {
  if (canonical(projects) === canonical(plan.remote.projects)) return plan.remote;
  return request('PUT', { revision: plan.remote.revision, projects });
}
export async function backupWorkspace(owner: string, projects: Project[]) {
  await idbSet(`${key(owner)}_before_sync`, { ...records.get(owner), at: Date.now(), projects });
}
export async function restoreWorkspaceBackup(owner: string) {
  const saved = await getWithMigration<LocalWorkspace>(`${key(owner)}_before_sync`);
  if (!saved || !Array.isArray(saved.projects)) throw new Error('此设备尚无同步前的恢复副本');
  records.set(owner, { ...saved, version: 1, enabled: false, base: saved.base || {} });
  await saveWorkspace(owner, saved.projects);
}
