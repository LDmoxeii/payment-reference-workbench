# 前端视觉验证记录

## 2026-10-01 当前多记录账单验收

`complete-multi-record-bill-reconciliation` 的候选 `a0983c88-602b-489b-aa9f-86c06d7e3455` 已由新独立 Verifier 自然完成 A1–A23 验收，全部通过。Runtime 已接收结果，当前为等待用户接受，尚未归档；正式逐项结论以 [验收报告](./comet/changes/complete-multi-record-bill-reconciliation/verification.md) 为准。本节记录本次实际视觉与联调证据，不把下方 9 月基线算作当前证据。

### 环境与实际范围

- WOW：同一候选前端 `http://127.0.0.1:5173` 连接专用真实服务 `http://127.0.0.1:18080/api`，fixture `multi-ui-wow`。
- CAP4K：同一候选前端 `http://127.0.0.1:5174` 连接专用真实服务 `http://127.0.0.1:18081/api`，fixture `multi-ui-cap4k`。
- 多记录场景使用独立业务日 `2056-02-10`、`Asia/Shanghai`，时刻 `2056-02-10T06:00:00Z`；其他支付/退款复核及 paired smoke 的时钟变化有记录，收尾恢复上述时刻。未清空用户交易、改动后端源码或关闭用户 8080 服务。
- 两端真实 UI 发布仅一笔支付的 revision 1，旧 Run 显示总明细 4 / 匹配 1 / 真实差异 3 与权威结算阻断；查询、复制、补齐三笔支付及一笔退款为完整 revision 2，新 Run 为 4 / 4 / 0，再冻结结算并执行唯一成功。旧 revision 完整对象与旧 Run 原始明细保持不变。
- 实际收入 CNY 300.00、成功退款 CNY 20.00、费用 CNY 1.80、调整 CNY 0.00；净额 CNY 278.20 与 INCLUDED 构成的有符号合计一致。此金额只是本次 fixture 的结果，不是 UI 写死的期望值。
- 桌面复核对账汇总、筛选、长 ID、责任字段与结算执行记录；`390 × 844` 移动视口复核多行账单、逐行精度错误、支付/退款 Attempt、页面内确认与当前视口错误通知，控件可操作。窄表格允许容器内部滚动，不要求一次显示全部列。
- 验收自行点击页面内确认/取消：取消不发布，确认后才发出命令。未要求用户点击原生弹窗，也未删除确认保护。

### 证据保留

原始证据仍在系统 TEMP，并已逐文件按 SHA-256 校验复制到独立本机目录：

`D:/code/payment-reference-workbench-evidence/complete-multi-record-bill-reconciliation/a0983c88/`

该目录不属于候选仓库，避免保留证据改动已冻结实现；它不会随 Git 自动分发，迁移机器时需另行复制。原始 JSON 绑定候选与 `skill-coordinated:verifier:8fb8d61f-a4e2-4853-add2-b10389e6ce9b`。

| 证据 | 内容 | SHA-256 |
|---|---|---|
| `verifier-v7-multirecord-http.json` | 58 次公开 HTTP 交换、历史不可变/冻结/合计/收尾断言 | `8b04dd7062501d898e09e6fae26f7dc257b38a9b0dc641b990935ad493235639` |
| `verifier-v7-ui-observations.json` | 两端实际页面观察、操作结果与截图索引 | `b7b1acd324dbb28093aafe8b1eb0a2622d6037f0f7818797dd747359f9a4a234` |
| `verifier-v7-paired-live-check.json` | 本次真实 HTTP 成功及 UNKNOWN/人工处置分支 2/2 | `5fe93816a99c76c0f662ffabfab830b183d8af5e64d9882e76858c44c8d19fb5` |

可直接查看的代表性截图：

- [CAP4K 新 Run 4 / 4 / 0](/D:/code/payment-reference-workbench-evidence/complete-multi-record-bill-reconciliation/a0983c88/verifier-v7-cap4k-run2-desktop.jpg)。
- [WOW 唯一结算执行成功](/D:/code/payment-reference-workbench-evidence/complete-multi-record-bill-reconciliation/a0983c88/verifier-v7-wow-settlement-success.jpg)。
- [CAP4K 移动端当前视口错误通知](/D:/code/payment-reference-workbench-evidence/complete-multi-record-bill-reconciliation/a0983c88/verifier-v7-cap4k-mobile-review-error.jpg)。

截图不能替代业务验收。当前 Runtime 类型检查、232 项测试、生产构建、diff-check 通过；4 个默认 live skipped 不算通过，另有本次 paired live 2/2 和双端真实 UI/HTTP 证据。实际未注入网络丢包或进程崩溃；所有无效 callback、负净额及 void/replacement 故障分支未逐个真实 UI 重跑，其冻结/幂等/边界结论来自当前候选测试与源码核验，不冒称截图已证明。

CAP4K 部分 search/ManualReview 源时间投影早 8 小时、通知列表摘要与详情投递计数不同，以及再次创建支付前须核对 `DEFAULT/CARD`，均保留在正式风险列表。前端本次不篡改这些源值；详情与源诊断是核对依据。

## 2026-09-25 视觉基线

`align-workbench-with-unified-backends` 在 2026-09-25 使用本机 Chrome headless 完成过桌面与移动视口渲染复核。移动证据通过 Chrome DevTools Protocol 的 `Emulation.setDeviceMetricsOverride` 强制为真实 `390 × 844` CSS viewport，并连接当时运行中的后端与 Vite 开发代理；不是把较宽 viewport 压缩成 390px 图片。该批截图是有时间边界的视觉基线，不自动代表后续每次业务字段调整后的当前画面。

- CAP4K：桌面 `1440 × 1000` 覆盖首页、支付、退款、对账、结算、人工核对/通知、Reference Lab、实现对照；移动 `390 × 844` 覆盖支付、对账、结算、人工核对/通知、Reference Lab。
- WOW：桌面 `1440 × 1000` 覆盖首页、支付、对账；移动 `390 × 844` 覆盖 Reference Lab。
- 两种 mode 使用相同页面结构，页面顶部和侧栏只切换只读实现说明；业务页面没有因后端类型改变信息架构。
- 支付、对账、结算、人工核对/通知与 Reference Lab 在 CAP4K mode 的 `innerWidth/clientWidth/scrollWidth` 均为 `390/390/390`；WOW Reference Lab 同样为 `390/390/390`。
- Reference Lab 截图已包含当时的账单暂不可读次数、通知 sender 与结算 executor 说明。`current-cap4k-reconciliation-*.png` 实际早于最终渠道/币种/业务日/时区 scope 表单，不再作为最终对账字段的当前证据；最终表单结构由组件测试覆盖，后续视觉迭代应重新生成这两张图片。
- 复核截图中未发现控件重叠、主页面横向溢出、长表单截断或移动导航遮挡。关闭状态的 off-canvas sidebar 位于 viewport 外是预期行为；数据表在窄视口使用自身横向滚动，不撑破页面。

## 截图证据

2026-09-25 基线证据位于 `docs/visual/`：

- `current-cap4k-*-desktop.png`：8 个 CAP4K 桌面页面。
- `current-cap4k-*-mobile.png`：5 个 CAP4K 移动页面。
- `current-wow-*-desktop.png`：3 个 WOW 桌面页面。
- `current-wow-reference-mobile.png`：WOW 移动 Reference Lab。

代表性 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `current-cap4k-overview-desktop.png` | `922f71f56593de7ba11bc33ef99e58ef05f4ec80bb77fdfa552330f960e3721c` |
| `current-cap4k-payments-mobile.png` | `45313534f2ed61ff0ad98a767ea9f837923368a0a0e4f4a78853e8667459c6dd` |
| `current-cap4k-reconciliation-mobile.png` | `dc7d2e16a3969fceba2b9d9cf939be8b0f8172a2e80ba098dc93feeb7622154c` |
| `current-cap4k-settlements-mobile.png` | `de3069e4b0afec7aed625cdd69d4e582af13fa4c3c98bcd3bf21fee32a6830a6` |
| `current-cap4k-reviews-mobile.png` | `8980f3b88bd81b6d5b8d38abc3c24b4794ce7ced4647712cc72757833cc51af8` |
| `current-cap4k-reference-mobile.png` | `365ae376a1dbe88ee6517b9f3c0ad84c88d759c3c56d05bfb5e9e46f759072d8` |
| `current-cap4k-alignment-desktop.png` | `8e056e63538cbf527946ace8ef9c3f6fae07f6d9118ddb44927d83ffaeda1074` |
| `current-wow-overview-desktop.png` | `a9c179d4d10c983a1266ff6a36b13768b0eedcb6d6f3349775d79e6284a6f6b7` |
| `current-wow-reference-mobile.png` | `5b74804f2cbac44058cbba5ad5015071c796429c8501924f2a3e87c8f5e1d9f1` |

`current-cap4k-reconciliation-desktop.png` 与 `current-cap4k-reconciliation-mobile.png` 保留用于追溯，但因上述 scope 表单变化不作为最终对账字段证据。更旧的 `cap4k-desktop.png`、`cap4k-mobile.png` 和 `wow-capabilities-desktop.png` 是 2026-09-21 的历史基线。

## 复核内容

- 首页正确显示连接状态、fixture、逻辑时钟、默认商户/渠道和统一业务地图。
- 五类权威列表的通用/专属筛选、空状态、刷新和 cursor 控件可读。
- 支付、退款、对账、结算和人工处置均使用结构化字段，不要求编辑任意 JSON。
- `OperationReceipt`、Operation、资源状态与 `finality` 使用不同区域/徽标表达；观察超时提供“继续观察”。
- 长 ID、Money、correlationId、证据和源诊断具备换行或可滚动容器。
- Reference Lab 明确标注 reference only；实现对照页只读解释传输差异。

## 可重复执行

先启动目标后端，然后启动相应 mode：

```powershell
.\node_modules\.bin\vite.cmd --mode cap4k --host 127.0.0.1
.\node_modules\.bin\vite.cmd --mode wow --host 127.0.0.1
```

桌面截图可以直接使用 headless Chrome；移动截图必须通过 CDP 设备度量覆盖设置真实 CSS viewport。仅使用 `--window-size=390,844` 的 Chrome 在本机实际得到约 526px CSS viewport，再压缩输出为 390px，会制造裁切假象，不能作为移动验收证据。

桌面示例截图命令：

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1000 --virtual-time-budget=3500 --screenshot='docs\visual\current-cap4k-overview-desktop.png' 'http://127.0.0.1:5173/#overview'
```

视觉验证只证明截图生成时的渲染和布局。支付到结算的业务正确性另由 WOW/CAP4K 真实 HTTP live smoke、adapter 契约测试和 Runtime Verifier 验收，不能由截图代替。
