/**
 * workspaceMemoryInitPrompt — Yoda 插件「Memory」子模块的记忆沉淀 Prompt
 *
 * 三条互补路径（对齐 Proma「Agent 技能 > 记忆」的两段式引导，并保留 MyYoda 原有的一键生成）：
 * - buildWorkspaceKnowledgeBootstrapPrompt：建立工作区地图与协作画像（不扫历史会话，更克制）
 * - buildWorkspaceSessionEvidencePrompt：授权会话补证据（分批、限量，需先有协作画像）
 * - buildWorkspaceMemoryInitPrompt：一次性生成（MyYoda 原有，范围内直接读历史会话 + 项目知识）
 *
 * 注意与 Proma 版本的关键差异：MyYoda 系统提示词明确约定 Project 自己工作目录下的
 * AGENTS.md/CLAUDE.md 是人写只读文件，Agent 不得自动创建或修改；因此这里只授权维护
 * 工作区根目录的 AGENTS.md（跨 Project 共享），不像 Proma 那样同时维护"项目根 AGENTS.md"。
 */

export type MemoryHistoryRange = '1m' | '2m' | '3m' | 'all'

export const MEMORY_HISTORY_RANGE_OPTIONS: Array<{ value: MemoryHistoryRange; label: string; promptLabel: string }> = [
  { value: '1m', label: '近 1 个月', promptLabel: '最近 1 个月内' },
  { value: '2m', label: '近 2 个月', promptLabel: '最近 2 个月内' },
  { value: '3m', label: '近 3 个月', promptLabel: '最近 3 个月内' },
  { value: 'all', label: '全部', promptLabel: '全部可用历史' },
]

export function getMemoryHistoryRangeLabel(value: MemoryHistoryRange): string {
  return MEMORY_HISTORY_RANGE_OPTIONS.find((option) => option.value === value)?.promptLabel ?? '最近 1 个月内'
}

/** 工作区级知识演进受管区块；写入工作区根 AGENTS.md，标记为 MyYoda 受管区块，不覆盖用户手写内容。 */
export const WORKSPACE_KNOWLEDGE_MAINTENANCE_BLOCK = `<!-- myyoda:knowledge-maintenance:start -->
## 协作知识演进（MyYoda 维护）

- 保持本文件中的工作区规则与已验证事实同步；命令、架构、边界和入口变化时做最小更新，不复制到长期记忆。
- 工作区的 \`memory/\` 是可扩展的长期协作知识库：\`MEMORY.md\` 只做主题索引和路由，按证据创建用户画像、协作偏好、纠错与经验、决策理由等主题文件；不要把临时过程或长篇证据写入其中。
- 用户画像按具体领域渐进修订，不以"新手/专家"等全局标签定性。只有稳定、会改变未来协作判断的信息才值得维护。若记忆时间敏感、状态会更新，或记录具有后续判断价值的阶段性进展，须在对应正文相邻标注事实/状态的发生、生效或截至时间（至少日期；日内顺序、截止点或时区会影响判断时写明时间和时区），不能用文件修改时间替代；稳定事实无需额外添加时间戳。
- 基于明确、稳定证据的记忆最小增量可直接写入并在完成后说明；仅在删除或大段覆盖、与既有记录冲突、存在不确定推断，或可能涉及敏感个人信息时，先提出候选并取得确认。工作区规则的已验证事实可直接更新。历史会话仅在用户授权后作为分批、限量的补充证据，不得全量扫描。
- 各工作区（项目）的 \`memory/\` 记录该工作区专属的决策与踩坑（工作区 = 项目，项目记忆即工作区记忆），不要写入其他工作区；本文件只沉淀当前工作区内的稳定知识。
<!-- myyoda:knowledge-maintenance:end -->`

/** 第一步：建立可维护的工作区地图与协作画像；不扫历史会话，仅基于当前可验证证据 + 真实对话逐步校准。 */
export function buildWorkspaceKnowledgeBootstrapPrompt(): string {
  return `请开始建立当前工作区的协作知识，但不要把它做成一次性"用户档案"问卷。按以下顺序渐进进行。

## 第一阶段：先建立可维护的工作区规则
用户已授权你主动维护当前工作区根目录的 AGENTS.md（工作区级指令文件，跨 Project 共享）。**不要触碰任何 Project 自己工作目录下的人写 AGENTS.md/CLAUDE.md——那是只读文件，只有用户自己会修改。**

1. 先读取现有工作区 AGENTS.md（若存在），再用最小必要的证据核验：当前工作区下各 Project 的实际情况、常用命令、目录入口、近期相关文档。不要只凭文件名或一般经验猜测。
2. 工作区 AGENTS.md 只负责工作区级的执行环境、跨 Project 命令与工作流约定、以及指向各 Project 自身规则的索引；不要复制某个 Project 的专属事实，也不要枚举已安装 Skills——它们会动态注入系统提示词。
3. 缺失时创建简洁的最小索引；已有时只做可验证的增量更新。优先维护已有 \`<!-- myyoda:... -->\` 区块；没有时只追加受管区块，绝不整体重写、删除或覆盖用户手写规则。
4. 确保工作区 AGENTS.md 包含下方完整的知识演进区块；若已有同名区块，只保留一个并按原内容做最小修订：

${WORKSPACE_KNOWLEDGE_MAINTENANCE_BLOCK}

5. 完成阶段后回复核验来源和更新内容。无需为这份 AGENTS.md 另行请求写入确认。

## 第二阶段：通过真实对话建立协作画像
工作区规则完成后，不要读取历史会话。只在当前回复末尾提出**一个**与本次过程有关、能改善未来协作判断的简短问题，例如用户希望了解解释深度、确认方式，或在当前技术领域的熟悉度。

不要让用户笼统介绍自己或项目。"小白/专业"只能是按领域、可随新证据修订的判断，不能写成全局标签。用户直接回答了稳定协作信息时，可最小创建或更新 memory/user-profile.md，并同步更新 MEMORY.md 的简短路由；在回复中说明写入结果。只有删除/大段覆盖、与既有记录冲突、存在不确定推断或涉及敏感个人信息时，才先复述候选并请求确认。用户跳过时停止追问并正常继续。

## 第三阶段：历史会话只作补证据
本次没有阅读历史会话的授权。等协作画像已有初步内容后，另行邀请用户决定是否授权分批扫描当前工作区的高信号会话。`
}

/** 第二步：授权后分批、限量地用历史会话补充证据（需先有 user-profile.md，即已完成第一步的初步画像）。 */
export function buildWorkspaceSessionEvidencePrompt(historyRange: MemoryHistoryRange): string {
  const rangeLabel = getMemoryHistoryRangeLabel(historyRange)
  const rangeGuidance = historyRange === 'all'
    ? '用户明确选择全部可用历史；仍必须优先近期和高信号会话，并在得到足够证据后停止。'
    : `只处理${rangeLabel}的会话；若证据不足，不得自行扩大范围。`

  return `用户已授权你将当前工作区的历史会话作为**补充证据**，不是全量记忆蒸馏。协作记忆或工作区规则的既有内容仍是优先上下文。

范围与预算：
- ${rangeGuidance}
- 先只查看会话元信息（时间、标题、完成状态）；选择至多 3 个近期、已完成、与当前工作区直接相关的高信号会话作为第一批。
- 对每个入选会话，只读取回答问题所需的摘要或局部片段；不要读取完整原始 JSONL，不要无差别扫描，也不要为了凑数量继续消耗 tokens。
- 每批提炼后判断证据是否已经足够；足够即停止。不足时说明缺口，并由用户决定是否授权下一批。

写入边界：
- 你可以基于已核验的事实，小幅维护当前工作区根目录的 AGENTS.md；不要触碰任何 Project 自己工作目录下的人写 AGENTS.md/CLAUDE.md（只读）。
- 对 memory/ 的用户画像、偏好、纠错、经验和决策理由，基于明确证据的最小增量可直接写入并说明；时间敏感、可更新或有后续价值的过程性内容必须在正文相邻标注对应的发生、生效或截至时间，不能以文件修改时间替代；稳定事实无需额外添加时间戳。只有删除/大段覆盖、冲突、不确定推断或敏感信息才先展示候选并取得确认。
- 不要把会话流水账、一次性任务过程或未经验证的推断写入任何长期文件；不要读取或写入其他工作区的会话或记忆。`
}

/** 一次性生成（MyYoda 原有，保留作为快捷方式）：单个 Agent 会话内完成读取 + 提炼 + 写入的全流程。 */
export function buildWorkspaceMemoryInitPrompt(historyRange: MemoryHistoryRange): string {
  const rangeLabel = getMemoryHistoryRangeLabel(historyRange)
  const rangeGuidance = historyRange === 'all'
    ? '这次处理全部可用历史；如果历史很多，请优先最新、最有代表性和用户实际完成工作的会话，避免把临时过程写入长期记忆。'
    : `如果你认为需要覆盖超过${rangeLabel.replace('最近', '')}的历史，请先在最终回复里建议用户扩大范围；这次默认只处理${rangeLabel}。`

  return `请帮我初始化并沉淀当前工作区的长期记忆。

目标：
1. 读取当前工作区${rangeLabel}的 Agent 工作会话，优先关注最新、最有代表性、用户实际完成工作的会话。如果证据不足，请说明而不是编造。
2. 同时检查当前工作区（项目）的工程根目录 AGENTS.md（项目地图）、工作区记忆（memory/ 含 MEMORY.md 与主题文件）、项目资产，以及会话级 Context（各会话 cwd 下的 .context/）和工作区级 Context（workspace-files/.context/ 及相关本地文档）；必须保留来源工作区，区分工作区专属事实、跨工作区通用知识、当前任务临时产物与跨会话长期资料。
3. 工作区记忆要吸收工程根 AGENTS.md 与既有记忆中对整个工作区有长期价值的稳定知识，而不是只总结工作区根目录文件；工作区专属事实保留在当前工作区记忆中，并在汇总内容中注明来源，避免丢失上下文。
4. 从这些会话、工作区记忆、工程根 AGENTS.md、工作区资料和 Context 中提炼工作区级别的稳定知识，包括工作区结构、常用命令、架构约定、用户偏好、踩坑经验、重要决策和未来 Agent 必须知道的注意事项。
5. 更新工作区根目录的 AGENTS.md：只写稳定、跨会话有价值的工作区指令和工作方式，避免写临时过程和聊天流水账。
6. 更新工作区 memory/MEMORY.md，必要时创建主题文件：MEMORY.md 只放主题索引和路由，详细内容拆到主题文件；只记录应该长期回忆的经验。
7. 沉淀并持续迭代一份「用户画像」记忆，写入 memory/user-profile.md（并在 MEMORY.md 索引中登记）。这份画像用于让未来的 Agent 越来越懂用户，应包含：
   - 用户的角色、技术背景与擅长领域
   - 稳定的工作方式与协作偏好（沟通风格、语言、颗粒度、对确认/自动化的偏好等）
   - 反复出现的关注点、常用工具链和技术栈倾向
   - 明确表达过的好恶、约束和"下次请这样做"的要求
   迭代原则：这是一份会被反复更新的活文档——基于已有内容做增量合并，只在有新证据时新增或修订对应条目，保留仍然成立的旧结论，不要整体推倒重写；对不确定或仅出现一次的信号，标注为"待确认"而非当成稳定画像。
8. 写入长期记忆前先做筛选：只有明确重复出现、用户明确要求记住，或删掉后未来 Agent 明显会犯错的信息才写入；单次弱信号、临时过程和证据不足的判断不要写入，放到最终回复的待确认点里。若记忆时间敏感、会随状态更新，或记录具有后续判断价值的阶段性进展，须在对应正文相邻标注事实/状态的发生、生效或截至时间（至少日期；日内顺序、截止点或时区会影响判断时写明时间和时区），不能用文件修改时间替代；稳定事实无需额外添加时间戳。
9. ${rangeGuidance}

要求：
- 先查看当前工作区可用的会话和文件（包括已有的 user-profile.md），再决定如何写。
- 写入内容要简洁、可维护、方便用户审阅；用户画像要条目化、可追溯，避免笼统空话。
- 优先小幅增量修改，不要为了显得完整而重写已有记忆；MEMORY.md 保持短索引，避免承载长正文。
- 不要删除用户已有的有效内容；发现过时内容时先保守修订或标注。
- 完成后回复：读取了哪些范围、更新了哪些文件、沉淀了哪些关键主题、用户画像这次有哪些新增或修订、还有哪些建议用户确认的点。`
}
