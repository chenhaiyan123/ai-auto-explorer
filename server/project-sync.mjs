import path from 'node:path';
import { createHash } from 'node:crypto';
import { WakeStorage } from './wake-storage.mjs';

export const MAX_WORKSPACE_BYTES = 12 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
// Project documents never carry device credentials. Also reject prototype keys.
const privateField = /^(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|private[_-]?key|credentialId|credentials|__proto__|constructor|prototype)$/i;
export function cleanProjects(projects) {
  if (!Array.isArray(projects) || projects.length > 200) throw fail('项目同步最多支持 200 个项目');
  const ids = new Set();
  for (const p of projects) {
    if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 160 || ids.has(p.id) || typeof p.name !== 'string' || typeof p.metaProblem !== 'string' || !Array.isArray(p.nodes)) throw fail('项目数据格式无效或 ID 重复');
    ids.add(p.id);
  }
  let count = 0;
  const clean = (v, depth = 0) => {
    if (++count > 600000 || depth > 80) throw fail('项目内容过大或嵌套过深', 413);
    if (Array.isArray(v)) return v.map(x => clean(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !privateField.test(k)).map(([k, x]) => [k, clean(x, depth + 1)]));
    return v;
  };
  const result = clean(projects);
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_WORKSPACE_BYTES) throw fail('项目同步内容超过 12 MB', 413);
  return result;
}

export async function readWorkspaceBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_WORKSPACE_BYTES) throw fail('项目同步请求超过 12 MB', 413);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class ProjectSync {
  constructor(root, masterKey) {
    this.storage = new WakeStorage(path.join(root, 'project-sync'), masterKey);
    this.queues = new Map();
  }
  initialize() { return this.storage.initialize(); }
  key(owner) { return createHash('sha256').update(`workspace:${owner}`).digest('hex'); }
  async read(owner) {
    const value = await this.storage.credentials(this.key(owner));
    return value.current || { revision: 0, projects: [], updatedAt: null };
  }
  async write(owner, input) {
    if (!Number.isSafeInteger(input?.revision) || input.revision < 0) throw fail('同步版本无效');
    const projects = cleanProjects(input.projects);
    const key = this.key(owner);
    const next = (this.queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      const saved = await this.storage.credentials(key);
      const current = saved.current || { revision: 0, projects: [], updatedAt: null };
      if (current.revision !== input.revision) throw fail('另一台设备已更新项目，请重新同步', 409);
      const value = { revision: current.revision + 1, projects, updatedAt: Date.now() };
      // Keep one encrypted recovery snapshot in the same atomic write.
      await this.storage.credentials(key, { current: value, previous: current });
      return value;
    });
    this.queues.set(key, next);
    try { return await next; } finally { if (this.queues.get(key) === next) this.queues.delete(key); }
  }
}
