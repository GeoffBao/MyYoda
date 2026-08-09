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
        answer: '工具由当前空间的 MCP、Skills 和内置能力共同决定。会话执行时会显示工具活动；遇到需要确认的操作，MyYoda 会先请求你的授权。',
        keywords: ['MCP', '权限', '技能'],
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
        answer: 'MyYoda 优先使用本地文件保存设置、会话、Project 和附件，不依赖本地数据库。开发模式通常使用 ~/.luxcoder-dev/，正式环境使用 ~/.myyoda/。',
        keywords: ['本地优先', '存储', 'JSONL'],
      },
      {
        question: 'Agent 执行敏感操作时会怎么样？',
        answer: '权限模式决定 Agent 是否需要确认。建议从 safe 或 ask 开始；只有在明确理解风险并且工作目录可信时，才考虑更宽松的权限模式。',
        keywords: ['权限', '安全', '确认'],
      },
      {
        question: '为什么 Agent 没有直接执行某个操作？',
        answer: '可能是权限模式、工具未启用、MCP 未连接，或当前渠道不支持该能力。先查看工具活动和权限提示，再检查空间设置中的 MCP 与 Skills。',
        keywords: ['MCP', '权限模式', '工具'],
      },
    ],
  },
]
