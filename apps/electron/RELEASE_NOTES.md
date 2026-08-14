# MyYoda v0.9.2 更新

## Features（新功能）

### 代码图谱（Graphify）与 Coding 加强

- **图谱引擎迁移至 Graphify**：代码知识图谱由 code-review-graph 切换为 Graphify（纯本地 AST 分析，零 LLM、代码不出本机），构建更快（约 40 秒）、产物更小（约 24MB）
- **图谱 MCP 工具化**：图谱就绪后自动向 Agent 注入 10 个图谱工具（`mcp__graphify__*`：查询图、节点邻居、最短路径、社区、PR 影响等），AI 理解依赖/影响面时直接调用工具，无需 Bash 跑命令
- **Coding 加强一体开关**：设置 → 通用新增「Coding 加强」总开关，一键开启全部编码增强：模型专属编码规范（DeepSeek）、Chat 输出预算提升（64K）、新会话思考深度默认 max、编码预置技能（code-review / ultraqa / deep-interview / ai-slop-cleaner）、仓库代码地图（repo map）自动注入、Graphify 代码图谱
- **对话栏图谱按钮**：Coding 加强开启后对话栏出现图谱按钮（待创建 / 创建中 / 就绪 / 失败 / 不可用 五态图标），一键创建仓库代码地图与 Graphify 图谱，与设置开关实时联动
- **Graphify 环境一键管理**：设置页一键安装 / 卸载 Graphify（含 MCP 依赖），带实时进度日志；支持 `python -m graphify` 回退（Windows PATH 不含 Python Scripts 时自动兜底）

## Bug Fixes（缺陷修复）

- **修复图谱引导每轮重复注入**：Graphify 引导改为会话级一次注入（此前每轮重复注入约 300 token）
- **删除无效命令引导**：清理引导文案中不存在的 `graphify prs` 命令（PR 影响工具仅在 MCP serve 中）
- **修复无图状态盲区**：开关已开启但未建图时会话内注入建图提示（仅提示不自动建）；会话中建图后引导自动升级为查询命令模板
- **图谱按钮开关联动**：按钮随 Coding 加强开关显隐（此前关闭开关按钮仍显示）

## Improvements（体验改进）

- **非 git 项目防护**：图谱功能对非 git 项目严格禁用（按钮置灰 + 跳转设置），不产生任何残留文件
- **安全加固**：MCP 桥接层剥离 `project_path` 参数，AI 无法借图谱工具跨目录读取其他项目的图
- **性能**：Graphify 环境检测缓存加长至 10 分钟，避免主进程周期性同步阻塞
- **图谱产物防护**：`graphify-out/` 自动追加进主仓库 `.gitignore`，图谱文件不入库

## Breaking Changes（破坏性变更）

- 原 code-review-graph（CRG）知识图谱已移除；已有 CRG 缓存与图谱不再使用，需通过对话栏图谱按钮重新为项目建图
