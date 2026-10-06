# Outcome

从 README 的业务流程抽取一份中文业务场景手册，使学习者能理解每个页签、核心表单和按钮，并按步骤完成支付到结算的闭环。文档采用类似测试用例的“前置条件—输入—操作—预期结果—完成判据”结构，不扩展为边界测试矩阵。

# Scope

- 新增 `docs/business-learning-scenarios.md`；README 保留业务概要，增加手册入口，将重复的长篇操作教程改为简要说明与链接。
- 覆盖实际八个导航页签：首页、支付、退款、对账、结算、人工核对、Reference Lab、实现对照。通知在人工核对页，Payment Timeline 在支付页。
- 提供页签地图、核心表单/按钮用途以及共用读图规则：用户需填写/核对的业务输入、自动生成/预填的数据、点击后自动处理的内容、需要下一次人工操作的节点。
- 按依赖排列十二个练习：环境与时钟准备、成功支付、部分退款、完整账单与匹配对账、漏账纠正、成功结算、差异处置与事实确认、UNKNOWN 与人工核对、通知查看与重试、Payment Timeline、可选到期关闭、可选作废与 replacement。
- 每个练习包含目的、前置条件、所在页签/表单、输入来源、顺序步骤、逐步预期结果、完成判据和下一步；按当前权威资源及能力决定可执行动作。
- 对 WOW/CAP4K 的不同操作效果，在影响学习步骤时提供简短说明；不要求学习者研究路由或 DTO。

## Source coverage

覆盖边界：README 的“支持的业务流程”（182–246 行）及其必要依赖（20–33 行总体流程和异步语义、35–39 行运行前提、248–266 行与学习操作有关的后端差异）。用户明确排除边界条件，所以重复/冲突/越界等故障组合不转为练习；保留正确操作必需的不可变账单、权威阻断、防重付等规则。页面和后端源码仅用于核对 README 的实际按钮与效果。

表中 Spec 均指 `specs/business-learning-scenarios/spec.md`。验收编号按其中十二个 `Scenario:` 的顺序建立，准备确认时核对 Runtime 生成的实际编号。

| 来源条目与位置 | 读取状态 | 需要保留的内容 | Spec 位置 | 验收 ID | 覆盖状态 | 理由或替代关系 |
| --- | --- | --- | --- | --- | --- | --- |
| U1：用户要求解释每个页签、核心按钮、表单、手填与自动处理 | complete | 能回答页面用途、输入责任和动作效果 | 页签与阅读方式 | A1 | covered | 当前目标 |
| U2：用户要求从 README 抽取全部流程，类似测试用例但不考虑边界条件 | complete | 独立场景手册、统一步骤与预期结果；不做边界矩阵 | 页签与阅读方式、全部练习 | A1–A12 | covered | 当前范围与明确排除 |
| U3：用户在账单可用、运行对账、匹配及显式完成上的疑问 | complete | 区分发布、通知、运行、匹配、完成、结算资格 | 完整账单与匹配对账 | A5 | covered | 已调查的学习困难 |
| S1：README:20–31 流程图 | complete | 环境→支付→可选退款→账单/对账→结算→核对/通知/时间线的依赖 | 全部练习 | A2–A12 | covered | 用于练习顺序 |
| S2：README:33 异步语义 | complete | 已受理、Operation、业务状态及 finality 分层；继续观察同一操作 | 页签与阅读方式 | A1 | covered | 每个练习的共享规则 |
| S3：README:35–39 运行前提 | complete | 已启动工作台及其所选后端 | Reference 环境 | A2 | covered | 不重复安装教程 |
| S4：README:186 支付创建 | complete | 商户、订单身份、金额、方式、幂等键 | 成功支付 | A3 | covered | 标注输入/默认值来源 |
| S5：README:187 attempt | complete | 独立创建再稳定提交 attempt | 成功支付 | A3 | covered | 创建不会自动提交 |
| S6：README:188 渠道结果 | complete | 服务端验证 SUCCESS/FAILURE/UNKNOWN | 成功支付、UNKNOWN 与人工核对 | A3、A9 | covered | 实际结果表单位于支付/退款页；Lab 配置脚本 |
| S7：README:189 支付结果观察 | complete | submission/result receipts、成功事实、费用、通知、timeline | 成功支付、通知、时间线 | A3、A10、A11 | covered | 权威完成证据 |
| S8：README:190 到期与可信边界 | complete | 可选到期关闭；不能自报 verified=true | Reference 环境、可选练习 | A2、A12 | covered | 保留正常分支及共享限制 |
| S9：README:190 重复/无效/未知引用/迟到/冲突组合 | complete | 不逐项构造异常实验 | — | — | non-goal | 用户排除边界条件 |
| S10：README:194 退款预算 | complete | original/succeeded/reserved/available | 部分退款 | A4 | covered | 解释预占与转换 |
| S11：README:195 退款申请 | complete | 全额/部分共用申请；示范部分退款，说明全额金额来源 | 部分退款 | A4 | covered | 不重复同一套表单步骤 |
| S12：README:196 退款 attempt/结果 | complete | 申请后独立创建、提交、接收可信结果 | 部分退款 | A4 | covered | 独立业务动作 |
| S13：README:197 失败/UNKNOWN 与预算 | complete | 失败释放、UNKNOWN 保留预占及关联核对 | 部分退款、UNKNOWN 与人工核对 | A4、A9 | covered | 用结果说明保留常见业务分支 |
| S14：README:197 重复/迟到/冲突组合 | complete | 不展开组合练习 | — | — | non-goal | 用户排除边界矩阵 |
| S15：README:199–201 五类权威列表 | complete | 筛选、详情、分页、条件变化回首屏；最近记录仅快捷入口 | 页签与阅读方式 | A1 | covered | 共用说明，不重复五套步骤 |
| S16：README:205 发布与信号 | complete | 不可变 revision、bill available/refresh | 完整账单与匹配对账 | A5 | covered | 区分账单发布与通知 |
| S17：README:206 运行与证据 | complete | 创建/重跑 Run、matching basis、双方证据 | 完整账单与匹配对账、漏账纠正 | A5、A6 | covered | 有效新 Run 与历史 Run 分开 |
| S18：README:207 差异动作 | complete | DifferenceDisposition/FactConfirmation、actor/reason/evidence、保留事实 | 差异处置与事实确认 | A8 | covered | 真实差异专用 |
| S19：README:208 阻断 | complete | 未决差异阻断；明确结论解除相应阻断 | 完整账单与匹配对账、差异处置 | A5、A8 | covered | 权威资格不由匹配数量推断 |
| S20：README:212 教学种子 | complete | 三笔100元与一笔20元退款只是示例，独立范围 | 漏账纠正 | A6 | covered | 使用实际数据，不绑定用户现有随机 ID |
| S21：README:214 交易号与行身份 | complete | 支付/退款分行；真实外部号与稳定行 ID 区分 | 完整账单与匹配对账、漏账纠正 | A5、A6 | covered | 不能把退款抵扣成支付行 |
| S22：README:215 金额、日期、时区 | complete | 元输入、精确最小单位、Reference 时钟与业务时区 | Reference 环境、完整账单与匹配对账 | A2、A5 | covered | 正常录入必需 |
| S23：README:216 完整发布确认 | complete | 核对 Bill ID/revision/行数后发布 | 完整账单与匹配对账 | A5 | covered | 实际按钮与确认步骤 |
| S24：README:217 权威回读与继续观察 | complete | 回读才确认可见；继续同一 Operation/账单回读 | 完整账单与匹配对账 | A5 | covered | 共用观察说明落实到发布 |
| S25：README:217 丢响应与发布重试实验 | complete | 不构造网络故障；保持同一请求身份的规则可作简短提醒 | — | — | non-goal | 不做故障注入练习 |
| S26：README:218 前往对账与商户确认 | complete | 导航/预填后核对上下文；缺权威商户时需显式确认 | 完整账单与匹配对账 | A5 | covered | 不隐式运行 |
| S27：README:219 旧 Run 与筛选 | complete | 隔离示例4/1/3、PLATFORM_ONLY、筛选只影响显示 | 漏账纠正 | A6 | covered | 不把所有历史记录都写成固定四笔 |
| S28：README:220 整版复制 | complete | 权威 currentRevision+1，原记录保留，历史只读 | 漏账纠正 | A6 | covered | 正常新版本纠正 |
| S29：README:221 添加/复制行与完整快照 | complete | 新行身份、外部号人工核对、四行齐全、版本不累加 | 漏账纠正 | A6 | covered | 旧版本/Run 不覆盖 |
| S30：README:222 零差异、完成与资格 | complete | 4/4/0 后仍查权威阻断；显式/自动完成 | 完整账单与匹配对账、漏账纠正 | A5、A6 | covered | 不能写成必须处置 MATCHED |
| S31：README:223 准备到成功结算 | complete | 同范围候选、纳入/排除、冻结、脚本、执行、真实净额 | 成功结算 | A7 | covered | 净额不固定280元 |
| S32：README:225 差异学习 | complete | 不一律接受差异；MATCHED 只查看；追加处置历史 | 差异处置与事实确认 | A8 | covered | 教学结论须有证据 |
| S33：README:227 编辑器时间与提示 | complete | 新行逻辑时钟、刷新不改历史/手填时间、显式同步确认 | Reference 环境、漏账纠正 | A2、A6 | covered | 表单行为说明 |
| S34：README:227 空账单/零金额/重复外部号与错误组合 | complete | 不逐项实验字段错误 | — | — | non-goal | 用户不要求边界用例 |
| S35：README:229 数值范围与两端越界限制 | complete | 不枚举 Int32/安全整数极值；正常练习使用页面接受的 revision | — | — | non-goal | 不新增数值边界测试 |
| S36：README:233 候选构成 | complete | merchant/currency/period、included/excluded、原因码 | 成功结算 | A7 | covered | 输入与自动计算分开 |
| S37：README:234 冻结 | complete | scope/items/Money/version 冻结 | 成功结算 | A7 | covered | 解释确认按钮 |
| S38：README:235 结算三类结果 | complete | SUCCESS/FAILURE/UNKNOWN 与防重付 | 成功结算、UNKNOWN 与人工核对 | A7、A9 | covered | 常见分支摘要，不重复付款 |
| S39：README:236 作废/replacement/负净额 | complete | 权威允许时可选作废/替代；负净额进入核对说明 | 可选练习、UNKNOWN 与人工核对 | A12、A9 | covered | 不穷举阻断组合 |
| S40：README:240 人工核对 | complete | 权威列表及 outcome/reason/evidence | UNKNOWN 与人工核对 | A9 | covered | 默认文本不能冒充真实证据 |
| S41：README:241 通知 | complete | content identity、历史、安全重试 | 通知 | A10 | covered | 重投递不是重付款 |
| S42：README:242 timeline | complete | 稳定顺序、发生时间/记录时间、全链路关联 | 时间线 | A11 | covered | 回查闭环 |
| S43：README:246 Lab 目的、环境、时钟、账单、维护 | complete | 学习环境、配置与业务消费分开、非生产能力 | Reference 环境、可选练习 | A2、A12 | covered | 核心表单全覆盖 |
| S44：README:246 四类脚本及诊断限制 | complete | 配置/读取/重置、不同定位方式与 unavailable | Reference 环境 | A2 | covered | 读诊断不可用不等于业务消费不存在 |
| S45：README:248–264 后端差异 | complete | 与完成、结果验证、责任、脚本、replacement 有关的可见效果 | 页签与阅读方式、对应练习 | A1、A2、A5、A9、A12 | covered | 路由/header/DTO仅背景；操作效果核对源码 |
| S46：README:266 backend-alignment 链接 | complete | 保留深入实现说明入口 | 页签与阅读方式 | A1 | covered | 手册不替代实现对照文档 |

# Non-goals

- 不修改业务页面、按钮、适配器、后端接口或资金规则；发现实现问题时单独说明。
- 不编写自动化测试、不展开金额/时间/版本极值、重放/冲突/迟到/网络故障矩阵。
- 不操作现有 `bill-bc0c625b`，不清空用户交易、重置共享环境或重建实验数据。
- 不增加生产支付、认证、真实渠道、部署或数据库说明。

# Acceptance examples

正式验收由目标 Spec 的十二个场景完整定义；本节不重复生成另一组验收项。结果应允许新学习者从手册识别页签、输入和按钮，按正确顺序完成主线，并知道何时需要真实人工判断。

# Constraints and invariants

- 自动生成/预填不等于自动发起；HTTP受理不等于 Operation 成功，更不等于业务成功。
- 账单每版是完整不可变快照；外部交易号、平台资源 ID、账单行 ID 不混用；业务日使用逻辑时钟与时区。
- “前往对账”只导航和预填。WOW 通知可用后需独立创建 Run；CAP4K 信号路径可能已创建/推进 Run，须先回读再决定下一动作。
- MATCHED 不处置；零差异仍核对完整性、阻断及结算资格。WOW 可在允许时显式完成；CAP4K 自动完成。不能把整个 Run 必须 COMPLETED 写成所有后端结算的硬前提。
- 结算净额由后端候选构成计算；UNKNOWN 保持原执行身份，明确失败且权威允许后才可新执行。
- 人工核对必须基于实际证据；预填的 actor/reason/evidence 示例需核对，处置追加且不覆盖事实。
- 核对代码只读；文档以当前按钮和权威回读为准，不靠固定 ID、电脑当前日期或固定费用推断。

# Decisions

- 采用一份独立中文 Markdown 手册和 README 入口，便于循序练习和维护。
- 用统一模板组织十二个场景；常见分支有独立练习或结果说明，异常组合只保留范围提示。
- 使用单个 Native Change：文档、README 入口和教学准确性属于同一个结果，不拆分为 Supervisor Change。
- 现有两端调查已完成；本轮只补核对实际八个导航页签，不重复操作用户的业务流程。
- 最终整体方案交给用户确认；未将最初请求或本次旧归档收尾视为新需求的 Shape 确认。

# Open questions

没有需要另行澄清的阻塞问题。目录与文档结构采用上述方案；Runtime 准备完整摘要后等待用户确认，确认前不编写正式场景手册。

# Verification expectations

- 独立只读核对全部十二项验收，检查 README 来源表、实际导航、核心表单/按钮、两端差异与文档对应关系。
- 静态检查 Markdown 链接/锚点、场景完整性、前置依赖、示例标识和表格可读性。
- 纯文档变更不重新执行资金实验；可复用当前已确认的源码/契约与先前真实验证证据核对行为，不把本次未运行的业务场景声称为新验收。
- 不安装依赖；运行 `git diff --check`，核实业务代码和两个后端工作树未发生变化。
