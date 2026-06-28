# 把登录后端部署到阿里云函数计算（FC）

让 www.hiexplore.com 的邮箱验证码登录在线上可用。整体结构：

```
浏览器(www.hiexplore.com, GitHub Pages, HTTPS)
        │  fetch
        ▼
api.hiexplore.com  ──►  阿里云 FC 函数(运行 server/auth-fc.mjs)  ──►  Resend 发邮件
```

要做三件事：① 把 `server/auth-fc.mjs` 部署成一个 FC 函数；② 给它绑一个带 HTTPS 的自定义域名 `api.hiexplore.com`；③ 前端用 `VITE_AUTH_API=https://api.hiexplore.com` 重新构建并部署。

> 前提：`hiexplore.com` 已 ICP 备案（已确认）。FC 部署在**大陆区域**，本文以**华东1（杭州）cn-hangzhou** 为例。

---

## 第一步：创建 FC 函数

1. 登录阿里云 → 进入 [函数计算 FC 控制台](https://fcnext.console.aliyun.com/) → 右上角地域选 **华东1（杭州）**。
2. 左侧 **函数** → **创建函数**。
3. 创建方式选 **Web 函数**：
   - **运行环境**：Node.js 20（或 18）
   - **代码上传方式**：使用代码编辑器（在线写）
   - **函数名称**：`hiexplore-auth`
4. 进入函数后，在**代码编辑器**里：
   - 新建一个文件名为 **`index.mjs`**（用 `.mjs` 后缀，因为代码用了 `import`）。
   - 把本仓库 `server/auth-fc.mjs` 的**全部内容**粘进去。
5. **配置 → 环境信息 / 运行配置**里设置：
   - **启动命令**：`node index.mjs`
   - **监听端口**：`9000`
   - **请求处理程序类型**：处理 HTTP 请求（Web 函数默认即是）

> 也可以把 `server/auth-fc.mjs` 单独打成 zip 上传，文件名同样建议改成 `index.mjs`。这个后端零依赖，不需要 node_modules。

---

## 第二步：配置环境变量

函数详情 → **配置 → 环境变量**，添加这几条：

| 变量名 | 值 | 说明 |
|---|---|---|
| `RESEND_API_KEY` | `re_你新生成的Key` | Resend 邮件 Key（建议用新 Key，别用截图露过的） |
| `MAIL_FROM` | `HiExplore <noreply@hiexplore.com>` | 发信地址（域名已在 Resend 验证过） |
| `AUTH_SECRET` | 一段随机长串（如 40+ 位） | 令牌签名密钥，自己生成，别外泄 |
| `ALLOW_ORIGIN` | `https://www.hiexplore.com,https://hiexplore.com` | 允许的前端来源，多个用逗号分隔 |

保存后**重新部署/发布**一次，让环境变量生效。

---

## 第三步：建 HTTP 触发器（先拿到一个能测的地址）

1. 函数 → **触发器** → **创建触发器** → 类型 **HTTP**。
2. **认证方式**：选 **无需认证（anonymous）**（这是给公网前端调用的接口）。
3. **请求方式**：勾选 GET、POST、OPTIONS。
4. 创建后会得到一个默认调用地址（形如 `https://<函数>-<随机>.cn-hangzhou.fcapp.run`）。

**先测一下后端通不通**（把下面 URL 换成你的默认地址）：
```bash
curl https://你的默认地址/auth/health
# 期望返回 {"ok":true,"provider":"resend"}
```
返回 `provider:"resend"` 就说明函数和 Key 都对了。

> 注意：FC 默认域名在浏览器里有时会被强制当附件下载，所以**正式给前端用要绑自定义域名**（下一步）。命令行 curl 不受影响，可放心用来自测。

---

## 第四步：绑定自定义域名 api.hiexplore.com（含 HTTPS）

### 4.1 申请免费 SSL 证书
1. 阿里云 → **数字证书管理服务（SSL 证书）** → 申请**免费 DV 证书** → 绑定域名填 `api.hiexplore.com`。
2. 按提示在阿里云 DNS 加一条验证记录（同一个账号会比较顺）→ 等签发完成。

### 4.2 在 FC 里加自定义域名
1. 函数计算控制台 → 左侧 **域名管理** → **添加自定义域名**。
2. 域名填 `api.hiexplore.com`。
3. **路由配置**：路径 `/*` → 选择函数 `hiexplore-auth`（版本 LATEST）。
4. **HTTPS**：开启，选择刚才申请的 `api.hiexplore.com` 证书。
5. 保存。FC 会给你一个 **CNAME 目标地址**（形如 `xxx.cn-hangzhou.fc.aliyuncs.com`），记下来。

### 4.3 在阿里云 DNS 把 api 指过去
1. 阿里云 **云解析 DNS** → `hiexplore.com` → 添加记录：
   - **记录类型**：CNAME
   - **主机记录**：`api`
   - **记录值**：第 4.2 步 FC 给的 CNAME 目标地址
2. 等 DNS 生效（几分钟），验证：
```bash
curl https://api.hiexplore.com/auth/health
# 期望 {"ok":true,"provider":"resend"}
```

通了就说明线上后端 OK。

---

## 第五步：前端接入并重新部署

1. 本地仓库根目录，用线上后端地址重新构建：
```bash
VITE_AUTH_API=https://api.hiexplore.com npm run build
```
2. 部署到 GitHub Pages：
   - 如果用的是 `.github/workflows/deploy.yml` 自动部署：把 `VITE_AUTH_API` 配成 GitHub 仓库的 **Secret/Variable**，让 Actions 构建时带上；然后 push 触发部署。
   - 或本地构建后把 `dist/` 推到 Pages 分支。
3. 打开 https://www.hiexplore.com，登录框应**只剩“邮箱”一种方式**（说明已连上后端），输入任意邮箱 → 获取验证码 → 收邮件 → 登录。

---

## 排错速查

- **CORS 报错（被浏览器拦）**：确认 `ALLOW_ORIGIN` 里有访问用的确切来源（`https://www.hiexplore.com`，注意 http/https、有没有 www 都要对得上）。
- **`provider:"dev-console"`**：FC 没读到 `RESEND_API_KEY`，检查环境变量是否保存并重新部署。
- **`API key is invalid`**：Key 填错或前后有多余字符；在环境变量里重填。
- **邮件进垃圾箱**：在阿里云 DNS 加 DMARC（TXT，主机记录 `_dmarc`，值 `v=DMARC1; p=none;`），并让用户把首封标记“非垃圾邮件”。
- **自定义域名打不开**：检查 SSL 证书是否签发、FC 域名路由是否指到函数、`api` 的 CNAME 是否生效。

## 安全提醒
- `RESEND_API_KEY`、`AUTH_SECRET` 只放在 FC 环境变量里，不要写进代码、不要截图外泄。
- 本地 `server/start-auth.sh`（含 Key）已加入 `.gitignore`，不会提交。
