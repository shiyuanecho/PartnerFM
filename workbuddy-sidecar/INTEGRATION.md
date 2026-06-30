# WorkBuddy ↔ Seegent 集成指南

## 架构概述

```
用户 → Seegent 前端 (index.html)
        → Python 后端 (server.py) /api/workbuddy
            → Node.js 侧车 (sidecar) port 9876
                → @tencent-ai/agent-sdk → WorkBuddy API
```

Python 后端不能直接调用 Node.js SDK，所以加一个**侧车进程**做桥接。

---

## 第一步：启动侧车

```bash
cd workbuddy-sidecar

# 安装依赖
npm install

# 启动（默认 localhost:9876）
node server.js
```

建议用 **启动.command** 里加一句自动启动，或者用 `pm2` 保活。

---

## 第二步：修改 server.py

在 `do_POST` 方法里加一个新路由。打开 `server.py`，找到第 1276-1279 行附近：

```python
        if self.path == '/api/agent':
            return self._agent_loop()
        if self.path == '/api/mcp-discover':
            return self._mcp_discover()
        self.send_error(404)
```

在 `self.send_error(404)` 之前，插入：

```python
        if self.path == '/api/workbuddy':
            return self._proxy_workbuddy()
```

然后在 `_proxy_chat` 方法后面（大约第 1567 行附近），添加这个新方法：

```python
    def _proxy_workbuddy(self):
        """将请求转发到 WorkBuddy 侧车进程 (Node.js SSE)."""
        import urllib.request

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        SIDECAR_URL = 'http://127.0.0.1:9876/api/chat'
        SIDECAR_TIMEOUT = 300  # 5 分钟超时

        req = urllib.request.Request(
            SIDECAR_URL,
            data=body,
            headers={
                'Content-Type': 'application/json',
            },
            method='POST'
        )

        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            with urllib.request.urlopen(req, timeout=SIDECAR_TIMEOUT) as resp:
                while True:
                    chunk = resp.readline()
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            # 侧车没启动时的友好提示
            err_msg = f'event: error\ndata: {{"code":"SIDECAR_DOWN","message":"WorkBuddy 侧车未启动，请先运行 workbuddy-sidecar 目录下的 node server.js"}}\n\n'
            self.wfile.write(err_msg.encode('utf-8'))
            self.wfile.flush()
```

---

## 第三步：修改 index.html（前端）

### 3.1 给模型选择器加一个「WorkBuddy」provider

找到 `PROVIDER_REGISTRY` 的定义（搜索 `const PROVIDER_REGISTRY`），在里面加一条：

```javascript
const PROVIDER_REGISTRY = {
  // ... 已有的 ...

  // 在最后一个 provider 后面加上：
  'workbuddy': {
    name: 'WorkBuddy',
    icon: '🤝',
    url: 'http://127.0.0.1:9876/v1',  // sidecar 地址（只做标识用）
    models: {
      'workbuddy-default': { label: 'WorkBuddy Agent', ctx: '无限', cost: '按量计费' }
    }
  }
};
```

### 3.2 修改 sendChat 函数

找到第 7539 行附近的 `sendChat` 函数，在 `const endpoint = useAgent ? '/api/agent' : '/api/chat';` 这行后面，改成：

```javascript
    // 判断是否使用 WorkBuddy
    const isWorkbuddy = pid === 'workbuddy';

    const endpoint = isWorkbuddy ? '/api/workbuddy'
                  : useAgent ? '/api/agent'
                  : '/api/chat';

    let body;
    if (isWorkbuddy) {
      body = { prompt: text, model: 'deepseek-v3.1', options: { maxTurns: 20 } };
    } else {
      body = { api_key: model.key, base_url: model.url, model: model.mid, messages };
      if (workspace) body.workspace = workspace;
    }
```

### 3.3 适配 SSE 事件解析

WorkBuddy sidecar 返回的 SSE 事件名和 /api/agent 不一样，需要在 `sendChat` 的 fetch 响应处理部分做适配。找到 `const resp = await fetch(...)` 下面的 `handleAgentStream` / `handleChatStream` 判断处，改成：

```javascript
    if (isWorkbuddy) {
      await handleWorkbuddyStream(resp, session, abortSignal);
    } else if (useAgent) {
      await handleAgentStream(resp, session, abortSignal);
    } else {
      await handleChatStream(resp, session, abortSignal);
    }
```

### 3.4 新增 handleWorkbuddyStream 函数

在 `handleChatStream` 函数附近，添加：

```javascript
async function handleWorkbuddyStream(resp, session, abortSignal) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  // 创建 assistant 消息占位
  addChatMessage('assistant', '', true);
  const msgs = session.messages;
  const msgIdx = msgs.length;
  msgs.push({ role: 'assistant', content: '' });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (abortSignal.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);
          if (data.text) {
            fullText += data.text;
            updateLastAssistantMessage(fullText, msgIdx);
          }
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }

  msgs[msgIdx].content = fullText;
}
```

### 3.5 补充工具函数

如果还没有 `updateLastAssistantMessage` 函数，在文件末尾附近加一个：

```javascript
function updateLastAssistantMessage(text, msgIdx) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const assistantMsgs = container.querySelectorAll('.msg.assistant');
  if (!assistantMsgs.length) return;
  const el = assistantMsgs[assistantMsgs.length - 1];
  if (el) {
    el.innerHTML = renderMarkdown(text);
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}
```

---

## 第四步：启动顺序

```bash
# 终端 1：启动侧车
cd workbuddy-sidecar && node server.js

# 终端 2：启动 Seegent
cd .. && python3 server.py
```

然后在浏览器打开 `http://localhost:8765`，在模型选择器里选 **WorkBuddy Agent**，即可使用。

---

## 验证

```bash
# 测试侧车是否正常运行
curl -s http://127.0.0.1:9876/health
# → {"status":"ok","sessions":0}
```

---

## 注意事项

| 问题 | 说明 |
|------|------|
| **认证** | 侧车会自动复用你终端的 `codebuddy` 登录态。也可以设 `CODEBUDDY_API_KEY` 环境变量 |
| **超时** | 默认 300 秒，可以在 sidecar 的 `maxTurns` 或 timeout 参数调整 |
| **资源消耗** | 每个请求独享一个 SDK session，多用户并发时注意内存 |
| **生产部署** | 建议用 `pm2` 管理侧车进程：`pm2 start server.js --name workbuddy-sidecar` |
