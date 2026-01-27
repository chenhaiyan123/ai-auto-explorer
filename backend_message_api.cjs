
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3001;

// 启用中间件
app.use(cors());
app.use(express.json());

// 内存存储留言（生产环境应使用数据库）
let messages = [
  {
    id: 'initial-msg-1',
    username: '系统管理员',
    content: '欢迎来到 AI 自动探索助手留言板！',
    createdAt: new Date().toISOString()
  }
];

// GET /api/messages - 获取所有留言
app.get('/api/messages', (req, res) => {
  // 按时间倒序返回
  const sortedMessages = [...messages].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(sortedMessages);
});

// POST /api/messages - 提交新留言
app.post('/api/messages', (req, res) => {
  const { username, content } = req.body;

  if (!username || !content) {
    return res.status(400).json({ error: 'Username and content are required' });
  }

  const newMessage = {
    id: uuidv4(),
    username,
    content,
    createdAt: new Date().toISOString()
  };

  messages.push(newMessage);
  console.log(`New message from ${username}: ${content}`);

  res.status(201).json(newMessage);
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`-------------------------------------------`);
  console.log(`Message Board API is running on:`);
  console.log(`http://localhost:${PORT}/api/messages`);
  console.log(`-------------------------------------------`);
});
