/**
 * DiscoveryModal - 发现详情弹窗组件
 */

import React from 'react';
import { Discovery } from '../services/longTermExplorer';

interface DiscoveryModalProps {
  discovery: Discovery;
  onClose: () => void;
  onVerify: (discoveryId: string, isValid: boolean) => void;
  onExploreRelated: (nodeIds: string[]) => void;
}

const DiscoveryModal: React.FC<DiscoveryModalProps> = ({
  discovery,
  onClose,
  onVerify,
  onExploreRelated
}) => {
  // 注意：Tailwind 走本地构建（静态扫描类名），不能用 `bg-${color}-600` 这类拼接，
  // 否则类名不会被生成。这里直接写完整的字面量类名。
  const typeConfig = {
    breakthrough: { icon: '🌟', label: '突破性发现', head: 'bg-yellow-600/10', chip: 'bg-yellow-600/20', text: 'text-yellow-400', bar: 'bg-yellow-500' },
    significant: { icon: '💡', label: '重要发现', head: 'bg-blue-600/10', chip: 'bg-blue-600/20', text: 'text-blue-400', bar: 'bg-blue-500' },
    minor: { icon: '📝', label: '一般发现', head: 'bg-slate-600/10', chip: 'bg-slate-600/20', text: 'text-slate-400', bar: 'bg-slate-500' },
    pending: { icon: '⏳', label: '待验证', head: 'bg-orange-600/10', chip: 'bg-orange-600/20', text: 'text-orange-400', bar: 'bg-orange-500' }
  };

  const config = typeConfig[discovery.type] || typeConfig.pending;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
        {/* 头部 */}
        <div className={`p-6 border-b border-slate-800 ${config.head}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 ${config.chip} rounded-xl flex items-center justify-center text-2xl`}>
                {config.icon}
              </div>
              <div>
                <div className={`text-[10px] font-bold ${config.text} uppercase mb-1`}>
                  {config.label}
                </div>
                <h3 className="text-lg font-bold text-white">{discovery.title}</h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 摘要 */}
          <div>
            <h4 className="text-sm font-bold text-slate-400 mb-2">摘要</h4>
            <p className="text-sm text-slate-300 leading-relaxed">{discovery.summary}</p>
          </div>

          {/* 详细内容 */}
          {discovery.content && (
            <div>
              <h4 className="text-sm font-bold text-slate-400 mb-2">详细内容</h4>
              <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-950 border border-slate-800 rounded-xl p-4">
                {discovery.content}
              </div>
            </div>
          )}

          {/* 证据 */}
          {discovery.evidence && discovery.evidence.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-slate-400 mb-2">支撑证据</h4>
              <ul className="space-y-2">
                {discovery.evidence.map((ev, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-slate-400">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    {ev}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 相关节点 */}
          {discovery.relatedNodeIds && discovery.relatedNodeIds.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-slate-400 mb-2">相关节点</h4>
              <button
                onClick={() => onExploreRelated(discovery.relatedNodeIds || [])}
                className="px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-bold rounded-lg hover:bg-blue-600/30 transition-all"
              >
                🔗 查看 {discovery.relatedNodeIds.length} 个相关节点
              </button>
            </div>
          )}

          {/* 置信度 */}
          <div>
            <h4 className="text-sm font-bold text-slate-400 mb-2">置信度</h4>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${config.bar} rounded-full transition-all`}
                  style={{ width: `${discovery.confidence || 0}%` }}
                />
              </div>
              <span className="text-sm font-bold text-slate-300">{discovery.confidence || 0}%</span>
            </div>
          </div>

          {/* 元信息 */}
          <div className="text-xs text-slate-500 flex items-center gap-4">
            <span>发现于 {new Date(discovery.timestamp).toLocaleString()}</span>
            {discovery.verifiedAt && (
              <span className="text-emerald-400">
                ✓ 已于 {new Date(discovery.verifiedAt).toLocaleString()} 验证
              </span>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800">
          <div className="flex gap-2">
            {!discovery.verifiedAt && (
              <>
                <button
                  onClick={() => onVerify(discovery.id, true)}
                  className="px-4 py-2 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold rounded-lg hover:bg-emerald-600/30 transition-all"
                >
                  ✓ 确认有效
                </button>
                <button
                  onClick={() => onVerify(discovery.id, false)}
                  className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-500/30 text-xs font-bold rounded-lg hover:bg-red-600/30 transition-all"
                >
                  ✗ 标记无效
                </button>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-all"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiscoveryModal;
