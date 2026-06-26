/**
 * WorkBuddy Sidecar — Node.js HTTP SSE 服务器
 *
 * 桥接 PartnerFM（Python 后端）与 @tencent-ai/agent-sdk
 *
 * 使用方式：
 *   1. cd workbuddy-sidecar && npm install
 *   2. node server.js
 *   （默认监听 localhost:9876）
 *
 * 安全提示：sidecar 默认只绑定 127.0.0.1，仅 PartnerFM 后端的
 * /api/workbuddy 路由可以访问，不对外暴露。
 */

import { createServer } from 'node:http';
import { query } from '@tencent-ai/agent-sdk';

const PORT = parseInt(process.env.WORKBUDDY_SIDECAR_PORT || '9876', 10);
const HOST = process.env.WORKBUDDY_SIDECAR_HOST || '127.0.0.1';

// 简易内存 session 存储（生产环境建议用 Redis 或数据库）
const sessions = new Map();

// ---------- 工具函数 ----------

/** 发送 SSE 事件 */
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** 发送 SSE 错误并关闭连接 */
function sendSSEError(res, code, message) {
  sendSSE(res, 'error', { code, message });
  res.end();
}

// ---------- HTTP 路由 ----------

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  // CORS — 允许 PartnerFM 后端（或开发时的前端直连）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ----- 健康检查 -----
  if (path === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
    return;
  }

  // ----- 核心接口：/api/chat (SSE 流式) -----
  //
  // POST /api/chat
  // Content-Type: application/json
  // Body: { prompt: string, model?: string, sessionId?: string, options?: {...} }
  //
  // SSE 事件:
  //   system   — 会话初始化（含 sessionId、tools 等）
  //   text     — AI 文本回复块
  //   tool_use — 工具调用信息
  //   result   — 查询结束（含耗时、费用）
  //   error    — 错误
  //   done     — 流结束信号
  //
  if (path === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      let params;
      try {
        params = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      const { prompt, model, sessionId, options = {} } = params;
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'prompt is required' }));
        return;
      }

      // 设置 SSE 响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        // 构造 SDK 查询选项
        const q = query({
          prompt,
          options: {
            model: model || options.model,
            maxTurns: options.maxTurns ?? 20,
            permissionMode: options.permissionMode || 'default',
            cwd: options.cwd,
            settingSources: options.settingSources,
            allowedTools: options.allowedTools,
            ...(options.env ? { env: options.env } : {}),
          },
        });

        for await (const message of q) {
          switch (message.type) {
            case 'system':
              sendSSE(res, 'system', {
                sessionId: message.session_id,
                tools: message.tools,
              });
              break;

            case 'assistant':
              for (const block of message.message.content) {
                if (block.type === 'text') {
                  sendSSE(res, 'text', { text: block.text });
                } else if (block.type === 'tool_use') {
                  sendSSE(res, 'tool_use', {
                    name: block.name,
                    input: block.input,
                  });
                } else if (block.type === 'tool_result') {
                  sendSSE(res, 'tool_result', {
                    content: block.content,
                  });
                }
              }
              break;

            case 'result':
              sendSSE(res, 'result', {
                subtype: message.subtype,
                durationMs: message.duration_ms,
                totalCostUsd: message.total_cost_usd,
              });
              break;
          }
        }

        sendSSE(res, 'done', {});
      } catch (err) {
        sendSSEError(res, 'SDK_ERROR', err.message || String(err));
        return;
      }

      res.end();
    });
    return;
  }

  // ----- 多轮对话 Session API -----
  //
  // POST /api/session
  // Body: { action: 'create', model?: string }  → 返回 sessionId
  // Body: { action: 'send', sessionId, prompt } → SSE 流式回复
  // Body: { action: 'close', sessionId }
  //
  if (path === '/api/session' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      let params;
      try {
        params = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      const { action, sessionId, prompt: sessionPrompt, model: sessionModel } = params;

      // --- Create ---
      if (action === 'create') {
        // 注意：unstable_v2_createSession 是 SDK 提供的多轮对话接口
        // 当前 SDK Preview 阶段不稳定，这里用 query + 传递 sessionId 做上下文保持
        const sid = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        sessions.set(sid, { createdAt: Date.now(), history: [] });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId: sid }));
        return;
      }

      // --- Send (多轮对话流式回复) ---
      if (action === 'send') {
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'session not found' }));
          return;
        }

        if (!sessionPrompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'prompt is required for send action' }));
          return;
        }

        const session = sessions.get(sessionId);

        // 构造带上下文的 prompt
        // SDK query() 是单轮接口，我们用拼接上下文的方式模拟多轮
        const contextPrompt = session.history.length > 0
          ? `[对话历史]\n${session.history.join('\n')}\n\n[当前消息]\n${sessionPrompt}`
          : sessionPrompt;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        let fullResponse = '';

        try {
          const q = query({
            prompt: contextPrompt,
            options: {
              model: sessionModel || 'deepseek-v3.1',
              maxTurns: 20,
              permissionMode: 'default',
            },
          });

          for await (const message of q) {
            switch (message.type) {
              case 'system':
                sendSSE(res, 'system', { sessionId: message.session_id });
                break;
              case 'assistant':
                for (const block of message.message.content) {
                  if (block.type === 'text') {
                    fullResponse += block.text;
                    sendSSE(res, 'text', { text: block.text });
                  }
                }
                break;
              case 'result':
                sendSSE(res, 'result', {
                  subtype: message.subtype,
                  durationMs: message.duration_ms,
                });
                break;
            }
          }
        } catch (err) {
          sendSSEError(res, 'SDK_ERROR', err.message || String(err));
          return;
        }

        // 保存对话历史
        session.history.push(`User: ${sessionPrompt}`);
        session.history.push(`Assistant: ${fullResponse}`);
        if (session.history.length > 20) {
          session.history.splice(0, session.history.length - 20);
        }

        sendSSE(res, 'done', {});
        res.end();
        return;
      }

      // --- Close ---
      if (action === 'close') {
        sessions.delete(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'closed' }));
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `unknown action: ${action}` }));
    });
    return;
  }

  // ----- 404 fallback -----
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

// ---------- 启动服务器 ----------

const server = createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`[WorkBuddy Sidecar] 运行在 http://${HOST}:${PORT}`);
  console.log(`[WorkBuddy Sidecar] SDK: @tencent-ai/agent-sdk`);
  console.log(`[WorkBuddy Sidecar] 端点:`);
  console.log(`  POST /api/chat       — 单轮查询（SSE 流式）`);
  console.log(`  POST /api/session    — 多轮对话（create/send/close）`);
  console.log(`  GET  /health         — 健康检查`);
});
