/**
 * 大容量本地存储（IndexedDB KV）。
 * 项目/笔记数据会越攒越大，localStorage 只有 ~5MB，超了会抛 QuotaExceededError 让页面崩溃。
 * IndexedDB 容量通常是磁盘可用空间的一大部分（几百 MB 起步），适合存这些数据。
 * 提供 localStorage 兜底，并支持从旧的 localStorage 数据自动迁移。
 */

const DB_NAME = 'hiexplore';
const STORE = 'kv';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-indexeddb')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 读取（IDB 失败时回退 localStorage 里的 JSON） */
export async function idbGet<T = any>(key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      tx.onsuccess = () => resolve(tx.result as T);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : undefined; } catch { return undefined; }
  }
}

/** 写入（结构化克隆，无需 JSON）。IDB 不可用时回退 localStorage。 */
export async function idbSet(key: string, value: any): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { throw e instanceof Error ? e : new Error('storage failed'); }
  }
}

/**
 * 取数据：优先 IDB；若 IDB 为空但 localStorage 有旧数据，则迁移过去并清掉旧的（释放 localStorage 空间）。
 */
export async function getWithMigration<T = any>(key: string): Promise<T | undefined> {
  const fromIdb = await idbGet<T>(key);
  if (fromIdb !== undefined && fromIdb !== null) return fromIdb;
  // 迁移旧 localStorage 数据
  try {
    const s = localStorage.getItem(key);
    if (s) {
      const parsed = JSON.parse(s) as T;
      await idbSet(key, parsed);
      try { localStorage.removeItem(key); } catch {}
      return parsed;
    }
  } catch {}
  return undefined;
}
