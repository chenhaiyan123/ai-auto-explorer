# AI 钱包充值

用户给自己的 AI 钱包充人民币；AI 在**平台共享模型**上干活、额度不够时，按模型定价自动从余额兑换 Token。

## 怎么开

在云端服务器（pay.hiexplore.com）的环境变量里：

| 变量 | 作用 |
|---|---|
| `BILLING_SALES_ENABLED=true` | 支付总开关（已有） |
| `BILLING_TOPUP_ENABLED=true` | **充值开关**，不设就是关的，前端显示「暂未开放，不会扣款」 |
| `BILLING_ALLOWED_IDENTITIES` | 验收期只让这几个邮箱能付款（已有，建议先只放自己） |

然后重新部署：`docker compose -f compose.wake.yml up -d --build`。

最后在「模型管理与额度分配」里，给要开放的共享模型填 **AI 钱包兑换价（元 / 百万 Token）**。0 = 这个模型不能用钱包余额。

## 规则

- 档位固定 ¥10 / ¥30 / ¥100 / ¥300（`shared/billing-plans.json` 的 `topup.amounts`，单位分）。金额只认后端，前端传别的金额会被拒。
- 到账以支付渠道验签 / 查单为准，重复回调、重复查单只加一次钱。
- 自动兑换：额度不够这次请求的预留时，扣 `max(¥1, 差额 × 价格)`，换成该模型的 Token；兑换的 Token 用不完留着下次用。
- 先扣钱再加额度；加额度失败自动退回钱包（流水里有「兑换失败退回」）。
- 钱包有钱但不够一次兑换：直接报「AI 钱包余额不足，请先充值」，不透支。
- 用户自己的 API Key 调用不碰钱包。
- 流水在 `/billing/account` 的 `wallet.tx`；管理员在 `/admin/billing` 的 totals 里看到全站余额 `walletBalance` 和已兑换 `walletSpent`。

## 还没做

- 提现 / 退款：目前要人工处理（文案写的是「需要退款请联系客服」）。
- 服务广场订单从钱包付款。
- iOS 不开放充值。
