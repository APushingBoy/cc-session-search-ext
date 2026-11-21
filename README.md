# Claude Session Search

在 VS Code 中搜索本地所有 Claude Code 历史对话。全程本地执行、只读、不调用任何 LLM。

## 使用

1. 点击右下角状态栏 **🔍 Claude Search**（或命令面板执行 `Claude Session Search: 搜索历史对话`）。
2. 输入关键词（大小写不敏感，支持中英文、代码、路径），可切换「全部 / 用户提问 / Claude 回复」。
3. 点击结果（或方向键 + 回车）在旁边打开会话预览，自动滚动并高亮命中消息。
4. 预览中可复制单条消息、Session ID、Session 文件路径。
5. 搜索界面「刷新」按钮重新扫描会话目录。

数据目录：优先 `CLAUDE_CONFIG_DIR`，否则 `~/.claude`；扫描其下 `projects/**/*.jsonl`。

## 开发

```bash
npm install
npm run compile     # 构建
npm run typecheck   # 类型检查
npm test            # 编译并运行单元测试（node:test + fixtures）
```

在 VS Code 中打开本目录按 **F5** 启动 Extension Development Host。

## 结构

```text
src/
├── extension.ts            # 激活、状态栏入口、命令
├── session/
│   ├── types.ts            # 类型定义
│   ├── discovery.ts        # 数据目录定位与 JSONL 发现
│   └── parser.ts           # JSONL 流式解析与消息分类
├── search/
│   └── searchService.ts    # SessionStore 缓存 + 纯函数搜索/摘要/定位
└── ui/
    ├── searchPanel.ts      # 搜索 Webview
    ├── sessionPreview.ts   # 会话预览 Webview
    ├── markdown.ts         # 安全的极简 Markdown 渲染（先转义）
    └── format.ts           # 时间格式化、nonce
media/                      # Webview 前端脚本与样式（无框架）
test/                       # 单元测试与模拟 JSONL fixtures
```
