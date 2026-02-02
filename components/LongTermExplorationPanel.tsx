import React, { useState, useEffect } from 'react';
import { ExplorationSession, Discovery, ExplorationIntensity } from '../services/longTermExplorer';

interface LongTermExplorationPanelProps {
  session: ExplorationSession | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onIntensityChange: (intensity: ExplorationIntensity) => void;
  onDiscoveryClick: (discovery: Discovery) => void;
}

const LongTermExplorationPanel: React.FC<LongTermExplorationPanelProps> = ({
  session,
  onStart,
  onPause,
  onResume,
  onStop,
  onIntensityChange,
  onDiscoveryClick
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (session?.status === 'running') {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - session.startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [session?.status, session?.startTime]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = session 
    ? Math.round((session.nodesExplored / Math.max(session.totalNodes, 1)) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* 头部状态 */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white">长期探索</h3>
          {session && (
            <div className={`px-2 py-1 rounded-full text-[10px] font-bold ${
              session.status === 'running' ? 'bg-green-600/20 text-green-400' :
              session.status === 'paused' ? 'bg-yellow-600/20 text-yellow-400' :
              session.status === 'completed' ? 'bg-blue-600/20 text-blue-400' :
              'bg-red-600/20 text-red-400'
            }`}>
              {session.status === 'running' ? '运行中' :
               session.status === 'paused' ? '已暂停' :
               session.status === 'completed' ? '已完成' : '错误'}
            </div>
          )}
        </div>

        {/* 运行时间 */}
        {session && (
          <div className="text-center py-3">
            <div className="text-3xl font-mono font-bold text-white">{formatTime(elapsedTime)}</div>
            <div className="text-[10px] text-slate-500 mt-1">运行时长</div>
          </div>
        )}

        {/* 进度条 */}
        {session && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>探索进度</span>
              <span>{session.nodesExplored}/{session.totalNodes} ({progress}%)</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 控制按钮 */}
      <div className="p-4 border-b border-slate-800">
        {!session ? (
          <button 
            onClick={onStart}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            开始长期探索
          </button>
        ) : (
          <div className="flex gap-2">
            {session.status === 'running' ? (
              <button 
                onClick={onPause}
                className="flex-1 py-2.5 bg-yellow-600/20 text-yellow-400 border border-yellow-500/30 font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                暂停
              </button>
            ) : session.status === 'paused' ? (
              <button 
                onClick={onResume}
                className="flex-1 py-2.5 bg-green-600/20 text-green-400 border border-green-500/30 font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                继续
              </button>
            ) : null}
            <button 
              onClick={onStop}
              className="flex-1 py-2.5 bg-red-600/20 text-red-400 border border-red-500/30 font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              停止
            </button>
          </div>
        )}
      </div>

      {/* 探索强度 */}
      {session && (
        <div className="p-4 border-b border-slate-800">
          <div className="text-[10px] text-slate-500 mb-2">探索强度</div>
          <div className="flex gap-2">
            {(['light', 'moderate', 'intensive'] as ExplorationIntensity[]).map((intensity) => (
              <button
                key={intensity}
                onClick={() => onIntensityChange(intensity)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                  session.config?.intensity === intensity
                    ? intensity === 'intensive'
                      ? 'bg-red-600 text-white'
                      : intensity === 'moderate'
                        ? 'bg-yellow-600 text-white'
                        : 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {intensity === 'light' ? '轻度' : intensity === 'moderate' ? '中度' : '深度'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 发现列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-[10px] text-slate-500 mb-2">
          最近发现 ({session?.discoveries.length || 0})
        </div>
        {session?.discoveries.length === 0 ? (
          <div className="text-center py-8 text-slate-600 text-xs">
            暂无发现，探索中...
          </div>
        ) : (
          <div className="space-y-2">
            {session?.discoveries.slice(-5).reverse().map((discovery) => (
              <button
                key={discovery.id}
                onClick={() => onDiscoveryClick(discovery)}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${
                  discovery.type === 'breakthrough'
                    ? 'bg-yellow-600/10 border-yellow-500/30 hover:bg-yellow-600/20'
                    : discovery.type === 'significant'
                      ? 'bg-blue-600/10 border-blue-500/30 hover:bg-blue-600/20'
                      : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-700/50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg">
                    {discovery.type === 'breakthrough' ? '🌟' :
                     discovery.type === 'significant' ? '💡' : '📝'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-200 truncate">{discovery.title}</div>
                    <div className="text-[10px] text-slate-500 truncate">{discovery.summary || discovery.description}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LongTermExplorationPanel;
