import React, { useEffect, useState } from 'react';
import { billingRequest, BillingOrder } from '../services/billingClient';
import { displayDate, useLanguage } from '../services/language';
export default function BillingAdmin() {
  const { t } = useLanguage(); const [data, setData] = useState<{ orders: (BillingOrder & { owner: string; transactionId?: string })[]; totals: { orders: number; paid: number; paidAmount: number } } | null>(null); const [error, setError] = useState('');
  const load = () => billingRequest<typeof data>('/admin/billing').then(v => { setData(v); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  return <div className="space-y-4"><div className="flex justify-between"><h3 className="font-bold">{t('支付订单', 'Payment orders')}</h3><button onClick={() => void load()} className="text-sm text-blue-300">{t('刷新', 'Refresh')}</button></div>
    <p className="text-xs text-slate-400">{t('只展示服务器核验到账的订单。商户密钥通过服务器文件配置，不在网页填写。退款首版需在商户平台处理并核对权益。', 'Paid orders require server verification. Merchant keys are configured in server files. Refunds currently require merchant-console processing and entitlement reconciliation.')}</p>
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {data && <><p>{t('订单', 'Orders')} {data.totals.orders} · {t('已支付', 'Paid')} {data.totals.paid} · ¥{(data.totals.paidAmount / 100).toFixed(2)}</p><div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr>{['用户', '订单', '金额', '状态', '创建时间'].map(v => <th key={v} className="p-2 text-left">{t(v)}</th>)}</tr></thead><tbody>{data.orders.map(o => <tr key={o.id} className="border-t border-slate-800"><td className="p-2">{o.owner}</td><td className="p-2 break-all">{o.id}<br />{o.transactionId}</td><td className="p-2">¥{(o.amount / 100).toFixed(2)}</td><td className="p-2">{o.status === 'paid' ? t('已支付', 'Paid') : t('待支付', 'Pending')}</td><td className="p-2 whitespace-nowrap">{displayDate(o.createdAt)}</td></tr>)}</tbody></table></div></>}
  </div>;
}
