export interface AlignmentItem {
  topic: string;
  priority: "P0" | "P1" | "P2";
  target: string;
  wow: string;
  cap4k: string;
  workbench: string;
  followUp: string;
}

export const alignmentItems: AlignmentItem[] = [
  { topic: "列表与分页", priority: "P0", target: "支付、退款、对账、结算可筛选分页查询", wow: "无权威列表接口", cap4k: "无权威列表接口", workbench: "按 ID 查询；本地最近记录仅用于导航", followUp: "两端增加稳定分页、筛选、排序和总数/游标契约" },
  { topic: "支付尝试", priority: "P0", target: "创建支付与发起尝试语义独立，每次尝试有稳定身份", wow: "创建支付时自动选择渠道并启动尝试", cap4k: "独立 attempts 入口", workbench: "统一动作声明兼容两种流程", followUp: "统一 start/attempt 身份、失败重试和到期规则" },
  { topic: "渠道结果", priority: "P0", target: "独立、可验真、可去重并保留重复/冲突证据", wow: "支付子资源 results；verified 为请求字段", cap4k: "全局 channel results；sandbox secret 核验", workbench: "渠道模拟区分别映射", followUp: "统一通知身份、验证结果、处置和错误字段" },
  { topic: "退款申请", priority: "P0", target: "商户退款号、幂等键、原因、金额、币种与独立渠道结果", wow: "创建请求同时选择 fake result；缺少幂等键、原因、币种", cap4k: "创建与结果分离；缺少显式幂等键、原因", workbench: "保留统一输入并标注源语义缺口", followUp: "补齐目标字段并统一退款结果入口" },
  { topic: "对账入口", priority: "P1", target: "账单 signal、权威账单、revision、查询、重跑和处置", wow: "可登记 fixture 并触发 bill-available", cap4k: "调度/集成事件形成批次；支持查询、重跑、处置", workbench: "按能力启用真实动作", followUp: "提供一致的 reference 演示入口和批次发现查询" },
  { topic: "结算流程", priority: "P1", target: "准备、复核、确认、执行、结果、未知与替代", wow: "生成后自动推进；支持替代和裁决", cap4k: "显式准备、确认、执行、结果和作废", workbench: "以动作模型呈现阶段差异", followUp: "对齐阶段语义与操作回执，保留事务模型差异" },
  { topic: "全链路轨迹", priority: "P1", target: "从支付追踪退款、对账、结算、通知与人工动作", wow: "有 payment trace", cap4k: "支付详情含尝试/回执/review，无跨域 trace", workbench: "WOW 完整；CAP4K 明确显示局部轨迹", followUp: "CAP4K 增加跨域轨迹；两端统一事件分类" },
  { topic: "商户隔离与授权", priority: "P0", target: "商户隔离、角色授权、敏感动作复核和审计", wow: "明确为 reference non-goal", cap4k: "存在 operator 字段和 sandbox 校验，无生产认证", workbench: "显示 reference 边界，不伪造登录安全", followUp: "两端增加认证、授权、租户隔离与审计契约" },
  { topic: "浏览器接入", priority: "P1", target: "受支持的 CORS 或同源网关", wow: "无 CORS", cap4k: "无 CORS", workbench: "Vite 开发代理", followUp: "定义正式 API Gateway/CORS 策略" },
  { topic: "错误与能力发现", priority: "P1", target: "稳定错误、字段问题、重试语义和版本化 capability", wow: "简单 code/message/field；无 capability 入口", cap4k: "status/code/message/details；无 capability 入口", workbench: "适配器归一错误并静态声明能力", followUp: "两端统一错误、分页元数据和 capability contract" },
];
