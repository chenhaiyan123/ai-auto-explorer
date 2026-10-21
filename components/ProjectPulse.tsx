import React, { useState } from 'react';
import type { ProjectLife, PulseNote } from '../types';
import { CADENCE_OPTIONS, cadenceLabel, KIND_LABEL } from '../services/projectPulse';

/**
 * 项目总览顶部的「长期关注」卡：一行状态 + 最近记下的几条。
 * 醒来看到的东西都在这里，不进对话框。
 */
const when = (at: number, now = Date.now()) => {
  const d = at - now, abs = Math.abs(d), h = Math.round(abs / 3600_000);
  if (abs < 60_000) return '刚刚';
  const s = abs < 3600_000 ? `${Math.max(1, Math.round(abs / 60_000))} 分钟` : h < 48 ? `${h} 小时` : `${Math.round(h / 24)} 天`;
  return d >= 0 ? `${s}后` : `${s}前`;
};

const ProjectPulse: React.FC<{
  life: ProjectLife;
  waking?: boolean;
  onWakeNow: () => void;
  onCadence: (hours: number) => void;
  onToggle: (on: boolean) => void;
  onToFact: (note: PulseNote) => void;
  onDismiss: (note: PulseNote) => void;
  onOpenNote?: (title: string) => void;
  /** 花钱权限（说人话的一句）；undefined = 还没谈过 */
  charter?: string;
  onEditCharter?: () => void;
  /** 免配置体验额度下不自动醒来 */
  autoOff?: boolean;
  /** 云端长期关注（关掉电脑也会醒）。undefined = 这个部署没有云端执行器 */
  cloud?: { enabled: boolean; nextCheckAt?: number; lastSummary?: string; lastAt?: number; onSetup: () => void };
}> = ({ charter, onEditCharter, cloud, autoOff, life, waking, onWakeNow, onCadence, onToggle, onToFact, onDismiss, onOpenNote }) => {
  const [all, setAll] = useState(false);
  const notes = life.journal.filter(j => j.handled !== 'dismissed').slice().reverse();
  const shown = all ? notes : notes.slice(0, 4);
  const on = life.state === 'watching';
  return (
    <section className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`w-2 h-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-500'}`} />
        <span className="text-[13px] font-semibold text-slate-200">{on ? '长期关注中' : '已暂停关注'}</span>
        <span className="text-[12px] text-slate-400">
          {waking ? '正在醒来看一眼…' : !on ? '不会自动醒来' : autoOff ? '体验额度下不自动醒来（省额度），可以手动「现在看一眼」' : `下次醒来：${when(life.nextWakeAt)}`}
          {life.lastWakeAt && !waking ? ` · 上次 ${when(life.lastWakeAt)}：${life.lastSummary || ''}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <label className="text-slate-400 flex items-center gap-1.5">节奏
          <select value={life.cadenceHours} onChange={e => onCadence(Number(e.target.value))} disabled={!on}
            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 text-[12px]">
            {CADENCE_OPTIONS.map(h => <option key={h} value={h}>{cadenceLabel(h)}</option>)}
          </select>
        </label>
        <button onClick={onWakeNow} disabled={waking || !on} className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40">现在看一眼</button>
        <button onClick={() => onToggle(!on)} className="px-2 py-0.5 rounded text-slate-500 hover:text-slate-300">{on ? '暂停关注' : '恢复关注'}</button>
        <span className="text-[11px] text-slate-500 ml-auto">没新东西会自动放慢；很久没打开也会放慢</span>
      </div>
      {cloud && (cloud.enabled ? (
        <div className="text-[12px] text-emerald-300/90 flex flex-wrap gap-x-2">
          <span>☁️ 已交给云端：关掉电脑也会按时醒来，并联网查论文和网页线索</span>
          {cloud.nextCheckAt ? <span className="text-slate-400">下次 {when(cloud.nextCheckAt)}</span> : null}
          {cloud.lastSummary ? <span className="text-slate-400">· 上次：{cloud.lastSummary}</span> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <span className="text-slate-400">现在只在这个页面开着时醒来。</span>
          <button onClick={cloud.onSetup} className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white">交给云端（关掉电脑也继续）</button>
        </div>
      ))}
      {onEditCharter && (
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <span className="text-slate-400">💰 花钱权限：{charter || '还没谈过（花钱都会先问你）'}</span>
          <button onClick={onEditCharter} className="text-blue-300 hover:underline">{charter ? '改' : '现在谈'}</button>
        </div>
      )}
      {notes.length === 0 ? (
        <p className="text-[12px] text-slate-500">还没记下什么。醒来时想到的灵感、线索、可以找的证据会记在这里，不会刷到对话框里。</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map(n => (
            <li key={n.id} className="text-[12px] leading-5 group">
              <div className="flex items-start gap-1.5">
                <span title={KIND_LABEL[n.kind].label}>{KIND_LABEL[n.kind].icon}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-slate-200 font-medium">{n.title}</span>
                  {n.detail && <span className="text-slate-400"> —— {n.detail}</span>}
                  {n.url && <a href={n.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-300 hover:underline" title={n.url}>↗ {n.site || '出处'}</a>}
                  {n.relatedTitle && onOpenNote && <button onClick={() => onOpenNote(n.relatedTitle!)} className="ml-1 text-blue-300 hover:underline">[[{n.relatedTitle}]]</button>}
                  <span className="text-slate-600 ml-1.5">{when(n.at)}</span>
                </div>
                <div className="flex gap-1 flex-shrink-0 opacity-60 group-hover:opacity-100">
                  {n.handled === 'fact' ? <span className="text-[11px] text-emerald-300">已进事实看板</span> : (n.kind === 'clue' || n.kind === 'evidence') && (
                    <button onClick={() => onToFact(n)} className="text-[11px] text-blue-300 hover:underline" title="记成一条待验证的事实">记为待验证</button>
                  )}
                  <button onClick={() => onDismiss(n)} className="text-[11px] text-slate-500 hover:text-slate-300" title="不相关，划掉">✕</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 4 && <button onClick={() => setAll(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">{all ? '收起' : `查看全部 ${notes.length} 条`}</button>}
    </section>
  );
};

export default ProjectPulse;
