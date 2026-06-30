# Seegent 多智能体协作平台 — 产品需求文档

> **版本**: v0.1 | **状态**: 草案 | **更新**: 2026-06-22
>
> 本文档由 AI 编排层阅读、解析并据此实现。所有数据模型明确，接口契约完整。

---

## 1. 问题陈述

**用户场景**：用户在 Seegent 中需要通过"对话"的方式，灵活调度多个 AI 智能体来完成复杂工作流——例如"让代码助手写一个排序算法"、"让文案助手把它写成博客"、"让数据分析师分析用户行为数据"——并在同一个平台内查看所有产物（MD 文档、HTML 页面、SVG 图表、PNG 图片）。

**当前缺陷**：
- 当前 Agent 是**单体的**，只有一个上下文循环，无法在同一个对话中调用不同的"角色+模型+工具集"组合
- 没有"智能体"概念，只有"角色"（Role），而角色是**纯提示词**层面，不绑定模型、工具白名单、文件存储空间
- Agent 调用无法嵌套/串联/并联，无法实现"A 做完 → B 接手 → C 汇总"的工作流
- Agent 输出的产物（MD/HTML/图片）没有**自动保存到工作区 + 自动预览打开**的能力

**不解决的成本**：
- 用户需要手动拷贝结果到文件 → 切换到文件管理 → 创建新文件 → 手动查看，流程割裂
- 无法实现"让 A 调用 B"的协作，所有任务都压在一个 Agent 上，模型能力混用
- 无法体系化管理不同项目对应的 Agent 配置

---

## 2. 目标

| # | 目标 | 可衡量标准 |
|---|------|-----------|
| 1 | 在聊天中直接调用**多个注册的智能体**完成任务 | 单条消息可触发至少 2 个子 Agent 依次/并行执行 |
| 2 | Agent 产物（MD/HTML/图片）自动保存到工作区并预览 | Agent 输出文件后，文件自动出现且焦点切换到预览 |
| 3 | 可视化的"项目 ↔ Agent 映射表"，一眼看清哪个智能体管哪个项目 | 新增 Agent 管理页面，显示 Agent 名称、模型、所属项目、状态 |
| 4 | Agent 注册表可自由增删改，每个 Agent 独立配置（角色提示词 + 模型 + 工具白名单） | 用户可在 UI 上创建/编辑 Agent，不涉及代码修改 |
| 5 | 支持 Agent 编排：串联（A→B）、并联（A∥B）、嵌套（A 内调 B） | 至少支持串联和嵌套两种编排模式 |

---

## 3. 非目标

| # | 非目标 | 理由 |
|---|--------|------|
| 1 | 不实现 Agent 市场/社区分享 | 初始阶段只服务单一用户，分享功能是 Phase 3 |
| 2 | 不做 Agent 的持久化记忆/知识库 | 当前每个 Agent 启动为独立 Session，记忆通过上下文传递 |
| 3 | 不做 Agent 计费/用量统计 | 仅一个用户使用，无计费需要 |
| 4 | 不做远程 Agent（外部 API 调用） | Phase 2 可通过 MCP 协议扩展，但 Phase 1 仅本地 Agent |
| 5 | 不做 Agent 自动路由/意图识别 | 用户手动指定调用哪个 Agent，而非 AI 自动判断 |

---

## 4. 系统架构

### 4.1 顶层架构

```
┌──────────────────────────────────────────────────────┐
│                    Seegent UI                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 聊天窗口     │  │ Agent 管理    │  │ 文件管理      │ │
│  │ (多会话)     │  │ (注册/编辑)   │  │ (预览/搜索)   │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘ │
└─────────┼────────────────┼──────────────────┼─────────┘
          │ SSE            │ REST            │ File API
┌─────────▼────────────────▼──────────────────▼─────────┐
│          Seegent Server (Python HTTP Server)         │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Agent Orchestrator（编排层）               │  │
│  │                                                    │  │
│  │  ┌────────────┐  ┌───────────┐  ┌──────────────┐ │  │
│  │  │ 主 Agent    │──│invoke_agent│─→│ 子 Agent 池  │ │  │
│  │  │ (聊天循环)   │  │  工具     │  │ (隔离执行)    │ │  │
│  │  └────────────┘  └───────────┘  └──────────────┘ │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌────────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ LLM Proxy  │  │ MCP 客户端 │  │ 文件系统工具集    │ │
│  │ (多模型)    │  │ (飞书等)  │  │ (读/写/搜索/语义) │ │
│  └────────────┘  └──────────┘  └────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 4.2 核心概念

| 概念 | 定义 | 数据模型 |
|------|------|---------|
| **Agent（智能体）** | 一个独立配置的 AI 会话单元，包含：角色提示词 + 模型 + 工具白名单 + 输出产物默认路径 | JSON 对象，存储在 `AGENTS_FILE` |
| **Project-Agent 映射** | 一个 Agent 可以归属一个或多个 Project。Project 代表工作域 | `{agentId: [...projectIds]}` |
| **主 Agent** | 用户在聊天窗口直接对话的那个 Agent，拥有 `invoke_agent` 工具 | 当前会话 Agent |
| **子 Agent** | 被 `invoke_agent` 工具调起的 Agent，独立执行，完成后返回结果 | 运行时创建 |
| **产物（Artifact）** | Agent 通过工具生成的文件（MD / HTML / 图片） | 物理文件 + 文件系统位置 |
| **编排模式** | Agent 调用的拓扑：串联、并联、嵌套 | 运行时参数指定 |

### 4.3 Agent 执行模式

```
# 串联模式（Sequential）
用户: "调文案助手帮我写产品介绍，然后让代码助手把它做成 HTML 页面"
→ 主Agent: invoke_agent("文案助手", "写产品介绍")
  → 文案助手执行 → 返回 MD 内容
→ 主Agent: invoke_agent("代码助手", "把以下内容做成HTML: ...")
  → 代码助手执行 → 写 index.html 到产物目录
→ 主Agent 汇总结果给用户

# 并联模式（Parallel）[Phase 2]
用户: "同时让翻译助手和文案助手帮我看看这篇英文文档"
→ 主Agent: invoke_agent(["翻译助手", "文案助手"], ...)
  → 两个子Agent 并行执行
  → 主Agent 合并结果

# 嵌套模式（Nested）
用户: "帮我分析这个数据，出图表"
→ 数据分析Agent: invoke_agent("图表助手", "根据这个数据生成柱状图...")
  → 图表助手执行 → 生成 SVG
  → 结果返回给数据分析Agent
→ 数据分析Agent 整合分析报告 + 图表，写文件
```

---

## 5. 数据模型

### 5.1 Agent 注册表 `AGENTS_FILE`（`.seegent-agents.json`）

```json
{
  "agents": [
    {
      "id": "code-assistant",
      "name": "代码助手",
      "icon": "💻",
      "description": "全栈开发、算法实现、代码审查、架构设计",
      "systemPrompt": "你是资深全栈软件工程师...",
      "modelId": "deepseek-v3",
      "provider": "deepseek",
      "temperature": 0.3,
      "tools": ["list_dir", "read_file", "write_file", "search_files", "web_search", "web_fetch", "semantic_search"],
      "allowedOutputDir": "产出/代码",
      "allowedFileTypes": [".md", ".html", ".js", ".py", ".ts", ".json"],
      "maxIterations": 15,
      "createdAt": "2026-06-22T00:00:00Z",
      "updatedAt": "2026-06-22T00:00:00Z",
      "status": "active"
    },
    {
      "id": "writing-assistant",
      "name": "文案助手",
      "icon": "✍️",
      "description": "技术博客、产品文档、商业文案、翻译润色",
      "systemPrompt": "你是专业的中文写作者...",
      "modelId": "gpt-4o",
      "provider": "openai",
      "temperature": 0.7,
      "tools": ["read_file", "write_file", "search_files", "web_search"],
      "allowedOutputDir": "产出/文案",
      "allowedFileTypes": [".md", ".html", ".txt"],
      "maxIterations": 10,
      "createdAt": "2026-06-22T00:00:00Z",
      "updatedAt": "2026-06-22T00:00:00Z",
      "status": "active"
    },
    {
      "id": "drawing-assistant",
      "name": "图表助手",
      "icon": "🎯",
      "description": "SVG 图表、架构图、流程图、数据可视化",
      "systemPrompt": "你是专业的数据可视化专家...",
      "modelId": "claude-sonnet-4",
      "provider": "anthropic",
      "temperature": 0.5,
      "tools": ["write_file", "read_file"],
      "allowedOutputDir": "产出/图表",
      "allowedFileTypes": [".svg", ".html", ".md"],
      "maxIterations": 8,
      "createdAt": "2026-06-22T00:00:00Z",
      "updatedAt": "2026-06-22T00:00:00Z",
      "status": "active"
    },
    {
      "id": "data-analyst",
      "name": "数据分析师",
      "icon": "📊",
      "description": "数据洞察、统计分析、趋势预测、SQL 查询",
      "systemPrompt": "你是资深数据分析师...",
      "modelId": "deepseek-v3",
      "provider": "deepseek",
      "temperature": 0.2,
      "tools": ["list_dir", "read_file", "write_file", "search_files", "semantic_search", "web_search"],
      "allowedOutputDir": "产出/数据",
      "allowedFileTypes": [".md", ".csv", ".json", ".html"],
      "maxIterations": 12,
      "createdAt": "2026-06-22T00:00:00Z",
      "updatedAt": "2026-06-22T00:00:00Z",
      "status": "active"
    },
    {
      "id": "default-general",
      "name": "全能助手",
      "icon": "🔄",
      "description": "不限定角色，根据对话灵活调用所有能力",
      "systemPrompt": "",
      "modelId": "deepseek-v3",
      "provider": "deepseek",
      "temperature": 0.7,
      "tools": ["list_dir", "read_file", "write_file", "search_files", "semantic_search", "web_search", "web_fetch", "file_stats", "recent_files"],
      "allowedOutputDir": "产出/通用",
      "allowedFileTypes": [".md", ".html", ".txt", ".json", ".csv", ".svg", ".png", ".jpg"],
      "maxIterations": 10,
      "createdAt": "2026-06-22T00:00:00Z",
      "updatedAt": "2026-06-22T00:00:00Z",
      "status": "active"
    }
  ],
  "activeAgentId": "default-general"
}
```

### 5.2 Project-Agent 映射表

存储在 `SEEGENT_DIR/.seegent-project-agents.json`：

```json
{
  "mappings": [
    {
      "projectId": "project-alpha",
      "projectName": "Learn Chinese（汉字学习）",
      "projectIcon": "🀄",
      "description": "面向海外用户的汉字学习应用，Cloudflare 全栈，Paddle 支付",
      "agentIds": ["code-assistant", "writing-assistant"],
      "defaultAgentId": "code-assistant",
      "workspaceDir": "/path/to/project-alpha",
      "outputDir": "产出/LearnChinese"
    },
    {
      "projectId": "seegent",
      "projectName": "Seegent（智能体工作站）",
      "projectIcon": "🤖",
      "description": "多人在线聊天智能体工作站，本平台自身",
      "agentIds": ["code-assistant", "drawing-assistant", "data-analyst"],
      "defaultAgentId": "code-assistant",
      "workspaceDir": "/path/to/Seegent",
      "outputDir": "产出/Seegent"
    },
    {
      "projectId": "word-learning",
      "projectName": "示例项目",
      "projectIcon": "📖",
      "description": "PWA 架构 0-6 岁幼儿教育 App",
      "agentIds": ["code-assistant", "drawing-assistant", "writing-assistant"],
      "defaultAgentId": "code-assistant",
      "workspaceDir": "/path/to/project-alpha/app",
      "outputDir": "产出/示例工具"
    }
  ],
  "activeProjectId": "seegent"
}
```

### 5.3 invoke_agent 工具契约

```json
{
  "name": "invoke_agent",
  "description": "调用另一个注册的智能体来完成任务。当前 Agent 会暂停等待子 Agent 返回结果后再继续。",
  "parameters": {
    "type": "object",
    "properties": {
      "agentId": {
        "type": "string",
        "description": "目标智能体的 ID，来自 Agent 注册表"
      },
      "task": {
        "type": "string",
        "description": "要交给该智能体完成的具体任务描述"
      },
      "context": {
        "type": "string",
        "description": "传给子 Agent 的上下文信息，如之前对话的部分结果、文件路径等（可选）"
      },
      "outputFile": {
        "type": "string",
        "description": "期望的输出文件名（可选），如 'sorting-algorithm.md'。子 Agent 会写入到其 allowedOutputDir"
      },
      "mode": {
        "type": "string",
        "enum": ["sequential", "parallel"],
        "description": "执行模式：sequential（默认，等待完成）、parallel（并行执行，Phase 2）"
      }
    },
    "required": ["agentId", "task"]
  }
}
```

### 5.4 Agent 产物自动保存契约

当子 Agent 完成执行后，Orchestrator 会：

1. **收集子 Agent 的最终响应文本**
2. **扫描子 Agent 调用中 `write_file` 工具写入的文件路径列表**
3. **如果响应中包含了产物（如代码块中的 MD/HTML/图片），自动调用 `write_file` 生成物理文件**，路径为 `{workspace}/{agent.allowedOutputDir}/{timestamp}_{name}`
4. **将产物列表返回给主 Agent**
5. **前端收到包含 `"artifacts": [...]` 的消息事件时，自动打开文件管理 tab 定位到该文件**

---

## 6. API 接口定义

### 6.1 现有接口（保持不变）

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 普通聊天 |
| `/api/agent` | POST | **增强后的主 Agent 循环（新增 invoke_agent 工具）** |
| `/api/models` | GET/POST | 模型配置 |
| `/api/roles` | GET/POST | 角色配置（保持向后兼容） |

### 6.2 新增接口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/agents` | GET | 返回 Agent 注册表全部信息 |
| `/api/agents` | POST | 保存/更新 Agent 注册表 |
| `/api/agents/:id` | GET | 返回单个 Agent 详情 |
| `/api/project-agents` | GET | 返回 Project-Agent 映射表 |
| `/api/project-agents` | POST | 保存/更新映射表 |
| `/api/agent/:id/invoke` | POST | 直接调用某个 Agent（不通过主 Agent 编排层，用于单独测试 Agent） |

### 6.3 SSE 事件扩展（`/api/agent` 响应流）

在原有 SSE 事件基础上新增：

| 事件名 | 数据格式 | 说明 |
|--------|---------|------|
| `invoke_agent_start` | `{"agentId": "code-assistant", "task": "..."}` | 主 Agent 开始调用子 Agent |
| `invoke_agent_iteration` | `{"agentId": "...", "iteration": 1, "thought": "..."}` | 子 Agent 的思考过程 |
| `invoke_agent_tool_call` | `{"agentId": "...", "tool": "write_file", "args": {...}}` | 子 Agent 调用了工具 |
| `invoke_agent_tool_result` | `{"agentId": "...", "tool": "write_file", "result": "..."}` | 子 Agent 的工具执行结果 |
| `invoke_agent_response` | `{"agentId": "...", "response": "最终结果文本"}` | 子 Agent 完成，返回结果 |
| `invoke_agent_error` | `{"agentId": "...", "error": "错误信息"}` | 子 Agent 执行出错 |
| `artifact` | `{"path": "产出/代码/sorting-algorithm.md", "type": "md"}` | Agent 产出了一个文件，前端应自动预览 |

### 6.4 Agent 管理 API 详细契约

**GET `/api/agents`**

响应体：
```json
{
  "agents": [
    {
      "id": "code-assistant",
      "name": "代码助手",
      "icon": "💻",
      "description": "全栈开发、算法实现",
      "modelId": "deepseek-v3",
      "provider": "deepseek",
      "temperature": 0.3,
      "tools": ["list_dir", "read_file", "write_file", "search_files"],
      "allowedOutputDir": "产出/代码",
      "allowedFileTypes": [".md", ".html", ".js", ".py", ".ts", ".json"],
      "maxIterations": 15,
      "status": "active"
    }
  ]
}
```

**POST `/api/agents`**

请求体：
```json
{
  "agents": [
    { "id": "new-agent", ... }
  ]
}
```

**GET `/api/project-agents`**

响应体：
```json
{
  "mappings": [
    {
      "projectId": "project-alpha",
      "projectName": "Learn Chinese",
      "projectIcon": "🀄",
      "agentIds": ["code-assistant", "writing-assistant"],
      "defaultAgentId": "code-assistant",
      "workspaceDir": "/path/to/project-alpha",
      "outputDir": "产出/LearnChinese"
    }
  ],
  "activeProjectId": "seegent"
}
```

---

## 7. 用户故事

### P0 — 必须实现

| ID | 用户故事 | 验收标准 |
|----|---------|---------|
| US-001 | **作为用户**，我希望能创建一个新的智能体（配置名称、角色提示词、模型、工具白名单），以便为不同任务场景准备专用助手 | [ ] 在 UI 中看到"新建 Agent"入口<br>[ ] 填写名称、选择角色提示词（可复用现有 Role）、选择模型、勾选可用工具<br>[ ] 保存后 Agent 出现在 Agent 列表中 |
| US-002 | **作为用户**，我在与主 Agent 对话时，可以说"调代码助手帮我写一个排序算法"，主 Agent 应能调用代码助手并返回结果 | [ ] 主 Agent 工具列表中有 `invoke_agent` 工具<br>[ ] 子 Agent 独立执行，使用其配置的模型和提示词<br>[ ] 子 Agent 的结果返回给主 Agent，主 Agent 继续加工 |
| US-003 | **作为用户**，当子 Agent 产出一个文件（如 sorting-algorithm.md）时，该文件应自动保存到工作区对应目录（如 `产出/代码/sorting-algorithm.md`） | [ ] 文件自动创建在工作区<br>[ ] 前端聊天流收到 `artifact` 事件<br>[ ] 文件管理模块自动刷新，定位到该文件 |
| US-004 | **作为用户**，我希望在一个页面上看清"哪个智能体负责哪个项目"：表格列出 Agent 名称、模型、项目归属、状态 | [ ] 新增 Agent 管理页面<br>[ ] 表格包含：图标、名称、所属项目、模型、工具数、状态<br>[ ] 可编辑映射关系（将 Agent 关联/取消关联到项目） |
| US-005 | **作为用户**，我可以编辑已有 Agent 的配置（改提示词、换模型、增减工具） | [ ] 点击 Agent 进入编辑模式<br>[ ] 修改后保存，下次调用生效 |
| US-006 | **作为用户**，我可以删除一个不再需要的 Agent | [ ] 删除操作需二次确认<br>[ ] 删除后不再出现在 Agent 列表中<br>[ ] 关联的 Project-Agent 映射自动清除 |

### P1 — 重要但不阻塞

| ID | 用户故事 | 验收标准 |
|----|---------|---------|
| US-007 | **作为用户**，我希望看到每个 Agent 的调用历史——什么时候被调用了、做了什么、产出了什么文件 | [ ] Agent 详情页显示历史调用记录<br>[ ] 每条记录显示：调用时间、调用者、任务、产物列表 |
| US-008 | **作为用户**，在聊天中，我希望看到子 Agent 的思考过程"迭代状态"——就像主 Agent 一样显示 tool_call 和 tool_result 卡片 | [ ] 子 Agent 的 thinking/tool_call/tool_result 都通过 SSE 透传到前端<br>[ ] 前端用缩进/嵌套样式区分主 Agent 和子 Agent 的消息 |
| US-009 | **作为用户**，我希望可以设置"每个 Agent 在哪个工作区目录下产出的文件" | [ ] Agent 配置页有 `allowedOutputDir` 字段<br>[ ] Agent 执行时的工作区绑定到所属 Project 的 workspaceDir |
| US-010 | **作为用户**，我想预览子 Agent 产出的 HTML/SVG 文件：在聊天消息内显示预览卡片 | [ ] 当 artifact 类型为 html/svg 时，聊天消息内嵌 iframe 或 SVG 直接渲染 |

### P2 — 未来考虑

| ID | 用户故事 | 验收标准 |
|----|---------|---------|
| US-011 | **作为用户**，我希望多个子 Agent 可以并行执行（如"同时查资料 + 写代码 + 审代码"） | [ ] invoke_agent 支持 `mode: "parallel"`<br>[ ] 多个子 Agent 同时运行，结果合并返回 |
| US-012 | **作为用户**，我希望可以编排一个工作流模板（如"写代码 → 审查 → 生成文档"）并一键触发 | [ ] 创建 Agent 工作流模板<br>[ ] 模板有向无环图（DAG）式编排 |
| US-013 | **作为用户**，Agent 的资产可以导出/导入为 JSON 文件，方便分享 | [ ] 导出按钮生成 `.seegent-agent.json` 文件<br>[ ] 导入自动注册到 Agent 列表 |

---

## 8. 功能需求（Requirements）

### 8.1 Must-Have（P0）

| 编号 | 模块 | 需求描述 | 实现提示 |
|------|------|---------|---------|
| R-001 | 后端 | **Agent 注册表存储**：在 `.seegent-agents.json` 文件中存储 Agent 定义，使用 `AGENTS_FILE` 常量指向 `os.path.join(BASE_DIR, '.seegent-agents.json')` | 参考现有 `MODELS_FILE` 的读写模式，新增 `_load_json`/`_save_json` 调用 |
| R-002 | 后端 | **`invoke_agent` 工具实现**：在主 Agent 的工具列表中添加特殊工具，调用时：1. 查找 agentId 在注册表中是否存在 2. 创建一个新的 Agent 会话（独立的 messages 列表） 3. 使用该 Agent 的模型/api_key 4. 用该 Agent 的 systemPrompt + tools 白名单 5. 执行 6. 收集结果返回 | 核心改动在 `_agent_loop` 中 new function `_invoke_agent(agentId, task, context)` |
| R-003 | 后端 | **子 Agent 执行隔离**：子 Agent 共享父 Agent 的 api_key 和 base_url，但使用自己的 model 和 systemPrompt。子 Agent 的 tools 仅限于其白名单中的工具 | 实现时复用 `_agent_loop` 的 LLM 调用逻辑，但替换 messages/tools |
| R-004 | 后端 | **产物自动保存**：子 Agent 执行结束后，扫描其 `write_file` 调用和最终响应中的代码块，自动生成文件路径：`{workspace}/{allowedOutputDir}/{timestamp}_{name}` | 在 `_exec_tool` 中拦截 `write_file`，记录写入了哪些文件 |
| R-005 | 后端 | **SSE 事件透传**：子 Agent 执行过程中的 `iteration`/`tool_call`/`tool_result`/`error` 等事件通过主 Agent 的 SSE 流透传给前端 | 添加 `invoke_agent_start`/`invoke_agent_iteration`/`invoke_agent_tool_call`/`invoke_agent_response` 事件 |
| R-006 | 后端 | **Agent 管理 API**：新增 `/api/agents`（GET/POST）和 `/api/project-agents`（GET/POST）端点 | 类似 `/api/roles` 的 JSON 文件读写 |
| R-007 | 前端 | **Agent 管理页面**：在侧边栏/工具菜单中新增"Agent 管理"入口。主页面包含两个 tab：Agent 列表 + 项目映射表 | 可复用现有角色 UI 模式 |
| R-008 | 前端 | **Agent 列表视图**：卡片/表格展示所有 Agent，含图标、名称、描述、模型、状态 toggle | 与"角色选择"UI 风格一致 |
| R-009 | 前端 | **Agent 编辑/创建表单**：字段：名称、ID（自动生成）、图标 emoji picker、角色提示词（复用现有 Role）、模型选择、工具多选 checkboxes、allowedOutputDir 输入框、temperature slider | |
| R-010 | 前端 | **Project-Agent 映射表**：表格形式，列：项目名（可点选）、默认 Agent、可用 Agent（多标签）、管理区（编辑/删除） | |
| R-011 | 前端 | **子 Agent 执行可视化**：在聊天消息流中，主 Agent 的 `invoke_agent` 调用显示为嵌套卡片——可展开/折叠，内部显示子 Agent 的 thinking/tool_call/tool_result | CSS 缩进 + 不同背景色区分层级 |
| R-012 | 前端 | **产物自动预览**：前端收到 `artifact` SSE 事件时，若文件管理模块已加载该文件所在目录，自动选中并预览该文件。若未加载，尝试打开该文件预览 | |

### 8.2 Nice-to-Have（P1）

| 编号 | 需求描述 |
|------|---------|
| R-013 | Agent 调用历史记录：记录每个 Agent 被调用的时间、来源、任务摘要、产物列表 |
| R-014 | 从现有"角色"一键创建 Agent：在角色列表页加"→ 创建为 Agent"按钮，自动填充提示词 |
| R-015 | Agent 状态管理：在 UI 上可暂停/启用 Agent（`status: "active"|"paused"|"archived"`） |
| R-016 | Agent 搜索/过滤功能 |

### 8.3 Future（P2）

| 编号 | 需求描述 |
|------|---------|
| R-017 | 并联模式：`invoke_agent` 支持 `mode: "parallel"` |
| R-018 | Agent 工作流模板：可视化 DAG 编排器 |
| R-019 | Agent 导出/导入为 `.agent.json` 文件 |
| R-020 | 远程 Agent 调用（通过 MCP 代理） |

---

## 9. 实现路线图

### Phase 1（本周）

| 步骤 | 内容 | 涉及文件 |
|------|------|---------|
| 1 | 新增 `AGENTS_FILE` 常量 & 初始化 | `server.py` |
| 2 | 定义 Agent 数据模型（含 5 个默认 Agent 模板） | `server.py` |
| 3 | 实现 `invoke_agent` 工具（_invoke_agent 函数） | `server.py` `_agent_loop` |
| 4 | 实现子 Agent 的独立执行循环 | `server.py` |
| 5 | 实现 SSE 透传事件（invoke_agent_start/iteration/response） | `server.py` |
| 6 | 实现产物自动保存扫描逻辑 | `server.py` |
| 7 | 新增 API：`/api/agents`、`/api/project-agents` | `server.py` |
| 8 | 前端 Agent 管理页面（列表 + 编辑 + 创建） | `index.html` |
| 9 | 前端 Project-Agent 映射表页面 | `index.html` |
| 10 | 前端子 Agent 执行嵌套卡片渲染 | `index.html` |
| 11 | 前端产物自动预览逻辑 | `index.html` |

### Phase 2（下周）

| 步骤 | 内容 |
|------|------|
| 12 | 并行的子 Agent 调用模式 |
| 13 | Agent 调用历史记录存储 + 展示 |
| 14 | 从角色一键创建 Agent |
| 15 | Agent 状态管理（active/paused/archived） |
| 16 | Agent 搜索/过滤 |

### Phase 3（未来）

| 步骤 | 内容 |
|------|------|
| 17 | Agent 工作流模板（DAG 编排器） |
| 18 | Agent 导出/导入 |
| 19 | 远程 Agent MCP 代理 |

---

## 10. 成功指标体系

### 10.1 北极星指标

> **智能体协作效率** = 用户完成一个复杂任务（如"写代码 + 写文档 + 生成图表"）所需的最小交互轮次

### 10.2 驱动指标（Leading）

| 指标 | 定义 | 目标值 |
|------|------|--------|
| Agent 使用率 | 日均 invoke_agent 调用次数 | > 5 次/天 |
| 产物自动保存率 | Agent 产生文件自动保存成功的百分比 | > 95% |
| 子 Agent 成功率 | invoke_agent 调用成功返回结果的百分比 | > 85% |
| 单任务 Agent 串联数 | 平均每次复杂任务调用的 Agent 数量 | > 2 |

### 10.3 健康指标（Lagging）

| 指标 | 定义 | 目标值 |
|------|------|--------|
| 任务完成时间 | 从用户发出请求到收到最终产物的时间 | < 60 秒 |
| 用户满意度 | 用户对 Agent 协作体验的 1-5 评分 | > 4.0 |
| Agent 配置留存率 | 创建的 Agent 配置在 7 天后仍活跃的比例 | > 80% |

---

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 子 Agent 无限循环/超时 | 中 | 中 | 设置 `maxIterations` 上限（默认 10），超时后强制终止返回错误 |
| Agent 递归调用死循环（A 调 B，B 又调 A） | 低 | 高 | invoke_agent 中检测调用链深度，> 3 层直接拒绝 |
| 产物文件路径冲突 | 中 | 低 | 文件名加时间戳前缀 `20260622_1138_sorting-algorithm.md` |
| 子 Agent 使用不同模型 / provider，API 不统一 | 中 | 高 | 抽象统一 LLM 调用接口，所有 Agent 都走这个接口 |
| 前端 SSE 事件膨胀导致性能下降 | 低 | 中 | 子 Agent 的 iteration/tool_call 事件仅在展开时渲染 |

---

## 12. 未解决问题

| # | 问题 | 回答者 | 是否阻塞 |
|---|------|--------|---------|
| 1 | 子 Agent 是否继承父 Agent 的 api_key？还是每个 Agent 独立配置 API Key？ | 用户 | 是 |
| 2 | 子 Agent 是否共享父 Agent 的附件/上传文件？ | 用户 | 否 |
| 3 | 产物自动保存的文件命名规则：时间戳前缀 vs 用户指定？ | 用户 | 否 |
| 4 | 子 Agent 的 SSE 事件是否要精简（只透传关键事件）还是完整透传？ | 用户 | 否 |
| 5 | Project-Agent 映射表的工作区路径，是否支持多个不连续路径？ | 用户 | 否 |

---

## 13. 附录

### 13.1 默认 Agent 模板（首次安装时预置）

| 名称 | 模型 | 核心能力 | 产出目录 |
|------|------|---------|---------|
| 🔄 全能助手 | deepseek-v3 | 不限定角色，按需灵活调用 | `产出/通用` |
| 💻 代码助手 | deepseek-v3 | 全栈开发、算法实现、架构设计 | `产出/代码` |
| ✍️ 文案助手 | gpt-4o | 技术博客、产品文档、翻译润色 | `产出/文案` |
| 🎯 图表助手 | claude-sonnet-4 | SVG 图表、流程图、架构图 | `产出/图表` |
| 📊 数据分析师 | deepseek-v3 | 数据洞察、SQL 查询、统计分析 | `产出/数据` |

### 13.2 与现有"角色"系统的关系

| 维度 | 现有角色（Role） | 新 Agent |
|------|-----------------|---------|
| 定义 | 纯提示词字符串 | 提示词 + 模型 + 工具白名单 + 文件路径 |
| 存储 | `ROLES_FILE` | 独立的 `AGENTS_FILE` |
| 嵌套 | 无 | 支持 invoke_agent 嵌套调用 |
| 调用方 | 用户在聊天前选择 | 主 Agent 工具列表中的 invoke_agent |
| 迁移 | 可一键从角色创建 Agent | 创建时自动填充提示词 |

### 13.3 文件改动清单

```
server.py  — 新增常量、新增 API 端点、修改 _agent_loop
index.html — 新增 Agent 管理页面、修改聊天消息渲染、新增产物预览
新增文件:
.seegent-agents.json         — Agent 注册表（首次启动自动生成）
.seegent-project-agents.json — Project-Agent 映射表
```


---

> **下一步**：确认没问题的部分后，开始从「Phase 1」的第一行代码实现。
