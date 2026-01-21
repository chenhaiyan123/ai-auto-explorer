const http = require('http');
const https = require('https');
const OSS = require('ali-oss');

// --- 配置区域 ---
const PORT = 9000;
const STATS_FILE_NAME = 'global_user_stats.json';

// 初始化 OSS 客户端 (需要配置环境变量)
// 如果没有配置 OSS 环境变量，/stats 功能将不可用，但不影响 AI 代理
let ossClient = null;
if (process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET && process.env.OSS_BUCKET_NAME) {
    ossClient = new OSS({
        region: process.env.OSS_REGION || 'oss-cn-hangzhou',
        accessKeyId: process.env.OSS_ACCESS_KEY_ID,
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
        bucket: process.env.OSS_BUCKET_NAME,
        secure: true // 使用 HTTPS
    });
}

const server = http.createServer((req, res) => {
    // 1. 全局 CORS 配置
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 2. 路由分发
    // === 新增功能: 全网统计数据同步 ===
    if (req.url === '/stats') {
        if (!ossClient) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'OSS environment variables not configured' }));
            return;
        }
        handleStatsRequest(req, res);
        return;
    }

    // === 原有功能: AI 代理 ===
    // 默认所有其他请求都转发给 DashScope
    handleAIProxy(req, res);
});

// --- 处理统计逻辑 (/stats) ---
async function handleStatsRequest(req, res) {
    try {
        if (req.method === 'GET') {
            // 读取全量数据
            try {
                const result = await ossClient.get(STATS_FILE_NAME);
                const data = result.content.toString();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
            } catch (e) {
                // 如果文件不存在，返回空数组
                if (e.code === 'NoSuchKey') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('[]');
                } else {
                    throw e;
                }
            }
        } else if (req.method === 'POST') {
            // 接收数据并合并
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const newStat = JSON.parse(body);
                    
                    // 1. 获取现有数据
                    let currentData = [];
                    try {
                        const result = await ossClient.get(STATS_FILE_NAME);
                        currentData = JSON.parse(result.content.toString());
                    } catch (e) {
                        if (e.code !== 'NoSuchKey') throw e;
                    }

                    // 2. 合并逻辑
                    let updated = false;
                    for (let i = 0; i < currentData.length; i++) {
                        if (currentData[i].username === newStat.username) {
                            // 取最新的 lastActiveTimestamp
                            if ((newStat.lastActiveTimestamp || 0) > (currentData[i].lastActiveTimestamp || 0)) {
                                currentData[i] = newStat;
                            }
                            updated = true;
                            break;
                        }
                    }
                    if (!updated) {
                        currentData.push(newStat);
                    }

                    // 3. 写回 OSS
                    await ossClient.put(STATS_FILE_NAME, Buffer.from(JSON.stringify(currentData)));

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'updated' }));
                } catch (e) {
                    console.error('Stats Error:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
        } else {
            res.writeHead(405);
            res.end();
        }
    } catch (e) {
        console.error('Handler Error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}

// --- 原有 AI 代理逻辑 ---
function handleAIProxy(req, res) {
    const options = {
        hostname: 'dashscope.aliyuncs.com',
        path: '/compatible-mode/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
    });

    req.pipe(proxyReq);
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
