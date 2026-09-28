# Payment Reference Workbench

面向统一支付业务诉求的学习与验证工作台。同一套页面和业务组件通过统一领域模型、统一服务接口和后端适配器连接：

- `wow-reference-payment`
- `cap4k-reference-payment`

业务含义以 `payment-product-template` 的 reference learning profile 为准，不以任一后端的 DTO、路由或框架实现为页面标准。两个后端当前覆盖相同的学习版业务范围；HTTP 方法、字段名、header、回执包装、callback evidence 和读模型收敛方式等差异只存在于 adapter/HTTP 边界。

## 业务地图

工作台围绕三类学习角色组织业务：

- 商户操作：创建支付、创建并提交支付 attempt、申请退款、创建并提交退款 attempt，查看状态、最终性、回执和退款预算。
- 渠道与 fixture 实验：配置 reference 环境和逻辑时钟，注入成功、失败、未知、重复、迟到、冲突等可信结果。
- 平台运营：权威账单与对账、差异处置和事实确认、结算冻结与执行、人工核对、通知重试和 payment timeline。

一个典型完整闭环是：

```text
Reference 环境
  -> PaymentIntent
  -> PaymentAttempt
  -> 提交 attempt
  -> 可信渠道结果
  -> Refund / RefundAttempt（可选）
  -> 权威账单 revision
  -> ReconciliationRun / 差异处置
  -> Settlement / 确认 / 执行结果
  -> ManualReview / Notification / Payment Timeline
```

命令的 HTTP 2xx 或 `OperationReceipt` 只表示“已受理”，不表示支付、退款或结算已经成功。工作台按 `readAfter` 继续观察 `Operation` 和权威资源，并分别展示受理状态、操作状态、资源业务状态与 `finality`。

## 运行要求

- Node.js 20 或更高版本
- npm
- 启动 WOW 或 CAP4K 后端之一；仓库内两个 mode 默认都连接 `http://127.0.0.1:8080`

首次获取项目后安装锁定版本依赖：

```powershell
npm ci
```

连接 WOW：

```powershell
npm run dev:wow
```

连接 CAP4K：

```powershell
npm run dev:cap4k
```

`npm run dev` 等同于 WOW mode。Vite 通常从 `http://127.0.0.1:5173` 启动；若端口占用会输出实际端口。开发服务器把 `/backend/*` 代理到 `VITE_BACKEND_TARGET` 并移除 `/backend` 前缀，因此浏览器不需要后端额外开放 CORS。

后端未启动时，页面仍应可以打开，并把连接失败与后端业务错误区分显示。

### 本地后端启动

WOW：

```powershell
cd D:\code\wow-reference-payment
.\gradlew.bat run --no-daemon --console=plain
```

CAP4K：

在独立 PowerShell 窗口启动本地 Integration Event sink：

```powershell
cd D:\code\cap4k-reference-payment
pwsh -NoProfile -NonInteractive -File .\scripts\acceptance\reference-integration-event-sink.ps1 -Port 28081
```

另开窗口运行 CAP4K（已有 `start/build/libs/start.jar` 时可直接运行 Java 命令；否则先按后端项目说明构建）：

```powershell
cd D:\code\cap4k-reference-payment
java -jar .\start\build\libs\start.jar --server.port=18081 "--cap4k.ddd.integration.event.http.routes[payment.merchant-settlement.completed.v1]=http://127.0.0.1:28081"
```

CAP4K 的结算成功会发布 `payment.merchant-settlement.completed.v1` Integration Event。真实闭环必须让该事件指向运行中的 sink；未配置 route 会返回 `IntegrationEventRouteNotFoundException`（HTTP 500）。当 WOW 同时占用 8080 时，可把 `.env.cap4k` 的 `VITE_BACKEND_TARGET` 改为 `http://127.0.0.1:18081`。sink 只用于本地接收事件，不代表生产通知。

## 配置与后端切换

Vite 按 mode 读取 `.env.wow` 或 `.env.cap4k`。页面不读取 adapter 类型，只有运行时组合、adapter factory 和开发代理使用这些配置。

| 变量 | 用途 | 默认/示例 |
|---|---|---|
| `VITE_PAYMENT_ADAPTER` | adapter 注册键 | `wow` 或 `cap4k`，必填 |
| `VITE_API_BASE_URL` | 浏览器侧 API 基址 | `/backend/api` |
| `VITE_BACKEND_TARGET` | Vite 开发代理目标 | `http://127.0.0.1:8080` |
| `VITE_REFERENCE_FIXTURE_ID` | reference fixture 稳定标识 | `reference-default` |
| `VITE_REFERENCE_ACTOR_ALIAS` | reference 人工动作的 alias/表单预填 | 可选；由 adapter 映射到可信责任上下文 |

WOW 示例：

```dotenv
VITE_PAYMENT_ADAPTER=wow
VITE_API_BASE_URL=/backend/api
VITE_BACKEND_TARGET=http://127.0.0.1:8080
VITE_REFERENCE_FIXTURE_ID=reference-default
```

CAP4K 示例：

```dotenv
VITE_PAYMENT_ADAPTER=cap4k
VITE_API_BASE_URL=/backend/api
VITE_BACKEND_TARGET=http://127.0.0.1:8080
VITE_REFERENCE_FIXTURE_ID=reference-default
VITE_REFERENCE_ACTOR_ALIAS=fixture-reconciliation-operator
```

修改后端地址只需调整 `VITE_BACKEND_TARGET`；切换实现只需运行另一个 mode。业务页面、表单和 hooks 不需要修改。

## 项目结构

```text
src/
  adapters/       统一 adapter 接口、WOW/CAP4K 实现、映射和集中工厂
  config/         环境变量读取和运行时组合
  domain/         统一领域、请求、响应、Money 和错误模型
  http/           HTTP 通信、header、错误归一和观察辅助
  services/       页面使用的统一服务和 Operation/readAfter 协调
  styles/         工作台与响应式样式
  ui/             通用组件、结构化业务表单和页面
docs/
  backend-alignment.md   统一业务与两种实现/传输方式
  visual-validation.md  当前候选的视觉验证记录与待验项
  comet/                 正式需求、目标规格和工作流状态
```

运行时依赖保持在 React、Vite、TypeScript 和 Lucide 范围内；测试使用 Vitest，没有引入 UI 框架或全局状态管理库。

## 统一契约与 adapter 设计

```text
页面 / 结构化业务组件
          |
          v
PaymentWorkbenchService + 统一领域模型
          |
          v
集中 adapter factory
       /       \
      v         v
 WOW adapter  CAP4K adapter
       \       /
          v
 HTTP client + ApiError
```

页面只依赖 `PaymentWorkbenchService` 和统一类型。核心契约包括：

- `Money { currency, amountMinor }`：最小单位使用十进制整数字符串，领域计算不经过 JavaScript 二进制浮点。
- `Finality`：`NON_FINAL | FINAL | REVIEW_REQUIRED`，与资源自身 `status` 分离。
- `OperationReceipt`、`Operation`、`ReadAfter`：区分命令受理、操作收敛和资源业务结果。
- `ApiError`：保留稳定 `code`、`message`、`details`、`correlationId`、`retryable` 和必要源诊断。
- `PageRequest` / `PageResult<T>`：使用 opaque keyset cursor；页面不解析 cursor，也不伪造 total/page number。
- `Payment`、`Refund`、`AuthoritativeBill`、`ReconciliationRun`、`Settlement`、`ManualReviewItem`、`MerchantNotification` 和 `PaymentTimeline`。
- `CapabilityDeclaration`：`full | alternative | unavailable`，只描述真实后端 surface；页面依赖统一声明和 action descriptor，不读取后端类型。

adapter 负责：

- endpoint 路径、HTTP 方法、query/body/header；
- 字段名、Money、状态、finality 和关联引用映射；
- WOW 平铺与 CAP4K 嵌套的 receipt/resource envelope；
- `POLL` 与 `READ_ONCE` 的观察语义；
- callback token/evidence 注册和可信结果提交；
- 人工责任字段的 body/header 传输；
- 权威分页、错误 envelope 和 transport diagnostics。

页面不得出现 WOW/CAP4K 条件分支、后端路由字符串或 transport DTO。实现对照页可以只读展示这些差异，但不能用它们驱动业务流程。

## 支持的业务流程

### 支付

1. 使用 merchant、merchant order、Money、payment method 和 idempotency key 创建 PaymentIntent。
2. 独立创建 PaymentAttempt，并使用稳定 attempt identity 提交。
3. 通过 Reference Lab 提交由服务端验证的 `SUCCESS`、`FAILURE` 或 `UNKNOWN` 结果。
4. 查看 submission/result receipts、Operation、成功事实、费用快照、通知和 timeline。
5. 复现重复、无效、未知引用、迟到、冲突和到期场景；结果由后端裁决，前端不接受可编辑的 `verified=true`。

### 退款

1. 从成功支付查看 `original / succeeded / reserved / available` 权威退款预算。
2. 使用 merchant refund identity、Money、reason 和 idempotency key 申请全额或部分退款。
3. 独立创建、提交 RefundAttempt，再提交可信结果。
4. 查看失败/UNKNOWN/重复/迟到/冲突、预算占用或释放以及关联人工核对。

### 五类权威列表

Payment、Refund、ReconciliationRun、Settlement 和 ManualReviewItem 使用后端权威列表，支持统一筛选和 opaque cursor 翻页。切换筛选会清空旧 cursor，下一页原样回传后端 cursor；浏览器最近记录只能作为快捷入口，不能替代权威列表。

### 账单与对账

- 登记 reference 权威账单及不可变 revision，发送 bill available/refresh 信号。
- 创建或重跑 ReconciliationRun，查看 matching basis、平台事实、账单记录和差异。
- 对差异提交 `DifferenceDisposition` 或 `FactConfirmation`，保留 actor、reason、evidence 和原始事实。
- 只有明确结论可以解除相应阻断；未决 blocking difference 阻止完成和结算。

### 结算

- 按 merchant、currency 和 period 准备 Settlement，查看 included/excluded items 与 reason code。
- 确认后冻结 scope、items、Money 和 version。
- 执行并处理 `SUCCESS / FAILURE / UNKNOWN`，防止 UNKNOWN 或成功事实导致重复付款。
- 在允许时作废并创建 replacement；负净额及不确定结果进入人工核对。

### 人工核对、通知与 timeline

- 筛选和查看权威 ManualReviewItem，使用结构化 outcome/reason/evidence 处置。
- 查看 notification/content identity、投递历史并安全重试。
- 按 `recordedAt ASC, eventId ASC` 查看 payment timeline，追踪支付、退款、对账、结算、通知和人工操作。

### Reference Lab

Reference Lab 用于初始化 fixture/policy/merchant/channel、设置或推进逻辑时钟、登记账单、运行维护以及构造正常和异常结果。WOW 支持 payment channel、bill provider、notification sender、settlement executor 四类脚本的配置、读取、重置；CAP4K 支持 payment channel 的配置/重置、账单登记时的暂不可读次数、notification sender 的配置/重置，以及按 `executionId` 配置/读取/重置 settlement executor。CAP4K 的前三类脚本没有全部独立诊断读取路由，页面会如实显示 `unavailable` 的读取结果；脚本的业务消费能力不因此缺失。它仅用于学习和确定性复现，不是生产渠道、资金或权限系统。

## WOW 与 CAP4K 的实现差异

下面列出 adapter 吸收的实现/传输差异。统一业务动作和页面无需因这些差异分叉。

| 主题 | WOW | CAP4K | 统一处理 |
|---|---|---|---|
| 权威列表 | `GET` collection + query | `POST .../search` + JSON filters | `PageRequest/PageResult<T>` 与 opaque cursor |
| receipt 资源引用 | 顶层 `resourceType/resourceId` | 嵌套 `resource` | `ResourceRef` |
| Operation | Projection 收敛，常用 `POLL` | 响应包裹 operation，常用 `READ_ONCE` | `OperationReceipt + ReadAfter` |
| 人工责任上下文 | actor/reason/evidence 进入命令 body | alias 经 `X-Reference-Actor-Context`，reason/evidence 进入 body | `ResponsibilityInput` |
| callback 验证 | 先获取 fixture verification token | 先登记 callback evidence | 可信结果统一动作 |
| payment timeline | `/payments/{id}/trace` | `/payments/{id}/timeline` | `PaymentTimeline` |
| 支付到期 | 单支付 expire 命令 | 单支付 `close-expired` 命令；全局 maintenance 仍可独立运行 | `CLOSE_EXPIRED_PAYMENT` 与真实 receipt |
| Run 完成 | 有显式 complete 路由 | 在 bill signal/rerun/差异解除后自动收敛 | 统一读取 Run 状态；是否有额外 complete 传输不进入页面分支 |
| replacement | 独立 replace 命令 | void 请求的 `createReplacement=true` | 统一 void/replacement 动作 |
| 结算执行身份 | 接受 caller-supplied `executionId`；脚本按 fixture/channel 配置 | 接受 caller-supplied `executionId` 和显式执行渠道；脚本按 executionId 配置 | 统一执行命令和身份；脚本配置差异留在 adapter |
| 脚本诊断读取 | 四类脚本均可独立配置/读取/重置 | channel 与 notification 缺独立 read；bill 暂不可读次数随 revision 登记；settlement 可配置/读取/重置 | `ReferenceCommandResult.effect` 如实标明传输可用性 |

更完整的对应关系见 [docs/backend-alignment.md](./docs/backend-alignment.md)。

## 新增第三种后端

当统一业务语义不变时，新增后端不需要修改现有业务页面：

1. 在 `src/adapters/` 新增类并完整实现 `PaymentBackendAdapter`。
2. 在 adapter 内完成 DTO、Money、status/finality、resource ref、receipt、Operation、page 和 error 映射。
3. 把该后端的 callback 可信边界、责任上下文和 `readAfter` 收敛封装成统一命令语义。
4. 保证五类资源使用后端权威 `PageResult<T>`，opaque cursor 不被解释或重写。
5. 在 `src/adapters/factory.ts` 和 `BackendId` 中集中注册 adapter key。
6. 增加对应 mode、代理目标和必要 reference 配置。
7. 增加共享契约测试、路径/方法/header/payload 映射测试、错误/分页/观察测试。
8. 连接真实后端执行代表性支付到结算闭环，并比较规范化业务观察。

如果新后端提出当前统一模型之外的新业务语义，应先修改产品模板和统一规格，再让所有 adapter 显式响应；不要在单个 adapter 或页面中偷偷扩展。

## 验证

```powershell
npm run typecheck
npm run test
npm run build
```

也可以一次执行：

```powershell
npm run check
```

这些命令分别执行 TypeScript 检查、Vitest 测试和 production build。真实接入还必须分别连接 WOW 与 CAP4K，经浏览器/前端服务边界执行代表性闭环；mock、后端 Controller 测试和后端既有 PAY-AC 报告不能替代本轮前端证据。

真实 adapter 闭环测试默认跳过，显式指定后端后运行：

```powershell
$env:LIVE_PAYMENT_BACKEND='wow'
$env:LIVE_PAYMENT_BASE_URL='http://127.0.0.1:8080/api'
npm exec vitest run src/adapters/live-smoke.test.ts

$env:LIVE_PAYMENT_BACKEND='cap4k'
$env:LIVE_PAYMENT_BASE_URL='http://127.0.0.1:8080/api'
npm exec vitest run src/adapters/live-smoke.test.ts

$env:LIVE_PAIRED_CONSISTENCY='1'
$env:LIVE_WOW_BASE_URL='http://127.0.0.1:8080/api'
$env:LIVE_CAP4K_BASE_URL='http://127.0.0.1:18081/api'
npm exec vitest run src/adapters/paired-consistency-smoke.test.ts
```

2026-09-26 当前候选分别连接真实 WOW 与 CAP4K 执行上述单后端闭环，两个 mode 均通过。场景每次使用独立业务日，实际穿过环境初始化、支付/退款 attempt 与可信结果、退款预算、权威 Bill detail/revision、含阻断差异的对账与责任处置、结算 executor/执行结果、单支付到期关闭、ManualReview、通知、五类列表和 payment timeline；paired smoke 同时比较两端完整成功闭环与 `UNKNOWN → ManualReview → CONFIRM_FAILURE` 分支，覆盖 Money/status/finality、父子关联、稳定排序、预算、对账阻断、结算构成、幂等重放和副作用计数。这些证据独立于两个后端此前的 PAY-AC 报告。完整 `npm run check` 本轮已通过（107 passed、3 个真实环境测试默认 skipped）；最终候选的复验结论以当前 Comet Verify 记录为准。

当前候选的视觉验证范围和证据状态见 [docs/visual-validation.md](./docs/visual-validation.md)。

### 已关闭的学习版对齐项与剩余差异

WOW 四类 reference 脚本已落地并由对应支付提交、账单读取、通知投递和结算执行路径消费。CAP4K 已公开权威 Bill detail/revision history、带真实 `OperationReceipt` 的单支付 `close-expired`、settlement executor 控制面，并接受、持久化 caller-supplied `executionId`。本轮工作台已接入这些能力，原“后端再对齐”清单不再是未完成需求。

CAP4K 的 channel 和 notification script 无独立 read 路由，bill provider 暂不可读次数随 revision 登记而无独立 configure/read/reset；相应独立诊断动作会返回明确 `unavailable`。这与支付、对账、通知、结算业务闭环的能力状态分开表达。其他保留差异包括 `POLL/READ_ONCE`、GET list/POST search、actor body/header、callback token/evidence registry、WOW 显式对账完成/CAP4K 自动收敛，以及 settlement script 的 channel/executionId 绑定。详情见 [docs/backend-realignment.md](./docs/backend-realignment.md)。

## 已知边界与后续生产强化

当前交付是单人学习和业务验证用的 reference 工作台，明确不把以下设施伪装成已完成：

- 登录、JWT/OIDC、生产 RBAC/双人授权、生产租户隔离；
- 生产网关、CORS/CSRF/限流/TLS、Secret Manager；
- 生产数据库部署、迁移、重启恢复、持久化 Outbox/Inbox、跨进程 exactly-once、多实例调度锁；
- 真实支付渠道、真实验签证书、真实账单下载、真实资金移动和生产通知；
- 生产 SLA、长期审计、脱敏以及跨币种、分账、订阅、预授权、拒付/争议和税务业务。

这些非目标不会削弱学习版的领域语义：幂等、可信收件、重复/冲突/迟到/UNKNOWN、退款预算、对账阻断、结算冻结与防重付、责任字段、通知稳定身份、五类权威列表和完整 payment timeline 仍属于当前统一契约。
