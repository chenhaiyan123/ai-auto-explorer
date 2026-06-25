const https = require('https');

// ========== 阿里云 OSS 客户端（统计功能用）==========
let ossClient = null;
try {
  const OSS = require('ali-oss');
  if (process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET && process.env.OSS_BUCKET_NAME) {
    ossClient = new OSS({
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      bucket: process.env.OSS_BUCKET_NAME,
      secure: true
    });
    console.log('[FC] OSS client initialized');
  } else {
    console.log('[FC] OSS not configured, /stats endpoint disabled');
  }
} catch (e) {
  console.log('[FC] OSS module not available:', e.message);
}

const STATS_FILE_NAME = 'global_user_stats.json';

// ========== FC 入口函数 ==========
exports.handler = async (req, resp, context) => {
  // CORS 头
  resp.setHeader('Access-Control-Allow-Origin', '*');
  resp.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  resp.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 预检请求直接返回
  if (req.method === 'OPTIONS') {
    resp.statusCode = 204;
    resp.end();
    return;
  }

  // 路由：统计接口
  if (req.url === '/stats') {
    return handleStats(req, resp);
  }

  // 默认：AI API 代理
  return handleAIProxy(req, resp);
};

// ========== 统计处理 ==========
async function handleStats(req, resp) {
  if (!ossClient) {
    resp.statusCode = 500;
    resp.setHeader('Content-Type', 'application/json');
    resp.end(JSON.stringify({ error: 'OSS not configured' }));
    return;
  }

  try {
    if (req.method === 'GET') {
      try {
        const result = await ossClient.get(STATS_FILE_NAME);
        resp.statusCode = 200;
        resp.setHeader('Content-Type', 'application/json');
        resp.end(result.content.toString());
      } catch (e) {
        if (e.code === 'NoSuchKey') {
          resp.statusCode = 200;
          resp.setHeader('Content-Type', 'application/json');
          resp.end('[]');
        } else {
          throw e;
        }
      }
    } else if (req.method === 'POST') {
      const body = await readBody(req);
      const newStat = JSON.parse(body);

      let currentData = [];
      try {
        const result = await ossClient.get(STATS_FILE_NAME);
        currentData = JSON.parse(result.content.toString());
      } catch (e) {
        if (e.code !== 'NoSuchKey') throw e;
      }

      // 合并逻辑
      let updated = false;
      for (let i = 0; i < currentData.length; i++) {
        if (currentData[i].username === newStat.username) {
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

      await ossClient.put(STATS_FILE_NAME, Buffer.from(JSON.stringify(currentData)));

      resp.statusCode = 200;
      resp.setHeader('Content-Type', 'application/json');
      resp.end(JSON.stringify({ status: 'updated' }));
    } else {
      resp.statusCode = 405;
      resp.end();
    }
  } catch (e) {
    console.error('[FC] Stats Error:', e);
    resp.statusCode = 500;
    resp.setHeader('Content-Type', 'application/json');
    resp.end(JSON.stringify({ error: e.message }));
  }
}

// ========== AI API 代理 ==========
function handleAIProxy(req, resp) {
  return new Promise((resolve) => {
    const proxyReq = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`
      }
    }, (proxyRes) => {
      resp.statusCode = proxyRes.statusCode;
      // 复制响应头
      Object.keys(proxyRes.headers).forEach(key => {
        resp.setHeader(key, proxyRes.headers[key]);
      });
      proxyRes.pipe(resp);
      proxyRes.on('end', resolve);
    });

    proxyReq.on('error', (e) => {
      console.error('[FC] Proxy Error:', e);
      resp.statusCode = 500;
      resp.setHeader('Content-Type', 'application/json');
      resp.end(JSON.stringify({ error: e.message }));
      resolve();
    });

    req.pipe(proxyReq);
  });
}

// ========== 工具函数 ==========
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
