/**
 * FeedbackModal - 产品内反馈入口。
 *
 * 三个设计要点：
 * 1. 类型用图标按钮而不是下拉框 —— 少一次点击，且"没看懂"这个选项会主动
 *    提示用户：卡住了也值得说一声。推广期最缺的就是这类反馈。
 * 2. 诊断上下文默认折叠但可展开查看，让用户清楚自己发了什么（不暗中收集）。
 * 3. 提交失败自动降级成预填好的 GitHub Issue 链接，按钮不会点了没反应。
 */

import React, { useMemo, useState } from 'react';
import {
  FeedbackKind, collectContext, submitFeedback, FeedbackContext,
} from '../services/feedbackService';

interface FeedbackModalProps {
  onClose: () => void;
  /** 由 App 传入的业务上下文：项目数、节点数、当前模型等 */
  extraContext?: FeedbackContext;
  /** 埋点回调 */
  onTrack?: (event: string, data?: Record<string, string | number>) => void;
}

const KINDS: { key: FeedbackKind; icon: string; label: string; placeholder: string }[] = [
  { key: 'bug', icon: '🐞', label: '有报错', placeholder: '什么操作之后出的问题？屏幕上显示了什么？' },
  { key: 'confused', icon: '😕', label: '没看懂', placeholder: '哪一步卡住了？你当时以为会发生什么？' },
  { key: 'idea', icon: '💡', label: '有建议', placeholder: '你希望它能做到什么？为什么需要这个？' },
  { key: 'other', icon: '📝', label: '其他', placeholder: '随便说，好话坏话都想听。' },
];

const FeedbackModal: React.FC<FeedbackModalProps> = ({ onClose, extraContext, onTrack }) => {
  const [kind, setKind] = useState<FeedbackKind>('confused');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [showCtx, setShowCtx] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const ctx = useMemo(() => collectContext(extraContext), [extraContext]);
  const current = KINDS.find(k => k.key === kind)!;
  const tooShort = text.trim().length < 5;

  const handleSubmit = async () => {
    if (tooShort || busy) return;
    setBusy(true); setError(null); setFallbackUrl(null);
    const r = await submitFeedback(kind, text.trim(), contact.trim(), ctx);
    setBusy(false);
    if (r.ok) {
      onTrack?.('feedback_submitted', { kind });
      setDone(true);
      return;
    }
    setError(r.error || '提交失败');
    if (r.fallbackUrl) setFallbackUrl(r.fallbackUrl);
    onTrack?.('feedback_failed', { kind, reason: r.error || 'unknown' });
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-8 text-center" onClick={e => e.stopPropagation()}>
          <div className="text-4xl mb-3">🙏</div>
          <h3 className="text-lg font-bold text-white mb-2">收到了，谢谢</h3>
          <p className="text-xs text-slate-400 leading-6">
            {contact.trim()
              ? '有需要追问的地方我会用你留的联系方式找你。'
              : '这条是匿名的，所以没法回复你。下次留个联系方式，卡住的问题我可以直接帮你看。'}
          </p>
          <button onClick={onClose} className="mt-6 w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-xl">关闭</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h3 className="font-bold text-white">说点什么</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">卡住、报错、觉得哪里蠢——都想知道</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white" title="关闭">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {KINDS.map(k => (
              <button
                key={k.key}
                onClick={() => setKind(k.key)}
                className={`py-2.5 rounded-xl border text-[11px] font-bold transition-colors ${
                  kind === k.key
                    ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="text-lg leading-6">{k.icon}</div>
                {k.label}
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={current.placeholder}
            rows={6}
            maxLength={4000}
            className="w-full bg-slate-800 border border-slate-700 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-white outline-none resize-none leading-6"
          />

          <input
            value={contact}
            onChange={e => setContact(e.target.value)}
            placeholder="邮箱或微信（选填，留了我才回得上话）"
            maxLength={200}
            className="w-full bg-slate-800 border border-slate-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
          />

          <div>
            <button onClick={() => setShowCtx(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">
              {showCtx ? '▾' : '▸'} 会一起发送 {Object.keys(ctx).length} 项运行信息（点击查看）
            </button>
            {showCtx && (
              <div className="mt-2 bg-black/40 border border-slate-800 rounded-lg p-3 text-[10px] font-mono text-slate-400 space-y-1">
                {Object.entries(ctx).map(([k, v]) => (
                  <div key={k}><span className="text-slate-600">{k}:</span> {String(v)}</div>
                ))}
                <div className="pt-1 text-slate-600">不包含你的笔记内容和 API Key。</div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-[11px] text-amber-300 leading-6">
              {error}
              {fallbackUrl && (
                <>
                  {' '}反馈通道暂时不可用，可以
                  <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="underline font-bold mx-1">去 GitHub 提一条</a>
                  （内容已帮你填好）。
                </>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-800 flex items-center gap-3">
          <button onClick={onClose} className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-bold">取消</button>
          <button
            onClick={handleSubmit}
            disabled={tooShort || busy}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold py-3 rounded-xl text-sm transition-colors"
          >
            {busy ? '提交中…' : tooShort ? '再多写几个字' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
