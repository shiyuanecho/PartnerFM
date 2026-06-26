# PartnerFM

本地 AI 工作台，集文件管理、模型配置、AI 对话于一体。仿 Apple 设计风格，纯本地运行。

## 安装

```bash
pip install partnerfm
```

可选依赖（PDF/Word 索引、语义检索、OCR）：

```bash
pip install partnerfm[full]
```

## 启动

```bash
partnerfm --open
# → http://localhost:8765
```

或者直接运行源码：

```bash
python3 server.py
```

Mac 用户也可双击 `启动.command`。

## 四大模块

### 📁 文件管理
- **多文件夹管理** — 侧边栏添加多个文件夹，展开/折叠、拖拽移动文件
- **拖拽添加** — 从访达多选文件夹拖入侧边栏一键添加
- **文件预览** — Markdown（渲染+编辑）、HTML（实时预览）、PDF、图片、文本/代码
- **文件操作** — 新建/重命名/删除，右键菜单
- **IndexedDB 持久化** — 关闭后重新打开自动恢复

### 🤖 模型管理（Hermes 风格）
- **Provider 注册表** — 内置 302.AI、DeepSeek、OpenAI、Anthropic、智谱 GLM、通义千问、Moonshot
- **模型元数据** — 每个模型展示上下文长度和价格
- **302.AI 聚合 API** — 一把 Key 访问 50+ 模型
- **自定义 Provider** — 支持任意 OpenAI 兼容 API

### 💬 AI 对话
- 右侧聊天窗口，选择模型即可对话
- **文件上下文** — 打开 Markdown/文本文件后，对话自动附带文件内容
- 对话历史保存在 `.partnerfm-chats.json`

### 🔧 CLI & MCP
- 查看已连接的 CLI 工具（Cursor Agent、Hermes Agent）及使用教程
- MCP 服务器管理

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘P` | 快速搜索文件 |
| `⌘S` | 保存当前编辑 |
| `⌘W` | 关闭当前标签 |
| `⌘⇧T` | 恢复关闭的标签 |

## 技术实现

- `index.html` — 单文件前端，零依赖零构建
- `server.py` — Python HTTP 服务器 + LLM API 代理 + JSON 持久化
- **File System Access API** — 读写本地文件
- **IndexedDB** — 持久化文件夹句柄
- **localStorage** — 模块状态、文件夹元数据后备

## 浏览器兼容

需要 Chrome / Edge 108+（File System Access API）。Safari 暂不支持。

## 项目记忆

详见 [MEMORY.md](./MEMORY.md)，包含架构设计、持久化机制、已知 Bug 及修复记录。

## 许可

MIT
