const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean> }).env;
export const SHARED_API = String(env?.VITE_WAKE_API || '').replace(/\/+$/, '');
export const SHARED_MODELS_CHANGED = 'hiexplore-shared-models-changed';
export interface SharedModel { id: string; label: string; provider: string; baseUrl: string; model: string; hasKey: boolean; enabled: boolean; dailyTokens: number; maxOutputTokens: number; usedToday: number }
export interface TokenBalance { granted: number; available: number; spent: number; held: number }
export interface SharedCall { id: string; owner: string; modelId: string; reserved: number; charged?: number; status: string; at: number; error?: string; note?: string; overrun?: boolean }
export interface SharedCatalog { models: SharedModel[]; balances: Record<string, TokenBalance>; calls: SharedCall[]; accounts?: { owner: string; balances: Record<string, TokenBalance> }[]; grants?: { id: string; owner: string; modelId: string; tokens: number; note: string; at: number }[] }
export async function sharedRequest<T = SharedCatalog>(path: string, method = 'GET', body?: unknown, timeoutMs = 20000): Promise<T> {
  if (!SHARED_API) throw new Error('共享模型后台尚未接入，请先使用自己的 API Key');
  const url = new URL(SHARED_API);
  const local = env?.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) throw new Error('共享模型后台地址配置无效');
  const token = local ? env?.VITE_WAKE_DEV_TOKEN : localStorage.getItem('aae-auth-token');
  if (!token) throw new Error('请先用邮箱登录，再使用共享模型');
  const response = await fetch(`${SHARED_API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json();
  if (method !== 'GET') window.dispatchEvent(new Event(SHARED_MODELS_CHANGED));
  if (!response.ok) throw new Error(data.error || `共享模型服务错误 ${response.status}`);
  return data;
}
