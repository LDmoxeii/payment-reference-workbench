---
generated_from_state_version: 24
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 4
- 验证器尝试次数: 1
- 完成时间: 2026-10-06T16:38:01.530Z
- 摘要: 已独立核对当前candidate 1121c582-c558-4f16-8f9d-847d0ec2c0a6全部A1-A12，恰好十二条且均passed，总体pass。启动receipt已由公开CLI成功登记；复用与当前candidate、workspace及verifier execution绑定的documentation-whitespace、handbook-static-validation两项Runtime passed记录（各exitCode 0、executionCount 1），没有重跑已有套件。当前verification.md不存在，未以旧报告替代本轮证据；完成独立核查后才核对Builder handoff，其A12修正声明与当前源码一致。只读核对Git显示workbench变更为README及新增文档/Comet工件，WOW和CAP4K工作树干净；本Verifier未修改候选、业务代码或用户业务数据，不执行accept-result或归档。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | specs/business-learning-scenarios/spec.md | 新学习者定位页签、输入与动作 - GIVEN 学习者已打开工作台，尚不了解页签或表单 - WHEN 阅读手册导航、共用规则与任意一个场景 - THEN 能找到全部八个页签、通知与 Timeline 的位置，以及每个核心表单/按钮对应的用途或场景 - AND 每个场景具有规定的结构，明确用户输入/核对、自动预填及点击后自动处理的责任 - AND 共用列表和异步说明不会把最近记录当权威列表、把受理当业务成功或把预填当自动执行 - AND README 和手册相互链接，场景链接/锚点有效，深入实现说明链接保留 | 当前README与中文手册相互链接，手册八页签地图、核心入口和十二个统一练习模板与src/ui/WorkbenchApp.tsx:20-29实际导航一致；通知在人工核对页，Timeline在支付页。共用规则区分受理、Operation、业务状态和finality，符合src/services/workbench-service.ts:46-114；列表筛选、清空、分页、详情与条件变化回首屏符合src/ui/AuthoritativeList.tsx:27-76，最近记录仅作快捷入口。绑定当前候选的handbook-static-validation已实际通过链接、锚点、模板及表格检查。 |
| A2 | passed | specs/business-learning-scenarios/spec.md | 准备环境并理解 Reference Lab - GIVEN 已运行工作台及选定的 WOW 或 CAP4K 后端 - WHEN 按环境练习查看配置、理解必要表单和脚本、准备本次业务日 - THEN 能识别需填写/确认的环境参数与自动回读数据，按逻辑时钟和时区选取日期 - AND 明确刷新不会改写手工或历史行时间，显式同步时间需要核对影响范围 - AND 四类脚本的配置、诊断、重置及消费步骤都有说明，WOW/CAP4K 不同定位方式和诊断能力准确 - AND 说明这是学习与确定性复现工具，可信结果由服务端裁决，不提供 verified=true 输入或生产能力承诺 | 练习01解释fixture/merchant/channel/actor/policy、逻辑时钟和业务时区，先读现状再按需要设置；四类脚本均说明定位、配置/读取/重置和业务消费动作。核对ReferenceLabPage.tsx:69-90、112-140、180-267及两端adapter，CAP4K登记副作用、缺少独立诊断读取和WOW维护替代能力均如实披露。BillRevisionEditor.tsx:177-212、257明确不以电脑时间替代、刷新不覆盖草稿时间且显式同步先确认；可信结果经服务端验证，没有verified=true输入或生产能力承诺。 |
| A3 | passed | specs/business-learning-scenarios/spec.md | 按四个独立动作完成支付 - GIVEN 已准备环境及一个本次独立订单 - WHEN 阅读成功支付练习并顺序定位创建、attempt 创建、attempt 提交和可信结果表单 - THEN 每步写明必要输入、默认值、按钮文字及权威预期结果 - AND 不声称创建支付自动创建/提交 attempt，或配置脚本已等于付款 - AND 成功完成以权威支付事实与业务状态判断；外部号来自实际成功详情 - AND FAILURE/UNKNOWN 的预算或核对含义按资源类型说明，不复制异常组合矩阵 | 练习02按创建支付、创建attempt、提交选定attempt、接收可信结果四步分别列输入来源与权威预期，符合PaymentsPage.tsx:128-132、195-202的独立命令。渠道及外部号从权威attempt回读预填（85-95），成功事实、费用快照、预算及后续通知/Timeline入口可见（191-206）；配置Lab脚本不被描述为付款，FAILURE/UNKNOWN后续限制以实际资源状态说明。 |
| A4 | passed | specs/business-learning-scenarios/spec.md | 申请退款并读懂预算变化 - GIVEN 一笔有可用退款额度的成功支付 - WHEN 阅读部分退款练习及全额退款说明 - THEN 能定位预算、申请、attempt 和结果表单，区分用户金额/原因与自动生成或预填身份 - AND 每步说明预占、成功转换、失败释放、UNKNOWN 保留的权威结果 - AND 以本次 Refund 的渠道退款号和状态作为后续账单输入，不从支付号推造退款号 | 练习03以已成功支付和实际available预算为前提，部分退款与全额退款金额选择说明完整；申请、attempt创建/提交及可信结果分别操作，与RefundsPage.tsx:124-127、151-172一致。成功转换预占、明确整体失败释放、UNKNOWN继续占用准确；CAP4K RefundBehavior.kt:214-245及WOW Refund.kt:164-181区分终态失败与可重试attempt失败。退款外部号取本次Refund/Attempt，不从支付交易号推造。 |
| A5 | passed | specs/business-learning-scenarios/spec.md | 发布完整账单并读懂对账完成 - GIVEN 已有真实支付/退款成功事实及其外部号 - WHEN 阅读账单发布与匹配对账练习 - THEN 发布、可见、导航、通知、运行、匹配、完成及结算资格被区分，逐步预期结果明确 - AND 记录输入来自实际事实，发布核对 Bill ID/revision/行数，暂未读出时继续同一观察或回读 - AND WOW/CAP4K 的信号及完成动作说明与当前实现一致，不隐式重复创建 Run - AND MATCHED 只查看证据，零差异仍检查完整性、未解决/阻断明细及权威结算资格 | 练习04区分完整账单编辑、发布确认、权威可见、导航预填、信号、Run、MATCHED、完成及结算资格。BillRevisionEditor.tsx:112-165、186、215-227验证Bill/revision与完整记录内容、确认行数、继续观察/回读并只导航。WOW ReconciliationApplicationService.kt:107-137的billAvailable只验证/回读且独立run在139行开始；CAP4K adapter.ts:715-730信号后推进Run、649-656完成为替代说明，与手册分支一致。MATCHED只读、零差异仍查阻断和候选资格，未设置整个Run必须COMPLETED的通用结算前提。 |
| A6 | passed | specs/business-learning-scenarios/spec.md | 用完整新版本纠正漏账 - GIVEN 教学范围存在三笔成功支付和一笔成功退款，旧版只含一笔支付 - WHEN 阅读查询、复制整版、补齐行、完整发布及重新对账步骤 - THEN 能理解旧4/1/3与新4/4/0的来源，并根据实际范围核对权威计数 - AND 每个新 revision 包含全部交易，退款独立一行；添加/复制行生成身份但不会替用户选择另一笔真实交易号 - AND 历史只读，版本号取 currentRevision+1，原版及旧 Run 不被覆盖 - AND 回读有效新 Run 后检查资格，再接入结算练习 | 练习05把三笔支付加一笔退款的4/1/3及完整新版本4/4/0限定于隔离教学范围，并要求替换为实际金额、外部号、时间与独立ID。src/ui/bill-draft.ts:64-81从权威currentRevision+1复制完整历史版本并保留业务字段；32-37添加/复制行只生成新行身份，不选择真实交易号。BillRevisionEditor.tsx:249-285历史只读、完整版本复制和退款独立行与步骤一致；新账单和有效新Run回读后仍检查资格，旧版和旧Run不被覆盖或累加。 |
| A7 | passed | specs/business-learning-scenarios/spec.md | 从候选到冻结再到成功结算 - GIVEN 本次交易范围的权威候选允许相应结算动作 - WHEN 阅读准备、检查构成、确认冻结、脚本配置和执行步骤 - THEN 每步指出输入、自动候选/计算、按钮及权威结果，冻结与执行分开 - AND 完成以实际构成、净额及唯一成功 execution/业务事实为准 - AND SUCCESS/FAILURE/UNKNOWN 的后续限制准确，未知结果不能触发新的付款身份 | 练习06分开准备候选、核对included/excluded及原因码、确认冻结、executor定位、执行和权威结果；与SettlementsPage.tsx当前表单及动作一致。实际收入、退款、费用、调整和净额来自冻结构成，WOW SettlementApplicationService.kt:617-815按逐笔证据计算候选而非要求所有Run先完成。CAP4K MerchantSettlementBehavior.kt:72-101、198-345保留UNKNOWN执行身份并防止新付款、一次成功形成唯一事实；手册未写死280或278.20，明确失败也仅在权威允许后新执行。 |
| A8 | passed | specs/business-learning-scenarios/spec.md | 对真实差异作责任处置 - GIVEN Run 中存在需要判断的真实差异，且权威动作允许处置或事实确认 - WHEN 阅读差异练习并核对双方证据、责任字段与结论 - THEN 能区分 DifferenceDisposition 与 FactConfirmation，并找到各自输入和适用动作 - AND 默认 reason/evidence 只作输入示例，要求使用实际检查后的依据 - AND 预期结果为追加处置历史和权威阻断变化，原始账单与平台事实保留 | 练习07针对真实有效差异，解释双方证据、matching basis、DifferenceDisposition和FactConfirmation，给出有证据支持的ESCALATE/BLOCK路径并要求替换默认责任/原因/证据。ReconciliationPage.tsx:239-256禁止处置MATCHED并展示追加历史；提交确认实际仅传conclusion，WOW adapter.ts:387-395转发，手册313行明确披露WOW完整确认事实输入缺失、不承诺当前表单可完成。CAP4K依据权威差异构造确认内容，与其适用说明一致；原平台和账单事实保留，阻断由后端裁决。 |
| A9 | passed | specs/business-learning-scenarios/spec.md | 处理未知结果而不重复资金动作 - GIVEN 支付、退款或结算资源关联一个权威人工核对项 - WHEN 阅读 UNKNOWN 练习并沿稳定关联 ID 打开核对详情 - THEN 能找到 outcome、责任、原因、证据及必要补救引用的来源和操作 - AND 区分退款仍占额度、结算仍保留 execution 身份等结果，不以重复尝试替代核对 - AND 处置后查看权威业务状态、解除的具体阻断及追加历史，不承诺人工按钮必然把业务变为成功 | 练习08沿真实资源/Review ID查询、读evidence和blocking scopes，再根据当前类型填写允许outcome、责任、原因、证据及必要补救引用，符合ReviewsPage.tsx:89-123、140-143。WOW Refund.kt:177-191有UNKNOWN或阈值复核路径，CAP4K RefundBehavior.kt:241-268保留预算并按实际reviewAfterAt进入复核，304-358的责任收敛只对占用中的UNKNOWN/REVIEW_REQUIRED生效。手册338行披露CAP4K Lab维护不触发退款复核、WOW维护仅替代说明；人工解决不被承诺为必然业务成功，结算UNKNOWN不重付。 |
| A10 | passed | specs/business-learning-scenarios/spec.md | 查看通知并重试原投递 - GIVEN 已有权威通知及可查看的投递历史 - WHEN 阅读通知查询、sender 配置和重试练习 - THEN 每步说明输入来源、自动回读及对应按钮，失败/未知投递不等于业务失败 - AND 明确重试仅重新投递同一业务内容，不重复支付、退款或结算 - AND 按权威详情观察新增投递历史，不把列表摘要当完整证据 | 练习09从本次成功事实关联或权威通知列表定位notification，核对content identity、来源和详情attempt历史，随后按需要配置sender并重试原通知。ReferenceLabPage.tsx:238-250提供sender定位与配置/读取/重置；ReviewsPage.tsx:107-123只发RETRY_NOTIFICATION，WOW adapter.ts:452-458使用原notificationId重投递。手册区分业务成功和投递失败/未知，只在实际新投递发生后认定新增历史，没有重复支付、退款或结算的步骤。 |
| A11 | passed | specs/business-learning-scenarios/spec.md | 从支付时间线回查闭环 - GIVEN 一笔经历相关业务动作的支付 - WHEN 阅读支付页“读取 Timeline”练习 - THEN 能找到入口并理解自动分页、排序、两种时间与关联 ID - AND 根据本次实际发生的事件回查各权威资源，不宣称每笔支付必然已有全部流程事件 | 练习10入口为支付页本次Payment ID的读取Timeline，符合PaymentsPage.tsx:204；19-35沿nextCursor自动读取完整分页，206展示occurredAt、recordedAt、关联资源、责任与证据及服务端稳定顺序。手册392-394正确区分发生和记录时间、recordedAt ASC/eventId ASC排序，只回查本次实际已发生事件，不承诺每笔支付必然包含全部流程。 |
| A12 | passed | specs/business-learning-scenarios/spec.md | 按条件执行到期关闭或结算替代 - GIVEN 支付已满足到期条件，或 Settlement 权威动作允许作废/创建 replacement - WHEN 阅读相应可选练习 - THEN 前置条件、所需输入、实际按钮、自动结果与完成判据完整 - AND WOW/CAP4K 的单独或组合传输差异被转为可理解的操作说明 - AND 不要求学习者改变现有成功事实、重付 UNKNOWN、清空数据或逐项构造边界异常 | 练习11/12沿用完整模板并以当前状态和actions为前提。到期关闭与逻辑时钟/维护用途分开，CAP4K只执行PAYMENT_EXPIRY、WOW维护返回替代说明，与adapter及PaymentsPage单支付关闭一致。手册449行已修正WOW顺序：原结算仍持有效范围、未作废且权威允许时直接创建替代；WOW SettlementApplicationService.kt:381-430要求ownershipActive、拒绝UNKNOWN/PROCESSING/SUCCEEDED/VOIDED，直接VoidSettlement(replacementPlan)。CAP4K VoidMerchantSettlementCmd.kt:54-93组合先作废再创建关联替代、MerchantSettlementBehavior.kt:432-452拒绝重复VOIDED路径。说明不再要求先单独作废，前后继关系可回查且替代不自动付款，不绕过SUCCESS/UNKNOWN或scope唯一性。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Git diff whitespace | diff --check | . | passed | 0 | 327 ms |
| Documentation structure links and scope | -e const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process'); const assert = require('node:assert/strict'); const handbookPath = 'docs/business-learning-scenarios.md'; const handbook = fs.readFileSync(handbookPath, 'utf8'); const readme = fs.readFileSync('README.md', 'utf8'); const scenarios = [...handbook.matchAll(/^## 练习 (\d{2})：/gm)]; assert.equal(scenarios.length, 12, 'Exactly twelve exercises required'); for (let i = 0; i < scenarios.length; i++) { const number = String(i + 1).padStart(2, '0'); assert.equal(scenarios[i][1], number, 'Exercises must be sequential'); const section = handbook.slice(scenarios[i].index, scenarios[i+1]?.index ?? handbook.indexOf('## 范围与实现参考')); for (const label of ['目的', '前置条件', '页签/表单/按钮', '完成判据', '下一步']) { assert(section.includes('**' + label + '：**'), number + ' missing ' + label); } assert(section.includes('\| 输入及来源 \| 用户需填写或核对 \| 自动预填/处理 \|'), number + ' missing input responsibility'); assert(section.includes('\| 步骤 \| 操作 \| 逐步预期结果 \|'), number + ' missing ordered expectations'); assert(handbook.includes('<a id="scenario-' + number + '"></a>'), number + ' missing stable anchor'); } const map = handbook.slice(handbook.indexOf('## 八个页签分别做什么'), handbook.indexOf('## 所有练习共用')); for (const tab of ['首页','支付','退款','对账','结算','人工核对','Reference Lab','实现对照']) assert(map.includes('\| ' + tab + ' \|'), 'Missing tab ' + tab); for (const file of ['README.md', handbookPath]) { const text = fs.readFileSync(file, 'utf8'); let columns = null; for (const [i, line] of text.split(/\r?\n/).entries()) { if (!line.startsWith('\|')) { columns = null; continue; } const count = line.split(/(?<!\\)\\|/).length; if (columns === null) columns = count; assert.equal(count, columns, file + ':' + (i+1) + ' inconsistent table columns'); } for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) { const link = match[1]; if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue; const [target, anchor] = link.split('#'); const resolved = target ? path.resolve(path.dirname(file), decodeURIComponent(target)) : path.resolve(file); assert(fs.existsSync(resolved), file + ' missing link target: ' + link); if (anchor) { const targetText = fs.readFileSync(resolved, 'utf8'); const ids = [...targetText.matchAll(/<a\s+id="([^"]+)"/g)].map(x=>x[1]); for (const h of targetText.matchAll(/^#{1,6}\s+(.+)$/gm)) ids.push(h[1].toLowerCase().replace(/[`*_]/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s/g,'-')); assert(ids.includes(decodeURIComponent(anchor)), file + ' missing anchor: ' + link); } } } assert(readme.includes('./docs/business-learning-scenarios.md'), 'README must link handbook'); assert(handbook.includes('../README.md'), 'Handbook must link README'); assert(readme.includes('./docs/backend-alignment.md'), 'Implementation reference retained'); assert(!handbook.includes('bill-bc0c625b'), 'No user-owned sample bill'); const changed = cp.execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean); for (const file of changed) assert(file === 'README.md' \|\| file === handbookPath \|\| file.startsWith('docs/comet/changes/add-business-learning-scenarios/'), 'Out-of-scope tracked change: ' + file); for (const backend of ['D:/code/wow-reference-payment', 'D:/code/cap4k-reference-payment']) { const status = cp.execFileSync('git',['-C',backend,'status','--porcelain'],{encoding:'utf8'}); assert.equal(status.trim(), '', 'Backend working tree changed: ' + backend); } console.log('PASS: 12 exercise templates, eight tabs, table widths, local links and anchors, mutual entry points, scope and backend trees. Semantic behavior still requires independent verification.'); | . | passed | 0 | 269 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- git diff --check: passed — 修正文档后退出码0；静态核对WOW replace入口的范围/状态前置与VoidSettlement(replacementPlan)，并核对页面替代动作。
- 已知限制: 纯文档变更，未新增资金流程验证；WOW FactConfirmation缺完整事实输入、CAP4K诊断/维护范围等现状已在手册披露。

## 阻塞项

_无。_

## 风险与跳过的工作

- 本轮只验证当前文档候选与当前UI、适配器及两端源码的语义一致性；未新增真实资金、故障注入或浏览器端到端流程验证，不能把静态通过称为本轮实际支付/退款/结算成功。
- WOW FactConfirmation当前页面仅提供结论，完整确认事实输入仍缺失；手册313行已披露，本轮不修改该实现。
- CAP4K部分脚本缺少独立诊断读取或bill provider控制；其Lab维护仅支付到期检查，WOW维护提供替代说明。能力差异已披露，退款复核仍需按实际后端条件观察。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Builder handoff Runtime checks failed: handbook-static-validation | 2026-10-06T14:58:17.875Z |
| 1 | 2 | 1 | execution-error | — | 平台支持subagent，但本次独立只读Verifier启动被拒绝：collab spawn failed: agent thread limit reached。unfiltered list_agents仅返回已完成旧代理，目标verify_business_handbook_candidate_2未启动，interrupt返回not found；没有verifier-started或语义验收结果。Runtime两项静态检查均已passed并复用，候选文件保留；不能把Builder核对冒称独立验收通过。 | 2026-10-06T15:04:08.412Z |
| 1 | 2 | 2 | execution-error | — | 平台拒绝本次新独立只读Verifier启动：collab spawn failed: agent thread limit reached。unfiltered agents.list_agents仅有已完成旧代理，verify_business_handbook_attempt_2未启动，interrupt_agent返回not found。没有verifier-started或独立语义结论；Runtime两项静态检查passed且reused，候选与证据保留。 | 2026-10-06T15:11:57.914Z |
| 1 | 2 | 3 | execution-error | — | 按用户要求改用可写codey_worker角色启动新的独立Verifier，但平台再次拒绝：collab spawn failed: agent thread limit reached。unfiltered list_agents仅有已完成旧代理，本次verify_business_handbook_writable_role未启动，interrupt_agent返回not found；没有verifier-started或独立验收结论。既有两项Runtime检查passed并复用，候选文档未修改。 | 2026-10-06T15:33:59.439Z |
| 1 | 2 | 3 | recovery | — | Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again. | 2026-10-06T15:48:49.037Z |
| 1 | 3 | 1 | execution-error | — | 本次原生codey_worker子代理verify_handbook_retry_after_release已成功创建，随后平台确认errored：模型上游HTTP 530（upstream_http_error，request ID 3841e606a86e404993c3d6448cb77451），没有返回完整验收结果。用户说明刚刚有网络波动并明确要求重新尝试，拟使用全新子代理及新Verifier任务重试。 | 2026-10-06T15:58:12.127Z |
| 1 | 3 | 2 | fail | A12 | 当前候选A1-A11通过，A12未通过。十二项均已逐项独立核对，Runtime两项静态检查passed且适用。唯一发现的验收缺陷是手册449行的WOW先作废再创建替代说明与当前replace命令和页面动作不一致；候选文档及三个仓库业务代码未被Verifier修改。 | 2026-10-06T16:19:23.806Z |
| 1 | 4 | 1 | pass | — | 已独立核对当前candidate 1121c582-c558-4f16-8f9d-847d0ec2c0a6全部A1-A12，恰好十二条且均passed，总体pass。启动receipt已由公开CLI成功登记；复用与当前candidate、workspace及verifier execution绑定的documentation-whitespace、handbook-static-validation两项Runtime passed记录（各exitCode 0、executionCount 1），没有重跑已有套件。当前verification.md不存在，未以旧报告替代本轮证据；完成独立核查后才核对Builder handoff，其A12修正声明与当前源码一致。只读核对Git显示workbench变更为README及新增文档/Comet工件，WOW和CAP4K工作树干净；本Verifier未修改候选、业务代码或用户业务数据，不执行accept-result或归档。 | 2026-10-06T16:38:01.530Z |



## 结论

已独立核对当前candidate 1121c582-c558-4f16-8f9d-847d0ec2c0a6全部A1-A12，恰好十二条且均passed，总体pass。启动receipt已由公开CLI成功登记；复用与当前candidate、workspace及verifier execution绑定的documentation-whitespace、handbook-static-validation两项Runtime passed记录（各exitCode 0、executionCount 1），没有重跑已有套件。当前verification.md不存在，未以旧报告替代本轮证据；完成独立核查后才核对Builder handoff，其A12修正声明与当前源码一致。只读核对Git显示workbench变更为README及新增文档/Comet工件，WOW和CAP4K工作树干净；本Verifier未修改候选、业务代码或用户业务数据，不执行accept-result或归档。
