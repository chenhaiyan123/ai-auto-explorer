/**
 * LongTermExplorationPanel - 长期探索面板组件
 */

import React from 'react';
import { ExplorationSession, Discovery, ExplorationIntensity } from '../services/longTermExplorer';

interface LongTermStats {
  totalRuntime: number;
  cycleCount: number;
  nodesExplored: number;
  discoveries: {
    breakthrough: number;
    significant: number;
    minor: number;
    pending: number;
  };
  reflections: number;
  energyUsed: number;
  energyRemaining: number;
  averageCycleTime: number;
  discoveryRate: number;
}

interface LongTermExplorationPanelProps {
  session: ExplorationSession | null;
  stats: LongTermStats;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onIntensityChange: (intensity: ExplorationIntensity) => void;
  onDiscoveryClick: (discovery: Discovery) => void;
  isSubscribed: boolean;
  onSubscribe: () => void;
}

const LongTermExplorationPanel: React.FC<LongTermExplorationPanelProps> = ({
  session,
  stats,
  onStart,
  onPause,
  onResume,
  onStop,
  onIntensityChange,
  onDiscoveryClick,
  isSubscribed,
  onSubscribe
}) => {
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}小时${mins}分钟`;
    return `${mins}分钟`;
  };

  if (!isSubscribed) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">⭐</div>
        <h3 className="text-lg font-bold text-white mb-2">长期探索模式</h3>
        <p className="text-sm text-slate-400 mb-6 max-w-xs">
          解锁 AI 深度自主探索能力，让系统在后台持续挖掘知识和洞察
        </p>
        <button
          onClick={onSubscribe}
          className="px-6 py-3 bg-gradient-to-r from-yellow-600 to-orange-600 text-white font-bold rounded-xl hover:from-yellow-500 hover:to-orange-500 transition-all shadow-lg"
        >
          开通订阅
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      {/* 状态指示器 */}
      <div className={`p-4 rounded-xl border ${
        session?.status === 'running'
          ? 'bg-emerald-600/10 border-emerald-500/30'
          : session?.status === 'paused'
            ? 'bg-yellow-600/10 border-yellow-500/30'
            : 'bg-slate-900 border-slate-800'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              session?.status === 'running'
                ? 'bg-emerald-500 animate-pulse'
                : session?.status === 'paused'
                  ? 'bg-yellow-500'
                  : 'bg-slate-600'
            }`} />
            <span className="text-xs font-bold text-slate-300">
              {session?.status === 'running' ? '探索中' : session?.status === 'paused' ? '已暂停' : '未启动'}
            </span>
          </div>
          {session && (
            <span className="text-[10px] text-slate-500">
              运行 {formatTime(stats.totalRuntime)}
            </span>
          )}
        </div>

        {/* 控制按钮 */}
        <div className="flex gap-2">
          {!session ? (
            <button
              onClick={onStart}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all"
            >
              ▶️ 开始探索
            </button>
          ) : session.status === 'running' ? (
            <>
              <button
                onClick={onPause}
                className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-bold rounded-lg transition-all"
              >
                ⏸️ 暂停
              </button>
              <button
                onClick={onStop}
                className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-500/30 text-xs font-bold rounded-lg hover:bg-red-600/30 transition-all"
              >
                ⏹️
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onResume}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all"
              >
                ▶️ 继续
              </button>
              <button
                onClick={onStop}
                className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-500/30 text-xs font-bold rounded-lg hover:bg-red-600/30 transition-all"
              >
                ⏹️
              </button>
            </>
          )}
        </div>
      </div>

      {/* 探索强度 */}
      {session && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-slate-500 uppercase">探索强度</div>
          <div className="flex gap-1">
            {(['light', 'moderate', 'intensive'] as ExplorationIntensity[]).map((intensity) => (
              <button
                key={intensity}
                onClick={() => onIntensityChange(intensity)}
                className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${
                  session.config.intensity === intensity
                    ? intensity === 'intensive'
                      ? 'bg-red-600 text-white'
                      : intensity === 'moderate'
                        ? 'bg-blue-600 text-white'
                        : 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {intensity === 'light' ? '轻度' : intensity === 'moderate' ? '中度' : '深度'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 统计数据 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{stats.cycleCount}</div>
          <div className="text-[9px] text-slate-500">探索周期</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-emerald-400">{stats.nodesExplored}</div>
          <div className="text-[9px] text-slate-500">节点数</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-yellow-400">
            {stats.discoveries.breakthrough + stats.discoveries.significant}
          </div>
          <div className="text-[9px] text-slate-500">重要发现</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-purple-400">{stats.reflections}</div>
          <div className="text-[9px] text-slate-500">反思次数</div>
        </div>
      </div>

      {/* 能量条 */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="text-slate-500">探索能量</span>
          <span className="text-slate-400">{stats.energyRemaining} / {stats.energyUsed + stats.energyRemaining}</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-emerald-600 rounded-full transition-all"
            style={{ width: `${(stats.energyRemaining / (stats.energyUsed + stats.energyRemaining || 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* 发现列表 */}
      {session?.discoveries && session.discoveries.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-2">
          <div className="text-[10px] font-bold text-slate-500 uppercase">最近发现</div>
          {session.discoveries.slice(-5).reverse().map((discovery) => (
            <button
              key={discovery.id}
              onClick={() => onDiscoveryClick(discovery)}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                discovery.type === 'breakthrough'
                  ? 'bg-yellow-600/10 border-yellow-500/30 hover:bg-yellow-600/20'
                  : discovery.type === 'significant'
                    ? 'bg-blue-600/10 border-blue-500/30 hover:bg-blue-600/20'
                    : 'bg-slate-900 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">
                  {discovery.type === 'breakthrough' ? '🌟' : discovery.type === 'significant' ? '💡' : '📝'}
                </span>
                <span className="text-xs font-medium text-slate-200 truncate">{discovery.title}</span>
              </div>
              <div className="text-[10px] text-slate-500 truncate">{discovery.summary}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LongTermExplorationPanel;
