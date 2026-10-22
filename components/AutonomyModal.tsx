import React, { useState } from 'react';
import type { Project } from '../types';
import { charterLabel } from '../services/projectBrief';
import WalletTopup from './WalletTopup';
import { POLICY_LABEL, POLICY_HINT, type ModelPolicy } from '../services/modelRouter';

/**
 * 开工前最后一步：沟通完目标、方案、阶段、资源和钱之后，请用户授权 AI 自主运行。
 * 授权之后 AI 当自己是个独立的人：小事自己判断，不来打扰；只有很重要的事才叫你；
 * 你隔一两周回来看一次，它会汇报这段时间做了什么、怎么想的、卡在哪、需要你什么。
 */
const START_OPTIONS = [10, 20, 50];

const AutonomyModal: React.FC<{
  project: Project;
  onAllow: (o: { budgetCNY: number; checkInDays: number; allowJobs: boolean; modelPolicy: ModelPolicy }) => void;
  onStepByStep: () => void;
  onClose: () => void;
  onEditCharter: () => void;
}> = ({ project, onAllow, onStepByStep, onClose, onEditCharter }) => {
  const brief = project.outline?.brief;
  const suggested = brief?.startCNY || 20;
  const opts = [...new Set([...START_OPTIONS, suggested])].sort((a, b) => a - b);
  const [budget, setBudget] = useState<number>(suggested);
  const [days, setDays] = useState<number>(brief?.checkInDays === 14 ? 14 : 7);
  const [jobs, setJobs] = useState<boolean>(!!project.charter?.allowJobs);
  const [policy, setPolicy] = useState<ModelPolicy>(project.modelPolicy || 'balanced');
  const stage = brief?.stages?.[0];
  const perms = brief?.permissions?.filter(Boolean).slice(0, 4) || [];
  const charter = project.charter;
  const chip = (on: boolean) => `px-3 py-1.5 rounded-lg text-[13px] font-bold border transition-colors ${on ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-emerald-500'}`;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="允许 AI 自主运行" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-[17px] font-bold text-slate-100">⚡ 把这个项目交给我自主运行？</h2>
          <p className="text-[12px] text-slate-400 mt-1 leading-5">授权之后，我把自己当成这个项目的负责人：小事自己判断、自己做，不来打扰你；只有很重要的事（钱花完了、要花超过权限的钱、必须你在现实里拍板）才叫你。</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1.5 text-[13px] text-slate-200">
          <div><span className="text-slate-500">目标：</span>{(project.metaProblem || project.name).slice(0, 120)}</div>
          {stage && <div><span className="text-slate-500">先做第一阶段：</span>{stage.title}（约 {stage.weeks} 周）—— {stage.goal}</div>}
          {brief?.runEstimate && <div><span className="text-slate-500">大概能跑多久：</span>{brief.runEstimate}</div>}
        </section>

        <section className="space-y-2">
          <div className="text-[13px] font-semibold text-slate-200">启动资金 <span className="text-[11px] font-normal text-slate-500">建议从小做起，先让我活下来，跑出结果再加</span></div>
          <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="启动资金">
            {opts.map(v => <button key={v} role="radio" aria-checked={budget === v} onClick={() => setBudget(v)} className={chip(budget === v)}>¥{v}{v === suggested ? ' · 建议' : ''}</button>)}
          </div>
          <p className="text-[11px] text-slate-500 leading-5">这是我自主运行的花钱上限（模型 + 找人做事加起来）。花到这个数我就停下来等你，不会多花一分。钱从 AI 钱包里出：</p>
          <WalletTopup compact />
        </section>

        <section className="space-y-1.5 text-[13px] text-slate-200">
          <div className="font-semibold">前期需要你给我的权限</div>
          <ul className="text-[12px] text-slate-300 space-y-1 leading-5">
            <li>✅ 自己拆步骤、做每一步、遇到岔路自己判断（每个判断都会写进日志）</li>
            <li>✅ 联网查资料、整理、写方案</li>
            <li>{charter?.autoBuyCNY ? '✅' : '⛔'} 服务广场找人做事：{charter ? charterLabel(charter) : '还没谈过，花钱都先问你'} <button onClick={onEditCharter} className="text-blue-300 hover:underline ml-1">改</button></li>
            <li><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={jobs} onChange={e => setJobs(e.target.checked)} />允许我在服务广场接单赚钱（只接 AI 能独立做完的调研 / 写作类需求，收入进 AI 钱包）</label></li>
            {perms.map((p, i) => <li key={i}>• {p}</li>)}
          </ul>
        </section>

        <section className="space-y-2">
          <div className="text-[13px] font-semibold text-slate-200">用什么模型 <span className="text-[11px] font-normal text-slate-500">我会按活的难易自己换</span></div>
          <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="用模型的策略">
            {(['save', 'balanced', 'best'] as ModelPolicy[]).map(p => <button key={p} role="radio" aria-checked={policy === p} onClick={() => setPolicy(p)} className={chip(policy === p)}>{POLICY_LABEL[p]}</button>)}
          </div>
          <p className="text-[11px] text-slate-500 leading-5">{POLICY_HINT[policy]}。强模型更贵，启动资金花得更快。</p>
        </section>

        <section className="space-y-2">
          <div className="text-[13px] font-semibold text-slate-200">多久回来看我一次</div>
          <div className="flex gap-2">
            {[7, 14].map(d => <button key={d} onClick={() => setDays(d)} className={chip(days === d)}>{d === 7 ? '每周一次' : '两周一次'}</button>)}
          </div>
          <p className="text-[11px] text-slate-500 leading-5">你回来的时候，我会先给你一份汇报：这段时间做了什么、我是怎么想的、遇到了什么困难、需要你怎样支持。页面开着时我一直在做；关了以后靠「点亮」定时醒来推进。</p>
        </section>

        <div className="flex gap-2 flex-wrap pt-1">
          <button onClick={() => onAllow({ budgetCNY: budget, checkInDays: days, allowJobs: jobs, modelPolicy: policy })} className="flex-1 min-w-[10rem] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[14px]">⚡ 允许自主运行（¥{budget} 以内）</button>
          <button onClick={onStepByStep} className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-[13px]">先一步一步来</button>
        </div>
      </div>
    </div>
  );
};

export default AutonomyModal;
