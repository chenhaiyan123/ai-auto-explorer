import plans from '../shared/billing-plans.json';
import { t } from './language';
const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean> }).env;
export const BILLING_API = String(env?.VITE_BILLING_API || env?.VITE_WAKE_API || '').replace(/\/+$/, '');
export const BILLING_CHANGED = 'hiexplore-billing-changed';
export { plans };
export interface BillingOrder { id: string; sku: 'pro_month' | 'export'; artifactId: string | null; title: string; amount: number; currency: string; provider: string; status: 'pending' | 'paid'; createdAt: number; expiresAt: number; paidAt?: number; checkoutUrl?: string; codeUrl?: string; queryWarning?: string }
export interface BillingAccount { plan: 'free' | 'pro'; proUntil: number; purchaseAllowed: boolean; unlocked: string[]; orders: BillingOrder[]; artifacts: { id: string; title: string; createdAt: number; unlocked: boolean }[] }
export interface BillingCatalog { salesEnabled: boolean; proSalesEnabled: boolean; salesRestricted: boolean; providers: { id: string; ready: boolean }[]; researchBenefitsReady: boolean }
export interface ReportSnapshot { title: string; abstract: string; sections: { title: string; content: string }[]; conclusions: string[]; openQuestions: string[]; references: string[] }
export async function billingRequest<T>(path: string, method = 'GET', body?: unknown, publicRequest = false): Promise<T> {
  if (!BILLING_API) throw new Error(t('支付服务尚未开放，当前不会扣款', 'Payments are not available yet. No charge will be made.'));
  const url = new URL(BILLING_API);
  const local = !!env?.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) throw new Error(t('支付服务地址无效', 'Invalid billing service URL'));
  const token = local && env?.VITE_WAKE_DEV_TOKEN ? String(env.VITE_WAKE_DEV_TOKEN) : localStorage.getItem('aae-auth-token');
  if (!publicRequest && !token) throw new Error(t('请先使用邮箱验证码登录，再购买或查询订单', 'Sign in with an email code to purchase or view orders.'));
  const r = await fetch(`${BILLING_API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(!publicRequest && token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(25000) });
  const data = await r.json(); if (!r.ok) throw Object.assign(new Error(data.error || t('支付服务暂不可用', 'Billing service unavailable')), { status: r.status });
  return data;
}
export function safeCheckoutUrl(value?: string): string | undefined {
  if (!value) return;
  try { const u = new URL(value); if (u.origin === 'https://openapi.alipay.com' && u.pathname === '/gateway.do' && !u.username && !u.password && u.searchParams.get('method') === 'alipay.trade.page.pay') return u.href; } catch {}
}
export function safeWechatCodeUrl(value?: string): string | undefined {
  if (value && /^weixin:\/\/wxpay\/bizpayurl\?[A-Za-z0-9%=&_-]{1,500}$/.test(value)) return value;
}
