/**
 * DiscoveryNotification - 发现通知组件
 */

import React, { useEffect, useState } from 'react';
import { Discovery } from '../services/longTermExplorer';

interface DiscoveryNotificationProps {
  discovery: Discovery;
  onView: () => void;
  onDismiss: () => void;
}

const DiscoveryNotification: React.FC<DiscoveryNotificationProps> = ({
  discovery,
  onView,
  onDismiss
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 动画进入
    setTimeout(() => setIsVisible(true), 50);
    
    // 自动消失
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDismiss, 300);
    }, 8000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  const typeConfig = {
    breakthrough: { icon: '🌟', label: '突破性发现', gradient: 'from-yellow-600 to-orange-600' },
    significant: { icon: '💡', label: '重要发现', gradient: 'from-blue-600 to-cyan-600' },
    minor: { icon: '📝', label: '新发现', gradient: 'from-slate-600 to-slate-500' },
    pending: { icon: '⏳', label: '待验证发现', gradient: 'from-orange-600 to-amber-600' }
  };

  const config = typeConfig[discovery.type] || typeConfig.pending;

  return (
    <div
      className={`fixed top-20 right-4 z-[90] max-w-sm transition-all duration-300 ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className={`bg-gradient-to-r ${config.gradient} p-0.5 rounded-2xl shadow-2xl`}>
        <div className="bg-slate-900 rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="text-3xl animate-bounce">{config.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                {config.label}
              </div>
              <h4 className="text-sm font-bold text-white truncate">{discovery.title}</h4>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">{discovery.summary}</p>
              
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setIsVisible(false);
                    setTimeout(onView, 300);
                  }}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-all"
                >
                  查看详情
                </button>
                <button
                  onClick={() => {
                    setIsVisible(false);
                    setTimeout(onDismiss, 300);
                  }}
                  className="px-3 py-1.5 text-slate-400 hover:text-white text-xs transition-colors"
                >
                  稍后
                </button>
              </div>
            </div>
            
            <button
              onClick={() => {
                setIsVisible(false);
                setTimeout(onDismiss, 300);
              }}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiscoveryNotification;
