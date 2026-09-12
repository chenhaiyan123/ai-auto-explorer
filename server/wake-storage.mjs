import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const scopeKey = (owner, projectId, branchId, scopeId) => createHash('sha256').update(JSON.stringify([owner, projectId, branchId, scopeId])).digest('hex');
export class WakeStorage {
  constructor(dir, masterKey) { this.dir = dir; this.masterKey = masterKey; this.queues = new Map(); }
  async initialize() { await fs.mkdir(this.dir, { recursive: true, mode: 0o700 }); }
  file(key, suffix = 'json') { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('无效项目标识'); return path.join(this.dir, `${key}.${suffix}`); }
  async read(key) { try { return JSON.parse(await fs.readFile(this.file(key), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async atomic(file, data) {
    const temp = `${file}.${randomUUID()}.tmp`; const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
    const dir = await fs.open(this.dir, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
  async update(key, fn) {
    const previous = this.queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => { const state = await fn(await this.read(key)); await this.atomic(this.file(key), state); return state; });
    this.queues.set(key, next); try { return await next; } finally { if (this.queues.get(key) === next) this.queues.delete(key); }
  }
  async keys() { return (await fs.readdir(this.dir)).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(f => f.slice(0, -5)); }
  async credentials(key, value) {
    const file = this.file(key, 'sealed');
    if (value !== undefined) {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      await this.atomic(file, { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
      return;
    }
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8')); const decipher = createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(data.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data, 'base64')), decipher.final()]).toString());
    } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  }
}
