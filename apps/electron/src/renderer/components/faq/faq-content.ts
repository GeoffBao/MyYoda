/**
 * MyYoda FAQ 内容。
 *
 * 这里保持为独立数据源，后续可以同时供新手引导、帮助中心和文档索引使用。
 */

export interface FaqItem {
  question: string
  answer: string
  keywords?: string[]
}

export interface FaqGroup {
  id: string
  topic: string
  description: string
  items: FaqItem[]
}

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'getting-started',
    topic: '开始使用',
    description: '先理解 MyYoda 的几个核心概念。',
    items: [
      {
        question: 'Chat、Code 和 Project 分别是什么？',
        answer: 'Chat 适合快速问答，Code 适合让 Agent 规划并执行任务，Project 是长期工作的容器，负责组织会话、工作目录、文件和项目记忆。',
        keywords: ['模式', '项目', '会话'],
      },
      {
        question: '第一次使用应该从哪里开始？',
        answer: '先在设置中添加一个 AI 渠道，然后新建一个 Project，确认工作目录后再创建 Chat 或 Code 会话。复杂任务优先使用 Code。',
        keywords: ['渠道', 'API Key', '新建项目'],
      },
      {
        question: '我可以只使用自己的模型 API 吗？',
        answer: '可以。MyYoda 支持配置 Anthropic、OpenAI、Google、DeepSeek、智谱、MiniMax、通义千问等渠道，也支持自定义 OpenAI 兼容端点。',
        keywords: ['Provider', '模型', '自定义端点'],
      },
      {
        question: '第一次任务应该怎么写？',
        answer: '建议同时写清目标、范围、限制和验收标准。先从一个可以在几分钟内验证的小任务开始，再把有效做法沉淀到 Project 记忆或 Skill。',
        keywords: ['提示词', '任务描述', '入门'],
      },
      {
        question: '什么时候应该新建 Project？',
        answer: '当工作需要固定目录、持续积累文件和记忆，或者会反复执行同一类流程时，就应该创建 Project；一次性问答不必创建。',
        keywords: ['新建项目', '长期工作', '工作流'],
      },
    ],
  },
  {
    id: 'agent',
    topic: 'Agent 与专家',
    description: '了解 Code 模式如何完成实际工作。',
    items: [
      {
        question: '什么时候应该使用 Code？',
        answer: '当任务需要读写文件、调用工具、执行命令、修改代码或经过多步验证时使用 Code。简单事实查询和短问答用 Chat 更快。',
        keywords: ['Agent', '工具', '执行'],
      },
      {
        question: 'Agent 专家和普通会话有什么区别？',
        answer: '专家是带有明确领域角色和工作方法的可复用配置。创建会话或任务时选择专家，Agent 就会结合对应的 Skills 和提示词工作。',
        keywords: ['专家', 'Skills', '角色'],
      },
      {
        question: 'Agent 可以调用哪些工具？',
        answer: '工具由当前工作区的 MCP、Skills 和内置能力共同决定。社区市场提供 60+ 可安装 Skill，覆盖文档、视频、代码审查等场景。会话执行时右侧面板实时显示工具活动；遇到需要确认的操作，MyYoda 会先请求你的授权。',
        keywords: ['MCP', '权限', '技能', '社区市场'],
      },
      {
        question: 'Code 模式现在用的什么 Runtime？',
        answer: 'v0.8.0 起统一使用 Pi Agent SDK 作为 Code Agent 的唯一执行引擎，不再区分 Claude Code CLI 和 Pi 两套 runtime。所有渠道的 Agent 会话行为一致，不再有双 runtime 的兼容差异。',
        keywords: ['Runtime', 'Pi', 'SDK', '执行引擎'],
      },
      {
        question: '怎样让 Agent 更容易一次做对？',
        answer: '提供相关文件或目录，明确目标和边界，并要求它先检查再行动、完成后运行验证。不要把多个无关目标混在同一个会话里。',
        keywords: ['上下文', '验收', '提示词'],
      },
      {
        question: '长任务应该一直放在同一个会话里吗？',
        answer: '不建议无限延长。一个会话尽量聚焦一个小目标；阶段性结论写入 Project 文件或记忆，再开新会话继续，能让上下文更干净。',
        keywords: ['会话', '长任务', '上下文'],
      },
    ],
  },
  {
    id: 'projects-files',
    topic: 'Project 与文件',
    description: '把长期工作放在正确的层级。',
    items: [
      {
        question: 'Project 和工作目录是什么关系？',
        answer: 'Project 是 MyYoda 内的组织和上下文容器，工作目录是它实际读写文件的本地目录。一个 Project 可以绑定一个明确的代码库或资料目录。',
        keywords: ['工作目录', 'cwd', '文件夹'],
      },
      {
        question: '会话文件和 Project 文件有什么区别？',
        answer: '会话文件服务于当前会话，适合临时附件和一次性材料；Project 文件属于整个 Project，适合共享资料、规则、脚本和长期产物。',
        keywords: ['附件', '项目文件', '共享'],
      },
      {
        question: 'Project 记忆会保存什么？',
        answer: 'Project 记忆用于沉淀稳定规则、技术约定、偏好和已确认结论。它会随 Project 注入相关 Agent 会话，不等同于完整的聊天记录。',
        keywords: ['MEMORY.md', '上下文', '规则'],
      },
      {
        question: '会话文件、Project 文件和 Workspace 文件怎么区分？',
        answer: '当前任务的临时材料放会话文件；项目内多个会话共享的资料放 Project 文件；跨 Project 通用的资料和规则放 Workspace 文件。',
        keywords: ['文件组织', 'Workspace', '附件'],
      },
      {
        question: '什么时候应该把内容写进记忆？',
        answer: '只有稳定、反复有用且已经确认的规则、偏好和结论才适合写入记忆。临时想法、未验证结论和一次性任务记录应留在会话或 Project 文件中。',
        keywords: ['记忆', 'MEMORY.md', '最佳实践'],
      },
    ],
  },
  {
    id: 'skills-market',
    topic: 'Skills 与社区市场',
    description: '使用和发现可复用的 Agent 能力。',
    items: [
      {
        question: '社区市场里有哪些 Skill？',
        answer: '社区市场包含 60+ 个 Skill，覆盖文档处理（PDF/PPTX/XLSX）、视频创作（HyperFrames）、前端设计、演示制作、代码审查、知识管理、微信读书等场景。本地维护的 19 个 Skill 可直接安装，另外 44 个外部收录的 Skill 一键拉取安装。',
        keywords: ['社区市场', 'Skill', '安装', '外部'],
      },
      {
        question: 'Skill 的版本和下载量是什么意思？',
        answer: '版本号表示 Skill 的最新迭代，下载量反映社区的使用热度。你可以参考这些指标来选择更成熟、更活跃的 Skill。',
        keywords: ['版本', '下载量', '热度'],
      },
      {
        question: '外部收录的 Skill 和本地托管的有什么区别？',
        answer: '本地托管的 Skill 由 MyYoda 维护并保证兼容性；外部收录的 Skill 从原作者的 GitHub 仓库直接拉取安装，版本跟随上游更新。两者安装后使用方式一致。',
        keywords: ['外部', '托管', '上游'],
      },
      {
        question: '我想创建自己的 Skill 并分享，该怎么做？',
        answer: '使用 skill-creator 从零创建或优化现有 Skill，完成后提交到 myyoda-skills 仓库的 PR。社区市场会自动拉取并通过版本号跟踪更新。',
        keywords: ['创建', '分享', '贡献'],
      },
    ],
  },
  {
    id: 'work',
    topic: '任务与自动化',
    description: '让重复工作可以被安排、追踪和复盘。',
    items: [
      {
        question: 'Task 看板和普通会话是什么关系？',
        answer: 'Task 是 Project 中可追踪的工作项，可以绑定专家、列状态和执行结果；运行时仍然通过 Code Agent 完成，过程可在对应会话中查看。',
        keywords: ['Task', 'Kanban', '看板'],
      },
      {
        question: '自动任务需要 MyYoda 一直运行吗？',
        answer: '需要。自动任务由本地应用调度，应用退出时不会在云端继续执行。每次运行都会保留状态、耗时和结果，方便回看失败原因。',
        keywords: ['定时任务', '调度', '运行历史'],
      },
      {
        question: '任务执行失败后怎么办？',
        answer: '先打开运行记录查看失败阶段和 Agent 输出，再从对应会话继续修复。可以调整渠道、权限模式或工作目录后重新运行。',
        keywords: ['失败', '重试', '运行记录'],
      },
      {
        question: 'Task 和普通 Agent 会话应该怎么选？',
        answer: '需要状态、负责人、列流转、依赖或可复盘运行记录时使用 Task；只是临时讨论或一次性执行时，普通 Agent 会话更轻量。',
        keywords: ['Task', '会话', '看板'],
      },
      {
        question: '自动任务适合安排什么？',
        answer: '适合定期检查、汇总、同步和生成固定格式报告等重复流程。第一次使用时先手动跑通流程，再设置频率和最大运行次数。',
        keywords: ['Automation', '定时任务', '报告'],
      },
    ],
  },
  {
    id: 'knowledge',
    topic: 'Yoda 知识库',
    description: '让项目产物逐渐变成可检索的团队知识。',
    items: [
      {
        question: 'Yoda 知识库现在适合放什么？',
        answer: '适合沉淀已经确认的项目文档、研究结论、操作规范和可复用经验。原始材料仍建议保留在本地 Raw 或 Project 文件中。',
        keywords: ['知识库', 'Wiki', '文档'],
      },
      {
        question: '个人知识库和企业知识库有什么区别？',
        answer: '个人知识库面向你的工作上下文，企业知识库面向团队共享内容。当前不同部署的可用范围和同步能力可能不同，以实际界面和管理员配置为准。',
        keywords: ['企业版', '团队', '共享'],
      },
    ],
  },
  {
    id: 'integrations',
    topic: '集成与 CodeClaw',
    description: '连接团队协作入口和桌面工作流。',
    items: [
      {
        question: '可以从飞书或钉钉使用 MyYoda 吗？',
        answer: '如果已配置对应的集成，可以接收消息、同步任务或发送通知。远程执行能力取决于当前部署和权限配置，不应把桌面端的全部能力默认视为可远程使用。',
        keywords: ['飞书', '钉钉', '远程'],
      },
      {
        question: 'CodeClaw 是做什么的？',
        answer: 'CodeClaw 是 MyYoda 的桌面陪伴与状态展示能力，用来呈现 Agent 工作状态和主题化角色体验。它不替代 Project、Task 或 Agent 本身。',
        keywords: ['CodeClaw', '主题', '状态'],
      },
    ],
  },
  {
    id: 'privacy',
    topic: '数据与权限',
    description: '知道数据在哪里，以及每一步谁在做决定。',
    items: [
      {
        question: '我的数据默认保存在哪里？',
        answer: 'MyYoda 优先使用本地文件保存设置、会话、Project 和附件，不依赖本地数据库。开发模式通常使用 ~/.myyoda-dev/，正式环境使用 ~/.myyoda/。',
        keywords: ['本地优先', '存储', 'JSONL'],
      },
      {
        question: 'Agent 执行敏感操作时会怎么样？',
        answer: '权限模式决定 Agent 是否需要确认。建议从 safe 或 ask 开始；只有在明确理解风险并且工作目录可信时，才考虑更宽松的权限模式。v0.8.0 新增了多层文件安全边界策略，防止 Agent 越权访问工作区之外的文件。',
        keywords: ['权限', '安全', '确认', '边界'],
      },
      {
        question: 'MyYoda 如何保护我的文件安全？',
        answer: 'v0.8.0 全面加固了文件安全：Agent 上传拒绝路径穿越和符号链接绕过；IPC 通信收窄了授权根范围；存储清理在索引损坏时 fail-closed 不再误删；工作区元数据和恢复区全面纳入白名单保护。',
        keywords: ['文件安全', '路径穿越', '符号链接', '清理'],
      },
      {
        question: '为什么 Agent 没有直接执行某个操作？',
        answer: '可能是权限模式、工具未启用、MCP 未连接，或当前渠道不支持该能力。先查看工具活动和权限提示，再检查工作区设置中的 MCP 与 Skills。',
        keywords: ['MCP', '权限模式', '工具'],
      },
    ],
  },
  {
    id: 'troubleshooting',
    topic: '故障排查',
    description: '先定位问题所在层级，再决定是重试还是调整配置。',
    items: [
      {
        question: '模型配置成功，但 Agent 不能执行怎么办？',
        answer: '先确认当前会话使用的渠道和模型，再检查权限模式、工作目录和工具是否启用。Chat 能回答不代表该模型一定支持完整的 Code 执行能力。',
        keywords: ['模型', 'Agent', '执行失败', '渠道'],
      },
      {
        question: 'Agent 为什么找不到我的文件？',
        answer: '检查会话是否绑定了正确的 Project，以及 Project 的工作目录是否指向真实目录。必要时在任务中明确写出文件路径或使用文件引用。',
        keywords: ['文件', '工作目录', 'Project', '路径'],
      },
      {
        question: '权限提示太多，应该怎么设置？',
        answer: '建议从 safe 或 ask 模式开始，只对可信工作目录和明确理解的操作放宽权限。不要为了省确认而直接使用最宽松的模式。',
        keywords: ['权限', 'safe', 'ask', '安全'],
      },
      {
        question: 'MCP 或 Skill 没有生效怎么办？',
        answer: '先确认当前 Workspace 已启用对应能力，再检查工具活动里是否出现调用记录。变更 MCP 或 Skill 后，必要时重新打开会话让能力上下文刷新。',
        keywords: ['MCP', 'Skill', 'Workspace', '工具'],
      },
    ],
  },
]
