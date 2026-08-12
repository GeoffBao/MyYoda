# MyYoda v0.8.0 更新

## 重大变更

### Agent Runtime 统一为 Pi Agent SDK（#38）

废弃 Claude Code CLI runtime，统一使用 Pi Agent SDK 作为唯一 Agent 执行引擎。此举对齐 Proma 架构，消除了双 runtime 维护成本、渠道兼容差异与权限行为不一致。所有 Claude 渠道流量自动走 Pi adapter，存量渠道 `baseUrl` 配置自动兜底。

### Workspace / Project 术语整合（#40）

UI、提示词、Planning 面板、Skills/MCP 描述、迁移桥接等 92 个文件中完成术语统一：
- **工作区 (AgentWorkspace)**：顶级组织单元，包含多个项目，提供默认工作目录
- **项目 (Project)**：绑定具体工作目录的长期工作容器
- 退役「空间」「空间容器」「默认空间」等旧术语，默认名称改为「默认工作区」
- 兼容历史数据迁移，不做破坏性变更

### 文件系统与存储安全加固（#41）

从 orphan cleanup 到 IPC、Agent 上传、附件路径全线加固：
- **Orphan cleanup fail-closed**：索引损坏时停止清理而非错误删除，Workspace 元数据目录全面纳入白名单保护
- **Agent 上传路径边界**：拒绝路径穿越和符号链接绕过，上传归属只限定 Workspace/Session 目录
- **IPC 安全收窄**：Task/Label/SessionGroup/Teambition 等新增 IPC root guard，Renderer `unrestricted` 绕过修复，删除过宽 capability root
- **新增安全边界策略层**：`agent-file-path-policy`、`agent-upload-boundary-policy`、`attachment-path-policy`、`destructive-file-policy`、`file-access-policy`、`workspace-root-access-policy`、`storage-cleanup-policy`

### 社区市场增强（#39）

社区 Skill 市场从简单列表升级为完整分发系统：
- **版本号 & 下载量**：Skill 卡片展示版本徽标和累计下载数
- **分类筛选**：按用途分类快速定位（文档处理 / 开发工具 / 知识管理 / 视频创作等）
- **外部 Skill 收录**：44 个外部仓库 Skill（HyperFrames、Anthropic Skills、Obra Superpowers 等）以 `n-skills` 兼容格式直接安装
- **本地计数持久化**：无远端统计端点时下载计数仍正常记录
- **63 个 Skill 覆盖**：19 个本仓库托管 + 44 个外部收录

## 其他改进

- **TipTap mention 异步启动修复**：修复 TipTap 3.29 的 `onStart` 误拒未登记数组导致 @mention 弹窗不创建的问题
- **Claude 订阅限流优化**：订阅窗口限流不再被映射为「Claude 订阅用量已达上限」终态，存量渠道 `baseUrl` 自动兜底
- **VisionRelay 会话安全**：VisionRelay 图片中继授权根纳入会话 sandbox 目录
- **Memory 时序上下文保留**：Workspace 长期记忆写入时保留时序关系
- **文件面板快捷键**：支持在预览 Tab 中切换文件面板显示（#1521）
- **排队消息可中断**：Agent 排队中的待发送消息支持取消（#1520）
- **委托子会话清理**：已完成/失败的委托子会话不再显示为未读完成标记
- **文件暴露扩展**：Agent 可见文件范围超出会话 attachments，支持 Project 内更广泛的文件访问（#1522）

## 跨平台修复

- **Windows 窗口控制与拖拽修复**（#1525）
- **Mac 构建失败兜底**：重试耗尽后正确报错而非无限等待（#1524）

---

> 如果打开应用时提示：
>
> > "MyYoda" is damaged and can't be opened.
>
> **这不是安装包损坏。** 安装到 Applications 后执行：

```bash
xattr -cr /Applications/MyYoda.app
open /Applications/MyYoda.app
```

Made with [MyYoda](https://github.com/GeoffBao/MyYoda)
