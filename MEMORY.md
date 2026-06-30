# Seegent 项目记忆

## 架构概览

- `index.html`：单文件前端，包含所有 JS/CSS/HTML
- `server.py`：Python HTTP 服务器，静态文件 + API 代理 + JSON 持久化
- 运行方式：`python3 server.py` → `http://localhost:8765`

## 模块总览

左侧导航共 4 个模块：

| 模块 | 数据源 | 说明 |
|------|--------|------|
| 文件 | IndexedDB + File System Access API | 文件夹树、标签页编辑、Markdown/HTML 预览、多模态支持 |
| 模型 | `.seegent-models.json` | Provider CRUD、API Key 管理、模型勾选、聊天选择器 |
| MCP | `.seegent-mcp.json` | MCP 服务器注册表 + CLI 命令集成 |
| 角色 | `.seegent-roles.json` | 角色 CRUD（合并了原提示词 + 能力/技能模块） |

模块切换通过 `switchModule(name)` → 对应 `#{name}-module` div 的 `.active` 类切换。activeModule 持久化到 localStorage，启动时 `setTimeout` + try-catch 恢复。

## 文件夹持久化机制

### 原理
文件夹通过 File System Access API 的 `FileSystemDirectoryHandle` 访问。Handle 对象可通过结构化克隆存入 IndexedDB，刷新/重启后从中恢复。

### 关键数据流
1. 用户添加文件夹 → `showDirectoryPicker()` → 获得 `FileSystemDirectoryHandle`
2. 立即存入 IndexedDB（`saveFolderHandle`）+ localStorage（元数据后备）
3. 页面加载时 `init()` → `getSavedFolders()` 从 IndexedDB 读取
4. 对每个 handle 调用 `queryPermission({ mode: 'readwrite' })`：
   - `'granted'` → 直接恢复到侧边栏
   - 其他值 → 加入待授权列表，显示"一键恢复"横幅
5. 用户点击恢复 → `requestPermission()`（需用户手势）→ 重新授权后写回 IndexedDB

### 重要原则
- **绝不在权限检查失败时删除 IndexedDB 记录**：浏览器重启后权限会被清除，`queryPermission()` 可能返回非 `'granted'`。此时应保留记录，等用户手势重新授权。只有用户明确拒绝或 handle 完全失效时才删除。
- **反序列化后验证 handle 有效性**：检查 `typeof handle.queryPermission === 'function'`，结构化克隆可能损坏 handle。
- **恢复成功后重新持久化**：`requestPermission()` 成功后，调用 `saveFolderHandle()` 更新 IndexedDB。
- **localStorage 作为元数据后备**：仅存 `{ id, name }`，IndexedDB 完全不可用时至少能提示用户之前添加过哪些文件夹。

## 文件夹排序

- 排序通过 localStorage key `seegent-folder-order` 持久化（`state.folders.map(f => f.id)` 数组）
- `saveFolderOrder()` 在添加/排序时写入，`applyFolderOrder()` 在 init 时恢复
- 新增文件夹追加到排序末尾，排序中不存在的旧文件夹保持原位置

## DOM 引用模式

### 规则：声明式映射 + 自动生成 + 启动校验

```javascript
const DOM_SELECTORS = {
  sidebar:    '#sidebar',
  folderList: '#folder-list',
  // 新增元素只需加一行
};

const dom = {};
for (const [key, sel] of Object.entries(DOM_SELECTORS)) {
  dom[key] = document.querySelector(sel);
  if (!dom[key]) console.warn('[Seegent] ⚠️ DOM 缺失: ' + key + ' ← ' + sel);
}
```

### 为什么
- 手写 `const dom = { sidebar: $('#sidebar'), ... }` 容易漏加属性
- `dom.undefined.addEventListener(...)` → TypeError → 中断整个 script 块 → 后续 `init()` 不执行
- 声明式映射 + 启动校验杜绝了这类问题

## JS 错误传播陷阱

两个 `<script>` 块在 `<body>` 末尾同步执行。若第一个 script 块中任意一行抛出未捕获错误，该块后续代码全部跳过。

常见场景：`dom.xxx.addEventListener(...)` 中 `dom.xxx` 为 undefined → TypeError → 后面的 `init()` 从未执行 → 即使 IndexedDB 中有数据也无法恢复。

## 聊天功能

### 会话数据模型
```javascript
{ id, name, contextItems: [{type,name,handle,icon}], messages: [{role,content}], modelId, systemPrompt, systemPromptText }
```

### 布局顺序（从上到下）
1. 对话 tabs 行（+ 按钮 + 对话标签）
2. 模型选择 + 系统提示选择 + 折叠按钮
3. 自定义提示文本框（选"自定义提示"时显示）
4. 文件上下文标签
5. 消息区
6. 输入框

### 每会话独立配置
- 模型选择 `onchange` 立即写入 `session.modelId` + `saveChatSessions()`
- 提示选择 `onchange` 立即写入 `session.systemPrompt` + `saveChatSessions()`
- `renderChatUI()` 每次渲染时恢复当前会话的选择器状态

### 系统提示数据流
- 提示词模块 → `promptConfig.prompts` → `refreshPromptSelect()` → 聊天下拉框
- 动态加载自 `/api/prompts`，CRUD 操作后自动同步
- 下拉框占位文字："选择模板"（`value=""` disabled）
- "无模板" 的 id 为 `"none"`（不是空字符串，避免和占位符冲突）

## 模型管理

### 数据模型
- 配置文件 `.seegent-models.json`，结构为 `{ providers: { pid: { key, models[] } }, default: "pid/model" }`
- Provider 注册表 `PROVIDER_REGISTRY` 定义内置 provider 及其模型元数据（ctx、cost）
- 旧格式 `{ models: [...] }` 自动迁移到新格式
- `getProviderModelMap()` 遍历所有已配置 provider 的启用模型，扁平化为聊天选择器选项

## 已修复的 Bug 及根因

### 1. 返回按钮不工作
- **现象**：点击 `← 返回` 无反应
- **根因**：`modelBackTarget` 存入字符串函数名，但 `modelGoBack()` 直接当函数调用
- **修复**：判断 `typeof`，字符串则通过 `window[name]` 查找函数

### 2. 浏览器刷新后回到首页
- **现象**：在模型管理页面刷新，自动跳回文件管理页
- **根因**：`activeModule` 默认写死 `'file'`，切换模块时未持久化
- **修复**：切换模块时 `localStorage.setItem('seegent-module', name)`，启动时从 localStorage 恢复

### 3. 刷新后页面全白、点不动
- **现象**：加了模块持久化后，刷新页面所有内容消失
- **根因**：IIFE 同步执行时 localStorage 值对应的模块 DOM 不存在，所有 `.active` 类被移除
- **修复**：用 `setTimeout(fn, 100)` + `getElementById` 校验 + try-catch

### 4. 模型列表中多出旧模型 ID
- **现象**：DeepSeek 配了两个 V4 模型，但聊天选择器显示 3 个
- **根因**：旧格式迁移时把 `deepseek-chat` 写入 `models` 数组，后续编辑时旧 ID 未被清理
- **修复**：清理 `.seegent-models.json` 中的旧 ID，`showProviderDetail` 做防御处理

### 5. 第二个 script 块崩溃导致部分功能失效
- **现象**：页面加载后右键菜单、模块切换等功能异常
- **根因**：死代码 `updateChatContext()` 调用了不存在的 `getFileContext()` → ReferenceError → 第二个 script 块中断
- **修复**：删除死代码（`updateChatContext` 函数 + 启动调用 + `switchModule` wrap）

### 6. 新建文件夹变成文档
- **现象**：右键菜单"新建文件夹"创建出来的图标是文档而非文件夹
- **根因**：`insertIntoTreeNode()` 写死 `kind: 'file'`，不传参时所有插入都当成文件
- **修复**：加 `kind` 参数（默认 `'file'`），文件夹创建时传 `'directory'`；另新增 `insertIntoTreeNodes()` 做 name 兜底匹配

### 7. 系统提示选择器刷新后空白
- **现象**：刷新页面后提示词下拉框不显示选中值，一片空白
- **根因**：`loadPromptConfig()` 异步加载，可能在 `renderChatUI()` 之后才完成；且"无模板"的 id 是空字符串 `""`，和占位符 value 冲突
- **修复**：
  - "无模板" id 从 `""` 改为 `"none"`
  - 占位改为 `<option value="" disabled selected>选择模板</option>`
  - `refreshPromptSelect()` 恢复当前会话的选中值
  - `renderChatUI()` 每次都恢复选择器状态

### 8. 聊天区横条左边缘不对齐
- **现象**：tabs 行、模型选择行、消息区左边缘不在同一条线上
- **根因**：各元素 padding 不统一（12px、14px、16px 混用）
- **修复**：统一所有聊天区横条左右内边距为 16px

## 待办（第 2 阶段）

### OCR（图片内文字建索引）
- 对图片文件提取文字内容并建索引，使语义检索能命中图片中的文字

### 向量语义检索（embedding + SQLite 向量库）
- 对文件内容生成向量嵌入，支持语义搜索（已预留 `_build_embedding`、`_index_file` 等后台接口）
- 数据库 `.seegent-index.db` 已创建 schema，等待 embedding API 接入

### PDF/Word 全文建索引
- 对 PDF 和 Word 文档生成全文索引，支持语义检索

## 已完成的功能升级

### 第 1 阶段智能体升级（2026-06-13 ~ 2026-06-14）
- ✅ SSE 流式输出（聊天 API 支持流式响应）
- ✅ Agent Tools（文件读写、搜索、Web 搜索、MCP 工具等）
- ✅ Markdown 渲染（聊天消息支持 Markdown 格式）
- ✅ 角色系统（合并提示词 + 能力/技能，统一为角色管理）
- ✅ MCP CLI 集成（MCP 服务器 CLI 命令 CRUD）
- ✅ AI 文件能力升级（文件夹路径绑定、search_files 支持 regex+递归、read_file 分段、多模态图片）
- ✅ _exec_tool 重复执行 bug 修复
- ✅ 聊天区横条与左侧模块区对齐修复

## 维护注意事项

- 修改 HTML 结构时，同步检查 `DOM_SELECTORS` 表是否完整
- 新增 id 元素后，在 `DOM_SELECTORS` 中加一行，表格按字母排序
- 修改文件夹持久化相关逻辑时，参照"重要原则"中的 4 条规则
- 不要删除 `.seegent-state.json`（服务器端状态，存 tabs/expandedNodes 等）
- `server.py` 中 `Cache-Control: no-store` 仅影响 HTTP 缓存，不影响 IndexedDB
- **页面级 IIFE 用 `setTimeout` + try-catch 包裹**，避免同步执行时操作未就绪 DOM 导致整页崩溃
- **字符串函数名用 `window[name]()` 调用**，不要直接当函数执行
- **`localStorage` 读取必须防御**：值可能不存在、被篡改、对应 DOM 已删除
- **绝对不要在代码、配置、对话中明文输出任何密钥**：包括但不限于 API Key、App ID、App Secret、Token、密码。配置文件中的敏感字段一律用占位符（如 `<你的AppToken>`），让人手动填写。教程示例中也不得出现真实凭证
- **配置文件是用户手动维护的**：`.seegent-models.json`、`.seegent-mcp.json`、`.seegent-cli.json` 中的密钥和 Token 由用户自己填写，工具绝不代填明文
