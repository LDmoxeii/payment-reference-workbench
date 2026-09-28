# 统一支付参考工作台完整目标规格

## 1. 产品定位与业务基线

支付参考工作台是 `payment-product-template` 统一学习版业务契约的交互投影，用于学习支付业务、比较 WOW/CAP4K 的框架实现，并快速验证统一业务诉求。工作台不以任何单一后端的 DTO 或路由作为页面模型，也不以两个后端旧能力的交集缩减功能。

归档后的 WOW 与 CAP4K 均已覆盖同一套支付、退款、对账、结算、人工核对、通知、权威列表和 payment timeline 业务。前端必须将二者视为相同业务能力的两种实现；路径、方法、字段、header、callback evidence、receipt 结构和 readAfter 差异由适配器处理。

## 2. Requirements

### Requirement: 统一业务契约与适配器隔离

**统一业务契约与适配器隔离。** 页面、组件、hooks 和表单只能依赖 `PaymentWorkbenchService`、统一领域对象及其动作，不得读取 adapter kind、拼接后端 URL 或用 WOW/CAP4K 条件分支决定业务流程。适配器由环境变量或集中配置工厂选择。

#### Scenario: 同一页面通过配置切换两个后端

- GIVEN 分别以 WOW 与 CAP4K 配置启动同一版本工作台
- WHEN 用户访问支付、退款、对账、结算、人工核对和 timeline 页面
- THEN 页面代码与业务组件不变，且只调用统一服务
- AND 两个适配器分别封装实际路径、方法、字段、header、回执、分页、错误和收敛差异
- AND 新增第三适配器不要求修改已有业务页面

### Requirement: 统一基础契约

**统一基础契约。** 前端必须完整建模 `Money`、`Finality`、`ResourceRef`、`EvidenceRef`、`OperationReceipt`、`Operation`、`ReadAfter`、`ApiError`、`Page<T>`、外部 `occurredAt` 与平台 `recordedAt`，并保留稳定关联与源诊断。

`Money` 使用 `{ currency, amountMinor }`，金额为十进制整数字符串。`Finality` 为 `NON_FINAL | FINAL | REVIEW_REQUIRED`。receipt 包含 `operationId`、`commandType`、资源引用、`acceptanceStatus`、`acceptedAt`、`idempotentReplay`、`correlationId` 和 `readAfter`；Operation 终止状态仅为 `SUCCEEDED | FAILED | REVIEW_REQUIRED`。`ApiError` 保留 `code/message/details/correlationId/retryable`。

#### Scenario: 受理、读取和错误语义保持完整

- GIVEN 后端分别返回同步拒绝、ACCEPTED、ALREADY_ACCEPTED、READ_ONCE、POLL、RESOURCE_NOT_READY 或观察超时
- WHEN 统一服务处理响应并驱动页面观察
- THEN 同步拒绝只形成 ApiError，不伪造 Operation 或资源
- AND receipt、Operation、资源业务状态和 finality 分层展示
- AND POLL 按 operationUrl/resourceUrl/retryAfterMs 收敛，超时只形成 OBSERVATION_TIMEOUT
- AND Money 不经过 JavaScript 浮点，源错误和 correlationId 可查看

### Requirement: 支付完整闭环

**支付完整闭环。** 支付页面必须支持创建 PaymentIntent、创建 PaymentAttempt、提交 attempt、接收 reference 渠道结果、处理到期/未知/重复/无效/迟到/冲突结果、查看成功事实、费用快照、submission receipts、result receipts、notifications 和 operations。

创建支付输入至少包含 merchantId、merchantOrderId、Money、paymentMethod 和 idempotencyKey；创建不得自动发起 attempt。attempt 与 submit 使用稳定 identity。页面不得提供可编辑的 `verified` 字段，可信结论由后端 verifier 派生。

支付详情中的创建、提交与可信结果动作必须只读显示当前绑定的 Payment ID。列表行只作为导航摘要，打开详情时必须按该 ID 读取权威 Payment。切换 Payment 时，Attempt、渠道、外部交易号、Submission/Result identity 和幂等键必须按新资源重建上下文；同一命令的安全重试继续使用原 identity。

常规结果录入使用已知 Attempt 选择器并级联渠道与外部交易号；未知 Attempt 仅在显式异常实验模式下允许自由输入。创建或提交 attempt 后，页面必须自动回读 Payment 并刷新支付权威列表；已有未决 Attempt 时不得错误开放并行创建。

#### Scenario: 从支付意图推进到可信结果

- GIVEN 合格商户、渠道、policy 与逻辑时钟
- WHEN 用户创建支付、创建并提交 attempt，再通过 reference 入口注入 SUCCESS、FAILURE 或 UNKNOWN
- THEN 页面依次显示支付、attempt、提交回执、结果收件、Operation 和最终性
- AND ACCEPTED 不显示为已付款，首个可信成功只显示一个 PaymentSuccessFact
- AND duplicate/invalid/unknown-reference/late/conflicting 收件均可查看且不覆盖已确定事实
- AND 到期、重试与成功后禁建新 attempt 的可执行状态来自统一资源动作
- AND 创建或提交 attempt 后无需手工刷新即可看到权威 attempt、submission/result receipts 与更新后的 actions
- AND 切换 Payment 或 Attempt 时所有关联字段与命令 identity 按当前上下文更新，不携带上一资源或上一 Attempt 的值
- AND 常规模式只选择已知且当前可操作的 Attempt，未知引用必须显式进入异常实验模式

### Requirement: 退款与预算完整闭环

**退款与预算完整闭环。** 退款页面必须支持申请 Refund、查看 Payment 权威预算、创建与提交 RefundAttempt、接收可信退款结果、处理失败/UNKNOWN/重复/迟到/冲突和人工核对。

退款申请包含 merchantId、paymentId、merchantRefundNo、Money、reason、idempotencyKey；申请只创建退款并预占预算，不注入最终结果。页面展示 original/succeeded/reserved/available，并保持 `succeeded + reserved <= original`。

退款详情中的创建、提交与可信结果动作必须只读显示当前绑定的 Refund ID。列表打开、命令完成和继续观察收敛后都必须读取权威 Refund 及来源 Payment 预算。切换 Refund 或 Attempt 时，表单不得复用上一退款的幂等键、Submission ID、Result identity、渠道或渠道退款号；同一已受理命令的安全重试除外。

常规提交只列出当前可提交的 RefundAttempt，唯一候选自动选中；有未提交或在途 Attempt 时禁止创建并行 Attempt，并给出提交、等待或处置现有 Attempt 的下一步。明确可重试失败且 policy 允许时，才重新开放创建。

#### Scenario: 部分退款、结果收敛与预算转换

- GIVEN 成功支付仍有可退款金额
- WHEN 用户申请部分退款、创建并提交 attempt，再注入成功、失败或 UNKNOWN 结果
- THEN 退款、attempt、receipts、operation 和预算变化可独立观察
- AND 相同申请重放不重复预占，超额申请同步拒绝
- AND 成功只转换一次预算，整体失败只释放一次，UNKNOWN/review 继续占用
- AND 成功后的迟到失败不回退成功退款或预算事实
- AND 创建或提交 RefundAttempt 后无需手工刷新即可看到权威 attempt、收件和预算变化
- AND 切换退款或 Attempt 时渠道退款号、渠道、identity 和幂等键不会残留其他上下文的数据
- AND 已有未决 Attempt 时创建动作禁用并解释原因，唯一可提交 Attempt 自动选中且目标 Refund ID 清晰可见

### Requirement: 五类权威列表与稳定分页

列表项必须只作为摘要和详情导航入口，不得直接作为完整详情初始化业务表单。点击详情必须按稳定 ID 调用对应权威详情查询；详情读取期间显示局部加载状态，并防止先发后到的旧请求覆盖用户最后选择的资源。动作完成后重新查询受影响详情和列表，同时保留当前筛选语义。

**五类权威列表与稳定分页。** Payment、Refund、ReconciliationRun、Settlement、ManualReviewItem 必须使用后端权威 `Page<T> { items, nextCursor, pageSize }`。统一查询支持 merchantId、status、finality、稳定 ID、createdFrom/createdTo 及资源专属筛选；页面使用 opaque keyset cursor，不解释或改写 cursor。

#### Scenario: 筛选五类列表并使用 opaque cursor 翻页

- GIVEN 后端存在跨 merchant、status、finality、时间且含相同 sortTime 的五类资源
- WHEN 用户筛选、小页翻页、返回首屏或更换筛选条件
- THEN 页面展示后端权威结果，不以 localStorage 或前端全量聚合代替
- AND nextCursor 原样回传，筛选变化清空旧 cursor
- AND 首屏后新建的更靠前记录不回填旧 cursor 的后续页
- AND INVALID_CURSOR 显示为可理解错误且不会静默回到错误数据集
- AND 点击任一列表详情都会按稳定 ID 读取权威完整资源，摘要缺少 attempts、receipts 或历史时也不会显示成空详情
- AND 快速连续打开多个资源时最终只展示最后选择的详情，动作后详情和相应列表自动失效并重新读取

### Requirement: 权威账单与 ReconciliationRun

**权威账单与 ReconciliationRun。** 工作台必须支持 reference 权威账单及不可变 revision、bill available/refresh、运行与重跑、run 详情、matching basis、差异、DifferenceDisposition、FactConfirmation 和显式完成。ReconciliationRun 是唯一对账执行主资源。

#### Scenario: 从账单 revision 运行对账并处置差异

- GIVEN reference bill provider 中存在稳定 bill/revision 和可关联的平台事实
- WHEN 用户登记/发现账单、触发 Run、查看差异、提交带责任字段的处置或 FactConfirmation，并在满足条件后完成
- THEN 高 revision 前进且迟到低 revision 不回退，旧 run 与 effectiveRun 可区分
- AND MATCHED、PLATFORM_ONLY、CHANNEL_ONLY、AMOUNT/CURRENCY/STATUS_MISMATCH、DUPLICATE、UNMATCHED 及双方证据可查看
- AND 原平台事实、账单、初始差异和追加处置分别保留
- AND 未决 blocking difference 阻断完成/结算，只有明确结论解除相应阻断

### Requirement: 结算完整生命周期

**结算完整生命周期。** 工作台必须支持按 merchantId、currency、period 准备 Settlement，查看 INCLUDED/EXCLUDED items 与 reason code，确认冻结，执行，接收 SUCCESS/FAILURE/UNKNOWN，人工核对，作废和创建 replacement。

#### Scenario: 准备、冻结并安全执行结算

- GIVEN 周期内存在收入、退款、费用、调整、未决、UNKNOWN 和已结算候选
- WHEN 用户 prepare、查看构成、confirm、execute 并提交三类结果，或在允许时 void/replacement
- THEN 每个候选均有来源、纳入/排除和 reason，净额等于 included items 汇总
- AND confirm 后 scope/items/Money/version 冻结
- AND SUCCESS 只形成一次，明确 FAILURE 后的新 attempt 受控，UNKNOWN 保持原 execution identity 并禁止重付
- AND 负净额进入人工核对，void/replacement 不绕过成功事实、UNKNOWN 或 scope 唯一性

### Requirement: 人工核对通知与 payment timeline

**人工核对、通知与 payment timeline。** ManualReviewItem 是权威资源，工作台必须支持列表、详情和带 outcome/reason/evidence 的处置；通知展示稳定 notification/content identity、投递尝试和重试；payment timeline 展示全链路权威事件。

#### Scenario: 从 payment timeline 追踪并完成人工核对

- GIVEN 一笔支付经历 attempts、receipts、退款预算、通知、bill/revision、Run/difference、Settlement 和 review
- WHEN 用户打开 payment timeline、通知详情和 ManualReviewItem，并提交完整责任字段
- THEN timeline 按 recordedAt ASC、eventId ASC 稳定展示全部关联事件且保留 occurredAt
- AND review 显示 related refs、blocking scopes、证据和追加处置历史
- AND 缺少可信 actor context、reason 或 evidence 时同步拒绝且无副作用
- AND 成功处置展示后端解析的 actorId、服务端时间、reason、evidence 和解除阻断结果

### Requirement: reference 实验与确定性

**reference 实验与确定性。** 工作台必须提供学习版 fixture、ReferencePolicy、逻辑时钟以及 channel/bill/settlement/notification executor 的结构化实验入口，能够构造正常与异常场景；控制面与业务 callback contract 分离。

#### Scenario: 使用 reference 实验复现异常并重复闭环

- GIVEN 固定 merchant/channel/actor alias、policy、clock 和 executor scripts
- WHEN 用户分别构造 success、failure、unknown、duplicate、invalid、unknown-reference、late、conflict 与暂不可读场景并从干净运行重复闭环
- THEN 页面记录本次 fixture/policy/clock，且业务结果由后端裁决
- AND callback 不接受客户端自报 verification，CAP4K evidence registration 与 WOW fixture token 差异由适配器处理
- AND 相同输入的规范化状态、错误、关联、排序和副作用可重复，同 identity 不产生第二业务效果

### Requirement: 面向业务的交互

**面向业务的交互。** 首页和业务区必须按“商户操作、渠道/fixture 实验、平台运营”组织。常用命令使用字段明确的表单、选择器或抽屉，而不是要求用户编辑任意 JSON；危险、资金结果和人工处置动作需要确认。

每个详情动作表单必须显示其绑定的稳定资源 ID。依赖字段采用明确级联：选择 Payment/Refund 后加载完整详情，选择 Attempt 后覆盖或清空渠道及外部交易号；不得使用旧字段作为缺失值回退。常规 Attempt 操作使用真正的选择器；允许未知引用的高级场景必须通过独立、明确标注的异常实验模式进入。

表单 identity 以“当前资源 + 业务步骤”为生命周期边界。切换资源时生成新的幂等键、Submission ID 和 Result identity；同一资源、同一命令因网络失败、投影延迟或观察超时而重试时保持 identity。动作不可执行时必须禁用并显示后端无关的业务原因与下一步，不让用户提交后再靠错误猜测状态规则。

#### Scenario: 在桌面和移动视口完成结构化业务操作

- GIVEN 用户不熟悉后端 DTO，分别使用桌面和移动视口
- WHEN 用户完成支付、退款、对账、结算和人工核对的主要操作
- THEN 表单使用统一业务术语、合理默认值、必填校验和上下文预填
- AND 用户无需知道当前后端路由或手写常用动作 JSON
- AND 长 ID、Money、状态、证据和错误可读/可复制，控件不重叠
- AND 危险动作有明确确认，成功/失败反馈不丢失当前上下文
- AND 创建、提交和可信结果区域清楚显示当前目标资源 ID，切换资源后表单不残留上一资源的关联字段或 identity
- AND 已知 Attempt 通过选择器操作并正确级联渠道与外部交易号，未知 Attempt 只在显式异常实验模式中自由输入
- AND 不可执行动作显示禁用原因和可执行的下一步，唯一可提交 Attempt 自动选中

### Requirement: 加载空状态错误与异步反馈

**加载、空状态、错误与异步反馈。** 每个请求必须有局部加载和重复提交保护；空数据、能力配置错误、404、字段错误、业务冲突、网络异常、RESOURCE_NOT_READY、轮询超时和业务终态必须可区分。

同步命令拒绝、网络失败和观察错误必须在当前视口通过非阻塞、可关闭且支持 `aria-live` 的通知立即可见；页面原位置仍保留完整错误码、details、correlationId、源诊断和重试入口。普通请求错误不得强制使用阻塞弹窗，危险动作的确认仍独立处理。

统一命令流程必须覆盖 receipt 受理、Operation 观察、权威资源回读和关联列表刷新。命令已受理后的观察/读取失败不能显示为命令未执行；应保留 receipt 和 Operation ID，允许继续观察。READ_ONCE 或 POLL 在 Operation 已收敛而 Projection 暂不可读时，应明确显示“命令已受理，详情尚未更新”，并在后续读取成功时自动刷新详情和列表。

#### Scenario: 请求失败或异步观察暂未收敛

- GIVEN 查询或命令发生字段错误、业务冲突、网络失败、Projection 暂不可见或观察超时
- WHEN 页面处理错误并允许用户继续
- THEN 保留表单输入、资源上下文和最近 receipt
- AND 展示稳定 code、消息、details、correlationId、retryable 和必要源诊断
- AND 可重试问题提供安全重试/手动刷新，不可重试问题指向需修改字段或现有资源
- AND 超时不显示为领域失败，后续仍可按 operationId 或 resource ref 继续观察
- AND 用户在长页面底部触发错误时无需滚回页首即可看到错误码和摘要，关闭通知后页内完整诊断仍然存在
- AND 命令同步拒绝与已受理后的观察失败明确区分，后者保留 receipt、Operation ID、资源上下文和继续观察能力
- AND Operation 或 Projection 稍后收敛时，当前详情和关联权威列表自动更新，不要求用户手工刷新整页

### Requirement: 可运行可维护与第三适配器扩展

**可运行、可维护与第三适配器扩展。** README 和实现文档必须说明项目结构、安装/启动、后端地址、开发代理、适配器切换、统一契约、业务流程、两端实现差异、验证命令、生产强化边界及新增第三适配器步骤。

#### Scenario: 按文档切换后端并注册第三适配器

- GIVEN 开发者获得仓库且不修改页面代码
- WHEN 按 README 分别启动 WOW/CAP4K 模式，或实现一个满足统一契约的新 adapter
- THEN 应用可以类型检查、测试、构建和连接对应后端
- AND adapter 注册集中，配置缺失时给出明确启动或连接错误
- AND 新 adapter 只需实现服务契约、映射、配置注册和契约测试
- AND 文档不再声称两端缺少列表、独立 attempt、refund result 或 timeline

### Requirement: 真实 WOW 接入验收

**真实 WOW 接入验收。** WOW 适配器必须连接当前真实服务并穿过实际 HTTP 路由、序列化、Operation/readAfter、Projection 和可信入站边界，不得用 mock 结果冒充真实接入。

#### Scenario: 经工作台连接真实 WOW 完成代表性闭环

- GIVEN 从干净 reference 运行启动真实 WOW 服务与前端 WOW 配置
- WHEN 经工作台创建并成功支付、完成部分退款、发布账单并运行/处置对账、准备/确认/执行结算、查看 review/notification/timeline 和五类列表
- THEN 所有请求命中真实 WOW HTTP surface，POLL/RESOURCE_NOT_READY 按 readAfter 收敛
- AND 页面显示统一模型、权威分页、完整证据与最终状态
- AND 创建/提交支付与退款 Attempt 后页面自动显示权威详情和列表变化，错误通知在当前视口可见，资源与 Attempt 级联不串用旧值
- AND 过程不修改、清理或提交 WOW 工作树，也不复用后端既有 67/67 报告代替本次前端证据

### Requirement: 真实 CAP4K 接入验收

**真实 CAP4K 接入验收。** CAP4K 适配器必须连接当前真实服务并穿过实际 HTTP 路由、序列化、事务 Operation、actor registry、callback evidence 和权威查询边界，不得用 mock 结果冒充真实接入。

#### Scenario: 经工作台连接真实 CAP4K 完成代表性闭环

- GIVEN 从干净 H2 reference 运行启动真实 CAP4K 服务与前端 CAP4K 配置
- WHEN 经工作台执行与 WOW 等价的支付、退款、账单/对账、结算、review/notification/timeline 和五类列表流程
- THEN 所有请求命中真实 CAP4K HTTP surface，READ_ONCE/Operation 语义正确
- AND actor alias 由 X-Reference-Actor-Context 传输，callback evidence 由服务端 registry 验证
- AND 页面显示统一模型、权威分页、完整证据与最终状态
- AND 创建/提交支付与退款 Attempt 后页面自动显示权威详情和列表变化，错误通知在当前视口可见，资源与 Attempt 级联不串用旧值
- AND 过程不修改、清理或提交 CAP4K 工作树，也不复用后端既有 67/67 报告代替本次前端证据

### Requirement: 双后端规范化业务一致性

**双后端规范化业务一致性。** 两个适配器必须对等价的统一输入提供相同业务含义；允许内部 ID、路由、HTTP 方法、receipt 包装和 readAfter mode 不同。

#### Scenario: 同一业务场景在两个后端得到等价观察

- GIVEN 两端使用等价 merchant/channel/actor、Money、policy、clock 与 executor script
- WHEN 分别通过同一前端服务流程执行支付到结算闭环及一个 UNKNOWN/人工处置分支
- THEN 规范化 Money、status、finality、ApiError、关联、排序、预算、阻断和副作用一致
- AND WOW 平铺 resource ref 与 CAP4K 嵌套 resource、GET 与 POST search、actor body/header、fixture token/evidence registry、trace/timeline 路径及 void/replacement 组合差异均不可泄漏到页面
- AND 两端均以相同的通知、权威详情刷新、表单上下文隔离、Attempt 选择和禁用原因表达等价业务状态
- AND 不比较随机内部 ID 字面值，也不要求两个框架采用相同事务或收敛方式

## 3. 完整统一领域模型

### 3.1 通用类型

- `Money { currency, amountMinor }`：大写 ISO 4217 与十进制整数字符串；输入层可提供 decimal 辅助转换，但领域层只保存 minor unit。
- `Finality`：`NON_FINAL | FINAL | REVIEW_REQUIRED`，与每个资源自身 `status` 独立。
- `ResourceRef` / `EvidenceRef`：稳定类型、ID 与可选 URI；关联不依赖嵌套副本。
- `OperationReceipt`：完整保留 operation、command、acceptance、resource、correlation 与 readAfter；兼容 WOW 平铺资源字段和 CAP4K 嵌套 `resource`。
- `Operation`：`ACCEPTED | PROCESSING | SUCCEEDED | FAILED | REVIEW_REQUIRED`，并保留错误、资源和时间。
- `ReadAfter`：`READ_ONCE | POLL`，含 operationUrl、可选 resourceUrl、retryAfterMs；URL 仅由 adapter/http 使用，页面按统一观察 API 工作。
- `ApiError`：稳定 code/message/details/correlationId/retryable 与可选 transport diagnostics。
- `PageRequest` / `Page<T>`：filters、pageSize、opaque cursor；不提供页码或前端自算 total 的假权威语义。
- `ActionDescriptor`：统一 action id、可执行性、禁用原因、字段 schema、确认级别和刷新/观察策略；页面不根据后端类型决定动作。

### 3.2 权威资源

- `Payment`：payment/merchant/order/idempotency、Money、method、status/finality/times、attempts、submission/result receipts、success fact、fee snapshot、refund budget、notifications、reviews、operations 与 actions。
- `Refund`：refund/payment/merchant/merchantRefundNo/idempotency、Money/reason、status/finality、attempts/receipts、budget decision、reviews、operations 与 actions。
- `AuthoritativeBill` / `BillRevision`：channel/bill/businessDate/currency/current revision、immutable revision content、completeness、records、evidence 和读取诊断。
- `ReconciliationRun`：scope/revision/effective identity、status/finality、platform facts、bill records、matching basis、differences、dispositions、confirmations、blocking reasons 和 actions。
- `Settlement`：merchant/currency/period、status/finality/version、gross/refund/fee/adjustment/net、items、confirmation、executions/receipts、void/replacement、reviews 和 actions。
- `ManualReviewItem`：type/status/finality、related refs、blocking scopes、evidence、created/resolved time、disposition history 与 actions。
- `MerchantNotification`：notification/content identity、业务关联、delivery attempts、最终状态与 retry action。
- `TimelineEntry`：eventId/category/occurredAt/recordedAt/refs/outcome/actor/reason/evidence；稳定排序由后端保证。

## 4. 统一服务边界

`PaymentWorkbenchService` 至少提供以下语义，具体方法可按前端模块拆分，但不得让页面直接使用 transport DTO：

- 连接/配置：读取连接状态、后端展示信息与 reference policy/fixture 状态。
- Operations：按 receipt 自动或手动观察 Operation/资源，支持继续观察和超时恢复。
- Payments：create/get/list、create attempt、submit attempt、close expired、receive/reference result、attempt/receipt/notification/timeline 查询。
- Refunds：request/get/list、budget、create attempt、submit attempt、receive/reference result。
- Bills/Reconciliation：bill/revision 查询与 reference 发布、bill available/refresh、run/rerun/get/list、difference dispose、fact confirm、complete。
- Settlements：prepare/get/list、confirm、execute、receive/reference result、void、replacement、items/executions 查询。
- Reviews/Notifications：review get/list/resolve，notification 查询与 retry。
- Reference Lab：fixture/policy/clock/actor alias/evidence/executor scripts 的统一操作。

命令方法返回 receipt 或同步 ApiError；统一服务负责适配器映射和 readAfter 协调，但不把资源业务终态折叠进 receipt。查询返回统一资源或 Page，不暴露后端 envelope。

## 5. 适配器责任与已知传输差异

### 5.1 WOW adapter

- 权威列表使用 `GET /api/payments`、`/api/refunds`、`/api/reconciliation-runs`、`/api/settlements`、`/api/manual-reviews` 及 query parameters。
- 将平铺的 `resourceType/resourceId` receipt 转为统一 `ResourceRef`，并按实际 `readAfter` 轮询 Projection。
- payment timeline 来自 `/api/payments/{id}/trace`。
- reference callback 使用服务端 fixture token/可信 verifier；前端不传 `verified`。
- 人工责任字段按 WOW 公开命令所需 body/header 映射。
- settlement void 与 replacement 的独立命令由统一工作流编排。

### 5.2 CAP4K adapter

- 五类权威列表使用对应 `POST .../search`，将统一 filters/cursor 映射到 request body。
- 将嵌套 `resource` receipt、CAP4K error envelope 与 READ_ONCE Operation 映射到统一契约。
- payment timeline 来自 `/api/payments/{id}/timeline`。
- 人工动作把统一 actor alias 放入 `X-Reference-Actor-Context`，不把用户可编辑 actorId 当成可信身份。
- callback 前通过 reference fixture 的 callback-evidence 入口登记服务端 evidence，再提交 canonical callback。
- settlement void 可通过 `createReplacement` 组合流程完成，adapter 对页面仍暴露统一的 void 与 replacement 动作结果。

### 5.3 不得泄漏的差异

页面不得出现 `if backend === ...`、后端路由字符串、CAP4K/WOW transport DTO、actor header、fixture token、callback proof 或 receipt 包装判断。面向学习者的“实现对照”可只读展示这些差异，但不能用它们驱动业务分支。

## 6. 页面与交互信息架构

- 首页：连接状态、当前配置、统一业务地图、最近 operation、五类资源快捷入口和 reference 环境摘要。
- 支付：权威列表/筛选/分页、创建、详情、attempt、submit/result receipts、退款预算、通知、timeline 与统一动作。
- 退款：权威列表、申请、详情、attempt/receipts、预算影响和 review。
- 对账：账单/revision、Run 权威列表、详情、差异、处置、FactConfirmation、完成和 evidence。
- 结算：权威列表、prepare、构成/金额、confirm、execute/results、void/replacement 和 review。
- 人工核对：权威列表、详情、blocking scopes、证据和责任处置。
- Reference Lab：fixture/policy/clock/actor/executor/result 场景的结构化控制；明确标注仅用于 reference 学习环境。
- 实现对照：统一业务语义、WOW/CAP4K 传输/框架实现差异和生产强化非目标；不再展示已解决的业务缺口。

所有页面提供加载、空、错误、accepted/observing/final 反馈。详情页可展开 transport diagnostics 和原始证据用于学习，但默认视图先展示统一业务语义。

## 7. 配置、扩展与文档

后端选择和地址通过环境变量或集中配置完成，开发模式提供明确的 WOW/CAP4K scripts 与同源代理。页面代码不读取这些变量；只有 adapter factory 和 transport 配置读取。

第三适配器步骤：实现统一 adapter/service contract；增加 DTO mapping、status/finality/error/receipt/page tests；注册 adapter key 与开发代理；运行共享契约测试和真实后端代表性闭环。若出现统一契约之外的新业务语义，应先修改业务 Spec，而不是在新 adapter 中偷偷扩展页面模型。

README 必须给出项目结构、运行要求、安装/启动、后端地址、切换方式、统一契约、适配器职责、支持流程、两端差异、验证方式、第三适配器步骤和已知生产强化边界。

## 8. 验证与交付边界

自动化验证覆盖统一模型、Money、状态/finality、receipt/operation/readAfter、ApiError、cursor、动作、两个 adapters 和页面业务逻辑。真实联调分别使用运行中的 WOW 与 CAP4K，从前端边界执行代表性支付到结算闭环并保存可复现证据；mock 只用于快速单测，不能证明真实接入。

工作台验收不重跑或冒用后端的 67 个 PAY-AC 作为前端证据，但代表性闭环必须实际穿过后端 HTTP surface。双后端比较忽略随机 ID 与框架收敛差异，只比较规范化业务观察。

## 9. 明确非目标

本 capability 不交付登录、JWT/OIDC、真实 RBAC/双人授权、生产租户隔离、生产数据库部署/迁移/重启恢复、持久化 Outbox/Inbox、跨进程 exactly-once、多实例锁、生产 gateway/CORS/CSRF/限流/TLS、Secret Manager、真实证书/渠道/账单下载/资金移动、生产通知/SLA/长期审计/脱敏或旧后端 API compatibility facade。

这些非目标不得用于省略 merchantId、actor responsibility、幂等、可信收件、重复/冲突/迟到/UNKNOWN、退款预算、对账阻断、结算冻结/防重付、通知稳定身份、五类权威列表或完整 payment timeline。
