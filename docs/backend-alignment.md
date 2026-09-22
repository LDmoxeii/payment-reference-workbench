# 支付参考后端业务对齐清单

本文以 `payment-product-template` 的统一业务诉求为目标，记录 WOW 与 CAP4K 当前实现、工作台兼容方式以及后端后续迭代。优先级表示“对完整业务工作台和后端统一契约的影响”，不表示当前 reference 项目代码质量。

## 优先级说明

- P0：统一业务闭环、安全边界或客户端契约的基础能力，应优先对齐。
- P1：运营完整性、可观察性和接入体验的重要能力。
- P2：策略细化或生产化增强，依赖业务规则进一步确认。

## 对齐矩阵

| 主题 | 优先级 | 统一业务目标 | WOW 当前 | CAP4K 当前 | 工作台当前兼容 | 后端后续迭代 |
|---|---|---|---|---|---|---|
| 支付/退款列表与分页 | P0 | 按商户、状态、时间、业务号筛选、排序和分页 | 没有列表 endpoint | 没有列表 endpoint | 本地最近记录仅用于导航；统一 `PageRequest/PageResult` 调用明确失败 | 两端增加稳定分页契约、筛选字段、排序、总数或游标；再扩展到对账和结算发现 |
| 支付尝试 | P0 | 创建支付与发起尝试语义独立，每次尝试有稳定身份和重试规则 | `POST /api/payments` 创建时自动选择渠道并启动尝试 | `POST /api/payments/{id}/attempts` 显式启动 | 支付对象的 action 决定是否显示发起按钮 | WOW 增加独立 start/attempt 入口，或两端形成版本化、可互操作的尝试状态机 |
| 支付渠道结果 | P0 | 独立、可验真、幂等、可区分重复/冲突/迟到 | `POST /api/payments/{id}/results`；`verified` 是普通请求字段 | `POST /api/channel/payment-results`；sandbox secret 校验 | 统一渠道结果模型，适配路径、字段和值；展示主状态、尝试状态和回执处置 | 统一通知身份、签名验证结果、重复/冲突处置、源证据和错误码 |
| 退款申请与结果 | P0 | 商户退款号、幂等键、原因、精确金额/币种；申请与渠道结果分离 | `POST /api/payments/{id}/refunds` 同时选择 fake result；缺少幂等键、原因、币种等目标字段 | `POST /api/refunds` 与 `/api/channel/refund-results` 分离；仍缺少显式幂等键和原因 | 统一退款表单保留目标字段；WOW 动作声明额外要求 initial result；CAP4K 创建后显示结果动作 | 两端补齐目标字段、幂等冲突和退款预算事实；WOW 拆分真实退款尝试与结果入口 |
| 退款预算 | P0 | 明确成功累计、处理中占用、可退款余额和失败释放 | Payment Projection 提供成功/预占金额，退款显示 reservation | Payment Projection 提供成功、预占、可退；退款显示 reservation | 支付详情统一展示四项，源缺失显示“未知”而不自行伪造 | 两端冻结字段语义和金额不变量，统一并发退款冲突码与审计事实 |
| 对账形成与发现 | P1 | 权威账单、账单 signal、revision、批次发现、重跑和处置 | 可登记 `/api/reference/statements` 并触发 `/api/reconciliation/bill-available`；无列表 | 日终调度或集成事件形成批次；支持按 ID 查询、重跑、处置；无普通创建和列表 | 按能力启用真实动作；CAP4K 不显示伪造的创建入口 | 提供一致的 reference 演示入口、按账单/日期发现批次的查询和 revision 语义 |
| 结算阶段 | P1 | 准备、复核、确认、执行、结果、未知保护、作废/替代关系 | `/api/settlements/generate` 后自动推进；支持 replace 和 adjudication | 显式 prepare、confirm、execute、channel result、void | 以统一 action 描述不同阶段；保留源状态和回执，不强行抹平流程 | 对齐阶段命名、操作回执、未知结果禁止重复付款和 replacement 链，允许实现保留事务差异 |
| 全链路轨迹 | P1 | 从支付追踪尝试、退款、对账、结算、通知和人工动作 | `GET /api/payments/{id}/trace` 提供聚合轨迹 | 支付详情有尝试、回执和 review，但没有跨域 trace | WOW 显示完整轨迹；CAP4K 显示局部并明确缺口 | CAP4K 增加稳定聚合轨迹；两端统一事件分类、发生时间、接收时间和证据引用 |
| 操作受理与最终状态 | P0 | HTTP 成功、命令受理、Projection 可见和业务终态相互独立 | 命令响应轻量，Projection 最终一致 | 多数命令返回当前结果，仍需重新查询业务对象 | 统一 `OperationReceipt` 声明 `poll/read_once`；超时不改写为失败 | 两端统一回执字段、建议刷新策略、版本/ETag 或可观察的操作状态 |
| 错误契约 | P1 | 稳定业务码、字段错误、冲突、重试语义和关联资源 | `{code,message,field?}`，覆盖 400/404/409 | `{status,code,message,details}`，覆盖 400/404/409/500 | 映射成统一错误，同时保留源 code/message/diagnostic | 两端对齐字段错误数组、幂等冲突关联资源、retryable/Retry-After 和 trace ID |
| 商户隔离与授权 | P0 | 商户隔离、角色授权、敏感动作复核和完整审计 | 明确属于 reference non-goal | 有 operator 字段与 sandbox 校验，没有生产认证 | 标记 reference 环境；不提供伪造登录或权限承诺 | 两端增加认证、租户边界、角色授权、敏感动作审计和最小权限 |
| 浏览器与网关接入 | P1 | 受支持的同源网关或明确 CORS 策略 | 未配置 CORS | 未配置 CORS | Vite `/backend` 开发代理 | 定义生产 API Gateway、CORS、CSRF、凭据和可观测性方案 |
| 能力发现和版本 | P1 | 客户端可查询契约版本、能力和动作约束 | 无 capability endpoint | 无 capability endpoint | 适配器静态声明 capability/action | 两端提供版本化 capability metadata，声明字段、动作、状态和弃用周期 |
| 业务政策 | P2 | 冻结退款期限、人工核对时限、双人复核阈值、结算周期和负净额策略 | 部分 reference 行为，不应视为正式政策 | 部分流程已建模，政策未全部冻结 | 只显示当前源事实和待决项 | 在产品模板中先确认规则，再分别实现并增加验收场景 |

## 当前可演示闭环

### WOW

1. 创建支付，后端自动选择 reference 渠道并启动尝试。
2. 通过 `/api/payments/{paymentId}/results` 提交成功、失败或未知结果。
3. 轮询 Payment Projection，区分命令受理和支付终态。
4. 对成功支付创建退款；fake result 在创建时驱动结果，未知结果可进入退款裁决。
5. 可选运营流程：登记权威账单、通知 bill available、查询对账、生成结算、替代或裁决。
6. 使用 payment trace 查看退款、对账、结算和通知关联。

### CAP4K

1. 创建支付。
2. 显式发起 payment attempt。
3. 通过 `/api/channel/payment-results` 提交 sandbox 渠道结果，再查询支付。
4. 对成功支付创建退款，再通过 `/api/channel/refund-results` 推进结果。
5. 对已有对账批次按 ID 查询、重跑或处置差异；工作台不能创建普通批次。
6. 结算按准备、确认、执行、sandbox 结果和受控作废分步推进。

## 建议后端迭代顺序

### 第一阶段：统一客户端基础契约

1. 支付、退款稳定列表和分页，明确筛选、排序、游标/总数。
2. 统一幂等、字段错误、冲突和操作受理回执。
3. 统一支付尝试身份和独立 start 语义。
4. 补齐退款申请字段与独立结果入口。
5. 建立认证、商户隔离和敏感动作授权边界。

### 第二阶段：运营流程可发现与可追踪

1. 对账批次发现、账单 revision 和 reference 演示入口。
2. 对齐结算阶段、未知结果保护、作废/替代关系。
3. CAP4K 增加跨域支付轨迹，两端统一事件分类与证据。
4. 提供版本化 capability metadata。

### 第三阶段：生产接入与业务政策

1. API Gateway/CORS、生产签名、凭据和审计方案。
2. 可靠通知与操作 trace ID。
3. 在模板冻结退款期限、人工时限、双人复核、结算周期和负净额政策后实现对应规则。

## 不能由工作台替代的能力

- 工作台的本地最近记录不能替代后端列表和分页。
- reference/sandbox 回调不能替代生产渠道验签与网络接入。
- 可编辑运营参数不能替代生产运营权限、审批和防误操作体系。
- 轮询不能替代后端明确的操作状态、版本控制或可靠事件协议。
- 能力对照页只能描述现状，不能证明后端已经具备目标能力。
