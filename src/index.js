import { IPDatabase } from './database.js';

// Worker 主程序
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return handleCors();
    }
    
    // API 路由
    if (path.startsWith('/api/')) {
      return handleApi(request, env, ctx);
    }
    
    // 静态页面
    if (path === '/' || path === '/index.html') {
      return serveStaticPage();
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

// 数据库单例
let dbInstance = null;

async function getDatabase(env) {
  if (!dbInstance) {
    dbInstance = new IPDatabase(env);
    await dbInstance.initialize();
  }
  return dbInstance;
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  
  switch (url.pathname) {
    case '/api/ip':
      return await handleIpQuery(request, env, ctx);
    case '/api/batch':
      return await handleBatchQuery(request, env, ctx);
    case '/api/db-info':
      return await handleDbInfo(request, env, ctx);
    case '/api/health':
      return handleHealth();
    default:
      return new Response('API endpoint not found', { status: 404 });
  }
}

async function handleIpQuery(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const clientIp = request.headers.get('cf-connecting-ip') || 
                    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                    'Unknown';
    
    const queryIp = url.searchParams.get('ip') || clientIp;
    
    // 验证 IP 格式
    if (!isValidIP(queryIp)) {
      return jsonResponse({
        error: 'Invalid IP address format',
        success: false
      }, 400);
    }
    
    const db = await getDatabase(env);
    const result = await db.query(queryIp);
    
    return jsonResponse({
      success: true,
      query: queryIp,
      client_ip: clientIp,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('IP query error:', error);
    return jsonResponse({
      error: error.message,
      success: false
    }, 500);
  }
}

async function handleBatchQuery(request, env, ctx) {
  // 支持批量查询（最大 100 个 IP）
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const body = await request.json();
    const ips = body.ips || [];
    
    if (!Array.isArray(ips) || ips.length > 100) {
      return jsonResponse({
        error: 'Invalid request. Maximum 100 IPs allowed.',
        success: false
      }, 400);
    }
    
    const db = await getDatabase(env);
    const results = await Promise.all(
      ips.slice(0, 100).map(async ip => ({
        ip,
        result: isValidIP(ip) ? await db.query(ip) : { error: 'Invalid IP' }
      }))
    );
    
    return jsonResponse({
      success: true,
      count: results.length,
      results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return jsonResponse({
      error: error.message,
      success: false
    }, 500);
  }
}

async function handleDbInfo(request, env, ctx) {
  const db = await getDatabase(env);
  const info = await db.getInfo();
  
  return jsonResponse({
    success: true,
    database: info,
    worker: {
      environment: env.ENVIRONMENT || 'production',
      commit_hash: env.COMMIT_HASH || 'unknown',
      build_time: env.BUILD_TIME || 'unknown'
    }
  });
}

function handleHealth() {
  return jsonResponse({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
}

function serveStaticPage() {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IP Query API</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 10px; margin-bottom: 30px; }
        .endpoint { background: #f8f9fa; border-left: 4px solid #667eea; padding: 15px; margin: 15px 0; }
        code { background: #e9ecef; padding: 2px 6px; border-radius: 4px; font-family: 'SFMono-Regular', Consolas, monospace; }
        .example { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 15px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 IP Query API</h1>
        <p>Real-time IP geolocation lookup service</p>
    </div>
    
    <h2>API Endpoints</h2>
    
    <div class="endpoint">
        <h3>GET /api/ip</h3>
        <p>Query your own IP address</p>
        <code>curl https://your-worker.workers.dev/api/ip</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /api/ip?ip=8.8.8.8</h3>
        <p>Query specific IP address</p>
        <code>curl "https://your-worker.workers.dev/api/ip?ip=8.8.8.8"</code>
    </div>
    
    <div class="endpoint">
        <h3>POST /api/batch</h3>
        <p>Batch query multiple IPs (max 100)</p>
        <code>curl -X POST -H "Content-Type: application/json" -d '{"ips":["8.8.8.8","1.1.1.1"]}' https://your-worker.workers.dev/api/batch</code>
    </div>
    
    <h2>Example Response</h2>
    <div class="example">
        <pre><code>{
  "success": true,
  "query": "8.8.8.8",
  "data": {
    "country": "United States",
    "region": "California",
    "city": "Los Angeles",
    "isp": "Google LLC",
    "latitude": 34.0544,
    "longitude": -118.244
  }
}</code></pre>
    </div>
    
    <h2>Database Information</h2>
    <p>Database is automatically updated from Git repository.</p>
    <p><a href="/api/db-info">View database info</a> | <a href="/api/health">Health check</a></p>
</body>
</html>`;
  
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

function handleCors() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

function isValidIP(ip) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}
