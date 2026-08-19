---
name: heygen
description: HyperFrames by HeyGen 视频渲染。当用户想用 HTML/CSS/动画代码生成确定性 MP4 视频、做数据可视化动画、生成产品演示或宣传片时使用。需要本机有 Node.js（npx）与网络。
---

# HyperFrames by HeyGen

HyperFrames（github.com/heygen-com/hyperframes）是 HeyGen 的开源视频框架：把 HTML、CSS、媒体与可定位动画渲染为确定性 MP4 视频。官方文档：https://hyperframes.heygen.com

## 核心用法

### 1. 生成项目骨架

```bash
npx hyperframes init <project-name>
```

生成项目目录，含 `src/index.html`（主帧）、样式与配置。

### 2. 编写帧（HTML/CSS）

- 所有视觉内容用 HTML/CSS 描述；动画用 CSS `@keyframes` 或可定位的 seekable 动画（如 Web Animations API）。
- 在 `src/index.html` 中编写画面；支持媒体（图片/视频/音频）相对路径引用。

### 3. 渲染为视频

在项目目录内执行（`render` 的第一个位置参数是项目目录，`-o` 指定输出）：

```bash
npx hyperframes render -o out.mp4
# 或指定项目目录：
npx hyperframes render <project-name> -o out.mp4
```

- 默认输出 MP4；支持按需设置其它参数（详见 `npx hyperframes render --help`）
- 渲染是确定性的：相同输入产出相同帧序列，适合版本化与回放。

### 4. 校验 HTML 合约

```bash
npx hyperframes lint <project-name>
```

渲染前先 lint，避免布局/媒体错误。

## 推荐工作流

1. 与用户确认视频目标（时长、尺寸 16:9/9:16、风格、素材）
2. `npx hyperframes init` 创建项目
3. 编写 HTML/CSS 帧（多帧页面切换可用多 `<section>` 或路由帧）
4. `npx hyperframes lint` 校验
5. `npx hyperframes render` 渲染并给出产物路径
6. 询问用户是否需要调整样式/节奏后重新渲染

## 注意事项

- 需要 Node.js 环境与网络（首次运行 npx 会拉包）。
- 大媒体素材注意引用路径与体积；远程图片需可访问。
- 视频内容合规性由用户负责；不确定的需求先与用户确认再渲染。
