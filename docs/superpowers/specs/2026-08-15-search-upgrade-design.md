# Yoda 搜索升级设计：从 2 类扩展到全量数据源统一搜索

日期：2026-08-15 · 状态：待用户确认

## 一、背景与目标

现状：「Yoda 搜索」（⌘⇧F 唤起的居中弹窗，`YodaSearchView.tsx`）只覆盖 **Chat 对话** 和 **Agent 会话**（标题精确匹配 + 消息内容全文，内容搜索走主进程 IPC），默认态显示最近会话时间分组，另有「Agent 搜索」按钮做 LLM 语义搜索兜底。

用户诉求：把搜索范围扩大到全部数据源——**定时任务、Todo、日程、技能/MCP 插件、项目、看板任务**，以及**发现里的官方内容（文章/视频）和社区讨论**，都要能在同一个搜索入口找到。

## 二、需求澄清结论（对话中已确认，不再讨论）

| 决策点 | 结论 |
|---|---|
| 结果组织方式 | 混合流（Raycast/Spotlight 风格）+ 类型筛选 chip，不做分类 Tab 导航，不做纯分区滚动 |
| 发现-社区讨论搜索范围 | 仅搜本地已缓存的讨论，不发起远程请求（避免延迟和 GitHub API 限流风险） |
| 新类型搜索深度 | 仅标题/名称匹配；正文/语义级搜索交给「Agent 搜索」兜底模式（需扩展其 prompt 覆盖全部数据源，不止 Chat/Agent 会话文件） |
| 展示形态 | 保持居中弹窗，加宽 `max-w`；新增搜索历史记录 |
| 置顶处理 | 不做独立 chip / 独立区块；置顶会话本来就在「会话」类型结果里，行上保留一个小图标标记即可 |
| 技能/MCP 数据 | 打开搜索弹窗时后台预取当前工作区能力（`workspaceCapabilitiesVersionAtom` 已有缓存版本号机制，避免重复拉取） |
| 搜索触发时机 | 改为即时搜索：输入后 ~200ms 防抖自动触发，不再要求手动点搜索/回车 |
| 技术架构 | Provider 架构（见下），而非原地内联扩展或后端统一 IPC |

## 三、整体架构

```
apps/electron/src/renderer/components/app-shell/search/
├── unified-search-types.ts       # UnifiedSearchResult 接口 + SearchResultType 枚举
├── providers/
│   ├── session-provider.ts        # 会话（Chat + Agent，含置顶标记）
│   ├── automation-provider.ts     # 定时任务
│   ├── todo-provider.ts           # Todo
│   ├── calendar-provider.ts       # 日程
│   ├── skills-provider.ts         # 技能 + MCP
│   ├── kanban-task-provider.ts    # 看板任务
│   ├── project-provider.ts        # 项目（工作区）
│   └── discover-provider.ts       # 发现（官方内容 + 已缓存社区讨论）
├── unified-search-model.ts        # runUnifiedSearch() 编排 + 排序 + chip 过滤 + 结果截断
├── search-history.ts              # 搜索历史（atomWithStorage 持久化，去重 + 最大条数）
└── __tests__/                     # 每个 provider + model 独立单测
```

`YodaSearchView.tsx` 保留现有壳子（Dialog 容器、输入框、快捷键、键盘导航骨架），内部渲染改为消费 `runUnifiedSearch()` 输出；Chat/Agent 现有全文搜索 IPC 调用不变，收纳进 `session-provider.ts`。

**为什么是 Provider 架构而非原地扩展**：现有组件已 500+ 行，9 类数据源如果继续内联会让排序、点击跳转、UI 渲染逻辑相互缠绕，无法单独测试某一类型的匹配正确性。Provider 模式让每类数据源是独立纯函数，符合项目里已有的「纯函数 + 单测」惯例（`search-dialog-model.ts`、`yoda-search-view.test.ts` 里的 `getDateGroupLabel`/`groupRecentByDate`），后续加新类型（知识库、Repo Wiki）只需新增一个 provider 文件。

**为什么不做后端统一 IPC**：新增的 6 类数据（定时任务/Todo/日程/看板任务/项目/技能）本来就完整同步在渲染进程 atom 里，搬到主进程会制造一份可能与 atom 不同步的数据副本，纯增复杂度。会话正文全文搜索本来就是 IPC（消息存 JSONL 文件），这部分不变。

## 四、数据模型

```ts
export type SearchResultType =
  | 'session-chat' | 'session-agent'
  | 'automation' | 'todo' | 'calendar'
  | 'skill' | 'mcp'
  | 'kanban-task' | 'project'
  | 'discover-official' | 'discover-discussion'

export interface UnifiedSearchResult {
  id: string                   // 结果 key（配合 type 唯一）
  type: SearchResultType
  title: string                 // 命中后展示的标题/名称
  subtitle?: string             // 次要信息：项目名/工作区名/日期/状态
  matchStart: number             // 标题内命中位置，复用现有 HighlightText 高亮
  matchLength: number
  matchScore: number             // 直接复用 findBestSearchMatch().score（已有 exact/fragment/fuzzy 三档评分）
  sortKey: number                 // 用于排序的时间戳：updatedAt / dueAt / startAt 等按类型语义各异，统一转成 ms 时间戳
  pinned?: boolean                // 仅 session 类型可能为 true
  archived?: boolean              // 归档/已完成，视觉降权但仍可搜到
  onSelect: () => void            // 点击跳转，由 provider 构造时闭包好
}
```

每个 provider 是纯函数：

```ts
export function searchSessions(query: string, ctx: SessionSearchContext): UnifiedSearchResult[]
export function searchAutomations(query: string, automations: Automation[]): UnifiedSearchResult[]
export function searchTodos(query: string, todos: Todo[]): UnifiedSearchResult[]
export function searchCalendarEvents(query: string, events: CalendarEvent[]): UnifiedSearchResult[]
export function searchSkillsAndMcp(query: string, capabilities: WorkspaceCapabilities | null): UnifiedSearchResult[]
export function searchKanbanTasks(query: string, projects: KanbanProject[]): UnifiedSearchResult[]
export function searchProjects(query: string, workspaces: AgentWorkspace[]): UnifiedSearchResult[]
export function searchDiscover(query: string, feed: DiscoverFeedItem[], cachedDiscussions: DiscussionSummary[]): UnifiedSearchResult[]
```

匹配逻辑统一复用 `findBestSearchMatch(title, query)`（`@myyoda/shared`）：命中返回 `{ matchStart, matchLength, score, kind }`，未命中返回 `null` 直接过滤掉。这样不用为每个 provider 重新发明匹配算法，评分体系也天然统一。

**`sortKey` 取值来源**（避免实现时歧义）：

| 类型 | sortKey 来源 |
|---|---|
| 会话（chat/agent） | `updatedAt` |
| 定时任务 | 最后一次运行时间，无则创建时间 |
| Todo | `dueAt`（无截止时间则用创建时间） |
| 日程 | `startAt` |
| 技能/MCP | 安装/启用时间，无则靠后固定排序（不参与时间排序竞争） |
| 看板任务 | `updatedAt` |
| 项目（工作区） | `updatedAt`（无则用 `createdAt`） |
| 发现-官方内容 | 发布时间 |
| 发现-社区讨论 | 最后回复时间（无回复则创建时间） |

`onSelect` 带副作用，不适合在纯函数单测里断言效果；provider 单测只测**匹配是否命中、字段是否正确**，跳转正确性由第七节的映射表规范 + model 层集成测试覆盖。

## 五、排序算法

```ts
function computeSortScore(result: UnifiedSearchResult): number {
  // matchScore 已经是 0~1000+ 的量级（exact=1000, fragment=700~900, fuzzy 更低），
  // 直接作为主排序键；sortKey 归一化成 0~1 的小数作为同分时的新鲜度 tie-breaker。
  const recencyBoost = Math.min(1, result.sortKey / Date.now())
  return result.matchScore + recencyBoost
}
```

- **主排序**：匹配质量（`findBestSearchMatch` 的 score，精确匹配显著高于模糊匹配）
- **次排序**：新鲜度（sortKey 越新越靠前），只在匹配质量接近时起作用，量级刻意压到 0~1，不会盖过匹配质量差异
- **不做**类型权重、"今天到期"特殊 boost 等花活——先按 YAGNI 做最简单可预测的版本，如果用完发现某类型该被优先看到，再加

**每类型结果条数限制**：每个 provider 默认最多返回 8 条参与混合排序，避免看板任务这种量大的类型淹没其他类型；选中某个类型 chip 后，该类型不再受 8 条限制（放宽到 30 条，翻页留到后续需要时再做）。

## 六、UI 布局与交互

**输入框下方 chip 行**：把 11 个 `SearchResultType` 收敛成 7 个可点 chip——`全部 / 会话 / 定时任务 / 计划 / 项目 / 插件 / 发现`（定时任务+计划分开是因为计划本身在侧边栏就是独立入口；技能与 MCP 合并成"插件"一个 chip，看板任务归入"项目" chip，因为看板任务始终挂在项目下）。chip 只在当前结果集里有对应类型的结果时才显示，动态生成，不常驻空 chip。chip 带类型内命中数徽标。

**空输入态**（弹窗刚打开、query 为空）：
1. 快捷操作（新建对话/新建 Agent 会话，不变）
2. **搜索历史**（新增）：最近 8 条历史关键词横向 chip 或纵向列表，点击直接填入并触发搜索；一个「清空」小按钮
3. 最近会话时间分组（不变）

**有输入态**：query ≥ 2 字符后 200ms 防抖自动触发（不再需要点搜索按钮/回车），中文输入法 composition 过程中不触发（沿用现有 `isComposingRef` 拦截逻辑）。结果按第五节排序后渲染成统一列表，每行左侧图标区分类型（不再按"标题匹配/内容匹配"分区块标题，因为已经是混合流），chip 起筛选作用而不是分区作用。

**键盘导航**：↑↓ 选择、Enter 打开选中项、Esc 清空/关闭——语义不变，只是 Enter 不再需要承担"触发搜索"的双重职责（即时搜索后，Enter 只做"打开"）。

**「Agent 搜索」按钮**：保留原样式和位置，作为深度语义搜索兜底；prompt 需要扩展，说明搜索范围包括定时任务配置、Todo/日程、技能描述、看板任务、项目、发现内容，不再局限于「Chat/Agent 会话文件」。

**说明看着还行吗？** 接下来发第七节（点击跳转映射表，这个我会顺带列出需要新增的 3 个轻量定位 atom）和第八节（边界情况 + 测试计划），发完这两节我就直接把完整设计文档写好提交。

## 七、点击跳转映射表

| 类型 | 跳转行为 | 复用/新增机制 |
|---|---|---|
| 会话-Chat | `openSession('chat', id, title)` | 现有，不变 |
| 会话-Agent | `openSession('agent', id, title)` | 现有，不变 |
| 定时任务 | `setAutomationForm({ open: true, draft })` 直接打开编辑表单 | 现有（`PlanningView.tsx` 已有此调用模式） |
| Todo | `setActiveView('planning')` + `planningTabAtom='todos'` + `planningSelectedTodoIdAtom=id` 定位到具体项 | 现有 atom，直接复用 |
| 日程 | `setActiveView('planning')` + `planningTabAtom='calendar'` + 定位到具体事件 | **新增** `planningSelectedCalendarEventIdAtom`（照抄 `planningSelectedTodoIdAtom` 的模式） |
| 技能 | `setActiveView('agent-skills')` + `agentSkillsTabAtom='skills'` + 定位到具体技能 | **新增** `agentSkillsSelectedSlugAtom`（`AgentSkillsView.tsx` 目前用本地 `useState` 管理选中技能，改成 atom 供外部写入） |
| MCP | `setActiveView('agent-skills')` + `agentSkillsTabAtom='mcp'` | 现有（MCP 数量通常个位数，不做精确定位，只切 tab） |
| 看板任务 | `pendingTaskEditorTargetAtom = resolveTaskEditorTarget(item)` 打开任务编辑器 | 现有（`task-editor-model.ts` 已有 `resolveTaskEditorTarget`） |
| 项目 | `selectWorkspace(id)` + `setActiveProjectPageId(id)` + `setProjectPageTab('overview')` + `setCodeMainView('project')` | 现有（复用 `SidebarProjectsTab.openWorkspacePage` 同款调用序列） |
| 发现-官方内容 | `setActiveView('discover')` + `discoverTabAtom='featured'` + 定位到具体条目 | **新增** `discoverSelectedItemIdAtom`；若定位到具体条目工作量超预期，可先降级为只切 tab 不定位，作为 P1 而非 P0 |
| 发现-社区讨论 | `setActiveView('discover')` + `discoverTabAtom='community'` + `discussionCategoryAtom` 对齐 + 打开该讨论详情 | **新增** `discoverPendingDiscussionNumberAtom`；沿用 `getDiscussion()` 现有加载逻辑 |

新增 3 个轻量"待定位"atom，都沿用项目里 `planningSelectedTodoIdAtom` 已验证过的模式（一个 `atom<string | number | null>`，目标视图挂载时读取一次并消费掉），风险低、改动面小。

## 八、边界情况与测试计划

**边界情况**：
- 某类型数据源为空（如没有任何定时任务）：provider 返回空数组，不报错；该类型 chip 不出现（chip 基于当前结果集动态生成）
- Skills/MCP 预取 IPC 失败：静默降级、控制台打印错误，不影响其他类型结果渲染（沿用现有「内容搜索失败」的 catch 模式）
- 搜索历史持久化写入失败：不影响搜索功能本身，历史区退化为空列表
- 归档会话 / 已完成 Todo / 已归档项目：默认仍纳入搜索结果，视觉上沿用现有 `archived` 灰化 + 图标标记处理，不隐藏（找旧东西也是搜索的合理场景）
- 中文输入法 composition 中：不触发防抖搜索，沿用现有 `isComposingRef` 判断

**测试计划**：
- 每个 provider 一个测试文件：给定 mock 数据 + 关键词，断言命中/不命中、字段正确性、`matchStart`/`matchLength` 正确
- `unified-search-model.test.ts`：多 provider 结果混合排序正确性、chip 过滤正确性、单类型结果截断（8 条/30 条）正确性
- `search-history.test.ts`：写入去重、最大条数截断、清空
- 现有 `yoda-search-view.test.ts` 里的纯函数测试（`getDateGroupLabel`/`groupRecentByDate`/`formatRelativeTime`）保留不动
- 遵循项目现有倾向：纯函数测试为主，`YodaSearchView.tsx` 本身不追加大量组件级测试

## 九、建议实施顺序

给 writing-plans 拆步时的参考分组（不是强制要求，只是建议）：

1. **基础架构**：`unified-search-types.ts` + `unified-search-model.ts` + `search-history.ts` 骨架，先用现有 session-provider 跑通整条链路（验证架构可行，不引入新风险）
2. **无需新增 atom 的 5 个 provider**：定时任务、Todo、看板任务、项目、技能/MCP（MCP 只切 tab 不定位）——都复用现有跳转机制，风险最低
3. **需新增 3 个定位 atom 的 2 个 provider**：日程、技能精确定位
4. **发现 provider**：官方内容 tab 级跣转先上，条目级定位作为 P1 后续补上（社区讨论需要定位到具体讨论，因为不定位体验会很差，优先级高于官方内容）
5. **UI 改造**：chip 行、搜索历史、防抖即时搜索，接入统一模型层
6. **Agent 搜索兼底 prompt 扩展**

## 十、范围说明（本次不做）

- 发现-社区讨论的远程实时搜索（已决策：仅搜本地缓存）
- 新类型的正文/描述全文检索（已决策：交给 Agent 搜索语义兜底）
- 结果排序的类型权重/紧急度 boost（YAGNI，用后觉得需要再加）
- 发现-官方内容条目级精确定位（如工作量超预期，可先做 tab 级降级）
