# PartnerFM — 本地 AI 智能体工作台

> **浏览器即桌面，本地即安全。**  
> 一个在浏览器中运行的本地 AI 工作站，文件、对话、Agent、MCP 全栈闭环，
> 数据不出本机，隐私由你掌控。

```text
pip install partnerfm   →   一键起飞，全本地运行
```

---

## 核心功能

| 模块 | 一句话说明 |
|------|-----------|
| 📁 **文件管理** | 侧边栏文件树 + 多标签编辑器，支持拖拽、多格式预览、⌘P 搜索 |
| 💬 **AI 对话** | 多会话独立管理，流式输出、多模型切换、多模态（图片）、Markdown 渲染 |
| 🤖 **Agent 系统** | Think → Tool Call → Result 循环，内置 11 个工具，工具调用可视化卡片展示 |
| 🎭 **多智能体协作** | 5 个预置智能体（全能/代码/文案/图表/数据分析），支持串联和内嵌协作 |
| 🎯 **角色系统** | 12 个预置角色（文案写手、教程讲师、选题策划等），一键注入 prompt |
| 🔧 **模型管理** | 支持 DeepSeek、OpenAI、Claude、智谱、通义千问等，支持自定义 Provider |
| 🔌 **MCP 集成** | 飞书、企业微信、GitHub、Notion 等外部平台工具接入 |
| 📊 **数据监测** | 社媒数据查询（抖音、小红书等） |
| 🧠 **语义检索** | SQLite 本地向量索引，语义级文件搜索，数据不出机器 |

---

## 架构

```
浏览器 (File System API + IndexedDB)  ←→  Python HTTP Server (Agent 循环 + SQLite)
```

---

## 快速开始

```bash
pip install partnerfm
partnerfm
```

浏览器访问 `http://localhost:8080` 即可使用。
