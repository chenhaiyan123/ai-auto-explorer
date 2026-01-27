// TestMessageBoard.tsx（放在项目根目录）
import React from 'react';
// 导入留言板组件（路径对应你的实际位置：components文件夹在根目录）
import MessageBoard from './components/MessageBoard';

// 独立测试页：只渲染留言板，无任何其他内容
const TestMessageBoard = () => {
  return (
    <div style={{ 
      maxWidth: '800px', 
      margin: '20px auto', 
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h2 style={{ color: '#333', marginBottom: '20px' }}>留言板功能测试页</h2>
      {/* 直接渲染留言板组件 */}
      <MessageBoard />
    </div>
  );
};

export default TestMessageBoard;