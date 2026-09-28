# 统一支付业务与后端实现差异

本文以 `payment-product-template` 的 reference learning profile 为业务基线，说明同一业务诉求在 WOW 和 CAP4K 中如何实现，以及工作台 adapter 如何把传输差异归一化。

这不是“取两个后端能力交集”的兼容清单。支付、退款、五类权威列表、账单与对账、结算、人工核对、通知和 payment timeline 都是统一业务目标；框架、路由、HTTP 方法、字段和收敛方式的差异由 adapter 吸收。2026-09-26 两端归档的新契约和工作台真实 HTTP 联调确认：上一轮列出的学习版业务缺口已经补齐；仍有少数脚本诊断命令的独立 HTTP route 差异，工作台会如实显示，不能由前端伪造。

## 统一业务契约

| 主题 | 统一业务语义 | 页面观察 |
|---|---|---|
| Money | `{ currency, amountMinor }`，最小单位为十进制整数字符串 | 不以 JavaScript 浮点作为资金真源 |
| 状态与最终性 | 资源 `status` 与 `NON_FINAL / FINAL / REVIEW_REQUIRED` 分离 | 不把 UNKNOWN、review 或 Operation 成功显示成资金成功 |
| 命令受理 | 命令返回 `OperationReceipt`，同步拒绝返回 `ApiError` | 2xx/ACCEPTED 只表示受理 |
| 异步观察 | receipt 提供 `readAfter`，之后观察 Operation 和资源 | 超时形成 `OBSERVATION_TIMEOUT`，不改写领域状态 |
| 可信结果 | payment/refund/settlement callback 由服务端可信边界验证 | 页面没有可编辑的 `verified` 字段 |
| 幂等与冲突 | 同 identity 不重复产生业务效果，冲突保留稳定错误和关联 | receipt、错误、原事实和冲突证据分别可见 |
| 权威列表 | Payment、Refund、ReconciliationRun、Settlement、ManualReviewItem 使用 keyset Page | cursor 不透明，页面不自算 total 或用最近记录代替 |
| 责任事实 | 人工动作保留 actor、reason、evidence 和服务端时间 | 缺失可信责任上下文时同步拒绝且无副作用 |
| 全链路 | timeline 关联支付、attempt、refund、bill/run、settlement、review、notification | `recordedAt ASC, eventId ASC` 稳定展示并保留 `occurredAt` |

## 传输与实现差异矩阵

| 主题 | WOW 实现 | CAP4K 实现 | 工作台归一化 |
|---|---|---|---|
| 框架与模型 | 事件/Projection 风格，命令后读模型可能暂不可见 | CAP4K 聚合与事务 Operation | 页面只读统一资源和 `SourceMetadata` |
| 命令回执 | receipt 的 `resourceType/resourceId` 平铺 | receipt 的 `resource` 嵌套；Operation 响应可有 envelope | `OperationReceipt`、`ResourceRef`、`Operation` |
| readAfter | 主要通过 `POLL` 等待 Projection | 主要通过 `READ_ONCE` 读取事务结果 | 统一观察器遵守 receipt，不猜测后端 |
| Payment 列表 | `GET /api/payments` + query | `POST /api/payments/search` + body | `listPayments(PageRequest)` |
| Refund 列表 | `GET /api/refunds` + query | `POST /api/refunds/search` + body | `listRefunds(PageRequest)` |
| ReconciliationRun 列表 | `GET /api/reconciliation-runs` | `POST /api/reconciliation-runs/search` | 同一权威 `Page<ReconciliationRun>` |
| Settlement 列表 | `GET /api/settlements` | `POST /api/merchant-settlements/search` | 同一权威 `Page<Settlement>` |
| ManualReview 列表 | `GET /api/manual-reviews` | `POST /api/manual-reviews/search` | 同一权威 `Page<ManualReviewItem>` |
| Notification 列表 | notification collection 查询 | `POST /api/merchant-notifications/search` | 统一 notification 模型；不冒充五类主资源之一 |
| 支付字段 | `merchantOrderNo`、`amount` 等 WOW wire name | `merchantOrderNumber`、`money` 等 CAP4K wire name | `merchantOrderId`、`Money` |
| 退款字段 | payment 子资源创建、`merchantRefundNo` | 顶层 refunds 创建；不同 endpoint 中使用 refund number/identity | 统一 `RequestRefundInput` 与稳定 refund ID |
| 支付/退款 attempt | 创建、提交和结果是独立动作 | 创建、提交和结果也是独立动作 | 同一“资源 -> attempt -> submit -> result”流程 |
| reference 渠道脚本 | 按 fixture/channel 配置、读取和重置，payment submit 实际消费五类脚本 | `/reference-fixtures/payment-channel-script` 配置/重置，submit 消费；无独立 read route | 统一 channel 实验；独立读取诊断按 transport result 展示 |
| bill provider 读取脚本 | 按 bill/revision 配置、读取、重置暂不可读次数；读取按 signal/read attempt identity 消费 | register revision 的 `unavailableReadCount`；没有独立 configure/read/reset route | 同一“暂不可读后恢复”业务；独立控制面可用性如实显示 |
| notification sender 脚本 | 按 notification/source fact 配置、读取、重置，真实投递和 retry 消费 | 按 notification/source fact 配置、重置，真实投递和 retry 消费；无独立 read route | 统一投递实验与 stable delivery identity；读取诊断不伪造 |
| settlement executor 脚本 | 按 fixture/channel 配置、读取、重置；execute 依 caller `executionId` 消费 | 按 caller `executionId` 配置、读取、重置并在 execute 消费 | 统一 `CONFIGURE/READ/RESET_SETTLEMENT_EXECUTOR` 与 execution；绑定方式在 adapter 内 |
| callback evidence | 先从 fixture 获取与 unsigned payload 绑定的 verification token | 先登记 callback evidence，再提交完全一致的 canonical callback | 统一 `RECEIVE_*_RESULT`，验证细节不出 adapter |
| 人工责任上下文 | `actorId/actorRole/reason/evidenceRefs` 映射到 body | alias 经 `X-Reference-Actor-Context`，reason/evidence 映射到 body | `ResponsibilityInput`；页面不写 header |
| 支付到期 | 单支付 expire 路由 | 单支付 `POST /api/payments/{id}/close-expired` 返回真实 receipt；全局 `PAYMENT_EXPIRY` maintenance 仍可运行 | `CLOSE_EXPIRED_PAYMENT` 与真实 Operation/readAfter |
| 权威账单入口 | reference statement 及 revision 可独立查询 | `GET /api/authoritative-bills/{billId}` 返回 current revision、完整 immutable history 和逐记录证据 | `AuthoritativeBill`；浏览器缓存不充当权威读取 |
| Run 形成/完成 | bill available、run/rerun，并有显式 complete | bill signal 形成 Run；最后 disposition/confirmation 后自动重算完成 | 统一读取 `scope/status/finality`；是否需要额外 complete 传输不进入页面分支，不伪造 receipt |
| 结算 endpoint | `/settlements/*` | `/merchant-settlements/*` | 统一 Settlement 生命周期 |
| 结算 execution identity | 接受 caller-supplied `executionId` | 接受并持久化 `executionId`、执行渠道和幂等绑定；callback/timeline 关联同一 identity | 同一个 caller-supplied identity 贯穿 execute、结果和详情 |
| 作废与替代 | 独立 void 与 replace 命令 | void 的 `createReplacement` 决定是否生成替代 | 统一 void/replacement 业务动作 |
| timeline | `GET /api/payments/{id}/trace` | `GET /api/payments/{id}/timeline` | `PaymentTimeline` |
| 错误 envelope | WOW code/message/details 形态 | CAP4K status/code/message/details 形态 | `ApiError { code,message,details,correlationId,retryable }` |

## 共同业务闭环

### 支付与退款

两端都按以下语义推进：

1. 创建 PaymentIntent，不自动把“已创建”解释为“已发起”。
2. 创建 PaymentAttempt。
3. 提交 attempt，保留 submission receipt。
4. 经服务端可信边界接收成功、失败或 UNKNOWN 结果。
5. 观察 Operation、资源、result receipt、success fact 和 finality。
6. 对成功支付申请部分或全额退款；预算先保留，再随明确结果转换或释放。
7. 重复、无效、未知引用、迟到和冲突收件保留证据，不覆盖已确定事实。

### 对账

统一目标要求稳定 bill identity、不可变 revision、ReconciliationRun、matching basis、difference、disposition 和 FactConfirmation。两端均可独立按 Bill ID 读取权威 current revision 和历史，工作台保留 publishedAt、completeness、payload fingerprint 与逐记录 Money/raw status/occurredAt/raw evidence；源响应未给出的证据字段保持空值，不补造。两端 Run 闭环均能验证高 revision 前进、低 revision 不回退和 blocking difference。产品模板把 Run 范围定义为渠道、币种、业务日和时区；merchantId 是关联筛选条件而不是 Run 的单一固有字段。WOW 显式完成、CAP4K 满足条件后自动完成属于收敛方式差异。

### 结算

两端都支持准备、构成解释、确认冻结、执行、`SUCCESS / FAILURE / UNKNOWN / NO_RESULT` 的 reference executor 脚本、人工核对、作废和 replacement。统一不变量是：确认后 scope/items/Money/version 冻结，成功事实只形成一次，UNKNOWN 不得启动可能造成重复付款的新 identity，作废/替代不能绕过阻断。两端执行 endpoint 均接收 caller-supplied `executionId`；WOW 脚本按 channel 配置、执行时按该 identity 消费，CAP4K 脚本直接按该 identity 配置和消费。可信结果 ingress 继续用于明确 callback 实验。

### 人工核对、通知和 timeline

ManualReviewItem 是权威资源，处置必须留下完整责任事实。MerchantNotification 保留稳定 notification/content identity 和投递尝试。Payment timeline 提供跨支付、退款、对账、结算、通知和人工核对的关联视图；两个后端只在路径和内部事件来源上不同。

## 工作台边界

页面和业务组件只依赖统一 service/model，不得：

- 根据 `wow` 或 `cap4k` 决定业务步骤；
- 拼接后端 URL、header 或 transport DTO；
- 把 localStorage 最近记录当作权威列表；
- 把 accepted、Operation SUCCEEDED 或 observation timeout 改写为资金成功/失败；
- 让用户提交 `verified=true`，或用前端判断替代服务端 verifier；
- 删除、覆盖原始收件、证据、责任事实和历史 disposition。

adapter 可以为完成同一业务动作调用不同数量、不同方法的 HTTP endpoint。若某个实现没有单独的 transport endpoint（例如 CAP4K 的显式 Run complete），页面应依赖统一资源动作和状态，而不是硬编码后端判断。

## 后续生产强化（不属于本轮学习版交付）

学习版业务对齐项已完成，后续强化重点是把 reference 设施升级为生产设施：

- 登录、OIDC/JWT、商户/租户隔离、生产 RBAC、双人复核与最小权限；
- API Gateway、正式 CORS/CSRF/限流/TLS、Secret Manager 和生产证书；
- 生产数据库部署/迁移/重启恢复、持久化 Outbox/Inbox、跨进程 exactly-once、多实例调度锁；
- 真实渠道验签与网络接入、真实账单下载、真实资金移动和生产通知；
- 生产 SLA、长期审计、可观测性、脱敏与数据保留政策；
- 产品未来新增的跨币种、分账、订阅、预授权、拒付/争议和税务语义。

这些强化项可以后续单独迭代，但不能作为删去幂等、可信收件、预算、阻断、冻结、防重付、责任字段、权威列表或 timeline 的理由。

## 前端验收说明

WOW 与 CAP4K 各自已归档的后端验收只证明后端契约前提，不自动证明工作台 adapter、页面或开发代理正确。本轮工作台仍必须独立完成：

1. TypeScript 类型检查、单元/契约测试和 production build。
2. 分别连接真实 WOW 与 CAP4K，从前端边界执行代表性支付到结算闭环。
3. 比较 Money、status/finality、错误、关联、排序、预算、阻断和副作用等规范化观察。
4. 忽略随机内部 ID、路由、框架事务和 readAfter 模式等允许差异。

2026-09-26 Builder 已分别从真实 WOW 和干净 H2 CAP4K 运行同一 `src/adapters/live-smoke.test.ts`，两个 mode 均通过。测试穿过真实 HTTP、receipt/Operation、Projection/事务读取、可信 callback、预算、独立 Bill detail/revision、含阻断差异的对账与责任处置、executor 脚本与结算结果、单支付到期关闭、ManualReview、通知、五类列表和 timeline。paired consistency smoke 还以统一服务在两端串行执行完整成功闭环和 UNKNOWN/人工核对分支，直接比较 Money/status/finality、父子关联、稳定排序、预算、阻断、结算构成、幂等重放和副作用；最终验收结论仍由当前 Comet change 的独立 Verifier 给出。

## 已关闭的后端对齐项与剩余传输差异

CAP4K 的 Bill detail/revision history、单 Payment `close-expired`、settlement executor configure/read/reset、caller-supplied `executionId` 均已落地。WOW 的 payment channel、bill provider、notification sender 和 settlement executor 四类脚本已具备 configure/read/reset，且分别由真实业务入口消费。这些是后端已归档的新契约，工作台 adapter 和统一页面已接入；参见 [已关闭项和当前差异](./backend-realignment.md)。

CAP4K 的 channel/notification 脚本没有独立 read route，bill provider 暂不可读次数随账单 revision 登记，没有独立 configure/read/reset。工作台对这些独立控制命令返回明确的 transport `unavailable`；配置/消费和业务闭环仍可用。CAP4K 本地结算成功还要求启动可达的 Integration Event sink，并配置 `payment.merchant-settlement.completed.v1` route，具体命令见 [README](../README.md#本地后端启动)。
