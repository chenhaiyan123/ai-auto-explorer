import { t as ui } from '../services/language';
import React, { useState } from 'react';
import SharedModelsPanel from './SharedModelsPanel';

export default function AdminDashboard({ onClose, initialTab = 'models', stats, messages, notice }: {
  onClose: () => void; initialTab?: 'stats' | 'messages' | 'models'; stats: React.ReactNode; messages: React.ReactNode; notice?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={ui("管理员后台")}>
    <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full p-4 sm:p-6 shadow-2xl flex flex-col h-full max-h-[94vh] text-slate-200">
      <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold text-purple-400">{ui("管理员后台")}</h2><button className="px-3 py-2 bg-slate-800 rounded-lg" onClick={onClose}>{ui("关闭")}</button></div>
      {notice && <p className="text-sm text-amber-200 mb-3">{notice}</p>}
      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="后台功能">
        {([['models', 'AI 模型与额度'], ['stats', '用户统计'], ['messages', '用户留言']] as const).map(([id, label]) => <button key={id} id={`admin-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`admin-panel-${id}`} onClick={() => setTab(id)} className={`px-4 py-2 rounded-lg text-sm ${tab === id ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`} className="min-h-0 flex-1 overflow-auto">
        {tab === 'models' ? <SharedModelsPanel embedded /> : tab === 'stats' ? stats : messages}
      </div>
    </div>
  </div>;
}
