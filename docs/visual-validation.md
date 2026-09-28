# 前端视觉验证记录

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
