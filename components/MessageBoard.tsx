import React, { useState, useEffect } from 'react';

// 使用 types_message 中的 Message 类型
interface MessageType {
  id: string;
  username: string;
  content: string;
  createdAt: string;
}

interface MessageBoardProps {
  username?: string;
}

const MessageBoard: React.FC<MessageBoardProps> = ({ username = '匿名用户' }) => {
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadMessages();
  }, []);

  const loadMessages = async () => {
    try {
      const { getMessages } = await import('../services/messageService');
      const data = await getMessages();
      setMessages(data as MessageType[]);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const { postMessage } = await import('../services/messageService');
      await postMessage(username, newMessage.trim());
      setNewMessage('');
      await loadMessages();
    } catch (e) {
      console.error('Failed to add message:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-3">留言板</div>
      
      {/* 留言列表 */}
      <div className="space-y-3 max-h-[300px] overflow-y-auto mb-4">
        {messages.length === 0 ? (
          <div className="text-center py-6 text-slate-600 text-xs">暂无留言</div>
        ) : (
          messages.slice(-10).map((msg) => (
            <div key={msg.id} className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
              <div className="flex justify-between items-start mb-1">
                <span className="text-xs font-medium text-blue-400">{msg.username}</span>
                <span className="text-[9px] text-slate-600">
                  {new Date(msg.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-slate-300">{msg.content}</p>
            </div>
          ))
        )}
      </div>

      {/* 发送表单 */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="写下你的留言..."
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !newMessage.trim()}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {isLoading ? '...' : '发送'}
        </button>
      </form>
    </div>
  );
};

export default MessageBoard;
