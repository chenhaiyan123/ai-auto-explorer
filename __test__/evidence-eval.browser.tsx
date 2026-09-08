/** Manual evaluation, opt-in real model calls; isolated from all user projects. */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInquiry, newRound, runInquiry, recoverInquiry, type InquiryWorkspace } from '../services/inquiry';
import { callLLM, loadLLMSettings } from '../services/llmProvider';
import '../index.css';

const KEY = 'hiexplore-evidence-eval-20260908';
const question = '让用户读完文章后写下一个具体问题，相比仅收藏文章，是否能提高七天后的回访比例？';
const baseline = '这是独立产品研究评估，不包含真实用户资料。尚无真实实验或观察数据。请提出恰好三个竞争假设，识别下一步最值得获取的证据。区分可由现有材料完成的推理与必须等待现实数据的判断；没有材料就明确说明。';
const synthetic = '\n新增材料 E1（人为构造的合成测试材料，并非真实用户实验）：随机分配的合成对照组100人，第七天回访20人；合成干预组100人，第七天回访30人。干预组收到额外邮件提醒，对照组没有。因此“写问题”与“邮件提醒”同时变化，无法单独归因。没有更多随访或分层记录。请明确计算描述差异，检查混杂，说明是否改变先前判断、哪项假设受到影响；不能声称产品实际有效。';
type Saved = { workspace: InquiryWorkspace; calls: number; tokens: number; model: string; gate?: string; phase: string };
const fresh = (): Saved => ({ workspace: { ...createInquiry('root', question), background: baseline }, calls: 0, tokens: 0, model: '', phase: '未启动' });
function Evaluation() {
  const [data, setData] = useState<Saved>(() => {
    try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); return saved ? { ...saved, workspace: recoverInquiry(saved.workspace) } : fresh(); } catch { return fresh(); }
  });
  const state = useRef(data); const stop = useRef(false);
  const [busy, setBusy] = useState(false);
  const put = (next: Saved) => { state.current = next; setData(next); localStorage.setItem(KEY, JSON.stringify(next)); };
  const run = async (withEvidence: boolean) => {
    if (busy) return;
    stop.current = false; setBusy(true);
    try {
      let w = state.current.workspace;
      if (!w.rounds.length || w.rounds.at(-1)?.status === 'completed') w = newRound(w);
      w = { ...w, background: baseline + (withEvidence ? synthetic : '') };
      put({ ...state.current, workspace: w, model: loadLLMSettings().model, phase: withEvidence ? '加入合成证据' : '没有外部证据' });
      await runInquiry({
        read: () => state.current.workspace,
        write: workspace => put({ ...state.current, workspace }),
        shouldStop: () => stop.current || state.current.calls >= 38,
        model: async messages => {
          put({ ...state.current, calls: state.current.calls + 1 });
          const result = await callLLM(messages, { jsonMode: true });
          put({ ...state.current, tokens: state.current.tokens + (result.usage?.prompt_tokens || 0) + (result.usage?.completion_tokens || 0) });
          return result.content;
        },
      });
    } catch (e) { put({ ...state.current, phase: String(e) }); }
    finally { setBusy(false); }
  };
  const gate = () => {
    try { const next = newRound(state.current.workspace); put({ ...state.current, gate: `无新证据仍允许创建第 ${next.rounds.length} 轮；本次只检查门槛，没有发起额外模型调用。` }); }
    catch (e) { put({ ...state.current, gate: String(e) }); }
  };
  return <main className="min-h-screen bg-slate-950 text-slate-200 p-4 space-y-4">
    <h1 className="text-xl font-bold">证据驱动探索 · 真实模型评估</h1>
    <p>使用已配置模型，点击才调用。独立测试存储；最多38次请求；不改动用户项目。E1是合成材料，不能证明真实产品效果。</p>
    <p>{question}</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy} onClick={() => run(false)}>运行无证据阶段</button>
      <button disabled={busy || data.workspace.rounds.at(-1)?.status !== 'completed'} onClick={gate}>检查无证据续跑门槛</button>
      <button disabled={busy || !data.workspace.rounds.length} onClick={() => run(true)}>加入合成证据并运行</button>
      <button disabled={!busy} onClick={() => { stop.current = true; }}>当前步骤后停止</button>
    </div>
    <p role="status">模型：{data.model || loadLLMSettings().model} · {busy ? '运行中' : '已停止'} · {data.calls} 次调用 · {data.tokens} tokens</p>
    <p>接入方式：{loadLLMSettings().provider} · 服务地址：{(() => { try { const u = new URL(loadLLMSettings().baseUrl); return u.origin + u.pathname; } catch { return '未配置'; } })()}</p>
    {data.gate && <p>{data.gate}</p>}
    {data.workspace.rounds.map(r => <section key={r.id} className="border border-slate-700 rounded p-3 space-y-3"><h2>第 {r.number} 轮 · {r.status} · {r.tasks.filter(t => t.status === 'completed').length}/{r.tasks.length}</h2>
      {r.error && <p role="alert">{r.error}</p>}
      {r.hypotheses.map(h => <p key={h.id}>{h.statement} — 证伪：{h.falsification}</p>)}
      {r.tasks.map(t => <details key={t.id}><summary>{t.role} · {t.status}</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(t.result || t.error || {}, null, 2)}</pre></details>)}
    </section>)}
    <details><summary>完整评估记录（JSON）</summary><pre id="evaluation-record" className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(data, null, 2)}</pre></details>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Evaluation />);
