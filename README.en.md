# 🧭 HiExplore · Autonomous Inquiry Platform

**English** | [中文](./README.md)

> **Questions as coordinates, intelligence as currency.**
> Park your valuable questions, ideas and curiosity in the background, and let AI investigate them long‑term like a team — handing work back to you whenever a human call is needed.

HiExplore is an open‑source, **question‑driven autonomous inquiry platform**. It treats every project like a *research repository*: you define a question worth digging into, AI breaks it into a few key directions, assembles a team of specialized agents, explores those directions over time, produces structured notes, and weaves them into a navigable knowledge graph. All data stays in your own browser and local Markdown files, and you bring your own model.

**Who it's for:** independent researchers / creators / indie developers (turn curiosity into ongoing inquiry with minimal friction), and people doing intelligence / due‑diligence work (park a question, get continuous, traceable investigation).

---

## ✨ Features

**🗂️ Project = folder (engineering notes, like a code repo)**
Each project is a folder with a `README` and an `Overview` main file. A project breaks down into 5–8 key nodes (level 2), each of which can hold level‑3 detail notes. The left sidebar is an indentable, collapsible note tree; long notes also fold by heading into an outline instead of a wall of text.

**🔗 Bi‑directional links + knowledge graph**
Use `[[Title]]` anywhere in a note to link others, forming outgoing / backlinks automatically. The "🕸️ Graph" button pops up the network: vertical = hierarchy, horizontal = associations.

**🤝 AI team building + team chat**
Click 🤝 on a project: AI reads the goal → splits it into 5–8 key nodes → groups them into "work areas" (folders) → assigns a specialized agent to each → and can kick off autonomous exploration. The right panel is a group chat with the team: @mention a member, `[[reference]]` any note into context, and append any AI reply straight into a note.

**🔥 Question board (surface valuable questions)**
Collect candidate questions, score & rank them with QVS (scarcity / depth / verifiability / social value / innovation / feasibility), filter for high value, follow / upvote, and turn the best ones into projects in one click.

**📓 Local Markdown vault (your data)**
Everything is stored in browser localStorage; export a single note as `.md`, the whole vault as a `.zip` (project‑as‑folder structure), import `.md`, or — in Chrome/Edge — save directly into a local folder (Obsidian‑style vault).

**🧠 Bring your own model**
Every AI call uses the model you configure; no built‑in backend:
- Local: Ollama, LM Studio, vLLM (data never leaves your machine)
- Cloud: any OpenAI‑compatible API (DeepSeek, Qwen, Claude…)
- Self‑hosted proxy: keep your key behind a serverless function (see `server/fc_backend.js`)

**🔌 IoT / lab devices** — register HTTP‑API devices; AI can call them during exploration (read sensors, trigger actions) with an auditable log.

**🌗 Light / dark theme**, toggle in the top bar.

---

## 🚀 Quick start

```bash
git clone https://github.com/<your-name>/hiexplore.git
cd hiexplore
npm install
npm run dev        # http://localhost:3000
```

Open **⚙️ Settings → Model** and pick a preset. No backend required.

| Setup | Provider | API Base URL | Model |
|---|---|---|---|
| Local, free | OpenAI‑compatible | `http://localhost:11434/v1` | `qwen2.5:7b` |
| DeepSeek | OpenAI‑compatible | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Claude | OpenAI‑compatible | `https://api.anthropic.com/v1` | `claude-sonnet-4-6` |

> The stronger the model, the deeper and more reliable the autonomous inquiry. The 🧠 badge in the top bar shows the model currently in use.

---

## 🏗️ Stack

React 19 + TypeScript + Vite + Tailwind + D3. Pure front‑end, no backend dependency. Build with `npm run build` → static `dist/`, deployable to GitHub Pages / Vercel / any static host. A GitHub Pages workflow is included (`.github/workflows/deploy.yml`).

## 🤝 Contributing

Issues and PRs welcome — especially IoT device adapters, agent/exploration templates, QVS improvements, and model presets. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## 📄 License

[MIT](./LICENSE)
