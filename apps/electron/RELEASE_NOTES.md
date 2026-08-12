# MyYoda v0.8.1 更新

## 重大变更

### 编码优化模式总开关（#37）

新增「编码优化模式」总开关（**默认关闭**，设置 → 通用），一键开启 DeepSeek 编码优化全家桶：

- **仓库代码地图（repo map）**：绑定 Project 的 Agent 会话自动注入按符号重要度排序的代码地图（PageRank + mention 感知，Aider tree-sitter 移植，27 语言），大仓库快速定位
- **模型专属编码规范**：DeepSeek v4 会话注入工具纪律 / 先读后改 / 小步验证 / 改后必验证 / 禁止编造 API
- **思考深度默认 max**：未设置会话级思考时默认提升到 max（会话级设置优先）
- **Chat 输出预算提升**：max_tokens 64000/16384（官方文档确认 384K 输出上限）
- **编码相关预置技能**：code-review / ultraqa / deep-interview / ai-slop-cleaner 预置但默认对 Agent 不可见，开关开启后放行

### code-review-graph 内置 MCP 预置（#37）

代码知识图谱（查询调用链 / 影响面 / 审查上下文）作为内置能力预置，默认关闭；未安装时引导提示，手动配置优先。

## Improvements

- 快速任务窗口懒创建（启动不再预创建隐藏窗口，首次唤起才建）
- 会话思考深度不固化默认档（新会话留空，运行期解析链决定，开关真正生效）
- UI 三处联动：设置页下拉 / 会话框显示 / 实际生效链一致

## Bug Fixes

- 设置开关点击无效（受控 Switch 漏乐观更新）
- `watch:preload` 脚本回归导致 dev 流程无法启动
- 会话框思考深度显示与实际不一致
- main 安全测试 Windows 平台适配（symlink EPERM / 路径断言 / 8.3 短路径）
- ipc.ts MAX_ATTACHMENT_SIZE import 回归修复

## Breaking Changes

无。编码优化模式默认关闭，现有行为不变。
