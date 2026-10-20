import React from 'react';
import type { Awakening } from '../services/awakening';
import { judgmentSupported, waitEvidenceCurrent, type WaitItem, type JudgmentChange } from '../services/problemHeartbeat';
import { decisionDelta } from '../services/decisionSync';
import { useLanguage, displayDate } from '../services/language';

/** Evidence is linked explicitly, never inferred from unrelated recent activity. */
export default function DecisionSync({state, wait, judgment}: {state: Awakening; wait?: WaitItem; judgment?: JudgmentChange}) {
  const {t} = useLanguage(); const {baseline, changes} = decisionDelta(state);
  const b = wait?.decisionBrief;
  const ids = judgment?.evidenceIds || b?.evidenceIds || [];
  const current = judgment ? judgmentSupported(state, judgment) : wait ? wait.contextVersion === state.contextVersion && waitEvidenceCurrent(state, wait) : false;
  const reason = judgment?.reason || wait?.detail;
  const proposal = judgment?.after || b?.recommendation;
  const item = (x: typeof changes[number]) => <li key={x.id} className="py-1"><span className="text-slate-500">{displayDate(x.at)} · {x.kind === 'signal' ? t('线索 · 未因此核验', 'Signal · not verified by receipt') : t('AI 研究记录 · 非事实', 'AI research · not a fact')}</span><p>{x.title}</p><details><summary className="cursor-pointer text-slate-400">{t('查看原记录', 'Original record')}</summary><p className="whitespace-pre-wrap break-words">{x.detail}</p><p>{x.source}</p></details></li>;
  return <aside aria-label={t('决策前认知同步', 'Decision briefing')} className="rounded-xl border border-slate-600 bg-slate-950/70 p-4 space-y-4 text-sm">
    <h5 className="font-semibold">{t('先同步认知，再做决定', 'Catch up before deciding')}</h5>
    <p className="text-xs text-slate-400">{t('目标：', 'Goal: ')}{state.context.question}</p>
    <section><h6 className="font-medium">{t('1. 上次决策后发生了什么', '1. What changed since your decision')}</h6>
      <p className="text-xs text-slate-400">{baseline ? `${displayDate(baseline.at)} · ${baseline.title} · ${baseline.outcome === 'accepted' ? t('已同意 / 采纳', 'Approved / accepted') : t('已拒绝 / 未采纳', 'Declined / rejected')}` : t('尚无已记录的人类决策，以下为当前范围内已有记录。', 'No recorded human decision yet. Showing available records in this scope.')}</p>{baseline?.answer && <p className="text-xs text-slate-400">{baseline.answer}</p>}
      {!changes.length ? <p>{t('没有新增的线索或已结束研究记录；这不证明外界没有变化。', 'No new signals or completed research records; this does not prove nothing changed outside.')}</p> : <><ul className="text-xs">{changes.slice(0,3).map(item)}</ul>{changes.length > 3 && <details><summary className="cursor-pointer text-xs">{t(`另有 ${changes.length-3} 条记录`, `${changes.length-3} more records`)}</summary><ul>{changes.slice(3).map(item)}</ul></details>}</>}
    </section>
    <section><h6 className="font-medium">{t('2. 为什么需要你', '2. Why you are needed')}</h6><p>{reason}</p><p className="text-xs text-slate-400">{judgment ? t('这是待采纳的解释，需要你判断是否接受。', 'This interpretation needs your review before adoption.') : wait?.kind === 'permission' ? t('该行动需要明确授权；批准只限此请求。', 'This action needs explicit permission limited to this request.') : t('下一步取决于你的选择，系统正在等待。', 'The next step depends on your choice.')}</p></section>
    <section><h6 className="font-medium">{t('3. 建议怎么做', '3. Suggested next step')}</h6><p>{!current ? t('先更新依据和决策请求，暂不批准旧建议。', 'Refresh the evidence and request before approving.') : proposal || t('这条旧请求没有记录具体建议。先要求补充建议、成本与风险；不要把恢复条件当成推荐。', 'This older request has no recorded recommendation. Ask for a proposal, costs and risks first.')}</p>{proposal && current && <p className="text-xs text-amber-200">{t('这是 AI 建议，不是已验证结论。', 'This is an AI recommendation, not a verified conclusion.')}</p>}
      <p className="text-xs text-slate-400">{t('替代方案：', 'Alternative: ')}{b?.alternative || t('暂不采纳，先补充证据或缩小问题。', 'Defer adoption; obtain evidence or narrow the question.')}</p><p className="text-xs text-slate-400">{t('成本 / 风险 / 未知：', 'Cost / risk / unknowns: ')}{b?.risks || t('本条记录未完整提供，不能视为没有风险或零成本。', 'Not fully recorded. Do not assume no risk or zero cost.')}</p>
    </section>
    <section><h6 className="font-medium">{t('4. 依据 → 推理 → 建议', '4. Evidence → reasoning → proposal')}</h6>
      {!ids.length && <p className="text-amber-200">{t('没有关联已核验事实，目前无法建立完整证据链。', 'No verified facts are linked; the evidence chain is incomplete.')}</p>}
      {!current && <p className="text-amber-200">{t('依据或上下文已变化，需要重新核验。', 'Evidence or context changed; review again.')}</p>}
      {ids.map(id => {const f=state.context.facts.find(x=>x.id===id);return <details key={id} className="py-1 text-xs"><summary className="cursor-pointer">{id} · {f?.claim || t('证据已撤回', 'Evidence withdrawn')} · {f?.status === 'confirmed' ? t('当前标记已核验', 'Currently marked verified') : t('未核验', 'Unverified')}</summary><p>{t('原文 / 数据：', 'Excerpt / data: ')}{f?.excerpt || '—'}</p><p>{t('适用范围：', 'Scope: ')}{f?.scope || '—'}</p>{f?.source && /^https?:\/\//i.test(f.source) ? <a href={f.source} target="_blank" rel="noreferrer" className="text-blue-300 underline">{t('打开来源', 'Open source')}</a> : <p>{f?.source || t('未记录来源', 'No source recorded')}</p>}</details>})}
      <p className="text-xs text-slate-300">{t('推理（仍可质疑）：', 'Reasoning (open to challenge): ')}{b?.rationale || judgment?.reason || t('本条请求未记录事实如何支持建议。', 'This request does not explain how evidence supports a recommendation.')}</p>
      <p className="text-xs text-slate-400">{wait ? `${t('批准后的恢复条件：', 'Resume condition after approval: ')}${wait.condition}` : t('采纳仅更新判断，不代表已执行实验或付款。', 'Adoption updates the judgment; it does not execute experiments or payments.')}</p>
    </section>
  </aside>;
}
