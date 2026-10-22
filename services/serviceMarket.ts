import { t } from './language';
import { WAKE_API } from './wakeClient';
export interface ServiceListing {
  id: string; revision: number; title: string; providerName: string; category: string; description: string;
  inputs: string; deliverables: string; limits: string; location: string; contact?: string; unit: string;
  priceCents: number; currency: string; deliveryDays: number; published: boolean; mine: boolean;
  availability?: 'always' | 'scheduled' | 'by_appointment'; automation?: 'automatic' | 'assisted' | 'human';
  execution: 'provider_confirmed'; createdAt: number; updatedAt: number;
}
export interface ServiceContext { projectId: string; branchId: string; scopeId: string }
export interface ServiceOrder {
  id: string; revision: number; serviceId: string | null; quote: ServiceListing; side: 'buyer' | 'seller'; requestedBy: string;
  requirements: string; acceptance: string; quantity: number; totalCents: number; status: string;
  buyerContact: string; sellerContact: string; context: ServiceContext | null;
  /** external = 双方线下结算；wallet = AI 钱包担保（平台暂存，验收后放款） */
  settlement: { method: 'external' | 'wallet'; buyerReportedPaid?: boolean; sellerReportedReceived?: boolean; escrowRef?: string; escrowSettled?: boolean; settledAt?: number };
  delivery: null | { summary: string; source: string; limitation: string; at: number }; deliveryVersion: number; eventSynced: boolean;
  history: { action: string; by: string; at: number; note?: string }[]; createdAt: number; updatedAt: number;
}
export interface ServiceDemand { id: string; revision: number; title: string; requirements: string; acceptance: string; budgetCents: number; deadline: number; status: string; mine: boolean; requestedBy: string; bidCount: number; context: ServiceContext | null; orderId?: string; bids: { id: string; providerName: string; proposal: string; priceCents: number; deliveryDays: number; mine: boolean }[] }
export interface ServiceToken { id: string; name: string; expiresAt: number; revoked: boolean; context: ServiceContext | null; permissions?: string[]; maxOrderCents?: number; totalBudgetCents?: number; committedCents?: number }
export interface MarketState { /** 全站有几个服务方 / 几个在征集需求的人 */ stats?: { providers: number; requesters: number }; /** 没登录、只读浏览 */ anonymous?: boolean; walletSettlement?: boolean; settlement: 'external'; deviceControl: boolean; services: ServiceListing[]; orders: ServiceOrder[]; tokens: ServiceToken[]; demands?: ServiceDemand[] }
export type MarketRequest = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean> }).env;
/** 用某个令牌访问服务广场（AI 项目经理用自己的 Agent 令牌，权限和额度由后端按令牌卡死） */
export const marketRequestAs = (bearer: string): MarketRequest => async (path, method = 'GET', body) => {
  if (!WAKE_API) throw new Error(t('暂时无法读取在线服务', 'Live listings are temporarily unavailable'));
  const response = await fetch(`${WAKE_API}/market${path}`, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || t('服务暂不可用', 'Service unavailable')), { status: response.status });
  return data;
};
export const marketRequest: MarketRequest = async (path, method = 'GET', body) => {
  if (!WAKE_API) throw new Error(t('暂时无法读取在线服务，仍可浏览服务场景。', 'Live listings are temporarily unavailable. You can still browse service examples.'));
  const url = new URL(WAKE_API), local = !!env?.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) throw new Error(t('服务地址无效', 'Invalid service endpoint'));
  const token = local && env?.VITE_WAKE_DEV_TOKEN ? String(env.VITE_WAKE_DEV_TOKEN) : localStorage.getItem('aae-auth-token');
  // 服务广场 / 需求广场全站公开：没登录也能逛（只读），下单、接单、发布才要登录
  if (!token && !(method === 'GET' && path === '/state')) throw new Error(t('请先用邮箱验证码登录，服务与订单将保存到你的账号。', 'Sign in with an email code to save services and orders to your account.'));
  const response = await fetch(`${WAKE_API}/market${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || t('服务暂不可用', 'Service unavailable'));
  return data;
};
export const serviceCategories = () => [
  ['printing', t('打印、3D 打印与加工', 'Printing & fabrication')], ['sensing', t('传感与测量', 'Sensors & measurement')],
  ['compute', t('计算与数字服务', 'Compute & digital services')], ['lab', t('实验与检测', 'Lab & testing')],
  ['human', t('人工执行', 'Human assistance')], ['other', t('其他设备服务', 'Other services')]
];
export const orderLabel = (status: string) => ({ proposed: t('待你确认', 'Needs your approval'), requested: t('待服务方接单', 'Awaiting provider'), accepted: t('已接单', 'Accepted by provider'), delivered: t('待验收', 'Awaiting acceptance'), completed: t('已验收', 'Accepted'), rejected: t('已拒绝', 'Declined'), cancelled: t('已取消', 'Cancelled') }[status] || status);
export const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export const serviceRank = (s: ServiceListing) => (s.availability === 'always' ? 4 : s.availability === 'scheduled' ? 1 : 0) + (s.automation === 'automatic' ? 32 : s.automation === 'assisted' ? 16 : 0);
export const availabilityLabel = (s: ServiceListing) => [s.automation === 'automatic' ? t('自动化服务', 'Automated') : s.automation === 'assisted' ? t('人机协作', 'Human-assisted') : t('人工执行', 'Human-operated'), s.availability === 'always' ? t('全天候受理（自报）', '24/7 intake (reported)') : s.availability === 'scheduled' ? t('固定时段', 'Scheduled hours') : t('预约服务', 'By appointment')].join(' · ');
