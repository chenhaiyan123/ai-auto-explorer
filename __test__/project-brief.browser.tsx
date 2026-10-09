import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectBrief from '../components/ProjectBrief';
import ExplorationLoop from '../components/ExplorationLoop';
import ProblemHeartbeatPanel from '../components/ProblemHeartbeatPanel';
import { loopFixture } from './exploration-loop.fixture';
import { collectWaits } from '../services/problemHeartbeat';
import { setLanguage } from '../services/language';
import '../index.css';
const fixture = loopFixture();
fixture.state = collectWaits(fixture.state, [{ kind: 'data', title: '提供两天的室温对照记录', detail: '记录室温、天气和空调设置，排除天气差异。', owner: '你', source: '实验记录', condition: '收到温度对照记录后，核对实验条件并更新判断' }], Date.now(), () => 'demo-wait');
function Preview() {
  const [narrow, setNarrow] = useState(false); const [destination, setDestination] = useState('');
  const review = useRef<HTMLDetailsElement>(null);
  return <main className="min-h-screen bg-slate-950 text-slate-200 p-4"><header className="flex flex-wrap gap-4 mb-4 text-xs"><span>演示数据 · 不连接后台，不调用模型</span><button onClick={() => setNarrow(!narrow)}>切换窄屏</button><button onClick={() => setLanguage('en')}>English</button><button onClick={() => setLanguage('zh-CN')}>中文</button></header><div style={{ maxWidth: narrow ? 358 : 850, margin: 'auto' }} className="space-y-4 rounded-xl border border-slate-700 p-4"><ProjectBrief project={fixture.project} scopeId="root" state={fixture.state} connected onFacts={() => setDestination('facts:root')} onReview={() => { if (review.current) review.current.open = true; }} onSettings={() => setDestination('settings')} onTeam={() => setDestination('team:root')} /><details ref={review}><summary>重要更新、待办与判断记录</summary><ProblemHeartbeatPanel state={fixture.state} busy={false} act={async () => { setDestination('演示：未发送'); return false; }} /></details><details><summary>探索循环 · 查看当前环节</summary><ExplorationLoop project={fixture.project} scopeId="root" state={fixture.state} connected /></details><p role="status">{destination}</p></div></main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
