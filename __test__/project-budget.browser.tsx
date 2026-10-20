import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectMandatePanel from '../components/ProjectMandatePanel';
import type { ProjectMandate } from '../services/projectMandate';
import { setLanguage } from '../services/language';
import '../index.css';
function Demo() {
  const [narrow, setNarrow] = useState(false);
  const [result, setResult] = useState('');
  const [mandate, setMandate] = useState<ProjectMandate>({ projectId: 'demo', revision: 1, termsRevision: 1, goal: '验证小团队是否需要持续跟踪客户反馈', acceptance: '取得三份真实访谈记录，区分使用意愿与实际付费', stopCondition: '无新证据则等待，不重复推演', deadline: Date.now() + 7 * 86400000, status: 'paused', effectiveStatus: 'paused', uncertain: false, tools: ['model_analysis', 'paper_search'], budgets: { DeepSeek: { totalTokens: 50000, dailyTokens: 25000, perCallTokens: 15000 } }, usage: { DeepSeek: { spent: 4800, held: 0, remaining: 45200, today: 4800 } }, calls: [] });
  return <main className="min-h-screen bg-slate-950 p-4 text-slate-200"><header className="mb-4 flex flex-wrap gap-4 text-xs"><span>构造演示 · 不连接模型，不修改生产预算</span><button onClick={() => setNarrow(!narrow)}>切换窄屏</button><button onClick={() => setLanguage('en')}>English</button><button onClick={() => setLanguage('zh-CN')}>中文</button></header><div style={{ maxWidth: narrow ? 358 : 850, margin: 'auto' }}><ProjectMandatePanel mandate={mandate} question={mandate.goal} connected busy={false} checkpoint onSave={async body => { const b = body as any; setMandate(m => ({ ...m, ...b, revision: m.revision + 1, status: 'paused', effectiveStatus: 'paused' })); setResult('模拟保存：未发送请求'); return true; }} onAction={async action => { setResult(`演示操作 ${action}：未发送请求`); return true; }} onDiscard={async () => { setResult('演示放弃：未发送请求'); return true; }} /><p role="status" className="mt-4 text-xs">{result}</p></div></main>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
