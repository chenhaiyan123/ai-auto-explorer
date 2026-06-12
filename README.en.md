# 🧭 AI Auto Explorer

**English** | [中文](./README.md)

> **Questions as coordinates, intelligence as currency.**
> Pin a question worth exploring, and let AI investigate it autonomously over days or weeks — even operating real lab equipment through IoT APIs.

**🌐 Live Demo: https://chenhaiyan123.github.io/ai-auto-explorer/**

AI Auto Explorer is an open-source, question-driven autonomous research platform. You pose a question worth studying; the AI decomposes it into a question tree, explores it node by node over the long term, accumulates knowledge cards and findings, and notifies you when it makes a breakthrough.

## ✨ Features

**📊 Question Value Scoring (QVS)** — Before burning compute, AI scores your question across 6 dimensions (scarcity, depth, verifiability, social value, novelty, feasibility) with a radar-chart report, so you know whether it's worth pursuing.

**🌳 Autonomous question-tree exploration** — Big questions are decomposed into sub-question nodes, explored and synthesized one by one, with research and build modes and full graph visualization.

**🤖 Agent teams & long-term exploration** — Multi-agent collaborative analysis, 24/7 background exploration, automatic knowledge cards, findings, and stage reports.

**🧠 Bring your own model** — Every AI capability runs on a model *you* control:
- Local models: Ollama, LM Studio, vLLM (your data never leaves your machine)
- Cloud APIs: any OpenAI-compatible service (Qwen, DeepSeek, etc.)
- Self-hosted proxy: hide your key behind a serverless function (see `fc_backend.js`)

**🔌 IoT lab-equipment integration** — Register any device with an HTTP REST API (sensors, incubators, robotic arms…). During exploration the AI can autonomously read data and execute operations, bringing the physical world into the research loop. Every call is logged and auditable.

## 🚀 Quick Start

```bash
git clone https://github.com/chenhaiyan123/ai-auto-explorer.git
cd ai-auto-explorer
npm install
npm run dev        # http://localhost:3000
```

On first launch, open **⚙️ Settings → Model** in the top-right corner, pick a preset (e.g. local Ollama) or enter your API endpoint, test the connection, and you're set. No backend required.

### Use a local model (recommended, zero cost)

```bash
ollama pull qwen2.5:7b
ollama serve
```

Then select the "Ollama (local)" preset in Settings.

### Connect an IoT device

**⚙️ Settings → IoT Devices → Register**, then fill in the device name, API base URL, and its operations (method / path / description). The AI will call them as needed during chat and exploration. Example:

```
Device: Incubator-1 (http://192.168.1.50:8080)
Ops:    Read temperature   GET  /api/temperature
        Set temperature    POST /api/temperature   body: {"target_temp": "{{temp}}"}
```

## 🏗️ Stack & Layout

React 19 + TypeScript + Vite + Tailwind CSS + D3. Pure-frontend architecture; config and data live in browser localStorage.

```
├── App.tsx                    # Main app
├── components/
│   ├── QuestionEvaluator.tsx  # QVS radar-chart report
│   ├── SettingsModal.tsx      # Settings: models / IoT devices
│   ├── GraphVisualization.tsx # Question-tree visualization
│   └── ...
├── services/
│   ├── llmProvider.ts         # Unified model layer (OpenAI-compatible / proxy)
│   ├── iotService.ts          # IoT device registry, calls & AI tool execution
│   ├── qvsService.ts          # Question value scoring (6 dimensions)
│   ├── geminiService.ts       # Core AI exploration calls
│   └── ...
└── fc_backend.js              # Optional: serverless API proxy reference
```

## ⚙️ Deployment (optional)

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
|---|---|
| `VITE_API_PROXY_URL` | Default cloud AI proxy URL (omit to let users configure their own model) |
| `VITE_ADMIN_PASSWORD` | Admin dashboard password (omit to disable admin login) |

Build with `npm run build`; the `dist/` output is fully static and deploys anywhere (GitHub Pages, Vercel, Cloudflare Pages, OSS…). This repo auto-deploys to GitHub Pages on every push via Actions.

## 🤝 Contributing

Issues and PRs welcome. We'd especially love: new IoT device adaptation examples, more model presets, and ideas for improving the QVS scoring dimensions.

## 📄 License

[MIT](./LICENSE)
