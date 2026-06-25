# 贡献指南 · Contributing

感谢你对 HiExplore 的兴趣！/ Thanks for your interest in HiExplore!

## 开发 / Development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # 类型检查 + 生产构建 / type-check + production build
```

提交前请确保 `npm run build` 通过（包含 TypeScript 类型检查）。
Before submitting, make sure `npm run build` passes (it includes the TypeScript type check).

## 我们尤其欢迎 / Especially welcome

- 新的 IoT / 实验设备适配 · IoT / lab device adapters
- Agent 角色与探索模板 · agent roles & exploration templates
- 问题价值评估（QVS）维度改进 · QVS dimension improvements
- 新的模型预设 · model presets
- 文档与示例 · docs & examples

## 约定 / Conventions

- 前端纯静态，无后端依赖；`server/` 下是可选的参考后端（留言板 / Serverless 代理）。
  The front‑end is pure static with no backend dependency; `server/` holds optional reference backends.
- 任何 AI 调用都应使用用户在「设置」里配置的模型，**不要硬编码模型名**。
  All AI calls must use the user‑configured model — **do not hardcode model names**.
- 不要提交任何密钥；`.env.local` 已在 `.gitignore` 中。
  Never commit secrets; `.env.local` is gitignored.

## License

By contributing, you agree your contributions are licensed under the [MIT License](./LICENSE).
