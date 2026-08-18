# 项目目录失效可恢复 + 默认工作区目录落地 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 项目目录失效时提供一键恢复动作（重新关联/关联到探测候选/设置默认目录），未绑定项目会话的 cwd 落到"默认工作区目录"（失效降级沙箱不阻断），首次启动 Onboarding 引导设置默认目录。

**Architecture:** 纯函数先行（cwd 决策、候选探测），再接入主进程 preflight 链路，最后补渲染进程 action 处理与 Onboarding 步骤。全部复用现有能力（RELOCATE_WORKING_DIRECTORY IPC、setAgentDefaultWorkingDirectory IPC、openFolderDialog、buildProjectPageNavigation、settingsTab），类型定义零改动（RecoveryAction.action 为开放字符串联合）。

**Tech Stack:** Electron 主进程 + React 渲染进程（bun 构建、bun:test 单测）、jotai 状态。

**设计文档:** `docs/superpowers/specs/2026-08-18-project-dir-unavailable-recovery-design.md`

**验证命令:**
- 单测: `bun test apps/electron/src/main/lib/<file>.test.ts`
- 全量: `bun test`
- 类型: `bun run typecheck`
- 提交（每个 Task 末尾）: 附加 trailer `Co-Authored-By: MyYoda <MyYoda@noreply.github.com>`

---

### Task 1: cwd 决策插入默认工作区目录（纯函数 + 单测）

**Files:**
- Modify: `apps/electron/src/main/lib/agent-cwd-resolver.ts`
- Test: `apps/electron/src/main/lib/agent-cwd-resolver.test.ts`

**Step 1: 写失败测试（追加到 agent-cwd-resolver.test.ts 末尾，describe 内）**

```ts
  test('默认工作区目录命中 → 使用 default-workspace cwd', () => {
    const result = resolveSessionCwd({
      defaultWorkingDirectory: '/Users/dev/default-workspace',
      sandboxCwd: SANDBOX,
    })
    expect(result).toEqual({ cwd: '/Users/dev/default-workspace', source: 'default-workspace' })
  })

  test('未绑定 Project 且配置默认目录 → 使用默认目录而非沙箱', () => {
    const result = resolveSessionCwd({
      agentCwdMode: 'project',
      resolveProjectCwd: projectResolver(null),
      defaultWorkingDirectory: '/Users/dev/default-workspace',
      sandboxCwd: SANDBOX,
    })
    expect(result).toEqual({ cwd: '/Users/dev/default-workspace', source: 'default-workspace' })
  })

  test('project 命中优先于默认工作区目录', () => {
    const result = resolveSessionCwd({
      agentCwdMode: 'project',
      projectId: 'proj-1',
      resolveProjectCwd: projectResolver({ status: 'external', cwd: PROJECT_DIR, displayPath: PROJECT_DIR }),
      defaultWorkingDirectory: '/Users/dev/default-workspace',
      sandboxCwd: SANDBOX,
    })
    expect(result).toEqual({ cwd: PROJECT_DIR, source: 'project' })
  })

  test('workspace 根目录优先于默认工作区目录', () => {
    const result = resolveSessionCwd({
      workspaceProjectRootPath: '/Users/dev/ws-root',
      defaultWorkingDirectory: '/Users/dev/default-workspace',
      sandboxCwd: SANDBOX,
    })
    expect(result).toEqual({ cwd: '/Users/dev/ws-root', source: 'workspace-root' })
  })
```

**Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/main/lib/agent-cwd-resolver.test.ts`
Expected: 新增 4 个用例 FAIL（`defaultWorkingDirectory` 属性不存在 / source 不匹配）

**Step 3: 实现**

`apps/electron/src/main/lib/agent-cwd-resolver.ts` 三处修改：

```ts
export interface ResolveSessionCwdInput {
  gitWorktreePath?: string
  workspaceProjectRootPath?: string
  agentCwdMode?: 'session' | 'project'
  projectId?: string
  resolveProjectCwd: (projectId: string) => EffectiveCwdResult | null
  /** 应用级默认工作区目录：未绑定项目且未命中更高优先级时的工程代码目录 */
  defaultWorkingDirectory?: string
  sandboxCwd: string
}

export type SessionCwdSource = 'worktree' | 'workspace-root' | 'project' | 'default-workspace' | 'sandbox'
```

`resolveSessionCwd` 中 project 分支之后、sandbox 兜底之前插入：

```ts
  if (input.defaultWorkingDirectory) {
    return { cwd: input.defaultWorkingDirectory, source: 'default-workspace' }
  }
```

**Step 4: 运行测试确认通过**

Run: `bun test apps/electron/src/main/lib/agent-cwd-resolver.test.ts`
Expected: 全部 PASS（含原有用例）

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/agent-cwd-resolver.ts apps/electron/src/main/lib/agent-cwd-resolver.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(agent): cwd 决策支持默认工作区目录 (source: default-workspace)"
```

---

### Task 2: orchestrator 传入默认目录（含失效降级）

**Files:**
- Modify: `apps/electron/src/main/lib/agent-orchestrator.ts`

**Step 1: 确认 import 现状**

在文件顶部确认已从 `node:fs` import `existsSync` / `statSync`（无则加），并确认 `getAgentWorkspacePath` 已 import（agent-workspace-manager）。若 `getAgentDefaultWorkingDirectory` 未 import，在 agent-workspace-manager import 列表补上：

```ts
getAgentDefaultWorkingDirectory,
```

**Step 2: 新增模块级辅助函数（放在 `reportPreflightError` 定义之前）**

```ts
/**
 * 会话默认工作区目录：应用设置 + 存在性检查。
 * 失效/不可访问时返回 undefined（会话降级到隔离沙箱，不阻断启动）。
 */
function resolveDefaultWorkingDirectoryForSession(): string | undefined {
  const configured = getAgentDefaultWorkingDirectory()
  if (!configured) return undefined
  try {
    if (!existsSync(configured) || !statSync(configured).isDirectory()) {
      console.warn(`[Agent 编排] 默认工作区目录不可用，回退会话沙箱: ${configured}`)
      return undefined
    }
    return configured
  } catch (err) {
    console.warn(`[Agent 编排] 默认工作区目录检查失败，回退会话沙箱: ${configured}`, err)
    return undefined
  }
}
```

**Step 3: resolveSessionCwd 调用处传入（约 1283 行）**

在 `const cwdResolution = resolveSessionCwd({` 的入参对象中加一行：

```ts
          const cwdResolution = resolveSessionCwd({
            gitWorktreePath: sessionMeta?.gitWorktreePath ?? activeWorktree?.path,
            workspaceProjectRootPath: ws.projectRootPath,
            agentCwdMode: sessionMeta?.agentCwdMode,
            projectId: sessionMeta?.projectId,
            defaultWorkingDirectory: resolveDefaultWorkingDirectoryForSession(),
            resolveProjectCwd: (projectId) => projectRepository.resolveEffectiveCwdForProject(getAgentWorkspacePath(ws.slug), projectId),
            sandboxCwd,
          })
```

**Step 4: 验证编译与测试**

Run: `bun run typecheck`
Expected: 无错误（agent-cwd-resolver 单测已覆盖决策分支）

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/agent-orchestrator.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(agent): 未绑定项目会话 cwd 使用默认工作区目录，失效降级沙箱"
```

---

### Task 3: 候选探测函数 findRelocationCandidates（纯函数 + 单测）

**Files:**
- Modify: `apps/electron/src/main/lib/project-path-service.ts`
- Test: `apps/electron/src/main/lib/project-path-service.test.ts`

**Step 1: 写失败测试（追加到 project-path-service.test.ts）**

使用临时目录（bun:test 支持 `mkdtempSync`），测试前先确认该测试文件已有 `describe` 结构：

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findRelocationCandidates, isRelocationCandidate } from './project-path-service'

function makeTempParent(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reloc-candidates-'))
  afterAll(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

describe('isRelocationCandidate', () => {
  test('完全同名（大小写不敏感）', () => {
    expect(isRelocationCandidate('LuxAgents', 'LuxAgents')).toBe(true)
    expect(isRelocationCandidate('luxagents', 'LuxAgents')).toBe(true)
  })
  test('去复数 s', () => {
    expect(isRelocationCandidate('LuxAgent', 'LuxAgents')).toBe(true)
  })
  test('前缀包含', () => {
    expect(isRelocationCandidate('LuxAgentsV2', 'LuxAgents')).toBe(true)
  })
  test('编辑距离 ≤ 2', () => {
    expect(isRelocationCandidate('LuxAgentX', 'LuxAgents')).toBe(true)
  })
  test('明显无关不匹配', () => {
    expect(isRelocationCandidate('MyYoda', 'LuxAgents')).toBe(false)
    expect(isRelocationCandidate('CoderHub', 'LuxAgents')).toBe(false)
  })
  test('过短名称不参与复数/前缀规则（防误报）', () => {
    expect(isRelocationCandidate('A', 'As')).toBe(false)
  })
})

describe('findRelocationCandidates', () => {
  test('命中父目录下的候选并返回绝对路径', () => {
    const parent = makeTempParent()
    mkdirSync(join(parent, 'LuxAgent'), { recursive: true })
    mkdirSync(join(parent, 'MyYoda'), { recursive: true })
    writeFileSync(join(parent, 'not-a-dir'), 'x')

    const result = findRelocationCandidates(join(parent, 'LuxAgents'), 'LuxAgents')
    expect(result).toEqual([join(parent, 'LuxAgent')])
  })

  test('最多返回 3 个候选', () => {
    const parent = makeTempParent()
    mkdirSync(join(parent, 'LuxAgent'), { recursive: true })
    mkdirSync(join(parent, 'LuxAgents2'), { recursive: true })
    mkdirSync(join(parent, 'LuxAgentsX'), { recursive: true })
    mkdirSync(join(parent, 'LuxAgentsY'), { recursive: true })

    const result = findRelocationCandidates(join(parent, 'LuxAgents'), 'LuxAgents')
    expect(result.length).toBe(3)
  })

  test('父目录不存在 → 空数组（不抛异常）', () => {
    const result = findRelocationCandidates(join(tmpdir(), 'no-such-parent-dir-xyz', 'LuxAgents'), 'LuxAgents')
    expect(result).toEqual([])
  })

  test('无有效输入 → 空数组', () => {
    expect(findRelocationCandidates('', 'LuxAgents')).toEqual([])
    expect(findRelocationCandidates('/a/b/c', '')).toEqual([])
  })
})
```

**Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/main/lib/project-path-service.test.ts`
Expected: 新增用例 FAIL（函数不存在）

**Step 3: 实现**

`apps/electron/src/main/lib/project-path-service.ts` 顶部 import 补：

```ts
import { readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
```

文件末尾追加（注意该文件已 import `basename`，检查并合并）：

```ts
/** 编辑距离（Levenshtein），用于目录名模糊匹配 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

/**
 * 目录名是否为项目名的重命名候选。
 * 规则（大小写不敏感）：完全同名 / 去复数 s / 前缀包含 / 编辑距离 ≤ 2。
 * 项目名过短（<3）时只允许完全同名，防误报。
 */
export function isRelocationCandidate(name: string, projectName: string): boolean {
  const n = name.toLowerCase()
  const p = projectName.toLowerCase()
  if (n === p) return true
  if (p.length < 3) return false
  const singular = p.endsWith('s') ? p.slice(0, -1) : p
  if (singular.length >= 3 && n === singular) return true
  if (n.length > p.length && n.startsWith(p)) return true
  return levenshteinDistance(n, p) <= 2
}

/**
 * 扫描失效 workingDirectory 的父目录，找出可能被重命名/移动后的候选目录。
 * 只返回目录项，最多 3 个；readdir 异常或输入无效返回空数组（绝不抛错）。
 */
export function findRelocationCandidates(displayPath: string, projectName: string): string[] {
  if (!displayPath || !projectName) return []
  const parent = dirname(displayPath)
  let entries: string[]
  try {
    entries = readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
  const hits = entries
    .filter((name) => name !== basename(displayPath) && isRelocationCandidate(name, projectName))
    .sort()
    .map((name) => join(parent, name))
  return hits.slice(0, 3)
}
```

注意：`basename(displayPath)` 对应项目名本身（如 LuxAgents），若父目录里恰好还有一个同名旧目录，应排除（防止把原路径自身当作候选）。若原路径已不存在，该过滤无副作用。

**Step 4: 运行测试确认通过**

Run: `bun test apps/electron/src/main/lib/project-path-service.test.ts`
Expected: 全部 PASS（含原有用例）

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/project-path-service.ts apps/electron/src/main/lib/project-path-service.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(project): findRelocationCandidates 探测失效目录的重命名候选"
```

---

### Task 4: 失效报错 actions（主进程）

**Files:**
- Modify: `apps/electron/src/main/lib/agent-orchestrator.ts`

**Step 1: 确认 import**

- 确认已 import `loadProjectById`（来自 `packages/shared/src/projects/storage.ts`；若无则从 `../../../../packages/shared/src/projects/storage` 相对路径引入——按文件顶部既有 import 风格）
- 确认已 import `findRelocationCandidates`（来自 `./project-path-service`）
- 确认已 import `RecoveryAction` 类型（来自 `@myyoda/shared` 或相对路径，按顶部既有风格）

**Step 2: 修改 project_directory_unavailable 分支（约 1292 行）**

将：

```ts
          if ('unavailable' in cwdResolution) {
            reportPreflightError({
              code: 'project_directory_unavailable',
              title: '项目工作目录不可用',
              message: `该会话绑定的项目工作目录「${cwdResolution.displayPath ?? '未知路径'}」已不可访问，可能已被移动或删除。请在项目设置里重新关联或恢复该目录后再继续。`,
              canRetry: false,
              actions: []
            })
            return
          }
```

替换为：

```ts
          if ('unavailable' in cwdResolution) {
            const workspaceRoot = getAgentWorkspacePath(ws.slug)
            const projectId = sessionMeta?.projectId
            const projectSlug = projectId ? loadProjectById(workspaceRoot, projectId)?.config.slug : undefined
            const displayPath = cwdResolution.displayPath ?? ''
            const actions: RecoveryAction[] = [
              { key: 'r', label: '重新关联目录', action: 'open_project_settings', payload: workspaceId },
              { key: 'd', label: '设置默认工作区目录', action: 'open_default_workspace_settings' },
            ]
            // 探测重命名/移动候选：只建议不自动改，用户点击才执行关联
            if (projectSlug && displayPath) {
              for (const candidate of findRelocationCandidates(displayPath, basename(displayPath))) {
                actions.push({
                  key: 'c',
                  label: `关联到 ${basename(candidate)}`,
                  action: 'relocate_project',
                  payload: JSON.stringify({ workspaceRoot, projectSlug, targetPath: candidate }),
                })
              }
            }
            reportPreflightError({
              code: 'project_directory_unavailable',
              title: '项目工作目录不可用',
              message: `该会话绑定的项目工作目录「${displayPath}」已不可访问，可能已被移动或删除。可重新关联到新目录、关联到自动探测到的候选目录，或改用全局默认工作区目录继续。`,
              details: [`原路径: ${displayPath}`],
              canRetry: false,
              actions,
            })
            return
          }
```

注意：`basename` 需已从 `node:path` import（检查顶部，无则补）。`workspaceId` 变量在 preflight 作用域内已存在（外层 if (workspaceId) 的判断变量）。

**Step 3: 验证编译**

Run: `bun run typecheck`
Expected: 无错误

**Step 4: 手动冒烟（可选，dev 模式）**

将某项目 workingDirectory 临时指向不存在路径（或改 config.json），发起会话，确认报错消息带 3 个按钮（候选存在时 4 个）。验证后还原。

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/agent-orchestrator.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(agent): 项目目录失效报错提供恢复 actions + 重命名候选探测"
```

---

### Task 5: renderer 报错 action 处理（SDKMessageRenderer）

**Files:**
- Modify: `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx`

**Step 1: 补 import**

按文件顶部既有风格补：

```ts
import { buildProjectPageNavigation } from '@/components/app-shell/code-main-view-model'
import { activeProjectPageIdAtom, projectPageTabAtom } from '@/atoms/project-atoms'
import { codeMainViewAtom } from '@/atoms/code-main-view'
```

（`activeViewAtom`、`settingsOpenAtom`、`settingsTabAtom` 已 import；`toast` 按文件既有 toast 用法引入，若未 import 则按既有风格补 `import { toast } from '@/components/ui/toast'` 或项目实际路径）

**Step 2: 扩展 handleRecoveryAction（约 1187 行 switch）**

在 `case 'open_external':` 之前插入三个 case：

```ts
      case 'open_project_settings': {
        // payload: workspaceId（与 SidePanel openProjectSettings 同构导航到项目设置 tab）
        const workspaceId = action.payload
        if (workspaceId) {
          const navigation = buildProjectPageNavigation(workspaceId, 'settings')
          setActiveProjectPageId(navigation.activeProjectPageId)
          setProjectPageTab(navigation.projectPageTab)
          setCodeMainView(navigation.codeMainView)
          setActiveView(navigation.activeView)
        }
        break
      }
      case 'open_default_workspace_settings':
        setSettingsTab('workspace')
        setSettingsOpen(true)
        break
      case 'relocate_project': {
        try {
          const payload = JSON.parse(action.payload ?? '{}') as {
            workspaceRoot?: string
            projectSlug?: string
            targetPath?: string
          }
          if (!payload.workspaceRoot || !payload.projectSlug || !payload.targetPath) {
            throw new Error('relocate_project payload 不完整')
          }
          await window.electronAPI.project.relocateWorkingDirectory(
            payload.workspaceRoot,
            payload.projectSlug,
            payload.targetPath,
          )
          toast.success('已重新关联项目目录，请重新发送消息')
        } catch (err) {
          console.error('[ErrorMessage] 重新关联项目目录失败:', err)
          toast.error(err instanceof Error ? err.message : '重新关联项目目录失败')
        }
        break
      }
```

在组件内补 state 读取（若组件尚未读取这些 atom，在组件顶部与 `setSettingsOpen` 同处加）：

```ts
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setActiveProjectPageId = useSetAtom(activeProjectPageIdAtom)
  const setProjectPageTab = useSetAtom(projectPageTabAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
```

（`setActiveView` 若已存在则复用，不重复声明。）

**Step 3: 补 iconForAction 图标（约 1221 行 switch）**

在 `case 'open_external':` 附近补：

```ts
      case 'open_project_settings':
        return <FolderOpen className="size-3.5 mr-1.5" />
      case 'open_default_workspace_settings':
        return <Settings className="size-3.5 mr-1.5" />
      case 'relocate_project':
        return <ArrowRightLeft className="size-3.5 mr-1.5" />
```

（`FolderOpen` / `ArrowRightLeft` 从 `lucide-react` import，按文件既有图标 import 风格补；`Settings` 已用。）

**Step 4: 验证编译**

Run: `bun run typecheck`
Expected: 无错误

**Step 5: 手动冒烟**

- 触发 `project_directory_unavailable`（见 Task 4 Step 4）→ 报错卡片显示按钮
- 点「重新关联目录」→ 跳到项目设置 tab
- 点「设置默认工作区目录」→ 打开设置-工作区
- 点「关联到 xxx」→ toast 成功/失败

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(agent): 报错卡片支持项目目录恢复 actions（重新关联/默认目录/候选关联）"
```

---

### Task 6: Onboarding 增加「设置默认工程目录」步骤

**Files:**
- Modify: `apps/electron/src/renderer/components/onboarding/OnboardingView.tsx`

**Step 1: 补 import**

```ts
import { WorkingDirectoryField } from '@/components/app-shell/kanban/WorkingDirectoryField'
```

**Step 2: 扩展 step 状态机与流转**

```ts
  const [step, setStep] = useState<'welcome' | 'workspace' | 'environment'>('welcome')
  const [defaultDirectory, setDefaultDirectory] = React.useState('')
```

将：

```ts
  const handleNextFromWelcome = () => {
    if (isWindows) {
      setStep('environment')
    } else {
      handleFinish()
    }
  }
```

替换为：

```ts
  const handleNextFromWelcome = () => {
    setStep('workspace')
  }

  const handleContinueFromWorkspace = async () => {
    if (defaultDirectory.trim()) {
      try {
        await window.electronAPI.setAgentDefaultWorkingDirectory(defaultDirectory.trim())
      } catch (err) {
        console.error('[Onboarding] 保存默认工作区目录失败:', err)
        toast.error('保存默认工作区目录失败，可稍后在设置中配置')
      }
    }
    if (isWindows) {
      setStep('environment')
    } else {
      await handleFinish()
    }
  }
```

（`toast` 按文件既有风格引入；若文件没有 toast 用法，从 `@/components/ui/toast` import。）

**Step 3: 新增 workspace 步骤 UI（在 `{step === 'welcome' && (...)}` 块之后、environment 块之前插入）**

```tsx
      {step === 'workspace' && (
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold mb-2">设置默认工程目录（可选）</h2>
            <p className="text-sm text-muted-foreground">
              未绑定项目的会话会把该目录作为工程代码目录；可跳过，稍后在 设置 → 工作区 中随时配置
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 mb-6">
            <WorkingDirectoryField
              value={defaultDirectory}
              onChange={setDefaultDirectory}
              placeholder="选择你的常用代码目录，例如 ~/Workspace/ClaudeCode"
            />
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('welcome')}
              className="text-muted-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              上一步
            </Button>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => handleContinueFromWorkspace()}
              >
                跳过
              </Button>
              <Button
                onClick={() => handleContinueFromWorkspace()}
              >
                继续
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
```

注意：`WorkingDirectoryField` 的 props 以实际组件定义为准（`value`/`onChange` 已有；`placeholder` 若组件不支持则去掉该 prop）。

**Step 4: 验证编译**

Run: `bun run typecheck`
Expected: 无错误

**Step 5: 手动冒烟**

- 清空 `onboardingCompleted` 设置后启动 → 欢迎 → 「直接开始使用」进入默认目录步骤
- 选择目录 → 继续 → 完成；验证 `~/.myyoda` 设置中 `agentDefaultWorkingDirectory` 已写入
- 再走一次跳过路径 → 设置未写入
- Windows 流程：workspace → environment → finish

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/components/onboarding/OnboardingView.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(onboarding): 首次启动增加可选的默认工程目录设置步骤"
```

---

## 收尾验证

Run: `bun test && bun run typecheck`
Expected: 全绿

复查：
1. `git log --oneline -6` 确认 6 个 commit 均带 MyYoda trailer
2. `git status --short` 干净

## 已知风险与备注

- Task 4 中 `loadProjectById` 的 import 路径以文件顶部既有相对路径风格为准（或改用 `projectRepository` 现有方法，若其已暴露按 id 查 slug 的接口）。
- Task 5 中 `window.electronAPI.project.relocateWorkingDirectory` 命名空间以 preload 实际暴露结构为准（preload/index.ts:1633 已封装该签名）。
- `WorkingDirectoryField` 的 props（如 placeholder）以组件实际定义为准，编译错误时按定义收敛。
- 存量会话 meta 不迁移；新逻辑只影响新会话 / 重启后会话的 cwd 决策。
