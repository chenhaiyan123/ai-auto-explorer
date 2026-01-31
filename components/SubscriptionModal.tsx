/**
 * SubscriptionModal - 订阅弹窗组件
 */

import React, { useState } from 'react';

interface SubscriptionModalProps {
  onClose: () => void;
  onSubscribe: () => void;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ onClose, onSubscribe }) => {
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('monthly');

  const plans = {
    monthly: { price: 29, period: '月', save: null },
    yearly: { price: 199, period: '年', save: '节省 ¥149' }
  };

  const features = [
    { icon: '⭐', title: '无限长期探索', desc: '让 AI 24/7 持续深入研究' },
    { icon: '🧠', title: '深度反思能力', desc: 'AI 自主总结和优化探索策略' },
    { icon: '💡', title: '突破性发现', desc: '自动识别和标记重要洞察' },
    { icon: '📊', title: '详细分析报告', desc: '生成专业的研究报告' },
    { icon: '🔔', title: '实时通知', desc: '重要发现即时推送' },
    { icon: '☁️', title: '云端同步', desc: '多设备数据同步' }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="relative bg-gradient-to-br from-yellow-600 via-orange-600 to-red-600 p-8 text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-lg transition-colors text-white/80 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
          
          <div className="text-5xl mb-4">⭐</div>
          <h2 className="text-2xl font-bold text-white mb-2">解锁长期探索</h2>
          <p className="text-white/80 text-sm">让 AI 持续深入研究，发现更多洞察</p>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-6">
          {/* 套餐选择 */}
          <div className="flex gap-3">
            <button
              onClick={() => setSelectedPlan('monthly')}
              className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                selectedPlan === 'monthly'
                  ? 'border-yellow-500 bg-yellow-600/10'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="text-sm font-bold text-slate-300 mb-1">月付</div>
              <div className="text-2xl font-bold text-white">
                ¥{plans.monthly.price}
                <span className="text-sm text-slate-500 font-normal">/月</span>
              </div>
            </button>
            <button
              onClick={() => setSelectedPlan('yearly')}
              className={`flex-1 p-4 rounded-xl border-2 transition-all relative ${
                selectedPlan === 'yearly'
                  ? 'border-yellow-500 bg-yellow-600/10'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              {plans.yearly.save && (
                <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full">
                  {plans.yearly.save}
                </div>
              )}
              <div className="text-sm font-bold text-slate-300 mb-1">年付</div>
              <div className="text-2xl font-bold text-white">
                ¥{plans.yearly.price}
                <span className="text-sm text-slate-500 font-normal">/年</span>
              </div>
            </button>
          </div>

          {/* 功能列表 */}
          <div className="grid grid-cols-2 gap-3">
            {features.map((feature, index) => (
              <div key={index} className="flex items-start gap-2 p-3 bg-slate-800/50 rounded-lg">
                <span className="text-lg">{feature.icon}</span>
                <div>
                  <div className="text-xs font-bold text-white">{feature.title}</div>
                  <div className="text-[10px] text-slate-500">{feature.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 订阅按钮 */}
          <button
            onClick={onSubscribe}
            className="w-full py-4 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-white font-bold rounded-xl transition-all shadow-lg text-lg"
          >
            立即订阅 · ¥{plans[selectedPlan].price}/{plans[selectedPlan].period}
          </button>

          {/* 说明 */}
          <p className="text-[10px] text-slate-500 text-center">
            订阅后可随时取消，未使用天数可按比例退款
          </p>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionModal;
