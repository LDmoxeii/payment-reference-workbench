# Payment Reference Workbench

面向统一支付业务诉求的前端工作台。它不是 WOW 或 CAP4K 接口的简单页面包装，而是先定义支付、退款、对账、结算和轨迹的统一业务契约，再通过适配器连接两套 reference 后端。

当前支持：

- `wow-reference-payment`
- `cap4k-reference-payment`

业务目标以 `payment-product-template` 为准。某个后端尚未实现的目标能力会显示为不可用或部分可用，并进入[后端对齐清单](./docs/backend-alignment.md)，不会从统一业务模型中删除，也不会由前端伪造。

## 运行要求

- Node.js 20 或更高版本
- npm
- 需要连接真实接口时，启动 WOW 或 CAP4K 后端之一；两者默认都使用 `http://127.0.0.1:8080`

安装依赖：

```powershell
npm ci
```

启动 WOW 模式：

```powershell
npm run dev:wow
```

启动 CAP4K 模式：

```powershell
npm run dev:cap4k
```

Vite 会输出实际访问地址，默认是 `http://127.0.0.1:5173`。两个后端当前没有 CORS 配置，开发服务器使用 `/backend` 同源代理访问后端。

后端没有启动时，工作台仍能打开，并在首页显示连接失败；创建、查询等业务请求会显示标准化网络错误。

## 后端配置与切换

WOW 模式读取 `.env.wow`：

```dotenv
VITE_PAYMENT_ADAPTER=wow
VITE_API_BASE_URL=/backend/api
VITE_BACKEND_TARGET=http://127.0.0.1:8080
```

CAP4K 模式读取 `.env.cap4k`：

```dotenv
VITE_PAYMENT_ADAPTER=cap4k
VITE_API_BASE_URL=/backend/api
VITE_BACKEND_TARGET=http://127.0.0.1:8080
VITE_CAP4K_VERIFICATION_MATERIAL=test-secret
```

修改 `VITE_BACKEND_TARGET` 可以连接不同端口。切换适配器只需使用不同启动 mode 或修改集中配置，不需要修改页面。`test-secret` 仅是 CAP4K sandbox 校验材料，不是生产安全方案。

## 项目结构

```text
src/
  adapters/       WOW、CAP4K 适配器、映射和适配器工厂
  config/         环境变量和运行时组合
  data/           业务能力与后端对齐矩阵
  domain/         统一领域模型、金额和错误模型
  http/           HTTP 客户端、错误归一和轮询
  services/       页面使用的统一服务与本地最近记录
  styles/         响应式工作台样式
  ui/             通用组件、动作交互和业务页面
docs/
  backend-alignment.md    后端业务对齐清单
  comet/                  已确认需求、规格和验收状态
```

依赖保持在 React、Vite、TypeScript、Lucide 和 Vitest 范围内，没有引入 UI 框架或全局状态管理库。

## 统一契约与适配器

页面只使用 `PaymentWorkbenchService`、统一领域对象、`CapabilityDeclaration` 和 `ActionDescriptor`：

```text
页面与业务组件
      |
      v
PaymentWorkbenchService + 统一模型
      |
      v
适配器工厂
   |        |
   v        v
 WOW      CAP4K
   |        |
   v        v
统一 HTTP 客户端与错误模型
```

适配器负责封装：

- endpoint 路径和 HTTP 方法；
- 请求字段、金额格式和响应结构；
- 统一状态与源状态映射；
- 渠道结果值，例如统一 `SUCCEEDED` 到 CAP4K `SUCCESS`；
- 受理回执、幂等复用和读模型刷新策略；
- 后端错误码、字段问题、HTTP 状态和诊断信息；
- 当前可执行动作、禁用原因、确认级别、所需字段和默认值；
- 列表/分页、轨迹、运营动作等能力是否完整、部分或不可用。

金额在领域层使用“币种 + 最小单位整数字符串”，计算使用 `BigInt`。CAP4K decimal 与 WOW 整数只在适配器边界转换，不以 JavaScript 浮点作为资金真源。

命令 HTTP 2xx 或 `accepted` 只表示操作受理。工作台会根据回执读取或轮询 Projection，并分别显示“已受理”“状态已读取”和“暂未收敛”，不会把受理当成支付成功。

## 已支持业务流程

### 商户操作

1. 创建支付：商户、订单号、幂等键、金额、币种、支付方式和可选到期时间。
2. 按支付号查询：查看支付主状态、源状态、尝试、回执、退款预算和结算资格。
3. 创建退款：从成功支付发起全额或部分退款，并查看退款号、状态、尝试、回执和预算占用。
4. 按退款号查询：查看退款处理、成功、失败、未知和复核状态。

### 渠道模拟

- WOW：创建支付时自动形成尝试，通过支付子资源提交 reference 结果；退款在创建时选择 fake 结果。
- CAP4K：显式发起支付尝试，再通过 sandbox payment/refund result 入口提交结果。
- 所有资金结果、关闭、作废和人工裁决操作都会显示二次确认。

### 平台运营

- 按 ID 查询对账批次和结算单。
- WOW：登记 reference 权威账单、通知 bill available、生成/替代结算和结算裁决。
- CAP4K：对账重跑、差异处置、结算准备、确认、执行、结果和作废。
- WOW 可读取支付聚合 trace；CAP4K 明确显示只有支付详情范围内的局部轨迹。

运营动作保留可编辑业务参数，便于学习和验证 reference 后端。它不是面向生产运营人员的权限化表单。

## 列表与最近记录

两套后端目前都没有权威支付/退款列表和分页 endpoint。工作台只把本浏览器成功创建或查询过的最小导航信息保存在 `localStorage`：资源类型、ID、标签、状态摘要、访问时间和适配器。

这些记录：

- 按适配器隔离，不会把 WOW ID 自动发给 CAP4K；
- 只用于快速重新打开资源；
- 不是后端全量订单、交易列表或分页结果。

统一领域契约仍保留 `PageRequest` / `PageResult<T>`。两个适配器在调用列表时会明确返回 `CAPABILITY_UNAVAILABLE`，等待后端后续实现。

## 两个后端的主要差异

| 业务点 | WOW | CAP4K | 工作台处理 |
|---|---|---|---|
| 支付尝试 | 创建支付时自动启动 | 显式 attempts endpoint | 通过动作声明呈现，不在页面判断后端 |
| 支付结果 | `/payments/{id}/results` | `/channel/payment-results` | 统一渠道结果请求，适配路径和字段 |
| 退款结果 | 创建退款时选择 fake result | 创建后独立提交 sandbox result | 动作所需字段决定表单，不在页面判断后端 |
| 异步语义 | 命令与 Projection 最终一致 | 多数命令后读取当前详情 | 回执声明 `poll` 或 `read_once` |
| 对账形成 | 可登记 fixture 并触发 | 调度/集成事件形成批次 | 只启用真实入口，CAP4K 不伪造创建 |
| 结算 | 生成后自动推进，支持替代/裁决 | 准备、确认、执行、结果、作废 | 统一动作列表保留流程差异 |
| 全链路轨迹 | 有 payment trace | 无跨域 trace | 完整或局部明确标识 |
| 列表/分页 | 无 | 无 | 本地最近记录 + 目标分页契约 |

完整差异、优先级和后端改造建议见[后端对齐清单](./docs/backend-alignment.md)。

## 新增第三种后端

1. 在 `src/adapters/` 新增一个实现 `PaymentBackendAdapter` 的适配器。
2. 将路径、方法、字段、金额、状态、响应、错误和异步语义映射到统一模型。
3. 为适配器声明 capabilities 和资源 actions；不支持的能力必须给出明确原因。
4. 在 `src/adapters/factory.ts` 注册新的配置标识。
5. 为新模式增加环境配置和 Vite 代理目标。
6. 增加请求 payload、响应映射、状态、错误、能力降级和最近记录隔离测试。
7. 更新能力对照数据和 `docs/backend-alignment.md`。

如果统一业务语义没有变化，不应修改支付、退款和运营页面。需要新增业务语义时，先扩展统一领域契约，再由所有适配器声明支持程度。

## 验证

```powershell
npm run typecheck
npm run test
npm run build
```

也可一次运行：

```powershell
npm run check
```

桌面、移动视口和双 mode 的实际渲染记录见[前端视觉验证记录](./docs/visual-validation.md)。

## 已知限制

- 当前只支持 CNY 两位小数；新增币种必须先在金额精度表中声明。
- 两套后端都没有权威列表/分页、生产认证授权或正式浏览器 CORS 方案。
- CAP4K 没有支付到退款、对账、结算的统一跨域 trace。
- CAP4K 对账批次需要由调度或集成事件预先形成，工作台只能查询、重跑和处置已有批次。
- WOW 部分命令依赖最终一致读模型；轮询超时只表示暂未观察到收敛，不表示业务失败。
- reference/sandbox 回调、固定 secret、fake 渠道和 fixture 账单都不能视为生产支付能力。
- 工作台不修改两个后端，也不实现模板尚未冻结的资金政策、生产安全、真实渠道签名或真实资金移动。
