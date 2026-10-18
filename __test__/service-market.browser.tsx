import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ServiceMarket from '../components/ServiceMarket';
import type { MarketRequest } from '../services/serviceMarket';
import { setLanguage } from '../services/language';
import '../index.css';
function Demo() {
  const [actor, setActor] = useState('demo-buyer'), [opened, setOpened] = useState(true), [language, setLang] = useState('zh-CN');
  const request: MarketRequest = async (route, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:8898/market${route}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await r.json(); if (!r.ok) throw new Error(result.error); return result;
  };
  return <><div style={{ position: 'fixed', top: 0, zIndex: 200, background: '#f5e9b9', color: '#332d1a', width: '100%', padding: '5px 12px', fontSize: 12, display: 'flex', gap: 14 }}><span>隔离演示 · 虚构服务 / 账号 · 不执行、不付款</span><select aria-label="演示身份" value={actor} onChange={e => setActor(e.target.value)}><option value="demo-buyer">需求方</option><option value="demo-provider">服务方</option></select><select aria-label="演示语言" value={language} onChange={e => { setLang(e.target.value); setLanguage(e.target.value === 'en' ? 'en' : 'zh-CN'); }}><option value="zh-CN">中文</option><option value="en">English</option></select><button onClick={() => setOpened(true)}>打开</button></div>{opened && <ServiceMarket key={actor} request={request} onClose={() => setOpened(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
