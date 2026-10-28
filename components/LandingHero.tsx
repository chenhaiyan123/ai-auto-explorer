import React from 'react';
import { t as ui } from '../services/language';

/**
 * 落地页首屏：一眼看懂这是什么。
 * 一句话：为每一个值得的问题，养一个会自己成长的 AI 生命体——长期探索、自我迭代、连接真实世界做成闭环、替你省注意力。
 */
const PILLARS = [
  { icon: '🌱', title: ['一个问题，一个生命体', 'One question, one living agent'], text: ['它有自己的目标、记忆和钱包，做得越久越懂这个领域，攒下别的 AI 没有的经验和数据', 'Its own goal, memory and wallet. The longer it works, the more it knows — experience and data no other AI has'] },
  { icon: '🔁', title: ['长期探索，自我迭代', 'Explores for the long haul'], text: ['自己拆步骤、找证据；被事实推翻就改方向。你关掉网页，它还在跑', 'Plans its own steps and gathers evidence; changes course when facts say so. Keeps going after you close the tab'] },
  { icon: '🤝', title: ['连接真实世界，做成闭环', 'Closes the loop in the real world'], text: ['AI 做不到的事，就发问卷、挂预售页、去服务广场找人下单；有本事了也能接单赚钱', 'What AI can\'t do, it gets done: surveys, pre-sale pages, hiring help in the marketplace — and taking jobs once it\'s good at something'] },
  { icon: '🧘', title: ['替你省注意力', 'Saves your attention'], text: ['小事自己拿主意，定期告诉你做成了什么、你成长了什么，只在真正重要时找你', 'Handles small decisions itself, reports progress on a schedule, and only interrupts you when it matters'] },
];
const FLOW = [['提出问题', 'Ask'], ['一起定目标和启动资金', 'Set goal & budget'], ['AI 自主探索、迭代', 'AI explores & iterates'], ['连接服务，拿到真实结果', 'Real-world results'], ['定期播报成果', 'Regular progress reports']];
const L = (pair: string[]) => ui(pair[0], pair[1]);

export default function LandingHero({ onTrial, onLogin, onMarket }: { onTrial?: () => void; onLogin: () => void; onMarket: () => void }) {
  return (
    <section className="relative overflow-hidden border-b border-slate-800/80" aria-labelledby="hero-title">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(37,99,235,0.25),transparent_70%),radial-gradient(40%_40%_at_85%_30%,rgba(16,185,129,0.12),transparent_70%)]" />
      <div className="relative max-w-5xl mx-auto px-4 pt-12 pb-10 sm:pt-20 sm:pb-14">
        <p className="text-center text-[12px] tracking-[0.2em] text-blue-300/80">HIEXPLORE · {ui('海探', 'AI EXPLORER')}</p>
        <h1 id="hero-title" className="mt-4 text-center text-[28px] leading-[1.25] sm:text-5xl sm:leading-[1.15] font-bold text-white text-balance">
          {ui('为每一个值得的问题，', 'For every question worth asking,')}<br />
          <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-emerald-300 bg-clip-text text-transparent"><span className="inline-block">{ui('养一个会自己成长的', 'raise an AI')}</span> <span className="inline-block">{ui('AI 生命体', 'that grows on its own')}</span></span>
        </h1>
        <p className="mt-5 max-w-2xl mx-auto text-center text-[14px] sm:text-[16px] leading-7 text-slate-300">
          {ui('它记住你的目标，长期探索、自我迭代；碰到 AI 做不到的事，就连接真实世界的服务——发问卷、做预售页、找人接单——把问题做成闭环。你不用一直盯着，它会定期告诉你做成了什么。',
            'It remembers your goal, explores and improves over time, and when AI alone isn\'t enough it reaches into the real world — surveys, pre-sale pages, hiring help — to close the loop. You don\'t have to watch; it tells you what got done.')}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          {onTrial && <button onClick={onTrial} className="px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-600/30 transition-colors">{ui('🎁 免注册，直接开始', '🎁 Start free, no sign-up')}</button>}
          <button onClick={onLogin} className="px-6 py-3.5 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-100 font-semibold">{ui('邮箱登录，长期保存', 'Log in to keep your work')}</button>
          <button onClick={onMarket} className="px-4 py-3 text-[14px] text-sky-300 hover:text-sky-200">{ui('逛逛服务广场 →', 'Browse the marketplace →')}</button>
        </div>

        <ol className="mt-10 flex flex-wrap justify-center gap-x-1 gap-y-2 text-[12px] sm:text-[13px]" aria-label={ui('怎么运作', 'How it works')}>
          {FLOW.map((f, i) => (
            <li key={i} className="flex items-center gap-1">
              <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-slate-300"><span className="text-blue-400 mr-1 tabular-nums">{i + 1}</span>{L(f)}</span>
              {i < FLOW.length - 1 && <span aria-hidden className="text-slate-600">→</span>}
            </li>
          ))}
        </ol>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PILLARS.map(p => (
            <div key={p.icon} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-2xl" aria-hidden>{p.icon}</div>
              <h2 className="mt-2 text-[15px] font-semibold text-slate-100">{L(p.title)}</h2>
              <p className="mt-1.5 text-[12.5px] leading-6 text-slate-400">{L(p.text)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
