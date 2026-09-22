# 前端视觉验证记录

验证日期：2026-09-21

验证环境：Vite 开发服务器 + 本机 Google Chrome headless。后端未启动，用于同时验证页面在网络不可达时仍可正常渲染并显示连接错误。

## 固化截图

| 模式 | 视口 | 页面 | 证据 | 结果 |
|---|---:|---|---|---|
| CAP4K | 1440 x 1000 | 工作台首页 | [cap4k-desktop.png](./visual/cap4k-desktop.png) | 固定侧栏、连接状态、四个业务入口、能力摘要和空记录状态均正常，无重叠 |
| CAP4K | 390 x 844 | 支付页 | [cap4k-mobile.png](./visual/cap4k-mobile.png) | 移动顶栏、单列表单、输入框、选择框和主按钮完整可见，无横向溢出 |
| WOW | 1440 x 1000 | 能力对照页 | [wow-capabilities-desktop.png](./visual/wow-capabilities-desktop.png) | WOW mode 正确生效；能力标签和六列表格完整渲染，内容未遮挡 |

## 交互检查

通过 Codex in-app browser 额外检查：

- 桌面工作台固定导航和首页连接失败反馈；
- 390 x 844 移动视口的导航抽屉打开、遮罩和关闭；
- 从移动导航进入支付页后，抽屉关闭且页面内容保持单列；
- 移动能力对照页使用横向滚动容器展示宽表格；
- WOW 与 CAP4K mode 切换后，同一页面结构保持不变，仅后端名称、能力和动作声明变化。

## 可重复命令

先分别启动开发服务器，再使用 Chrome 截图：

```powershell
npm run dev:cap4k
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1000 --screenshot='docs\visual\cap4k-desktop.png' 'http://127.0.0.1:5173/#overview'
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --hide-scrollbars --window-size=390,844 --screenshot='docs\visual\cap4k-mobile.png' 'http://127.0.0.1:5173/#payments'
```

```powershell
npm run dev:wow
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1000 --screenshot='docs\visual\wow-capabilities-desktop.png' 'http://127.0.0.1:5173/#alignment'
```

截图验证的是前端渲染和响应式交互，不作为真实后端业务能力已经通过端到端验证的证据。
