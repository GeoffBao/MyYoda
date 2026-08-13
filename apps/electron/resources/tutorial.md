# MyYoda 使用指南

最后更新：2026 年 8 月 13 日

---

## 1. MyYoda 是什么

<video src="https://github.com/GeoffBao/MyYoda/releases/download/tutorial-assets/myyoda-promo-30s.mp4" controls poster="https://github.com/GeoffBao/MyYoda/releases/download/tutorial-assets/promo-thumbnail.png" style="max-width:100%;border-radius:12px;margin:1rem 0;"></video>

MyYoda 是一个本地优先的 AI 工作台，面向研发、产品、测试、研究、运营、管理和知识工作场景。它既可以帮助你讨论和表达，也可以在可信环境中读取文件、调用工具、执行命令并交付可追踪的结果。

当前有两个顶层工作模式：

| 模式 | 核心定位 | 典型场景 |
|------|----------|----------|
| **Chat** | 思考、阅读、分析和表达 | 问答、翻译、写作、附件阅读、多模型比较、方案讨论、轻量技术问题 |
| **Project** | 执行、交付和持续推进 | 读写文件、运行命令、浏览器/MCP、项目上下文、任务编排、自动化、代码与文档产出 |

### Chat 还是 Project？

不要按“是否是程序员”来区分，而要看任务是否需要接触本地环境和持续执行：

| 需求 | 推荐模式 |
|------|----------|
| 问答、解释、翻译、头脑风暴 | Chat |
| 阅读附件并总结、改写或比较回答 | Chat |
| 只做研究和分析，不保存本地产物 | 通常 Chat |
| 讨论代码方案，但暂时不打开工程 | Chat |
| 读取或修改本地文件 | Project |
| 运行 Shell、Git、构建或测试 | Project |
| 绑定 Workspace / Project | Project |
| 调用浏览器、MCP 或外部工具并持续操作 | Project |
| 生成并保存可复查的项目文件 | Project |
| 使用 Project 看板、正式 Task、Automation 或协作子会话 | Project |
| 研究后生成报告、保存资料并持续迭代 | Project |

一句话：**Chat 是默认的思考与表达入口；Project 是可执行、可追踪、可交付的工作入口。Project 不限于写代码，办公和知识工作同样可以使用 Project。**

![Project 模式界面](https://github.com/GeoffBao/MyYoda/releases/download/tutorial-assets/code-mode-empty-state.png)

Project 看板和 Task 不再是独立顶层模式，而是 Project 内的工作区域。进入 Project 后，可以在会话、项目和 Project 看板之间切换。

---

## 2. 五分钟快速开始

### 第一步：配置模型渠道

打开 **设置 → 模型配置**，添加至少一个渠道。

可用渠道包括：

- API Key 渠道：Anthropic、OpenAI、Google、DeepSeek、Kimi、智谱、通义、豆包、OpenRouter、自定义兼容端点等；
- **ChatGPT 订阅登录**：通过 Codex OAuth 使用支持的 ChatGPT 订阅能力；
- **Claude Pro / Max 订阅登录**：通过浏览器授权使用 Claude 订阅能力。

订阅登录渠道当前主要用于 Project。API Key 渠道能否在 Chat 使用，取决于协议、模型和渠道配置；如果某个渠道不支持 Chat，界面会提示切换到 Project。

### 第二步：选择工作模式

- 想讨论、阅读、分析、写作或比较多个模型：选择 **Chat**；
- 想修改文件、运行命令、绑定工程、生成文件或执行多步骤工作：选择 **Project**。

如果 Chat 判断当前请求需要工具执行，可能会显示“切换到 Project”建议。迁移会保留原对话历史，把建议提示预填到 Project 输入区，**不会未经确认自动继续执行**。

### 第三步：确认 Workspace

Workspace 是 MyYoda 的隔离与能力容器，管理会话、Projects、Skills、MCP、Yoda 记忆、附加资料和自动任务。

默认用户通常只需要一个 Workspace。创建、重命名、切换或删除多工作区，请打开 **设置 → 连接与数据 → 工作区**。Project 折叠侧栏的 Project 图标也可能提供快速切换入口，但 Workspace 的正式管理入口是设置页。

Workspace 不等于某个代码仓库，也不等于某个 Project。一个 Workspace 可以包含多个 Project、多个会话和多种共享能力。

### 第四步：为工程或业务创建 Project

进入 Project，在左栏切换到“项目”投影或从项目入口创建 Project。Project 通常对应一个代码仓库、一个业务工作流或一个长期资料集合。

Project 可以配置：

- 名称、颜色和描述；
- `workingDirectory`：真实工程目录；
- Project → 知识：项目长期知识；
- Project → 资料：项目参考文件；
- 默认 Agent 专家。

从 Project 新建会话最稳妥。这样会话会继承项目描述、工作目录、资料和项目知识。

### 第五步：发起第一个任务

推荐写清目标、范围、限制和验收标准。例如：

> 请检查当前项目的登录流程，先定位根因并给出方案。不要修改数据库结构；实现后运行相关测试，并说明改动文件和风险。

---

## 3. 模型渠道与 Agent Runtime

### 渠道、模型、Runtime 的区别

| 概念 | 含义 |
|------|------|
| **渠道** | 模型供应商、订阅账号或企业 API 端点 |
| **模型** | 渠道下可用的具体模型 |
| **Agent Runtime** | 负责工具调用、文件操作、会话恢复和流式执行的运行内核 |

Project 当前默认使用 **Pi Agent Runtime**。Pi 可以使用已启用的多种模型渠道，不要求渠道必须采用 Anthropic 协议。

Claude Pro / Max 订阅渠道是特殊情况：应用会透明使用与订阅凭据兼容的 Claude Runtime。一般用户不需要手动管理 Runtime，只需选择可用渠道和模型。

### 模型选择建议

- 编程、架构和复杂执行：优先选择工具调用稳定、上下文充足的模型；
- 快速分析和文档任务：可选择成本更低、响应更快的模型；
- Project Task：先选择主任务的编排模型，再按需给子任务覆盖模型或渠道；
- Automation：优先选择稳定模型，并设置合理运行频率和最大运行次数。

如果模型不可用，请检查渠道是否启用、模型是否仍被供应商支持、代理是否正确，以及当前模式是否支持该渠道。

---

## 4. Workspace、Project 与目录模型

这是使用 Project 时最重要的心智模型。

### Workspace

Workspace 是顶层隔离容器，负责：

- Chat / Project 共享的能力配置；
- Project 会话和未归类会话；
- Skills、MCP、专家绑定和标签的工作区默认层；
- 记忆（Workspace 根目录 `AGENTS.md` 与 `memory/` 下的 auto-memory）；
- Projects、Tasks、Automation 和 Workspace Files；
- Workspace 级附加目录与附加文件；
- Workspace 级 Excalidraw 画布。

### Project

Project 是 Workspace 内的长期工作容器，负责：

- `workingDirectory`：真实代码仓库或业务资料目录；
- Project 描述、颜色和设置；
- `assets/`：项目参考资料；
- `MEMORY.md`：Project Knowledge；
- 关联会话和 Project Task；
- 默认 Agent 专家；
- 可选的自己的 Skills / MCP 配置。

Project 默认使用 Workspace 的 Skills/MCP（不复制，只是引用）。如果一个 Project 需要与其他 Project 不同的能力集合，可以在 Yoda 插件里切到这个 Project，单独为它添加/删除 Skill 或 MCP 服务器——一旦 Project 有了自己的配置，就不再回退到 Workspace 默认，两者完全独立。Memory 不走这套机制，始终是 Workspace 级（另见第 12 节）。

### Session cwd

每个 Project 会话都有自己的隔离目录，作为临时工作台和会话 cwd。它不是你的代码仓库。

当会话绑定 Project 时，MyYoda 会把 Project 的有效工作目录明确注入上下文，告诉 Agent 应在哪里读代码、改文件和运行命令，同时保留会话目录存放 `.context/` 等临时资料。

### 目录示意

```text
~/.myyoda/agent-workspaces/{workspace-slug}/
├── AGENTS.md                     # Workspace 级长期指令（Agent 可写）
├── memory/                       # Workspace auto-memory 与用户画像（MEMORY.md 索引+主题文件）
├── workspace-files/              # Workspace 跨会话共享资料
│   └── .context/                 # 跨会话 Context 文档
├── mcp.json                      # Workspace MCP 配置
├── skills/                       # Workspace Skills
├── skills-inactive/              # 已禁用的 Workspace Skills
├── projects/
│   └── {project-slug}/
│       ├── config.json
│       ├── assets/               # Project 资料
│       ├── MEMORY.md             # Project Knowledge（托管项目默认位置）
│       ├── skills/               # Project 自己的 Skills（可选，未配置时回退到 Workspace 默认）
│       ├── mcp.json              # Project 自己的 MCP 配置（可选）
│       └── workdir/              # 没有外部目录时的托管工作目录
├── tasks/{task-slug}/             # 正式 Task 与 Run 数据
├── excalidraw/                   # Workspace 级 .excalidraw 画布
└── {session-id}/
    └── .context/                 # 当前会话临时计划、笔记和交接

你的真实工程目录/                  # 通常位于 Workspace 之外
├── src/ ...                       # 由 Project workingDirectory 指向
└── .context/                     # Project 设置为“跟着真实目录走”时，MEMORY.md/skills/mcp.json 都落在这里，而不是上面的 projects/{slug}/
```

### 文件应该放在哪里

| 内容 | 推荐位置 |
|------|----------|
| 当前任务的临时计划、调试记录 | 会话目录 `.context/` |
| 多个会话都会使用的共享资料 | `workspace-files/` |
| Workspace 跨项目规则、稳定偏好和通用经验 | 左侧栏 Yoda 插件 → Memory |
| 某个 Project 的架构、命令、技术决策 | Project → 知识 |
| Project 的参考规范、样例和必要设计资料 | Project → 资料 / `assets/` |
| 真实代码和工程文件 | Project `workingDirectory` |
| Workspace 级手绘画布 | Chat → Excalidraw 画板 |

不要把临时过程、项目专属事实和可复用 SOP 全部写进同一份记忆。它们分别属于 Session Context、Project Knowledge、记忆（Memory）或 Yoda 插件中的 Skill。

---

## 5. Chat 模式

![Chat 模式界面](https://github.com/GeoffBao/MyYoda/releases/download/tutorial-assets/chat-mode-empty-state.png)

Chat 面向日常工作、知识处理和轻量创作。它默认不要求绑定本地工程，也不会因为一次普通问答就修改你的代码仓库。

### 主要能力

- 多模型渠道与模型切换；
- 同一问题并排比较多个模型；
- 图片、PDF、Office、代码和文本附件；
- Markdown、Mermaid、KaTeX 和代码高亮；
- 思考模式与上下文长度控制；
- Chat 提示词管理；
- 已配置的 Chat/API 工具；
- 清空上下文或插入上下文分割；
- 将对话迁移到 Project 继续执行。

### 适合 Chat 的例子

- 阅读一份合同、论文或会议纪要并总结；
- 翻译、改写、润色和写作；
- 比较多个模型对同一方案的回答；
- 讨论代码设计但暂时不打开工程；
- 对一个问题做研究并直接在对话中得到结论；
- 处理不需要写回本地文件的轻量技术问题。

如果任务开始需要保存报告、批量修改文件、调用浏览器、运行命令或持续维护，就切换到 Project。

---

## 6. Project 模式

Project 是可执行、可追踪的 Agent 工作台，不限于程序员写代码。它适合任何需要工作区、文件、工具或长流程的任务。

### 主要能力

- 读取、创建和修改本地文件；
- Shell、Git、构建和测试；
- Skills、MCP、浏览器和外部工具；
- Project 上下文、资料和 Project Knowledge；
- 文件树、Diff，以及 Markdown、Office、PDF、图片等文件预览；
- 多标签页和后台会话；
- 计划模式、可见进度和协作子会话；
- Project 看板、正式 Task、Automation；
- 研究后生成报告、整理资料或交付项目文件。

### 非编程场景也可以使用 Project

- 批量整理本地会议资料并生成报告；
- 浏览网页、收集资料并保存为项目文档；
- 维护一套长期项目资料和工作流程；
- 把复杂工作拆成多个有依赖的 Task；
- 定期检查文件、数据源或 CI 状态并输出摘要。

### 绑定 Project

从 Project 下新建会话最稳妥。这样会话会自动获得项目描述、真实工程目录、参考资料、Project Knowledge 和默认专家。

如果 Agent 去错误目录找代码，请检查：

1. 会话是否绑定正确 Project；
2. Project 的 `workingDirectory` 是否有效；
3. 是否把会话 cwd 误认为工程目录；
4. 右侧 Files 面板当前选的是“会话文件”还是“项目文件”。

### 权限模式

普通 Project 会话提供两种主要模式：

| 模式 | 行为 |
|------|------|
| **完全自动** | Agent 可连续调用工具和修改文件，适合目标明确且环境可信的任务 |
| **计划模式** | Agent 先调研并提交计划，等待批准后再执行写操作 |

涉及不可逆删除、外部发布、发送消息、付费消耗或安全权限变更时，即使在完全自动模式下，也应明确确认边界。

### 输入框引用

| 输入 | 用途 |
|------|------|
| `@` | 从当前 Workspace 的 Workspace Files、Workspace 附加目录/文件和会话附加内容中选择文件、目录或上下文 |
| `/` | 选择或触发 Skill |
| `#` | 引用 MCP 能力 |
| `&` | 引用其他会话 |

这些引用会随消息一起发送给 Agent，适合提供精准上下文。

---

## 7. Project 页面、文件面板与画布

### Project 页面

打开 Project 后，可以看到：

- **概览**：项目描述、工作目录和基本信息；
- **会话**：属于该 Project 的 Project 会话；
- **知识**：Project Knowledge，保存工程架构、命令、技术决策和注意事项；
- **资料**：Project assets 和参考文件；
- **设置**：Project 工作目录、颜色、描述和默认专家等配置；还有一个 Skills / MCP 摘要小节，显示该 Project 的 Skills/MCP 数量以及是否已自己配置过（还是沿用 Workspace 默认），点击“管理 →”可直接跳到 Yoda 插件并自动预选中这个 Project。

Project 页的“查看任务”会回到唯一的 Project 看板，并自动带上该 Project 的筛选条件，不会创建第二套任务数据。

### 右侧 Files 面板

Project 会话的右侧面板按当前 Session 展示两类主要文件来源：

- **会话文件**：会话隔离目录中的临时文件；
- **项目文件**：当前会话绑定的 Project 工作目录或 worktree；未绑定 Project 时不会把 Workspace Files 冒充为项目文件。

面板还保留 Workspace 附加目录/文件作为辅助访问入口，并支持文件预览、引用到输入框和代码改动 Diff。需要浏览当前 Workspace Files 时，应使用输入框的 `@` 选择器；它与右侧 Files 的“项目文件”不是同一个来源。

当前右侧面板是 Project 会话的文件面板，不是 Excalidraw 画布面板。Project 工作目录可能是外部目录，也可能是 MyYoda 为 Project 创建的托管目录。

### Excalidraw 画板

Chat 左栏的 **Excalidraw 画板**用于创建、编辑、重命名、删除和导出手绘画布，支持自动保存和 Cmd/Ctrl+S 手动保存。

当前画布按 **Workspace** 存储在 `excalidraw/`，还没有 Project 归属字段。因此它是 Workspace 级创作资产：可以在同一 Workspace 中使用，但不会自动出现在某个 Project 的右侧 Files 面板或 Project → 资料中。需要让某个项目使用画布时，可以导出后放入 Project assets，或在项目资料中保存引用。

这是当前版本的明确边界，不应把 Excalidraw 画布误认为已经与 Project 自动绑定。

---

## 8. Project 看板与 Task

进入 Project 后打开 **Project 看板**。看板负责展示正式 Task，并按 Project、Workspace、状态和标签筛选。

### Workspace、Project 与 Task 的关系

- Workspace 是 Task、Project、Session 和 Run 的数据隔离边界；
- Project 是长期工作容器；
- Task 是正式可追踪工作项；
- Session 是对话或执行载体；
- Run 是一次 Task 执行；
- Task 的子节点会产生可追踪的执行会话。

当前版本明确支持两种 Task scope：

- **Project Task**：绑定某个 Project，适合工程和长期业务工作；
- **Workspace Task**：属于当前 Workspace，但不绑定任何 Project，适合跨项目、Workspace 级事务或尚未归类的工作。

Workspace Task 不是“自动落到 Workspace 的默认 Project”；它的 `projectId` 为空，运行时使用显式 `cwd` 或 Workspace 默认工作目录策略。若任务需要 Project Knowledge、Project assets、Project 默认专家或项目工作目录，应明确选择 Project。

这不是临时兼容分支，而是 MyYoda 当前的正式数据模型：Workspace 是 Task 的必选边界，Project 是可选的长期工作容器。它保留了 Proma/通用工作台式的跨项目任务能力，同时吸收 craft-agents-oss 的 Project Task、Run、Session 追踪；Project Task 与 Workspace Task 在看板中应保持清晰的 scope 标识。

### 默认列

| 列 | 含义 |
|----|------|
| **待办** | 尚未开始或等待安排 |
| **进行中** | 正在推进 |
| **需验收** | Agent Run 已结束，等待用户确认结果 |
| **已完成** | 用户确认完成 |
| **已取消** | 用户取消，不再继续 |

看板列是用户整理工作的维度；Run 状态是机器执行生命周期。两者可以暂时不同，不能用拖动列代替运行控制。

### 轻量创建与正式 Task

看板中可以先输入一句目标，快速创建轻量工作项；工作变复杂后，再进入 TaskEditor 补充计划。

正式 Task 支持：

- 手动编辑任务计划；
- 根据目标生成初始计划；
- 将工作拆成有依赖关系的子任务 DAG；
- 设置编排模型、渠道、权限、专家和工作目录；
- 为单个子任务覆盖模型和渠道；
- 设置验收标准和最大修复次数；
- 创建、创建并运行、保存并运行；
- 查看各节点的真实执行会话。

“生成初始计划”只生成草稿；创建、运行和会话副作用应保持分段。运行前应确认 Task scope、Project（如需要）、工作目录、模型、权限和验收标准。

---

## 9. 三种容易混淆的任务对象

| 名称 | 用途 | 是否创建真实执行会话 |
|------|------|----------------------|
| **Project Task / Workspace Task** | 看板中的正式工作项，由 TaskRunner 调度；前者绑定 Project，后者保持 Workspace scope | 是，Run 的节点会产生会话 |
| **可见进度任务** | Agent 使用 TaskCreate / TaskUpdate 展示当前复杂任务进度 | 否，只是进度清单 |
| **collaboration 子会话** | Agent 把独立子问题委派给另一个真实 Agent 会话 | 是，可在侧边栏查看和继续 |

不要把可见进度任务误认为看板 Task，也不要为了一个强顺序的小修改创建 collaboration 子会话。

---

## 10. collaboration 协作子 Agent

当任务包含多个可以并行推进的独立方向时，Agent 可以创建真实可见的 collaboration 子会话，例如：

- 一个子 Agent 调研前端；
- 一个子 Agent 审查后端；
- 一个子 Agent 独立做风险审查；
- 父 Agent 汇总并决策。

MyYoda collaboration 子会话：

- 在侧边栏中真实可见；
- 保留完整上下文和结果；
- 可以等待、停止、继续和读取结果；
- 适合长耗时并行调研和对抗性审查。

简单搜索、单文件修改或强顺序任务通常不需要创建子会话，父 Agent 直接完成更高效。

---

## 11. Yoda 插件：专家、Skills、MCP 与 API

点击**左侧栏的“Yoda 插件”图标**直接打开（不在设置页里）。Yoda 插件是 Chat 与 Project 共享的能力配置中心，一个全屏视图，内部按顶部切换六个平级 Tab：专家 / 专家团 / Skills / MCP / API / Memory。它不是某个单独模型，也不等于一个额外的 Agent 会话。

### 范围切换器：工作区默认 vs 具体 Project

页面右上角的切换器决定 Skills 与 MCP 当前看到的是哪一层的配置：

- **全部项目共享**：当前 Workspace 的默认层，这个 Workspace 下所有 Project 都能用，也是今天大多数人的使用方式；
- **某个具体 Project**：切到一个 Project 后，Skills/MCP 变成这个 Project 自己的。未单独配置时自动回退展示 Workspace 默认内容；一旦在这个范围下新增过 Skill 或 MCP 服务器，它就变成该 Project 自己的独立配置，不再回退。
- 专家/专家团、API/增强工具、Memory 不受这个切换器影响，始终是全局或工作区级。

### 专家

专家是角色、身份和工作原则的组合。内置方向包括通用软件、驱动、应用、系统、通信、交付管理、架构、测试和代码审查等。

Project 可以设置默认专家，Task 也可以单独选择专家。当前专家注入和 Skills/MCP 合并最明确的使用路径是 Project Task / TaskRunner；普通 Project 会话不要假设一定自动绑定了 Project 专家，应在任务或会话中明确说明需要的角色。

### Skills

Skills 是可复用的工作流、决策规则和 SOP，适合沉淀“以后遇到类似任务应该怎么做”，而不是堆放普通事实。

代表性内置 Skills 包括：

- `myyoda-coach`：优化 MyYoda 使用方式和知识沉淀；
- `skill-creator`：创建、改进和测试 Skill；
- `find-skills`：发现可安装的 Skill；
- `agent-collaboration`：判断并组织协作子会话；
- `automation`：创建和维护自动任务；
- `docx`、`pptx`、`xlsx`：处理专业文档；
- `writing-plans`、`executing-plans`：规划和执行复杂实现；
- `session-cleaner`：清洗和渐进读取会话记录。

实际列表会随版本和 Workspace/Project 配置变化，以 Yoda 插件页面为准。

**在 Project 之间共享 Skill**：切到某个 Project 后，Skills 页面的“导入”按钮会弹出“从工作区默认/其他项目批量导入 Skill”，可以从同一 Workspace 下的其他 Project 或工作区默认里批量勾选导入，不用手动拷文件夹。导入进 Project 的 Skill 不带来源追踪（不支持“一键更新”），需要同步时重新导入一次。工作区级仍然支持从其他工作区导入（“社区市场”旁边的“导入”按钮），两个导入入口不是同一个。

### MCP

MCP 是 Agent 的外部工具扩展机制。可用能力取决于当前范围（Workspace 默认或某个 Project）的 MCP 配置，例如：

- 浏览器导航、截图、DOM、网络与性能分析；
- Automation 自动任务；
- collaboration 协作子会话；
- 创建 Project Task；
- 图像生成或其他外部服务。

在 Yoda 插件的 MCP 页面可以查看、启用、禁用和配置 MCP。使用 `#` 可以在输入框中精准引用某个 MCP。MCP 目前没有跨 Project/工作区的批量导入入口，需要在对应范围下手动逐个添加。

### API / 增强工具

Yoda 插件的 API 页管理应用内增强工具，例如：

- **联网搜索**：当前应用内实现使用 Tavily API，需要配置 Tavily Key；
- **Nano Banana**：图像生成/处理能力，具体可用性取决于配置；
- **自定义 HTTP 工具**：用户定义的 API 工具。

Brave Search 是独立的 MCP Server，不等同于应用内 Tavily 联网搜索。启用 Brave MCP 后，Agent 才能通过对应 MCP 使用它；不要把 Brave Key 填到 Tavily 联网搜索配置中。

---

## 12. 记忆（Memory）与 Project Knowledge

### 记忆（Yoda 插件 → Memory Tab）

打开左侧栏 **Yoda 插件** 后切到 **Memory** Tab（不再是独立的“Yoda 记忆”入口，已并入这里作为六个平级 Tab 之一）。它管理 Workspace 级长期记忆，始终不受页面右上角的 Skills/MCP 切换器影响：

- Workspace 根目录的 `AGENTS.md`（Agent 可写的长期指令文件，旧版本叫 `CLAUDE.md`）；
- `memory/MEMORY.md` 与主题文件（用户画像、协作偏好、纠错与经验等）；
- Workspace 默认工作目录。

页面提供两段式引导：先建立工作区地图与协作画像，再授权从历史会话补证据；也保留一个折叠小链接可以跳过分步、一次性快速生成。记忆适合保存跨 Chat/Project、跨 Project 都成立的规则、偏好、能力约束和稳定经验。它不应变成所有项目过程的流水账。

### Project Knowledge

打开 **Project → Project → 知识**。默认保存在 `projects/{project}/MEMORY.md`；如果 Project 创建时设置为“跟着真实目录走”，则落在 `{workingDirectory}/.context/MEMORY.md`，创建时一次性决定，不会事后迁移。适合记录：

- 当前工程架构；
- 常用命令；
- 技术决策；
- 发布和测试流程；
- 该 Project 特有的注意事项。

也可以从 Project 设置页“Skills / MCP”小节旁边直接跳到 Yoda 插件并自动预选中这个 Project（不需要先回到左侧栏手动找）。

### 作用域选择

| 内容 | 位置 |
|------|------|
| 用户偏好、跨项目经验、Workspace 规则 | 记忆（Yoda 插件 → Memory） |
| 工程架构、命令、项目决策 | Project Knowledge |
| 该 Project 单独的 Skills/MCP 能力集合 | Yoda 插件，切到具体 Project 后的 Skills/MCP Tab |
| 可复用流程和决策树 | Yoda 插件 → Skills |
| 当前任务计划和临时过程 | 会话 `.context/` |
| 可检索的跨项目知识产物 | Yoda 知识库（当前仍是 Preview） |

生成记忆时应先筛选证据，避免把单次过程、临时猜测或某个项目专属事实误写入 Workspace。

---

## 13. Yoda 知识库（Preview）

Chat 左栏的 **Yoda 知识库**是 Workspace 级知识库入口，设计目标是聚合 Chat 与 Project 产出的计划、规范、Project Knowledge 和其他知识产物，供未来跨 Project 检索。

**当前版本仍是占位/规划页面，不提供真正的索引、搜索或 Agent 查询能力。** 当前尚未实现：

- 白名单文件扫描；
- `wiki/INDEX.md` 或等价索引；
- 搜索结果和来源跳转；
- “发布到知识库”动作；
- `wiki-search` Engine Plugin；
- 跨 Project 权限和排除目录规则。

因此现在不要把 Yoda 知识库当作已经可用的全局搜索。需要稳定复用的知识，请写入 Project Knowledge、Workspace Files、记忆（Memory）或 Skill。

未来设计应明确：raw 是知识源文件，不等于源码；知识库是否读取源码必须另行决定。当前规划偏向只索引 MEMORY、plan、spec、设计文档和用户显式发布的产物，不默认扫描源码、密钥、`node_modules` 或构建产物。

---

## 14. Automation 自动任务

自动任务适合无人值守、未来还会运行、结果有持续价值的场景，例如：

- 每天生成项目状态摘要；
- 每周检查依赖或 CI 状态；
- 每隔一段时间监控数据源；
- 两小时后执行一次研究任务；
- 连续观察五次后自动停止。

### 支持的调度方式

- 固定间隔；
- 每日、每周、每月；
- 指定时间执行一次；
- 通过 `maxRuns` 限制最大运行次数。

自动任务还支持选择 Workspace 和模型、暂停/恢复、立即运行、查看运行历史与失败记录，并在适用配置下发送通知。

### 什么时候不该自动化

- 单纯提醒、闹钟或倒计时；
- 每次都需要用户实时判断才能继续；
- 现在就能完成且不会重复的任务；
- 高风险发布、付款或不可逆操作，除非边界已经明确授权。

你可以打开 Project 左栏的 **Task 日历**，也可以直接告诉 Project Agent：“把刚才的流程改成每周一上午自动执行”。

---

## 15. 当前设置与左侧栏入口

**Yoda 插件不在设置页里，是左侧栏的独立全屏入口**（图标直接点击，不需要先打开设置）。“Yoda 记忆”已不再是独立入口，已并入 Yoda 插件作为其中的 **Memory** 子页（详见第 11、12 节）。

当前设置页主要包含：

| 分类 | 功能 |
|------|------|
| **通用设置** | 应用和 Agent 通用行为 |
| **外观设置** | 界面主题与显示偏好 |
| **模型配置** | API 渠道、订阅登录、模型管理 |
| **企业组织技能** | 企业组织 Skill 分发与导入连接配置 |
| **提示词管理** | Chat 提示词配置 |
| **语音输入** | 语音输入配置 |
| **代理设置** | 网络代理 |
| **工作区** | Workspace 创建、切换、重命名和删除 |
| **数据迁移** | 本地数据迁移能力 |
| **磁盘管理** | 本地存储查看和清理 |
| **使用指南** | 打开本教程 |
| **关于/更新** | 版本信息和应用更新 |

左侧栏独立入口（不在上述设置页内）：

| 入口 | 功能 |
|------|------|
| **Yoda 插件** | 专家、专家团、Skills、MCP、API/增强工具、Memory（工作区记忆）六个平级 Tab |
| **Yoda 知识库** | Workspace 级知识聚合入口（当前仍为 Preview，见第 13 节） |

个别 Project 也可以在自己页面的“设置” Tab 里直接跳转到 Yoda 插件并自动预选中自己（见第 7 节）。

---

## 16. 最佳实践

### 先按环境边界选择模式

- 先在 Chat 讨论、阅读和形成结论；
- 需要本地文件、工具、Project 或可保存产物时进入 Project；
- 程序员可以先在 Chat 讨论方案，再迁移到 Project 实施；
- 产品、运营、研究和管理用户也可以在 Project 中处理资料、报告和长期工作流。

### 给任务明确边界

高质量任务通常包含：

1. 目标；
2. 相关文件或 Project；
3. 不能改变的现有行为；
4. 验收标准；
5. 是否先研究、是否需要计划模式；
6. 需要运行的测试。

### 复杂任务先研究再实现

涉及架构、第三方方案移植或高回归风险时，先要求 Agent：

- 调研当前实现；
- 对比候选方案；
- 列出需要保护的既有行为；
- 给出测试矩阵；
- 等你批准后再执行写操作。

### 一个会话聚焦一个目标

任务明显换题时新建会话。需要延续上下文时，可以引用旧会话、Project Knowledge、记忆（Memory）或 `.context/` 文档，而不是无限堆积历史消息。

### 用 Project 管工程，用 Workspace 管能力

- 一个 Workspace 可以服务一个团队、业务域或工作类型；
- 一个 Project 通常对应一个代码仓库或明确业务上下文；
- 不要把 Workspace 根目录当作真实工程目录；
- Project `workingDirectory` 应指向实际代码位置；
- 跨 Project 的稳定规则写入记忆（Memory），项目事实写入 Project Knowledge。

### 修改前保护已有功能

移植第三方方案或新增功能时，推荐逐项执行：

1. 说明功能价值；
2. 对比 MyYoda 当前能力；
3. 识别冲突和回归风险；
4. 决定移植、改良、暂缓或跳过；
5. 小批量实现；
6. 定向测试、全局 typecheck 和独立复审；
7. 每一笔单独提交。

---

## 17. 常见问题排查

### Chat 和 Project 的区别是什么？

Chat 适合思考、阅读、分析和表达；Project 适合接触工作区、文件、工具和持续执行。两者不是“非程序员 vs 程序员”的区别。需要保存本地结果、修改文件或运行命令时，优先选择 Project。

### Project 找不到项目代码

检查会话是否绑定 Project，以及 Project 的 `workingDirectory` 是否正确。会话 cwd 是隔离工作台，不是代码仓库。还要在右侧 Files 面板确认当前查看的是“项目文件”，而不是“会话文件”。

### Workspace 去哪里管理？

打开 **设置 → 连接与数据 → 工作区**。默认用户通常只需要一个 Workspace；多 Workspace 适合工作/私人、客户 A/客户 B 等需要能力和数据隔离的场景。

### Project Knowledge 和记忆（Memory）有什么区别？

Project Knowledge 保存单个 Project 的工程事实；记忆（Yoda 插件 → Memory Tab，旧名“Yoda 记忆”）保存跨 Chat/Project、跨 Project 的稳定规则和用户偏好。不要把所有项目内容都写进 Workspace 级记忆。

### 为什么我在某个 Project 里看不到工作区默认的 Skill 或 MCP？

检查 Yoda 插件页面右上角的切换器——如果当前选中的是一个具体 Project 而不是“全部项目共享”，且这个 Project 已经自己配置过 Skills 或 MCP，它就不会再回退展示工作区默认的内容，两者完全独立。需要工作区默认的能力时，可以在该 Project 的 Skills 页点“导入”，从工作区默认里批量勾选导入需要的项。

### Yoda 知识库为什么没有搜索？

当前 Yoda 知识库只是 Preview/占位入口，索引、检索和发布能力尚未实现。现阶段请使用 Project → 知识、记忆（Memory）、Workspace Files 或 Skills。

### 联网搜索应该填 Tavily 还是 Brave？

Yoda 插件 → API 中的应用内联网搜索使用 Tavily Key。Brave Search 是独立 MCP，只有在 Yoda 插件 → MCP 中启用对应 Server 后，Agent 才能调用。两者配置不要混用。

### Agent 专家什么时候生效？

Project 可以设置默认专家，正式 Project Task 也可以单独选择专家。当前专家、Skills 和 MCP 的注入路径在 TaskRunner 中最明确；普通 Project 会话如需特定专家，应在任务中明确说明。

### 画布为什么不在 Project 文件面板里？

当前 Excalidraw 画布是 Workspace 级资产，没有 Project 归属字段；右侧 Files 面板只定位会话和项目文件。需要项目化归档时，请导出画布并放入 Project 资料，或等待后续 Project 关联能力。

### 模型不可用或提示不支持

检查：

- 渠道是否启用；
- 模型是否仍被供应商支持；
- 当前任务是否真的使用了你选择的渠道和模型；
- 订阅登录是否需要重新授权；
- 网络代理是否正确；
- 当前模式是否支持该渠道。

### Agent 工具或 MCP 不可用

在**左侧栏 Yoda 插件 → MCP**（不在设置页里）中确认已启用，并检查外部命令、Node、npx、API Key 或服务地址是否可用。如果当前页面切到了某个具体 Project，记得确认看的是“全部项目共享”还是这个 Project 自己的配置——两者不同步，很容易看错范围。修改后重新发起一轮 Project 请求；如果外部 MCP 进程或环境仍未刷新，再尝试新建会话或重启应用。

### 自动任务没有运行

检查任务是否启用、触发时间、Workspace、模型配置、最大运行次数和最近运行记录。如果连续失败，先查看失败原因再恢复。

### 看板列和任务状态不一致

这是允许的：列表示用户整理位置，Run 状态表示机器生命周期。根据任务实际情况拖动列、处理“需验收”提示或停止运行，不要把拖列当作运行控制。

### 标题没有反映当前主题

新会话会自动生成标题；长会话会在若干真实用户消息节点重新生成。工具结果不会被误算为用户消息。你也可以随时手动重命名会话。

---

如有疑问，可以直接在 Project 中问：

> 请根据当前 MyYoda 功能告诉我应该用 Chat、Project、Project Task、collaboration 还是 Automation，并说明原因。
