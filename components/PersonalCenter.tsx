import React, { useEffect, useRef } from 'react';
import { t as ui } from '../services/language';

interface Props {
  name: string; email?: string; pro: boolean; model: string;
  trial?: { remaining: number; limit: number } | null;
  onClose: () => void; onBilling: () => void; onUsage: () => void;
  onSettings: () => void; onProjects: () => void; onHelp: () => void;
  onFeedback: () => void; onLogout: () => void;
  onDownload?: () => void; onAdmin?: () => void;
}

export default function PersonalCenter(p: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(p.onClose);
  close.current = p.onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const items = panel.current?.querySelectorAll<HTMLButtonElement>('button');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  const action = (fn: () => void) => () => { p.onClose(); fn(); };
  const tile = (label: string, detail: string, fn: () => void) => <button onClick={action(fn)} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-left hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-blue-400"><span className="block font-medium text-slate-100">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{detail}</span></button>;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={p.onClose}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={ui('个人中心', 'Personal center')} onClick={e => e.stopPropagation()} className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 sm:p-6 shadow-2xl outline-none">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{ui('个人中心', 'Personal center')}</h2><p className="mt-2 text-sm text-slate-200 break-all">{p.name} <span className="ml-2 rounded-full bg-blue-500/15 px-2 py-1 text-xs text-blue-300">{p.pro ? 'Pro' : 'Free'}</span></p><p className="mt-1 text-xs text-slate-400 break-all">{p.email}</p></div><button onClick={p.onClose} aria-label={ui('关闭', 'Close')} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800">✕</button></div>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tile(ui('套餐与订单', 'Plans & orders'), ui('查看 Free / Pro、支付订单与下载权益', 'View plans, payment orders and download access'), p.onBilling)}
        {tile(ui('用量与额度', 'Usage & credits'), ui('查看各模型剩余额度与使用记录', 'Check model balances and usage history'), p.onUsage)}
      </div>
      <button onClick={action(p.onSettings)} className="mt-3 w-full rounded-xl border border-slate-700 p-4 text-left hover:bg-slate-800"><span className="font-medium text-slate-100">{ui('设置', 'Settings')} <span aria-hidden="true" className="float-right text-slate-500">→</span></span><span className="mt-1 block text-xs text-slate-400">{ui('默认模型 · 自有 API · 语言 · 外观 · 通知 · 设备', 'Default model · Your API · Language · Appearance · Notifications · Devices')}</span><span className="mt-2 block text-xs text-slate-500">{ui('默认模型：', 'Default model: ')}{p.model || ui('未配置', 'Not configured')}{p.trial && ` · ${ui('体验剩余', 'Trial remaining')} ${p.trial.remaining}/${p.trial.limit}`}</span></button>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-300">
        {[[ui('项目管理', 'My projects'), p.onProjects], ...(p.onDownload ? [[ui('下载客户端', 'Download app'), p.onDownload]] : []), [ui('使用帮助', 'Help'), p.onHelp], [ui('意见反馈', 'Send feedback'), p.onFeedback]].map(([label, fn]) => <button key={label as string} className="rounded-lg p-3 text-left hover:bg-slate-800" onClick={action(fn as () => void)}>{label as string}</button>)}
      </div>
      {p.onAdmin && <button onClick={action(p.onAdmin)} className="mt-3 w-full rounded-xl border border-violet-500/30 p-3 text-left text-sm text-violet-300 hover:bg-violet-500/10">{ui('管理员后台', 'Admin console')}<span className="mt-1 block text-xs opacity-70">{ui('共享模型与 API Key · 用户额度 · 支付订单', 'Shared models & API keys · User credits · Payment orders')}</span></button>}
      <button onClick={action(p.onLogout)} className="mt-4 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10">{ui('退出登录', 'Sign out')}</button>
    </div>
  </div>;
}
