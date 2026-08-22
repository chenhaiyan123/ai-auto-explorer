import React, { useCallback, useEffect, useRef, useState } from 'react';
import { InboxItem, InboxReply, VERDICTS, KIND_LABEL, Verdict, parseItemId } from '../services/inbox';
import {
  fetchInbox, submitReply, flushOutbox, pendingOutbox,
  hasSyncBackend, pairCode, setPairedDevice,
} from '../services/inboxSync';
import { initNative, isNative, haptic, setBadge, toast } from '../services/native';

/**
 * 手机端「现实反馈」App。
 *
 * 它不是 HiExplore 的移动版——探索还是在电脑/云端跑。
 * 这里只回答一件事：**电脑上那条探索现在卡在哪个现实问题上，我当场给个答案。**
 *
 * 设计上刻意保留的三点：
 * 1. 判定标准原样显示，并且**在回填表单上方**——手机上更容易凭印象乱填，
 *    所以标准必须一直在视线里。
 * 2. 回填先落本地再发网络，断网也不丢；顶部会显示"N 条待发送"。
 * 3. 不做"标记已读"之类的假动作——一条待办只有给出现实答案才会消失。
 */

const TONE: Record<'good' | 'bad' | 'muted', string> = {
  good: 'bg-emerald-600 text-white',
  bad: 'bg-pink-600 text-white',
  muted: 'bg-slate-700 text-slate-200',
};

const KIND_ICON: Record<string, string> = { anchor: '📍', probe: '🔬', device_call: '⚠️' };

const ago = (t: number) => {
  const d = Date.now() - t;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 864e5) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 864e5)} 天前`;
};

const MobileInbox: React.FC<{ onExit?: () => void }> = ({ onExit }) => {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [open, setOpen] = useState<InboxItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [outbox, setOutbox] = useState(pendingOutbox().length);
  const [pairing, setPairing] = useState(false);
  const [codeInput, setCodeInput] = useState('');

  const refresh = useCallback(async () => {
    if (!hasSyncBackend()) { setError('这个部署没有配置同步后端（VITE_AUTH_API），手机端用不了。'); return; }
    setLoading(true); setError('');
    try {
      await flushOutbox();                 // 先把上次没发出去的补发掉
      setOutbox(pendingOutbox().length);
      setItems(await fetchInbox());
    } catch (e: any) {
      setError(e?.message || '拉取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 打开的详情面板用 ref 存一份，安卓返回键要靠它判断"该关面板还是该退出 App"
  const openRef = useRef<InboxItem | null>(null);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    refresh();
    // 原生壳：状态栏配色、收起启动图、接管安卓返回键
    initNative({
      onBack: () => {
        if (openRef.current) { setOpen(null); return true; }  // 先关面板
        return false;                                          // 再按一次才退出
      },
    });
    // 回到前台就刷一次；不做后台轮询——手机后台本来就会被系统挂起，白耗电还烧调用
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  // 图标角标 = 待办数，锁屏状态下也能一眼看到有没有事等着你
  useEffect(() => { setBadge(items.length); }, [items.length]);

  const send = async (item: InboxItem, verdict: Verdict, summary: string) => {
    const reply: InboxReply = { id: item.id, verdict, summary: summary.trim(), at: Date.now() };
    setItems(prev => prev.filter(x => x.id !== item.id));   // 立刻从列表消失，别让人重复填
    setOpen(null);
    haptic('medium');   // 提交是个确定性动作，给一下震动反馈
    const r = await submitReply(reply);
    setOutbox(pendingOutbox().length);
    if (r.sent) toast('已提交给电脑端');
    else setError(`已存在本地，联网后会自动补发：${r.error || ''}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center gap-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-blue-200">现实反馈</div>
          <div className="text-[11px] text-slate-500">
            {loading ? '同步中…' : `${items.length} 条等你给答案`}
            {outbox > 0 && <span className="text-amber-400"> · {outbox} 条待发送</span>}
          </div>
        </div>
        <button onClick={refresh} disabled={loading}
          className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-[12px] disabled:opacity-50">刷新</button>
        {onExit && (
          <button onClick={onExit} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-[12px]">桌面版</button>
        )}
      </header>

      {error && (
        <div className="mx-4 mt-3 text-[12px] text-amber-300 bg-amber-950/30 border border-amber-700/40 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {/* 列表 */}
      <main className="flex-1 p-4 space-y-3">
        {!items.length && !loading && (
          <div className="text-center py-16 space-y-3">
            <div className="text-4xl opacity-30">🎉</div>
            <div className="text-[13px] text-slate-400">现在没有需要你回答的现实问题</div>
            <div className="text-[11px] text-slate-600 leading-relaxed px-6">
              电脑上的探索一旦卡在某个路标、或有设备写操作等确认，就会出现在这里。
            </div>
          </div>
        )}

        {items.map(it => (
          <button key={it.id} onClick={() => setOpen(it)}
            className="w-full text-left rounded-2xl border border-slate-800 bg-slate-900/70 p-4 active:bg-slate-800 transition-colors">
            <div className="flex items-center gap-2 mb-1.5">
              <span>{KIND_ICON[it.kind]}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400">{KIND_LABEL[it.kind]}</span>
              <span className="text-[10px] text-slate-600 ml-auto">{ago(it.createdAt)}</span>
            </div>
            <div className="text-[15px] font-bold text-slate-100 leading-snug">{it.title}</div>
            {it.question && <div className="text-[12px] text-slate-400 mt-1.5 leading-relaxed line-clamp-2">{it.question}</div>}
            {it.projectName && <div className="text-[10px] text-slate-600 mt-2">{it.projectName}</div>}
          </button>
        ))}
      </main>

      {/* 配对（没登录时用设备码把手机和电脑连成一对） */}
      <footer className="p-4 border-t border-slate-800 text-center"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {!pairing ? (
          <button onClick={() => setPairing(true)} className="text-[11px] text-slate-600">
            没看到电脑上的待办？点这里输入配对码 · 本机码 {pairCode()}{isNative() ? '' : ''}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input value={codeInput} onChange={e => setCodeInput(e.target.value)}
              placeholder="电脑设置里的 8 位配对码"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-[13px] text-slate-200" />
            <button onClick={() => { if (setPairedDevice(codeInput)) { setPairing(false); refresh(); } }}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-[13px] font-bold">连接</button>
          </div>
        )}
      </footer>

      {open && <ReplySheet item={open} onCancel={() => setOpen(null)} onSubmit={send} />}
    </div>
  );
};

/** 回填面板：判定标准永远在按钮上方 */
const ReplySheet: React.FC<{
  item: InboxItem;
  onCancel: () => void;
  onSubmit: (item: InboxItem, verdict: Verdict, summary: string) => void;
}> = ({ item, onCancel, onSubmit }) => {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [summary, setSummary] = useState('');
  const kind = parseItemId(item.id)?.kind || item.kind;
  const options = VERDICTS[kind] || [];
  // 设备写操作的"拒绝"不必写理由，其余都必须写——不写等于没验证
  const needText = !(kind === 'device_call');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={onCancel}>
      <div className="w-full bg-slate-900 rounded-t-3xl border-t border-slate-700 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="sticky top-0 bg-slate-900 px-5 pt-4 pb-3 border-b border-slate-800 flex items-center gap-3">
          <div className="flex-1 text-[15px] font-bold text-slate-100">{item.title}</div>
          <button onClick={onCancel} className="text-slate-500 text-lg px-2">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {item.question && (
            <div>
              <div className="text-[10px] text-slate-600 mb-1">要回答的问题</div>
              <div className="text-[14px] text-slate-200 leading-relaxed">{item.question}</div>
            </div>
          )}
          {item.needs && (
            <div>
              <div className="text-[10px] text-slate-600 mb-1">需要的数据 / 参数</div>
              <div className="text-[13px] text-slate-300 leading-relaxed break-words">{item.needs}</div>
            </div>
          )}
          {item.detail && <div className="text-[12px] text-slate-500">{item.detail}</div>}

          <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-3">
            <div className="text-[10px] text-amber-400/90 mb-1">判定标准（出发前就定好的，别临时改）</div>
            <div className="text-[13px] text-amber-100/90 leading-relaxed whitespace-pre-line">{item.criteria}</div>
          </div>

          {needText && (
            <div>
              <div className="text-[10px] text-slate-600 mb-1.5">现实给出的结果是什么？</div>
              <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={4}
                placeholder="例：20 个用户里 17 个选了导航，只有 3 个选翻译"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-[14px] text-slate-200 resize-none" />
            </div>
          )}

          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
            {options.map(o => (
              <button key={o.value}
                onClick={() => setVerdict(o.value)}
                className={`py-3 rounded-xl text-[14px] font-bold transition-all
                  ${verdict === o.value ? TONE[o.tone] + ' ring-2 ring-white/40' : 'bg-slate-800 text-slate-400'}`}>
                {o.label}
              </button>
            ))}
          </div>

          <button
            disabled={!verdict || (needText && !summary.trim())}
            onClick={() => verdict && onSubmit(item, verdict, summary)}
            className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold text-[15px] disabled:opacity-30">
            提交给电脑端
          </button>
          <div className="text-[10px] text-slate-600 text-center">
            提交后电脑上的探索会据此继续；没网也能提交，联网后自动补发。
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileInbox;
