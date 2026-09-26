# 目标

将现有支付参考工作台升级为两个已完成统一业务契约对齐的参考后端的正式学习与验证入口。同一套页面、组件和前端业务逻辑通过统一领域模型与服务连接 `wow-reference-payment` 或 `cap4k-reference-payment`；切换配置时不修改页面代码。

工作台以 `payment-product-template` 的统一学习版业务诉求为唯一业务基线，完整呈现支付、退款、权威列表、账单与对账、结算、人工核对、通知和 payment timeline。两个后端的路径、方法、字段、header、回执形态、回调证据和收敛方式差异仅存在于适配器与 HTTP 层，不再被描述为业务能力缺口。

# 范围

- 重建前端统一契约：`Money`、`Finality`、资源引用、证据引用、`OperationReceipt`、`Operation`、`ReadAfter`、`ApiError`、opaque cursor `Page<T>`，以及支付、退款、账单、对账运行、结算、人工核对、通知和 timeline 模型。
- 重建统一服务边界和动作模型；页面、hooks、表单和展示组件只能依赖统一服务与统一资源状态，不能读取后端类型或拼接后端路由。
- 完整适配 WOW 与 CAP4K 当前已归档的统一业务契约，包括不同 HTTP method/path、receipt 资源引用形态、责任人上下文、callback evidence、timeline 路径、分页请求和结算作废/替代组合方式。
- 提供支付意图创建、attempt 创建与提交、可信渠道结果、到期/异常收敛、详情、receipts、通知和 operation 观察。
- 提供退款申请、预算查看、attempt 创建与提交、可信结果、失败/未知/冲突收敛及人工核对。
- 提供 Payment、Refund、ReconciliationRun、Settlement、ManualReviewItem 五类权威列表的筛选和 opaque keyset cursor 翻页。
- 提供权威账单与 revision、bill available、Run/rerun、差异处置、FactConfirmation 和显式完成流程。
- 提供结算准备、构成查看、确认冻结、执行、SUCCESS/FAILURE/UNKNOWN、作废、替代及防重复付款流程。
- 提供人工核对列表/详情/处置、通知投递历史与重试、payment timeline 和 reference fixture/policy/逻辑时钟/异常结果实验入口。
- 将常用业务动作从自由编辑 JSON 改为有字段语义、校验、确认级别和结果反馈的业务表单；原始诊断可以展开查看，但不是主要操作方式。
- 更新 README、后端实现差异说明、运行配置和第三适配器接入说明；旧“后端尚无列表、流程未对齐”的文档结论全部替换为已完成业务对齐后的现状。
- 分别连接真实 WOW 与 CAP4K 服务完成进程外联调和核心闭环验收，并验证相同场景的规范化观察一致。

## Source coverage

覆盖边界：用户最初指定的前端交付要求及本轮“完成第三步”的补充；`payment-product-template` 的 7 份统一业务真源；WOW 与 CAP4K 已归档的统一契约规格、真实 HTTP 验收结论和当前公开 surface；旧工作台已发布 Spec、README、对齐文档和现有实现。后端框架内部实现只用于确认传输入口，不改变统一前端业务语义。

| 来源条目与位置 | 读取状态 | 需要保留的内容 | Spec 位置 | 验收 ID | 覆盖状态 | 理由或替代关系 |
|---|---|---|---|---|---|---|
| S1 用户原始要求“核心目标/接口适配层” | complete | 统一领域/请求/响应/服务契约；两个适配器；配置切换；页面无后端分支；第三适配器可扩展 | REQ-WB-001、002、012 | A1、A2、A12 | covered | 当前有效需求 |
| S2 用户原始要求“业务交互” | complete | 创建、发起、状态、结果、退款/撤销、订单/交易/记录查看和错误反馈 | REQ-WB-003、004、006-011 | A3、A4、A6-A11 | covered | 当前有效需求 |
| S3 用户原始要求“架构与实现原则/交付要求” | complete | 职责分离、最小依赖、加载/空/错误状态、README、运行切换和验证 | REQ-WB-001、010-014 | A1、A10-A14 | covered | 当前有效需求 |
| S4 用户澄清“业务诉求为准，不取后端旧能力交集” | complete | 统一契约不因旧差异缩减；工作台可兼容传输差异 | REQ-WB-001、015 | A1、A15 | covered | 替代旧“按共同能力降级”的假设 |
| S5 用户澄清“一次迭代完成；认证授权、持久化可靠性后续强化” | complete | 本轮完成全部学习版业务；生产安全和可靠性设施是非目标，不能删减领域语义 | 全部 Requirements；非目标 | A1-A15 | covered | 当前范围决定 |
| S6 用户本轮提供的 WOW/CAP4K 归档验收结论 | complete | 两端业务契约已经对齐，工作台应直接接入，不再保留旧缺口结论 | REQ-WB-001、013-015 | A1、A13-A15 | covered | 当前后端能力基线 |
| S7 `docs/business/overview.md` | complete | 支付、退款、对账、结算、通知和参与者边界 | REQ-WB-003、004、006-009 | A3、A4、A6-A9 | covered | 统一业务范围真源 |
| S8 `docs/business/reference-learning-profile.md` | complete | 学习版 profile、fixture、policy、逻辑时钟、确定性与生产非目标 | REQ-WB-009、013-015 | A9、A13-A15 | covered | reference 运行边界真源 |
| S9 `docs/business/reference-backend-contract.md` | complete | Money、finality、operation、readAfter、错误、五类列表、命令/查询 catalog | REQ-WB-002-009 | A2-A9 | covered | 前端统一契约真源 |
| S10 `docs/business/glossary.md` | complete | 资源名称、稳定身份、状态、证据、责任事实和业务术语 | REQ-WB-002-009 | A2-A9 | covered | 统一语言真源 |
| S11 `docs/business/lifecycle.md` | complete | 支付/退款/对账/结算生命周期与收敛顺序 | REQ-WB-003、004、006-009 | A3、A4、A6-A9 | covered | 业务流程真源 |
| S12 `docs/business/rules.md` PAY-BR-001..079 | complete | 幂等、金额、可信结果、预算、对账阻断、结算冻结/防重付、责任字段、通知和 trace 不变量 | REQ-WB-002-009 | A2-A9 | covered | 62 条规则全部进入统一服务和页面可观察结果 |
| S13 `docs/acceptance/scenarios.md` PAY-AC-001..017 | complete | 支付创建、attempt、可信结果、重复/冲突/迟到、到期和费用快照 | REQ-WB-003、009 | A3、A9 | covered | 工作台提供操作入口与可核对事实 |
| S14 同上 PAY-AC-020..029 | complete | 退款申请、attempt、预算、重复、失败、UNKNOWN、冲突与迟到 | REQ-WB-004、009 | A4、A9 | covered | 当前有效需求 |
| S15 同上 PAY-AC-040..047 | complete | 权威账单、Run、差异、重跑、处置、FactConfirmation 与证据保留 | REQ-WB-006 | A6 | covered | 当前有效需求 |
| S16 同上 PAY-AC-060..068 | complete | 结算准备、构成、冻结、三结果、负净额、作废和替代 | REQ-WB-007 | A7 | covered | 当前有效需求 |
| S17 同上 PAY-AC-080..088 | complete | merchant 范围、通知、责任字段、时区、完整 timeline 和当前运行期可靠性 | REQ-WB-008、009 | A8、A9 | covered | 当前有效需求 |
| S18 同上 PAY-AC-090..103 | complete | 受理边界、Operation 观察、五类分页、reference 可重复闭环及双后端规范化一致 | REQ-WB-002、005、009、013-015 | A2、A5、A9、A13-A15 | covered | 当前有效需求 |
| S19 WOW `docs/comet/specs/payment-reference-alignment/spec.md` | complete | WOW 当前完整业务 surface、POLL/Projection 收敛和真实 HTTP 能力 | REQ-WB-013、015；适配器约束 | A13、A15 | covered | WOW 实现与传输证据，不取代模板真源 |
| S20 CAP4K `docs/comet/specs/payment-reference-build/spec.md` | complete | CAP4K 当前完整业务 surface、READ_ONCE、actor registry 和 callback evidence | REQ-WB-014、015；适配器约束 | A14、A15 | covered | CAP4K 实现与传输证据，不取代模板真源 |
| S21 两后端归档验收报告与真实 HTTP evidence | complete | WOW 67/67、CAP4K 67/67 证明后端业务已对齐，可作为前端真实联调前提 | REQ-WB-013-015 | A13-A15 | background | 后端通过不自动证明前端通过，前端仍独立验收 |
| S22 旧工作台 Spec“两个后端无权威列表/分页” | complete | 旧结论不再保留 | — | — | superseded | 两端现均有五类权威列表，由 REQ-WB-005 替代 |
| S23 旧工作台 Spec“WOW 创建即 attempt、退款创建注入 fake result” | complete | 旧流程不再保留 | — | — | superseded | 两端现均为创建、attempt、提交、结果分离，由 REQ-WB-003/004 替代 |
| S24 旧工作台 Spec“CAP4K 无完整 timeline、两端存在业务能力清单缺口” | complete | 旧能力降级页不再保留 | — | — | superseded | 两端业务能力已对齐；只保留实现/传输差异，由 REQ-WB-008/015 替代 |
| S25 旧工作台 README、`docs/backend-alignment.md` 与现有源码 | complete | 可复用技术栈和通用组件；旧契约、适配器映射、自由 JSON 操作和文档结论需更新 | REQ-WB-001-012 | A1-A12 | background | 实现基线，不是业务真源 |

# 非目标

- 本 change 不修改 `wow-reference-payment`、`cap4k-reference-payment` 或 `payment-product-template`；若真实接入发现后端回归，只记录可复现证据，不在前端仓库掩盖。
- 不交付登录、JWT/OIDC、生产 RBAC/双人授权、生产租户隔离、生产网关/CORS/CSRF/限流/TLS 或 Secret Manager。
- 不交付生产数据库部署、重启恢复、历史迁移、持久化 Outbox/Inbox、跨进程 exactly-once 或多实例调度锁。
- 不接入真实支付渠道、真实账单下载、真实资金移动、生产通知、生产 SLA、长期审计或脱敏设施。
- 不新增跨币种、分账、订阅、预授权、拒付/争议或税务业务。
- 不把前端 reference fixture/模拟结果描述为生产能力，也不在前端重做后端领域裁决。
- 不要求两个后端采用相同框架、路由、HTTP 方法、事务模型或 readAfter 模式；只要求规范化业务观察一致。

# 验收示例

唯一验收清单定义在完整目标规格 `specs/payment-workbench/spec.md` 的 15 个 `Scenario:` 中，依次覆盖：配置切换与隔离、统一基础契约、支付、退款、五类权威列表、对账、结算、人工核对/通知/timeline、reference 实验、业务表单与响应式交互、错误与异步反馈、文档与第三适配器、真实 WOW、真实 CAP4K，以及双后端规范化一致性。来源覆盖表中的 A1-A15 与该顺序一一对应。

# 约束与不变量

- 业务含义以模板统一学习版契约为准；后端传输差异不得进入页面条件分支，也不得反向缩减统一模型。
- `Money.amountMinor` 始终为十进制整数字符串；禁止 JavaScript 二进制浮点参与领域金额计算。
- 每个权威资源同时保留统一 `status`、独立 `finality`、稳定 ID、关联引用和必要源诊断。
- `OperationReceipt` 只表示命令受理；页面必须按 `readAfter` 观察 `Operation` 和资源，不能把 HTTP 2xx、ACCEPTED 或 Operation SUCCEEDED 等同于资金业务成功。
- 同步拒绝只显示 `ApiError`；不得伪造 Operation、资源或成功状态。观察超时不改写业务状态。
- 收件、证据、原事实、责任字段和人工处置不可由前端删除或覆盖；迟到/冲突结果不得回退已确定事实。
- 五类列表必须使用后端权威 Page 和 opaque cursor；不得再以 localStorage 最近记录冒充列表。
- 人工动作必须收集 reason/evidence 等业务字段；actorId 的 WOW body 与 CAP4K trusted header 差异由适配器处理。
- callback 验真结论来自服务端可信边界；前端不得提交或展示可编辑的 `verified=true`。
- 常用业务流程使用结构化表单和明确确认，不要求用户手写 JSON；原始 payload 仅作为学习诊断只读展示或高级 reference 输入。
- 新增第三后端时，若统一业务语义未变，只新增适配器、配置和契约测试，不修改已有页面。
- 当前 change 使用单个 Native change；统一模型、两个适配器、页面和真实闭环需要共同演进，拆分会增加契约漂移和集成成本。

# 决策

- 两个后端已经完成统一业务契约对齐，因此工作台不再以 capability unavailable 兼容旧缺口；能力对照页改为“统一业务语义 + 两种实现/传输方式 + 生产强化边界”。
- 页面采用资源状态驱动的统一动作描述；适配器可选择不同传输序列完成同一动作，但页面不知道后端名称。
- 支付与退款均采用“创建资源 → 创建 attempt → 提交 attempt → 接收/注入可信结果 → 观察 Operation/资源”的统一业务流程。
- ReconciliationRun 是唯一对账执行主资源；不再向页面暴露旧 Batch 语义。
- 五类列表全部使用权威 keyset pagination，最近记录只可保留为非权威快捷入口，不承担列表职责。
- 人工核对、通知和 timeline 是核心学习流程，不作为可选附属能力。
- reference 实验入口用于构造成功、失败、UNKNOWN、重复、迟到、冲突、无效和未知引用等场景，但所有业务裁决仍由后端完成。
- 前端技术实现沿用现有轻量栈；技术细节由实现者决定，不要求用户参与选择。

# 待解决问题

- 无阻塞问题。认证授权、生产持久化可靠性和真实渠道设施明确属于后续强化，不影响本轮学习版完整闭环。

# 验证预期

- Runtime 正式检查至少执行 TypeScript 类型检查、单元/契约测试和 production build。
- 自动化测试覆盖 Money、状态/finality、Operation/readAfter、ApiError、opaque cursor、两个适配器的路径/方法/header/request/response 映射，以及页面不依赖后端类型。
- 组件/浏览器测试覆盖结构化表单、加载/空/错误/超时、危险动作确认、长 ID、桌面和移动视口。
- 分别启动真实 WOW 与 CAP4K 服务，经前端开发代理或生产等价 HTTP 边界完成支付到结算的代表性闭环；不以 mock、Controller 测试或后端既有 67/67 报告替代前端真实联调。
- 双后端使用等价 fixture/policy/clock 场景，比较规范化 Money、状态、finality、错误、关联、排序和副作用；允许 operation 收敛方式与内部随机 ID 不同。
- 验收不得修改、清理或提交两个后端现有工作树；需要启动服务时使用明确端口并保留可复现命令与结果。
