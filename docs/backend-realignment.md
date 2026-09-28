# 已关闭的后端对齐项与当前差异

本文记录工作台上一轮真实联调发现、现已由 WOW 与 CAP4K 后端完成并归档的学习版契约对齐项，以及仍需由 adapter 吸收的传输差异。业务基线始终是 `payment-product-template` 的 reference learning profile，不以实现交集缩减功能。

截至 2026-09-26，上一版清单中的业务能力缺口已经关闭。它们不再是后续待办；工作台已接入对应公开 HTTP surface，并通过两个后端的真实代表性闭环。

## 已关闭的 CAP4K 对齐项

| 原对齐项 | 当前公开能力 | 工作台用法 |
|---|---|---|
| 权威 Bill 与 immutable revision 查询 | `GET /api/authoritative-bills/{billId}` 返回 current revision、完整历史、publishedAt、completeness、payload fingerprint 和逐记录原始证据 | `getBill` 映射为统一 `AuthoritativeBill`；源端没有的字段保持 `null`，不补造证据 |
| 单 Payment 到期动作 | `POST /api/payments/{paymentId}/close-expired` 返回真实 `OperationReceipt`，支持稳定幂等与冲突语义 | 统一 `CLOSE_EXPIRED_PAYMENT`，按 `READ_ONCE` 观察 Operation 与资源 |
| settlement executor script | 提供按 `executionId` 的 configure/read/reset，支持 `SUCCESS / FAILURE / UNKNOWN / NO_RESULT`，由执行入口消费 | Reference Lab 使用统一 settlement executor 命令 |
| caller-supplied settlement execution identity | 执行入口接受并持久化 `executionId`、`executionChannelId` 和幂等绑定；详情、callback 与 timeline 关联同一 identity | 统一 `EXECUTE_SETTLEMENT` 的 execution identity 贯穿执行与可信结果 |

## 已关闭的 WOW 对齐项

| 原对齐项 | 当前公开能力 | 工作台用法 |
|---|---|---|
| payment channel script | configure/read/reset，覆盖五类提交脚本并由 `SubmitPaymentAttempt` 消费 | 可复现 accepted result、`REJECT_ON_SUBMIT` 与 `NO_RESULT` |
| Bill provider 暂不可读脚本 | configure/read/reset，按稳定 signal/read-attempt identity 消费并支持恢复 | 可复现 bill available 后暂不可读、退避和恢复 |
| notification sender script | configure/read/reset，首次投递和 retry 按稳定 delivery identity 消费 | 可复现 `SUCCESS / FAILURE / RESULT_UNKNOWN` 且不制造第二次业务效果 |
| settlement executor script | configure/read/reset，执行按 caller-supplied execution identity 消费 | 可复现 `SUCCESS / FAILURE / UNKNOWN / NO_RESULT` 和幂等重放 |

## 仍然存在的实现与传输差异

这些差异不削弱统一业务能力，也不要求两个后端采用相同框架或路由。页面、业务组件和 hooks 不读取后端类型；差异只存在于 adapter、HTTP 与只读实现对照说明中。

| 主题 | WOW | CAP4K | 统一处理 |
|---|---|---|---|
| 异步观察 | Projection 为主，常用 `POLL` | 事务 Operation 为主，常用 `READ_ONCE` | 遵守 receipt 的 `readAfter`，不把超时改写为业务失败 |
| 权威列表 | `GET` collection + query | `POST .../search` + JSON body | `PageRequest/PageResult<T>` 与 opaque cursor |
| receipt 资源 | 顶层 `resourceType/resourceId` | 嵌套 `resource` | `ResourceRef` |
| 人工责任上下文 | actor/reason/evidence 主要进入 body | actor alias 经 `X-Reference-Actor-Context`，reason/evidence 进入 body | `ResponsibilityInput` |
| callback 可信边界 | fixture verification token | callback evidence registry | 统一 `RECEIVE_*_RESULT`，页面无可编辑 `verified` |
| payment timeline | `/payments/{id}/trace` | `/payments/{id}/timeline` | `PaymentTimeline` |
| ReconciliationRun 完成 | 支持显式 complete | 条件满足后自动收敛 | 统一读取 Run 状态；不伪造 CAP4K complete receipt |
| replacement | 独立 void/replace 命令 | void 的 `createReplacement` 组合 | 统一 void/replacement 业务动作 |
| settlement script selector | 按 fixture/channel 配置，执行时绑定 execution identity | 直接按 `executionId` 配置和消费 | 页面使用统一 selector，adapter 映射绑定方式 |

## Reference 控制面的细粒度诊断差异

CAP4K 的 payment channel 与 notification sender 没有独立 read route；Bill provider 的 `unavailableReadCount` 随 revision 登记，也没有独立 configure/read/reset route。对应的配置或业务消费能力可用，但请求不存在的独立诊断动作时，adapter 会返回明确的 transport `unavailable`，不会发送虚构请求或伪造观察。

这类结果只说明“该独立诊断 HTTP surface 不存在”，不表示支付、账单、通知或对账业务能力缺失。WOW 四类脚本均有完整 configure/read/reset 控制面；CAP4K settlement executor 也有完整 configure/read/reset 控制面。

## 当前工作台验证

工作台使用同一 `src/adapters/live-smoke.test.ts` 分别连接真实 WOW 与 CAP4K，验证支付/退款 attempt、可信结果、预算、权威 Bill detail/revision、对账与责任处置、结算 executor 和结果、单支付到期关闭、ManualReview、通知、五类列表及 timeline。`paired-consistency-smoke.test.ts` 既比较同一 UNKNOWN/人工处置分支，也让两端完成同一支付成功、部分退款、账单/对账、结算成功闭环，直接比较规范化状态、最终性、Money、父子关联、稳定排序、预算、阻断、结算构成、幂等重放和副作用。

CAP4K 结算成功会发布 `payment.merchant-settlement.completed.v1` Integration Event。本地真实闭环需要启动 reference sink 并配置 HTTP route；可复现命令见 [README](../README.md#本地后端启动)。没有该 route 时的 `IntegrationEventRouteNotFoundException` 是运行环境缺少事件出口，不是统一业务契约差异。

## 后续强化边界

后续工作是生产强化，而不是再次缩减学习版业务：认证授权、生产租户隔离、持久化数据库与 Outbox/Inbox、多实例锁、真实渠道和资金移动、生产通知、安全设施、长期审计与可观测性仍属于后续范围。

若未来真实联调发现新的后端回归，应保留可复现 HTTP 证据并在对应后端修复；工作台不得用缓存、合成 receipt、固定成功或页面分支掩盖。
