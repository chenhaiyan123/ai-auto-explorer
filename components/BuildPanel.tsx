/**
 * BuildPanel - 构建模式面板组件
 * 
 * 显示构建模式下的产出物、反馈和迭代功能
 */

import React, { useState } from 'react';
import { Artifact, UserFeedback } from '../types';

interface BuildPanelProps {
  artifacts: Artifact[];
  feedbacks: UserFeedback[];
  isIntegrating: boolean;
  onArtifactClick: (artifact: Artifact) => void;
  onIntegrate: () => void;
  onAddFeedback: (feedback: UserFeedback) => void;
  onGenerateIteration: () => void;
}

const BuildPanel: React.FC<BuildPanelProps> = ({
  artifacts,
  feedbacks,
  isIntegrating,
  onArtifactClick,
  onIntegrate,
  onAddFeedback,
  onGenerateIteration
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'artifacts' | 'feedbacks'>('artifacts');
  const [newFeedback, setNewFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature' | 'improvement'>('improvement');

  const handleSubmitFeedback = () => {
    if (!newFeedback.trim()) return;
    
    onAddFeedback({
      id: Date.now().toString(),
      type: feedbackType,
      content: newFeedback,
      createdAt: Date.now(),
      status: 'pending'
    });
    
    setNewFeedback('');
  };

  // 按类型分组产出物
  const groupedArtifacts = artifacts.reduce((acc, artifact) => {
    const type = artifact.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(artifact);
    return acc;
  }, {} as Record<string, Artifact[]>);

  const typeLabels: Record<string, string> = {
    'code': '📄 代码文件',
    'component': '🧩 组件',
    'style': '🎨 样式',
    'config': '⚙️ 配置',
    'doc': '📝 文档',
    'test': '🧪 测试',
    'other': '📦 其他'
  };

  return (
    <div className="h-full flex flex-col">
      {/* 子标签切换 */}
      <div className="flex gap-1 p-2 border-b border-slate-800">
        <button
          onClick={() => setActiveSubTab('artifacts')}
          className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
            activeSubTab === 'artifacts' 
              ? 'bg-emerald-600 text-white' 
              : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          📦 产出物 ({artifacts.length})
        </button>
        <button
          onClick={() => setActiveSubTab('feedbacks')}
          className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
            activeSubTab === 'feedbacks' 
              ? 'bg-orange-600 text-white' 
              : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          💬 反馈 ({feedbacks.length})
        </button>
      </div>

      {/* 产出物列表 */}
      {activeSubTab === 'artifacts' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {artifacts.length === 0 ? (
            <div className="text-center py-12 text-slate-600">
              <div className="text-4xl mb-3">📦</div>
              <div className="text-xs">暂无产出物</div>
              <div className="text-[10px] text-slate-700 mt-1">开始探索后将自动生成</div>
            </div>
          ) : (
            <>
              {Object.entries(groupedArtifacts).map(([type, items]) => (
                <div key={type} className="space-y-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">
                    {typeLabels[type] || type}
                  </div>
                  {items.map((artifact) => (
                    <button
                      key={artifact.id}
                      onClick={() => onArtifactClick(artifact)}
                      className="w-full text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-200 group-hover:text-emerald-400 truncate">
                          {artifact.title}
                        </span>
                        <span className="text-[9px] text-slate-600">
                          v{artifact.version || 1}
                        </span>
                      </div>
                      {artifact.description && (
                        <div className="text-[10px] text-slate-500 mt-1 truncate">
                          {artifact.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ))}

              {/* 集成按钮 */}
              {artifacts.length > 1 && (
                <button
                  onClick={onIntegrate}
                  disabled={isIntegrating}
                  className={`w-full py-3 rounded-lg text-xs font-bold transition-all ${
                    isIntegrating
                      ? 'bg-slate-800 text-slate-500'
                      : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30'
                  }`}
                >
                  {isIntegrating ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-3 h-3 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                      集成中...
                    </span>
                  ) : (
                    '🔗 集成所有产出物'
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 反馈列表 */}
      {activeSubTab === 'feedbacks' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* 添加反馈 */}
          <div className="space-y-2 p-3 bg-slate-900 rounded-lg border border-slate-800">
            <div className="flex gap-1">
              {(['bug', 'feature', 'improvement'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFeedbackType(type)}
                  className={`flex-1 py-1 text-[9px] font-bold rounded transition-all ${
                    feedbackType === type
                      ? type === 'bug' 
                        ? 'bg-red-600 text-white'
                        : type === 'feature'
                          ? 'bg-blue-600 text-white'
                          : 'bg-yellow-600 text-white'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {type === 'bug' ? '🐛 Bug' : type === 'feature' ? '✨ 功能' : '💡 改进'}
                </button>
              ))}
            </div>
            <textarea
              value={newFeedback}
              onChange={(e) => setNewFeedback(e.target.value)}
              placeholder="描述你的反馈..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white outline-none resize-none h-16"
            />
            <button
              onClick={handleSubmitFeedback}
              disabled={!newFeedback.trim()}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold rounded-lg transition-all"
            >
              提交反馈
            </button>
          </div>

          {/* 反馈列表 */}
          {feedbacks.length === 0 ? (
            <div className="text-center py-8 text-slate-600 text-[10px]">
              暂无反馈记录
            </div>
          ) : (
            feedbacks.map((feedback) => (
              <div
                key={feedback.id}
                className="p-3 rounded-lg bg-slate-900 border border-slate-800"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                    feedback.type === 'bug'
                      ? 'bg-red-600/20 text-red-400'
                      : feedback.type === 'feature'
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-yellow-600/20 text-yellow-400'
                  }`}>
                    {feedback.type === 'bug' ? '🐛' : feedback.type === 'feature' ? '✨' : '💡'}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    feedback.status === 'resolved'
                      ? 'bg-emerald-600/20 text-emerald-400'
                      : feedback.status === 'in-progress'
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-slate-700 text-slate-400'
                  }`}>
                    {feedback.status === 'resolved' ? '已解决' : feedback.status === 'in-progress' ? '处理中' : '待处理'}
                  </span>
                </div>
                <div className="text-xs text-slate-300">{feedback.content}</div>
              </div>
            ))
          )}

          {/* 生成迭代任务 */}
          {feedbacks.filter(f => f.status === 'pending').length > 0 && (
            <button
              onClick={onGenerateIteration}
              className="w-full py-3 bg-orange-600/20 text-orange-400 border border-orange-500/30 rounded-lg text-xs font-bold hover:bg-orange-600/30 transition-all"
            >
              🔄 根据反馈生成迭代任务
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default BuildPanel;
