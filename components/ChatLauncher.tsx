import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isChatEnabled, isChatDismissed, setChatDismissed, openChat } from '../services/analytics';

/**
 * 客服聊天入口按钮（替代 Tawk 自带的右下角气泡）。
 *
 * 为什么自己做一个：Tawk 的气泡是位置写死的 iframe，既拖不动也关不掉，
 * 会一直压着界面右下角。这个按钮可以拖到任意位置、位置记住，也可以直接关掉，
 * 关掉后能在「设置」里找回来——不会变成关了就再也打不开的死胡同。
 */

const POS_KEY = 'hiexplore_chat_pos';
const SIZE = 48;
const MARGIN = 12;

type Pos = { x: number; y: number };

const clamp = (p: Pos): Pos => ({
  x: Math.max(MARGIN, Math.min(window.innerWidth - SIZE - MARGIN, p.x)),
  y: Math.max(MARGIN, Math.min(window.innerHeight - SIZE - MARGIN, p.y)),
});

const defaultPos = (): Pos => ({
  x: window.innerWidth - SIZE - 24,
  y: window.innerHeight - SIZE - 24,
});

const loadPos = (): Pos => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return clamp(p);
    }
  } catch { /* 忽略 */ }
  return defaultPos();
};

const ChatLauncher: React.FC = () => {
  const [dismissed, setDismissed] = useState(isChatDismissed());
  const [pos, setPos] = useState<Pos>(() => (typeof window === 'undefined' ? { x: 0, y: 0 } : loadPos()));
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const [tip, setTip] = useState('');
  // 拖动过就不算点击，避免"想挪一下结果把聊天窗打开了"
  const movedRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const sync = () => setDismissed(isChatDismissed());
    window.addEventListener('chat-visibility', sync);
    const onResize = () => setPos(p => clamp(p));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('chat-visibility', sync);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-close]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    offsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    movedRef.current = false;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = clamp({ x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y });
    // 位移超过 4px 才算拖动，手抖不影响点击
    if (Math.abs(next.x - pos.x) > 4 || Math.abs(next.y - pos.y) > 4) movedRef.current = true;
    setPos(next);
  };

  const finishDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* 忽略 */ }
    if (movedRef.current) return;   // 是拖动，不是点击
    if (!openChat()) {
      setTip('客服挂件还在加载，稍等一下再点');
      setTimeout(() => setTip(''), 2500);
    }
  }, [dragging, pos]);

  if (!isChatEnabled() || dismissed) return null;

  return (
    <div
      className="fixed z-[120] select-none"
      style={{ left: pos.x, top: pos.y, width: SIZE, height: SIZE, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={() => setDragging(false)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        title="联系我们（可拖动换位置）"
        className={`w-full h-full rounded-full bg-blue-600 text-white shadow-lg shadow-black/40 border border-blue-400/40
          flex items-center justify-center text-[20px] transition-transform
          ${dragging ? 'cursor-grabbing scale-105' : 'cursor-grab hover:bg-blue-500'}`}
      >
        💬
      </button>

      {(hover || dragging) && (
        <button
          data-close
          onClick={e => { e.stopPropagation(); setChatDismissed(true); setDismissed(true); }}
          title="关闭客服按钮（可在设置里找回）"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 border border-slate-600
            text-slate-300 hover:bg-red-600 hover:text-white text-[11px] leading-none flex items-center justify-center shadow"
        >
          ✕
        </button>
      )}

      {tip && (
        <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap text-[10px] px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 shadow">
          {tip}
        </div>
      )}
    </div>
  );
};

export default ChatLauncher;
