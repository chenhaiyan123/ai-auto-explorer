import React, { useState } from 'react';
import { Outline } from '../types';
import {
  keptItems, droppedItems, editItem, dropItem, restoreItem,
  addItem, moveItem, setStart, setUserNote, MAX_ITEMS,
} from '../services/outline';

/**
 * 框架对齐界面：开始写之前，先跟用户把「打算写哪几篇」定下来。
 *
 * 这一屏的设计目标只有一个——**让人愿意改它**。所以：
 * - 每条只有一行标题 + 一句「要回答什么」，整屏三十秒能看完；
 * - 改标题是直接点进去改，不是「编辑→弹窗→保存」；
 * - 「不关心」不是删除，是划掉，随时能撤销——这样用户敢下手；
 * - 最后一步是「先从哪篇开始」，这是「一篇一篇写」的起点。
 *
 * 这一屏不调模型、不生成任何正文。确认之前，一个字都不会写。
 */

const Row: React.FC<{
  index: number;
  title: string;
  question: string;
  why?: string;
  byUser?: boolean;
  isStart: boolean;
  canUp: boolean;
  canDown: boolean;
  onEdit: (patch: { title?: string; question?: string }) => void;
  onDrop: () => void;
  onMove: (dir: -1 | 1) => void;
  onStart: () => void;
}> = ({ index, title, question, why, byUser, isStart, canUp, canDown, onEdit, onDrop, onMove, onStart }) => (
  <div className={`rounded-xl border p-3 transition-colors ${
    isStart ? 'border-blue-500/50 bg-blue-950/20' : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
  }`}>
    <div className="flex items-start gap-2">
      <span className="text-[11px] font-mono text-slate-500 mt-1.5 w-4 flex-shrink-0">{index + 1}</span>
      <div className="flex-1 min-w-0">
        {/* 直接点进去改，不做「编辑模式」——多一次点击，用户就懒得改了 */}
        <input
          value={title}
          onChange={e => onEdit({ title: e.target.value })}
          className="w-full bg-transparent text-[14px] font-bold text-slate-100 outline-none focus:bg-slate-800/60 rounded px-1 -ml-1"
          placeholder="这一篇叫什么"
        />
        <input
          value={question}
          onChange={e => onEdit({ question: e.target.value })}
          className="w-full bg-transparent text-[11px] text-slate-400 outline-none focus:bg-slate-800/60 rounded px-1 -ml-1 mt-0.5"
          placeholder="这一篇要回答的那一个问题"
        />
        {why && <div className="text-[10px] text-slate-600 mt-1 px-1">{why}</div>}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {byUser && <span className="text-[9px] text-emerald-400/80 mr-1">你加的</span>}
        <button onClick={() => onMove(-1)} disabled={!canUp} title="上移"
          className="w-6 h-6 rounded text-slate-500 hover:text-white hover:bg-slate-700 disabled:opacity-20 disabled:hover:bg-transparent text-[11px]">↑</button>
        <button onClick={() => onMove(1)} disabled={!canDown} title="下移"
          className="w-6 h-6 rounded text-slate-500 hover:text-white hover:bg-slate-700 disabled:opacity-20 disabled:hover:bg-transparent text-[11px]">↓</button>
        <button onClick={onDrop} title="这条我不关心"
          className="w-6 h-6 rounded text-slate-500 hover:text-pink-400 hover:bg-slate-700 text-[11px]">✕</button>
      </div>
    </div>
    <div className="flex items-center gap-2 mt-1.5 pl-6">
      {isStart ? (
        <span className="text-[10px] text-blue-300 font-bold">▶ 从这篇开始写</span>
      ) : (
        <button onClick={onStart} className="text-[10px] text-slate-500 hover:text-blue-300 transition-colors">
          从这篇开始
        </button>
      )}
    </div>
  </div>
);

const OutlinePlanner: React.FC<{
  outline: Outline;
  onChange: (o: Outline) => void;
  /** 确认框架 → 建空壳节点，开始一篇一篇写 */
  onConfirm: () => void;
  /** 让 AI 换一版 */
  onRegenerate?: () => void;
  busy?: boolean;
  onDiscard?: () => void;
}> = ({ outline, onChange, onConfirm, onRegenerate, busy, onDiscard }) => {
  const [newTitle, setNewTitle] = useState('');
  const kept = keptItems(outline);
  const dropped = droppedItems(outline);
  const start = kept.find(i => i.id === outline.startId) || kept[0];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">先把要写哪几篇定下来</h2>
        <p className="text-[12px] text-slate-400 mt-1.5 leading-6">
          这一步<b className="text-slate-200">一个字正文都还没写</b>。
          先看看这几篇对不对——标题直接点进去就能改，不关心的按 ✕ 划掉，
          缺的自己加。定好之后<b className="text-slate-200">一篇一篇写</b>，写完一篇停一下再决定下一篇。
        </p>
        <p className="text-[11px] text-slate-500 mt-2">目标：{outline.goal}</p>
      </div>

      <div className="space-y-2">
        {kept.map((item, idx) => (
          <Row
            key={item.id}
            index={idx}
            title={item.title}
            question={item.question}
            why={item.why}
            byUser={item.byUser}
            isStart={start?.id === item.id}
            canUp={idx > 0}
            canDown={idx < kept.length - 1}
            onEdit={patch => onChange(editItem(outline, item.id, patch))}
            onDrop={() => onChange(dropItem(outline, item.id))}
            onMove={dir => onChange(moveItem(outline, item.id, dir))}
            onStart={() => onChange(setStart(outline, item.id))}
          />
        ))}
        {!kept.length && (
          <div className="text-[12px] text-slate-500 text-center py-6 border border-dashed border-slate-700 rounded-xl">
            全划掉了。自己加一条，或者让 AI 换一版。
          </div>
        )}
      </div>

      {/* 自己加一条 */}
      <div className="flex gap-2">
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && newTitle.trim()) { onChange(addItem(outline, newTitle)); setNewTitle(''); }
          }}
          placeholder={kept.length >= MAX_ITEMS ? `最多 ${MAX_ITEMS} 篇，先划掉一条` : '还缺一篇？写个标题按回车'}
          disabled={kept.length >= MAX_ITEMS}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[12px] text-slate-200 outline-none focus:border-blue-500/50 disabled:opacity-40"
        />
        <button
          onClick={() => { if (newTitle.trim()) { onChange(addItem(outline, newTitle)); setNewTitle(''); } }}
          disabled={!newTitle.trim() || kept.length >= MAX_ITEMS}
          className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-[12px] font-bold disabled:opacity-40"
        >＋ 加一篇</button>
      </div>

      {/* 划掉的：留着可撤销，用户才敢下手 */}
      {!!dropped.length && (
        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
          <span>先不写：</span>
          {dropped.map(i => (
            <button key={i.id} onClick={() => onChange(restoreItem(outline, i.id))}
              className="line-through hover:no-underline hover:text-slate-300 transition-colors" title="点一下加回来">
              {i.title}
            </button>
          ))}
        </div>
      )}

      {/*
        用户补的这一句会带进后面每一篇的提示词。
        这是「认知同步」最便宜的一个入口：他脑子里有而框架里没有的东西，在这里说一次，
        后面每一篇都能用上，不用每篇都重新解释一遍。
      */}
      <div>
        <label className="text-[11px] text-slate-400">还有什么是我该知道的？（会带进后面每一篇）</label>
        <textarea
          value={outline.userNote || ''}
          onChange={e => onChange(setUserNote(outline, e.target.value))}
          rows={2}
          placeholder="例：这个项目的读者是没有技术背景的投资人；例：预算只有两万，别提需要自建机房的方案"
          className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[12px] text-slate-200 outline-none focus:border-blue-500/50 resize-none leading-6"
        />
      </div>

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={onConfirm}
          disabled={!kept.length || busy}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-bold disabled:opacity-40 transition-colors"
        >
          {start ? `就这样，先写《${start.title}》` : '就按这个框架开始'}
        </button>
        {onRegenerate && (
          <button onClick={onRegenerate} disabled={busy}
            className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[12px] disabled:opacity-40 transition-colors">
            {busy ? '拟稿中…' : '↻ 换一版'}
          </button>
        )}
        {onDiscard && (
          <button onClick={onDiscard} disabled={busy}
            className="px-3 py-2.5 text-slate-500 hover:text-slate-300 text-[12px] transition-colors">
            不用框架，直接开始
          </button>
        )}
        <span className="text-[11px] text-slate-600 ml-auto">共 {kept.length} 篇</span>
      </div>
    </div>
  );
};

export default OutlinePlanner;
