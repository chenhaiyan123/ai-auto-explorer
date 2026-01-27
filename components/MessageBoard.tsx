
import React, { useState, useEffect } from 'react';
import { Message } from '../types_message';
import { getMessages, postMessage } from '../services/messageService';

const MessageBoard: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [username, setUsername] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchMessages = async () => {
    setIsLoading(true);
    const data = await getMessages();
    setMessages(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchMessages();
  }, []);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!username.trim() || !content.trim()) return;

  setIsSubmitting(true);
  try {
    const newMessage = await postMessage(username, content);
    
    // 确保消息包含 username 字段
    const messageWithUsername = {
      ...newMessage,
      username: newMessage.username || username,
      author: newMessage.author || username,
    };
    
    setMessages((prev) => [messageWithUsername, ...prev]);
    
    // 同步到 localStorage
    const saved = localStorage.getItem('message_board_messages');
    const localMessages = saved ? JSON.parse(saved) : [];
    localMessages.unshift(messageWithUsername);
    localStorage.setItem('message_board_messages', JSON.stringify(localMessages));
    
    setContent('');
  } catch (error) {
    alert('提交留言失败，请检查后端服务是否启动。');
  } finally {
    setIsSubmitting(false);
  }
};

  return (
    <div className="w-full mx-auto p-6 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl ">
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
        <span className="text-blue-500">💬</span> 留言板
      </h2>

      {/* 提交表单 */}
      <form onSubmit={handleSubmit} className="mb-10 space-y-4">
        <div>
          <input
            type="text"
            placeholder="您的昵称"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            required
          />
        </div>
        <div>
          <textarea
            placeholder="输入您的留言内容..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all min-h-[150px]"
            required
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-4 rounded-xl font-bold text-white transition-all shadow-lg ${
            isSubmitting ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 active:scale-95 shadow-blue-900/20'
          }`}
        >
          {isSubmitting ? '发送中...' : '提交留言'}
        </button>
      </form>

      {/* 留言列表 */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">最新留言</h3>
        {isLoading ? (
          <div className="text-center py-10 text-slate-500 animate-pulse">正在加载留言...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 text-slate-500 border border-dashed border-slate-800 rounded-2xl">
            暂无留言，快来抢沙发吧！
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="bg-slate-800/50 border border-slate-700 p-5 rounded-2xl group hover:border-slate-600 transition-all">
              <div className="flex justify-between items-start mb-2">
                <span className="font-bold text-blue-400">{msg.username}</span>
                <span className="text-[10px] text-slate-500">{new Date(msg.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MessageBoard;
