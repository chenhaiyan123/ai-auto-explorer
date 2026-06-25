# 🧭 HiExplore · AI 自动探究平台

[English](./README.en.md) | **中文**

> **以问题为坐标，以智能为货币。**
> 把有价值的问题、想法和好奇心挂在后台，让 AI 像一支团队一样长期自动探究、沉淀，并在必要时把工作交回给你。

HiExplore 是一个开源的、**问题驱动的自主探究平台**。它把每个项目当成一个「研究仓库」：你定义一个值得深挖的问题，AI 把它拆成几个关键方向、组建一支各有分工的 Agent 团队，围绕这些方向长期探索、产出结构化笔记，并把笔记沉淀成一张可导航的知识图谱。整个过程数据都在你自己的浏览器与本地 Markdown 文件里，模型也由你自己接入。

**适合谁：** 独立研究者 / 创作者 / 独立开发者（低门槛地把好奇心变成持续探究），以及做情报调研、尽职调查的人（把一个问题挂上去，得到持续、可溯源的调查）。

---

## ✨ 核心功能

**🗂️ 项目即文件夹（像代码仓库的工程笔记）**
一个项目就是一个文件夹，自带 `README` 和 `总览` 主文件。项目分解为 5–8 个关键节点（二级），每个节点内部还能再开三级详情。左侧是可缩进、可折叠的笔记树，所有笔记都能折叠收起，长内容也按标题折叠成大纲，不再是一面墙的字。

**🔗 双向链接 + 知识图谱**
在任意笔记正文里用 `[[标题]]` 关联其它笔记，自动形成出链 / 反向链接。点工具栏的「🕸️ 图谱」弹出关系网络：纵向是层级、横向是关联，一眼看清问题之间的脉络。

**🤝 AI 组建团队 + 团队群聊**
点项目上的 🤝，AI 会读懂项目目标 → 拆成 5–8 个关键节点 → 按「工作板块」（市场调研 / 工程制作…）分工 → 给每个方向指派一个专门的 Agent → 可一键让团队开始自动探索。右侧是与团队的群聊：@某个成员单独发言、`[[引用]]` 任意笔记进上下文、把 AI 的产出一键「补充到笔记」。

**🔥 问题广场（筛选有价值的问题）**
像知乎一样收集候选问题，用 QVS（稀缺性 / 深度 / 可验证性 / 社会价值 / 创新性 / 可执行性 6 维）打分排序，支持「只看高价值」「关注 / 赞」两套兴趣机制，看中的问题一键「立项」转成项目。

**📓 本地 Markdown 库（你的数据你做主）**
所有内容存在浏览器 localStorage；可把单篇导出 `.md`、整库导出 `.zip`（项目即文件夹的结构）、导入 `.md`，在 Chrome/Edge 里还能直接保存到本地文件夹（Obsidian 式 Vault）。

**🧠 模型自由接入**
所有 AI 能力都走你自己配置的模型，无内置后端：
- 本地：Ollama、LM Studio、vLLM（数据不出本机）
- 云端：任何 OpenAI 兼容 API（DeepSeek、通义千问、Claude…）
- 自部署代理：把 Key 藏在 Serverless 函数后（见 `server/fc_backend.js`）

**🔌 IoT / 实验设备接入**
注册带 HTTP API 的设备（传感器、培养箱、机械臂…），AI 在探索中可自主调用读取数据、执行操作，把物理世界纳入探究闭环，调用有日志可审计。

**🌗 白天 / 深色主题**，顶栏一键切换。

---

## 🚀 快速开始

```bash
git clone https://github.com/<your-name>/hiexplore.git
cd hiexplore
npm install
npm run dev        # http://localhost:3000
```

首次进入点右上角 **⚙️ 设置 → 模型接入**，选一个预设填好即可使用，无需任何后端。

### 配置模型（举例）

| 场景 | 接入方式 | API Base URL | 模型名 | 备注 |
|---|---|---|---|---|
| 本地零成本 | OpenAI 兼容 | `http://localhost:11434/v1` | `qwen2.5:7b` | 先 `ollama serve` |
| DeepSeek（推荐性价比） | OpenAI 兼容 | `https://api.deepseek.com/v1` | `deepseek-chat` | 需 DeepSeek Key |
| Claude（更完整） | OpenAI 兼容 | `https://api.anthropic.com/v1` | `claude-sonnet-4-6` | 需 Anthropic Key |

> 提示：模型越强，自动探究的内容越深入、越可靠。顶栏的 🧠 徽标会显示当前正在使用的模型。

---

## 🖥️ 桌面客户端（推荐用本地模型时）

做成桌面应用后，调用本地 Ollama / 局域网 IoT 设备不再受浏览器跨域和混合内容限制，离线本地优先。

```bash
npm install          # 首次会下载 Electron 运行时
npm run app          # 构建并打开 HiExplore 桌面应用
npm run app:dist     # 打包安装包（macOS .dmg / Windows .exe / Linux AppImage），产物在 release/
```

> 开发调试：一个终端 `npm run dev`，另一个终端 `npm run app:dev`（连开发服务器、带热更新）。

---

## 🏗️ 技术栈

React 19 + TypeScript + Vite + Tailwind + D3，纯前端，零后端依赖，数据保存在浏览器与本地文件。

```
├── App.tsx                # 主应用
├── components/            # NotesPanel(项目树) / NodeDetails(笔记) / TeamChat(团队群聊)
│                          # QuestionBoard(问题广场) / GraphVisualization(图谱) / ...
├── services/
│   ├── noteLinks.ts       # 双向链接 / 反链 / 关联边
│   ├── vault.ts           # Markdown 导入导出 / 本地库
│   ├── teamService.ts     # AI 组建团队（拆方向 + 指派 Agent）
│   ├── qvsService.ts      # 问题价值评估（6 维）
│   ├── llmProvider.ts     # 统一模型接入层（OpenAI 兼容 / 云代理）
│   ├── geminiService.ts   # 探索 / 对话核心调用
│   └── ...
├── server/                # 可选参考后端（留言板 / Serverless 代理），非前端必需
└── docs/                  # 部署等文档
```

构建：`npm run build`，产物在 `dist/`，可托管到任何静态站点（GitHub Pages / Vercel / OSS）。仓库已内置 GitHub Pages 部署工作流（`.github/workflows/deploy.yml`）。

---

## 🤝 贡献

欢迎 Issue 与 PR，尤其欢迎：新的 IoT 设备适配、Agent / 探索模板、QVS 维度改进、模型预设。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📄 License

[MIT](./LICENSE)
