import React, { useEffect, useRef, useState } from 'react';
import { auth, hasPasswordLogin } from '../services/authService';
import { t as ui } from '../services/language';
import WalletTopup from './WalletTopup';

interface Props {
  name: string; email?: string; pro: boolean; model: string;
  trial?: { remaining: number; limit: number } | null;
  onClose: () => void; onBilling: () => void; onUsage: () => void;
  onSettings: () => void; onProjects: () => void; onHelp: () => void;
  onFeedback: () => void; onLogout: () => void;
  onDownload?: () => void; onAdmin?: () => void;
  onSync?: () => void; syncStatus?: string;
  /** 项目 id → 名字（显示每个项目钱包里有多少钱） */
  projectNames?: Record<string, string>;
}

/** 登录密码：设了以后用「邮箱 + 密码」直接登录，不用每次收验证码 */
function PasswordSetting() {
  const [st, setSt] = useState<{ hasPassword: boolean; setAt: number | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { auth.passwordStatus().then(setSt).catch(() => setSt(null)); }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('');
    if (pw !== pw2) { setMsg(ui('两次输入的密码不一样', 'Passwords do not match')); return; }
    setBusy(true);
    try { await auth.setPassword(pw); setSt({ hasPassword: true, setAt: Date.now() }); setOpen(false); setPw(''); setPw2(''); setMsg(ui('设好了，下次可以用「邮箱 + 密码」直接登录', 'Saved. Next time sign in with email + password.')); try { localStorage.setItem('hx-login-mode', 'password'); } catch {} }
    catch (err) { setMsg(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return (
    <section className="mt-4 rounded-xl border border-slate-700 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-100">{ui('登录密码', 'Password')}</span>
        <span className="text-xs text-slate-500">{st ? (st.hasPassword ? ui('已设置 · 可以用邮箱 + 密码直接登录', 'Set · sign in with email + password') : ui('没设置 · 现在每次都要收验证码', 'Not set · you need an email code each time')) : ''}</span>
        <button onClick={() => setOpen(v => !v)} className="ml-auto text-xs text-blue-300 hover:underline">{open ? ui('收起', 'Close') : st?.hasPassword ? ui('修改', 'Change') : ui('设置密码', 'Set password')}</button>
      </div>
      {open && (
        <form onSubmit={save} className="mt-3 space-y-2">
          <input type="password" autoComplete="new-password" aria-label={ui('新密码', 'New password')} placeholder={ui('新密码（8 位以上，字母加数字）', 'New password (8+ chars, letters and numbers)')} value={pw} onChange={e => setPw(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none" />
          <input type="password" autoComplete="new-password" aria-label={ui('再输一次', 'Repeat password')} placeholder={ui('再输一次', 'Repeat password')} value={pw2} onChange={e => setPw2(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none" />
          <button type="submit" disabled={busy || pw.length < 8} className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-50">{busy ? ui('正在保存…', 'Saving…') : ui('保存密码', 'Save password')}</button>
          {st?.hasPassword && <p className="text-[11px] text-slate-500">{ui('改了密码以后，别的设备上用旧密码登录的会被退出', 'Changing it signs out other password sessions')}</p>}
        </form>
      )}
      {msg && <p role="status" className="mt-2 text-xs text-emerald-300">{msg}</p>}
    </section>
  );
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
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{ui('个人中心', 'Personal center')}</h2><p className="mt-2 text-sm text-slate-200 break-all">{p.name}</p><p className="mt-1 text-xs text-slate-400 break-all">{p.email}</p></div><button onClick={p.onClose} aria-label={ui('关闭', 'Close')} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800">✕</button></div>
      <div className="mt-5"><h3 className="mb-2 text-sm font-semibold text-slate-200">{ui('我的钱包', 'My wallet')}</h3><WalletTopup compact projectNames={p.projectNames} />
        <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{ui('充值进用户钱包；在项目的「钱包」页把一部分放进项目钱包，那个项目的 AI 就用它自己决定怎么花、怎么赚，赚的也进项目钱包，随时能收回。', 'Top up here, then move money into a project wallet from the project page.')}</p></div>
      {p.email && hasPasswordLogin() && <PasswordSetting />}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tile(ui('充值与订单', 'Top-ups & orders'), ui('充值记录、支付订单、导出过的成果包', 'Top-ups, payment orders and exports'), p.onBilling)}
        {tile(ui('用量与额度', 'Usage & credits'), ui('查看各模型剩余额度与使用记录', 'Check model balances and usage history'), p.onUsage)}
        {p.onSync && tile(ui('项目同步', 'Project sync'), p.syncStatus || ui('同步网页与 iPhone 上的项目、笔记和事实', 'Sync web and iPhone projects, notes and facts'), p.onSync)}
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
