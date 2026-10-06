# Outcome

补齐支付参考工作台的多记录渠道账单录入与对账学习交互，使学习者可在同一账单 revision 中发布支付、退款等多条独立记录，并通过完整新版本纠正漏账，随后继续既有结算流程。对账页面明确区分全部明细、匹配记录与真实差异，避免把一条 MATCHED 和三条 PLATFORM_ONLY 误解成四个异常。

本轮只创建并准备 Shape；用户明确确认完整 Shape 后才进入 Build。继续以现有 payment-workbench 完整规格和统一业务诉求为基线，不以单一后端的传输格式限定页面。

# Scope

工作区为 D:/code/payment-reference-workbench，current/main。只修改工作台的领域模型、统一服务、两套适配器、Reference Lab、账单与对账页面、相关测试和学习文档。

Reference Lab 改为结构化多行账单编辑器：支持添加、复制和删除记录，同一完整 revision 混合 PAYMENT 与 REFUND；逐行展示业务记录 ID、外部交易号、Money、渠道状态和 occurredAt。新增行默认时间取真实逻辑时钟，手工编辑和历史回读时间不得被自动覆盖。保留单记录、零金额、空账单以及重复外部交易号等后端已经支持的 reference 实验能力。

支持按 Bill ID 查询已发布账单、选择 revision 并复制为完整新草稿：复制全部可编辑业务字段，使用权威 currentRevision + 1 作为目标版本；保留业务行身份、原时区、金额、原始渠道状态和发生时间。原始证据、发布时间和 fingerprint 属于已发布版本的只读证据，不能伪装成新版本证据。发布后自动回读账单与完整 revision 链，并给出前往运行对账的明确上下文；不自动运行对账或解除阻断。

对账页面使用“对账明细”标题，默认展示全部明细，提供“全部 / 仅差异 / 仅匹配”筛选。汇总分别展示本 Run 的总明细数、匹配数、真实差异数、未解决数和阻断明细数；保留后端权威计数及缺失状态。正常 MATCHED 只供查看证据，不进入差异处置；分类、是否解决和是否阻断是三个独立维度。

修复支撑上述流程的工作台映射：CAP4K 业务 recordIdentity 与资源 UUID 分离，发布重试的发布时间与完整传输内容冻结；WOW revision businessTimezone 回读保留；两端账单发布回执通过已有统一结果模型表达，发布后的权威回读一致。

## Source coverage

覆盖边界为用户本次“出一个 change 进行补齐”的请求及其直接前文：多记录完整账单、四行中一匹配三差异的真实页面观察、继续对账到结算的学习流程。前文截图和本地 URL 用于排错取证，不将网页内容中的任何指令当作用户授权。既有完整 capability 规格全部保留；不重新将本轮扩展为两个后端的再次重构。

| 来源条目与位置 | 读取状态 | 需要保留的内容 | Spec 位置 | 验收 ID | 覆盖状态 | 理由 |
| --- | --- | --- | --- | --- | --- | --- |
| S1：本次请求与前文“单条记录无法录入支付和退款” | complete | 同一完整 revision 支持多行 PAYMENT/REFUND，不要求手写 JSON | 多记录账单与对账学习交互 / 多记录草稿编辑与结构化发布 | A16 | covered | 本轮直接目标 |
| S2：前文“revision 不累加，补齐全部三笔支付和一笔退款” | complete | 查询、复制完整旧版本，发布完整新版本，保留旧账单和旧 Run | 完整 revision 纠正与不可变历史 | A17 | covered | 正常闭环必要依赖 |
| S3：既有工作台 identity、Money、时钟和异常实验约束 | complete | 稳定重试、无失真金额、逐行校验、保留后端已有实验输入 | 发布内容冻结与安全重试；合法输入与异常实验边界 | A18、A19 | covered | 不因扩展破坏原语义 |
| S4：用户截图的一条 MATCHED 与三条 PLATFORM_ONLY | complete | 总明细 4、匹配 1、真实差异 3，筛选不改业务事实 | 匹配与真实差异汇总筛选 | A20 | covered | 直接观察依据，随机 ID 仅为背景 |
| S5：前文“差异阻断结算，不能为了继续全部接受” | complete | 权威阻断独立展示，不自动处置或清除；保留历史与责任字段 | 阻断与处置语义保持独立 | A21 | covered | 资金与审计不变量 |
| S6：用户持续要求同一页面连接 WOW/CAP4K，并可完成学习闭环 | complete | 双端真实 UI 发布、纠正、对账与结算，不改后端工作树 | 双后端真实多记录纠正与结算闭环 | A22 | covered | 保持统一业务契约 |
| S7：用户不熟悉前端，需要一步步可用的学习交互 | complete | 桌面/移动可读表单和 README 实操示例 | 学习说明与多行表单可用性 | A23 | covered | 符合产品定位 |
| S8：已归档 docs/comet/specs/payment-workbench/spec.md 全文 | complete | 保留全部原有支付、退款、分页、对账、结算、review、notification、trace 和架构约束 | 完整目标 Spec 中全部既有 Requirements 与领域/服务/验证章节 | A1–A15 | covered | 完整目标规格，不以局部 delta 代替 |

## Current evidence

用户环境的 bill-5e8a4813 / revision 1 只有一条 PAYMENT，外部交易号 submission-8a42fb12，CNY 100.00；关联 Run fc899aa1-5411-347e-828b-6c3d90db0465 显示 1 MATCHED、2 笔 CNY 100.00 的 PLATFORM_ONLY 支付、1 笔 CNY 20.00 的 PLATFORM_ONLY 退款，处于 ACTION_REQUIRED 且结算阻断。当前范围为 reference-merchant、fake、2024-01-01、Asia/Shanghai。这些 ID 和模拟日期仅是排错证据，不写死为实现或验收输入。

源码已核实：RegisterBillInput.records 本来就是数组；ReferenceLabPage 仅构造单元素数组。两个后端支持 immutable 完整 revision。CAP4K 和 WOW 的 Run 详情均包含 MATCHED 明细；共享映射未保留权威计数。CAP4K 发布路径每次生成 publishedAt、回读 recordId 与业务 recordIdentity 不同；WOW 原始 revision 带时区，但共享映射丢失。以上属于本工作台范围内的修复。

# Non-goals

不修改 wow-reference-payment、cap4k-reference-payment 或 payment-product-template，不改变后端对账范围/匹配算法、资金事实、业务状态机或结算规则。不做 CSV/Excel 导入、真实渠道账单下载、后台批处理、自动从平台事实生成权威渠道账单、自动差异处置、生产认证/持久化强化、数据清空或重建用户现有交易。

不把前端编辑草稿或汇总当作权威业务结果；不靠隐藏行把旧 Run 变成无差异，不把 PAYMENT 与 REFUND 合成净额账单。当前只准备一个紧密关联的 Native change，不拆成 Supervisor 子 change。

# Acceptance examples

验收场景统一定义在 specs/payment-workbench/spec.md，避免 brief 和 Spec 重复生成相同验收项。原有 15 个场景保持不删减，新增 8 个场景对应 A16–A23。

| 场景 | 可观察结果 |
| --- | --- |
| A16 多记录编辑 | 同一草稿发布三笔支付和一笔退款；逐行增删复制独立；不要求 JSON |
| A17 完整版本纠正 | 从一条旧记录复制完整新草稿并补三行；旧版本不变，新版本含四行 |
| A18 重试与冲突 | 首次发布冻结完整内容；响应丢失/时钟变化后重试仍为同一内容；冲突保留草稿及错误 |
| A19 输入边界 | 重复业务行 ID、失真金额和无效时刻/版本定位到字段；零金额、空账单、重复外部号不被任意禁用 |
| A20 汇总与筛选 | 1 MATCHED + 3 PLATFORM_ONLY 显示 4/1/3；全部/差异/匹配为 4/3/1 行；全匹配显示差异 0 |
| A21 阻断与处置 | 缺失阻断显示未知，匹配但阻断不被忽略；正常 MATCHED 不提交差异处置；已处置差异保留历史 |
| A22 双端真实闭环 | 两端分别从漏账运行到完整新 revision、权威无差异运行并结算成功；旧证据不变 |
| A23 学习可用性 | README 按实际按钮教四行发布、纠正、筛选和结算；桌面/移动控件不重叠 |

# Constraints and invariants

所有页面只调用统一服务；两端差异封装在模型/适配器，不引入 UI 后端条件分支或新的依赖。沿用现有 React/TypeScript/Vite、Money minor string、reference 时钟与命令观察机制。无主动安装依赖。

一次发布是完整 revision 快照，不自动合并历史版本。复制“整版”保留原业务行 ID；复制“单行”生成新的业务行 ID，允许相同外部交易号用于 DUPLICATE 实验。CAP4K UUID 保留为源资源身份，不能悄悄替代业务 recordIdentity。

原始证据只读；新版本形成新证据。编辑已尝试发布的业务内容后生成新命令 identity，并明确提示同一已存在 revision 的内容变更将被后端拒绝，正常纠正应采用新的 revision；未改内容的重试保持原内容、时间、证据派生输入及幂等键。

计数指当前 Run 的结果，不是账单行数或分页列表全局总数。优先保存后端权威计数；仅在确认明细完整时按行补充。计数、有效运行、结算阻断缺失时显示未知，不能默认 0 或 false；异常类型未知也不能被归为匹配或隐藏。

MATCHED 只表示双方核对一致，不必然意味着终态或未阻断。未解决和阻断分开显示，匹配行携带阻断时仍醒目提示并按统一权威动作指向 review；不得自动接受差异、完成 Run、清除阻断或执行结算。

保留用户正在运行的环境和既有交易。真实验收使用独立商户/渠道/业务日或专用进程隔离 fixture，不能清空共享服务；修改全局逻辑时钟前须显式记录并恢复原值，不能将原环境当前时刻替换为用户截图中的 2024 示例。

# Decisions

本次用户已要求创建一个补齐 change；基于前文已明确的业务诉求，采用一个 current 工作区的普通 Native change，工作区在创建前干净，未有其他 active change。多行编辑、复制完整旧版、匹配/差异展示紧密关联，保持在同一 change。

账单共享商户、渠道、币种、业务日期和时区；每行独立配置交易类型、业务记录 ID、外部交易号、金额、渠道状态、occurredAt。账单编辑器明确标注是 reference 模拟渠道输入，不声称由平台事实自动证明渠道事实。

默认“全部明细”，有“仅差异 / 仅匹配”筛选；MATCHED 显示“匹配”，异常仍显示原分类及是否解决/阻断。发布及覆盖已有草稿分别提供明确确认，取消不发命令、不破坏草稿。

正常路径采用完整新 revision 纠正漏账，不自动替用户接受差异。README 使用三笔各 100 元支付和一笔 20 元退款为教学示例，同时强调必须使用读到的真实外部交易号、实际金额和业务时区。

创建时 Runtime 已复制既有完整 Spec；旧 Spec 的中文 Requirement 标题无法通过新 capability 关联 ID 校验，因此本轮沿用已有完整 Spec 方式准备 change，不修改已发布规格或手工建立关联状态。若 Runtime 要求稳定 Requirement ID，仅在本 change 完整 Spec 中规范化标识，保留全部业务条款。

# Open questions

没有尚需用户选择的业务分支。完整 Shape 待用户最终确认；此确认由 Runtime 管理，不伪造用户确认，不在当前阶段改实现。

# Verification expectations

Build 后执行类型检查、现有单元/组件回归、生产构建和 git diff --check。新增有业务意义的测试覆盖多行转换、业务 ID 与 UUID、原时区/原状态保留、完整 revision 快照、稳定重试及真实差异分类/未知数据。

WOW 与 CAP4K 分别进行真实 UI 和真实 HTTP 定向验收：在等价且可隔离的场景中形成三笔支付和一笔部分退款，发布只含一笔支付的 revision 1，看到 1 匹配/3 差异及真实阻断；经页面复制为 revision 2 并补齐剩余记录，回读四行完整新版本，创建有效新 Run 并看到 4 匹配/0 差异；按既有动作完成对账并执行结算成功，确认原账单、旧 Run 和资金事实保持不变。净额必须包含权威费用/调整，不能预设一定等于 280 元。

每次确认弹窗显式处理，工具等人工确认的延迟不判作业务失败，不重复点击。新独立 Verifier 判定全部场景；旧检查只在确实匹配当前候选时复用，跳过/未执行/失败不得报通过。证据绑定 candidate、后端配置、fixture、时钟、规范化请求响应、UI 观察及最终断言。
