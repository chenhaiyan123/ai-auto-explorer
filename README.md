# 🧭 AI Auto Explorer · AI 自动探索助手

> **以问题为坐标，以智能为货币。**
> 把有价值、有意思的问题挂在后台，让 AI 进行长期自主探究——甚至操纵物联网实验设备去深入探索。

AI Auto Explorer 是一个开源的「问题驱动型」自主探索平台。你提出一个值得研究的问题，AI 会把它分解成问题树，长期、自主地逐节点探索，沉淀知识卡片与研究发现，并在有突破时通知你。

## ✨ 核心功能

**📊 问题价值评估（QVS）**：开始探索前，AI 从稀缺性、深度、可验证性、社会价值、创新性、可执行性 6 个维度为问题打分（雷达图报告），帮你判断这个问题值不值得投入算力。

**🌳 问题树自主探索**：AI 将大问题分解为子问题节点，逐个探索、推理、汇总，支持研究模式与构建模式，可视化展示整个探索图谱。

**🤖 Agent 团队与长期探索**：多 Agent 协作分析，7×24 后台持续探索，自动产出知识卡片、研究发现和阶段性报告。

**🧠 模型自由接入**：所有 AI 能力都通过你自己的模型驱动——
- 本地模型：Ollama、LM Studio、vLLM（数据不出本机）
- 云端 API：任何 OpenAI 兼容服务（通义千问、DeepSeek 等）
- 自部署代理：把 Key 藏在 Serverless 函数后面（见 `fc_backend.js`）

**🔌 IoT 实验设备接入**：注册任何带 HTTP REST API 的设备（传感器、培养箱、机械臂…），AI 在探索过程中可自主调用设备读取数据、执行操作，把物理世界纳入探究闭环。所有调用都有日志可审计。

## 🚀 快速开始

```bash
git clone https://github.com/<your-name>/ai-auto-explorer.git
cd ai-auto-explorer
npm install
npm run dev        # http://localhost:3000
```

首次进入后点击右上角 **⚙️ 设置 → 模型接入**，选择一个预设（如本地 Ollama）或填入你的 API 地址，测试连接即可使用。无需任何后端。

### 用本地模型（推荐，零成本）

```bash
# 安装并启动 Ollama
ollama pull qwen2.5:7b
ollama serve
```

设置中选择「Ollama（本地）」预设即可。

### 接入 IoT 设备

**⚙️ 设置 → IoT 设备 → 注册设备**，填写设备名称、API 地址、操作列表（方法/路径/说明）。注册后 AI 会在对话与探索中按需调用，例如：

```
设备：恒温培养箱-1（http://192.168.1.50:8080）
操作：读取温度 GET /api/temperature
      设定温度 POST /api/temperature  体：{"target_temp": "{{temp}}"}
```

## 🏗️ 技术栈与结构

React 19 + TypeScript + Vite + Tailwind CSS + D3，纯前端架构，配置与数据保存在浏览器 localStorage。

```
├── App.tsx                    # 主应用
├── components/
│   ├── QuestionEvaluator.tsx  # 问题价值评估（QVS 雷达图报告）
│   ├── SettingsModal.tsx      # 设置：模型接入 / IoT 设备
│   ├── GraphVisualization.tsx # 问题树可视化
│   └── ...
├── services/
│   ├── llmProvider.ts         # 统一模型接入层（OpenAI 兼容 / 云代理）
│   ├── iotService.ts          # IoT 设备注册、调用与 AI 指令执行
│   ├── qvsService.ts          # 问题价值评估（6 维度打分）
│   ├── geminiService.ts       # AI 探索核心调用
│   └── ...
└── fc_backend.js              # 可选：Serverless API 代理参考实现
```

## ⚙️ 部署配置（可选）

复制 `.env.example` 为 `.env.local`：

| 变量 | 说明 |
|---|---|
| `VITE_API_PROXY_URL` | 默认云端 AI 代理地址（不设则引导用户自行配置模型） |
| `VITE_ADMIN_PASSWORD` | 管理员看板密码（不设则禁用管理员登录） |

构建：`npm run build`，产物在 `dist/`，可托管到任何静态站点（GitHub Pages、Vercel、OSS 等）。

## 🤝 贡献

欢迎 Issue 与 PR。我们尤其欢迎：新的 IoT 设备适配案例、更多模型预设、QVS 评估维度的改进建议。

## 📄 License

[MIT](./LICENSE)
