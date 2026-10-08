import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ExplorationLoop from '../components/ExplorationLoop';
import { loopFixture } from './exploration-loop.fixture';
import { setLanguage } from '../services/language';
import '../index.css';
const { project, state } = loopFixture();
function Preview() {
  const [destination, setDestination] = useState('');
  const [mobile, setMobile] = useState(false);
  return <main className="min-h-screen bg-slate-950 text-slate-200 p-4"><header className="flex flex-wrap gap-4 mb-4"><span>交互检查 · 演示数据，不调用模型</span><button onClick={() => setMobile(!mobile)}>切换窄屏</button><button onClick={() => setLanguage('en')}>English</button><button onClick={() => setLanguage('zh-CN')}>中文</button><button onClick={() => document.documentElement.classList.toggle('light')}>切换主题</button></header><div style={{ maxWidth: mobile ? 340 : 1000, margin: 'auto' }}><ExplorationLoop project={project} scopeId="root" state={state} connected onPage={(page, scope) => setDestination(`${page}:${scope}`)} onNote={id => setDestination(`note:${id}`)} /><p role="status">{destination}</p></div></main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
