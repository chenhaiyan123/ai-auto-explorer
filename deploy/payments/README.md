# 微信与支付宝支付后台部署

截至 2026-09-21，云端 backend 与 Caddy 已运行，`https://pay.hiexplore.com/health` 已通过可信 HTTPS 验证，HTTP 自动跳转 HTTPS。证书下载、响应验签和官方查单通过；但真实 Native 下单返回 **HTTP 403 / NO_AUTH：商户收款功能已被限制**。因此已将 `BILLING_SALES_ENABLED=false`，验收账号名单保留，Pro 与支付宝也保持关闭。需商户先在微信商户平台处理收款限制，再重新打开小额验收；目前没有成功收款，真实回调、退款及成果交付仍未完成。

## 1. 服务器与文件

适用于一台支持 Docker Engine / Compose 的 Linux 主机和持久磁盘。只启动一个 backend。官网继续使用 GitHub Pages；现有登录 FC 不覆盖、不迁移。此配置同时可承载原有云端唤醒服务，不用为两个支付渠道分别购买服务器。

先确认服务器可用、公网 IP、域名 DNS 管理权限；中国内地部署须确认备案接入。已有服务占用 80/443 时应复用原代理，不能直接用这份配置抢占端口。

将运行包解压到 `/srv/hiexplore/app`，将商户文件通过 SSH 安全传输至以下目录（不要通过聊天、Git 或公开网盘传输密钥）：

```text
/srv/hiexplore/secrets/
  wechat-merchant.pem       商户 API 证书
  wechat-private.pem        对应商户私钥
  wechat-api-v3.txt         32 字符密钥，无换行
  alipay-private.pem       支付宝应用私钥，待提供
  alipay-public.pem        支付宝公钥，待提供
/srv/hiexplore/wechat-platform/
  wechatpay_SERIAL.pem     已通过验证的平台证书
```

backend 使用 Node 镜像的 UID/GID 1000。secrets 目录由该用户可读（建议属主 1000、目录 700、文件 600），在容器内只读挂载。平台证书目录属主 1000、目录 700、文件 600，允许后台定期更新。宿主机不要对私钥目录开放网页访问。

## 2. 配置与启动

在服务器项目根目录复制：

```sh
cp server/wake.env.example .env.wake
cp deploy/payments/compose.env.example .env.payments.local
chmod 600 .env.wake .env.payments.local
```

填写 `.env.wake`：

- `WAKE_AUTH_API` 必须与官网实际使用的登录后台一致；`WAKE_ADMIN_IDENTITIES` 为已验证的管理员邮箱。
- `WAKE_MASTER_KEY` 是一次性生成并独立备份的 32 字节随机值的 Base64，不能每次启动重建。它不是 API v3 密钥。
- `WAKE_ALLOWED_ORIGINS=https://www.hiexplore.com,https://hiexplore.com`；不得配置公网开发令牌。
- `BILLING_PUBLIC_URL=https://pay.hiexplore.com`（拟用域名，须先核对 DNS）。
- `WECHAT_MCH_ID`、`WECHAT_APP_ID`、`WECHAT_CERT_SERIAL` 从本机已核对配置迁入。
- `WECHAT_CERT_FILE=/run/secrets/wechat-merchant.pem`，`WECHAT_PRIVATE_KEY_FILE=/run/secrets/wechat-private.pem`，`WECHAT_API_V3_KEY_FILE=/run/secrets/wechat-api-v3.txt`。
- `WECHAT_PLATFORM_CERT_FILE=/run/wechat-platform/wechatpay_SERIAL.pem`，使用实际文件名。
- 支付宝填写真实 `ALIPAY_APP_ID`、`ALIPAY_SELLER_ID`，`ALIPAY_PRIVATE_KEY_FILE=/run/secrets/alipay-private.pem`、`ALIPAY_PUBLIC_KEY_FILE=/run/secrets/alipay-public.pem`。未齐全时全部留空，不能拿微信 AppID 或开放平台 AppSecret 替代。
- 默认 `BILLING_SALES_ENABLED=false`、`BILLING_PRO_ENABLED=false`。验收时先把 `BILLING_ALLOWED_IDENTITIES` 设置为经过网站登录验证的测试邮箱，再将销售开关设为 `true`；服务端只允许名单内账号创建订单。Pro 保持关闭。空名单代表所有登录用户，验收期间不得留空。

只检查 Compose 配置是否可解析，避免将包含密钥的完整解析结果输出到终端：

```sh
docker compose --env-file .env.payments.local -f compose.payments.yml config --quiet
docker compose --env-file .env.payments.local -f compose.payments.yml build backend
docker compose --env-file .env.payments.local -f compose.payments.yml run --rm --no-deps https caddy validate --config /etc/caddy/Caddyfile
docker compose --env-file .env.payments.local -f compose.payments.yml up -d
```

## 3. 域名、HTTPS 与前端

拟新增 `pay.hiexplore.com` 的 A 记录到服务器公网 IPv4；不要覆盖已有官网和登录服务记录。若未部署 IPv6，不创建 AAAA。放行公网 TCP 80/443；SSH 按实际管理来源限制。8790 不映射到公网。

Caddy 自动获取和续期 HTTPS 证书，TLS 证书状态保存在命名卷。它保留原始支付通知请求体及签名头，转发到 backend:8790。

验证：

```sh
curl --fail https://pay.hiexplore.com/health
curl --fail https://pay.hiexplore.com/billing/catalog
```

健康检查须返回正式模式；catalog 里的渠道 ready 只表示配置齐备，不能替代支付验收。未登录的 `/billing/account` 须为 401。两路公网回调分别为 `/billing/notify/wechat` 与 `/billing/notify/alipay`，它们不要求网站登录，但必须严格验签和核对交易内容。

确认后台和 HTTPS 正常后，把 GitHub Actions Variable `VITE_BILLING_API` 设置为支付后台地址并部署前端。只有希望同时接入云端研究时才设置 `VITE_WAKE_API`。支付密钥绝不放进 Actions Variables 或 `VITE_*`。

## 4. 收款验收与开放

- 支付宝需真实企业应用已开通电脑网站支付，使用目前代码支持的 RSA2 普通公钥模式；证书模式、服务商模式需另做适配。
- 先明确售后、退款及权益撤销处理。当前代码还没有自动退款及退款后权益撤销，不能宣称已完成该环节。
- 真实付款测试前限定测试账号与商品，明确收款商户、实际测试金额，由用户完成付款。
- 核对官网订单、商户流水、回调到账、主动查单、同版本下载和另一个账号无法访问；两个渠道分别完成。
- 重启 backend，确认订单、权限、账本和模型额度保留；重复回调不重复开通。
- 完成退款与交付验收后才开放成果包购买。Pro 的套餐研究额度、问题限制等仍未完成，保持关闭。

## 备份与恢复

命名卷 `hiexplore-payments_payment-data` 保存加密账本、订单、权益、研究任务和共享模型凭据。`docker compose down` 不删除命名卷；不要使用 `down -v` 或手动删卷。

```sh
bash deploy/payments/backup.sh /srv/hiexplore/backups
```

脚本暂停 backend 后备份、检查压缩包，最后恢复此前运行状态。容器移除了所有 capabilities，必须以数据属主 UID/GID 1000 读取账本；脚本只调整独立 staging 目录的属主，tar 任一步失败都会退出。已于 2026-09-20 在真实服务器验证备份成功，失败备份不能用于恢复。

数据备份和 `WAKE_MASTER_KEY` 分开保管；私钥、API 密钥及两份环境文件独立加密备份。本次已将备份下载到本机，并在隔离临时目录成功解密读取备份账本，未覆盖线上数据；该快照尚无项目与真实订单，不能替代真实支付后的恢复验收。本脚本没有设置定时任务，后续新增数据需要继续备份。

恢复先在隔离环境进行：停止服务，使用新的空数据卷，解压账本备份，再配置原 `WAKE_MASTER_KEY` 和商户文件；核对恢复结果后才切换域名。不要直接覆盖仍在写入的线上卷。旧卷保留直到验收成功。

官方文档：[Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https)、[阿里云轻量防火墙](https://help.aliyun.com/zh/simple-application-server/user-guide/manage-the-firewall-of-a-server)。
