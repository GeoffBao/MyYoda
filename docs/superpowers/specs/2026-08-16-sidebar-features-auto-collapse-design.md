# 侧边栏「功能」组自动折叠设计：菜单模式 + 指示模式

日期：2026-08-16 · 状态：已按用户评审修订（点击二级目录后保持展开 + 只显示激活项，对齐项目会话列表「折叠态 peek」交互），已实施（commit `563ba15e7`）

## 一、背景与目标

现状：「功能」组（计划 / 看板 / 画布 / 插件 / 知识库，`LeftSidebar.tsx` 的 `featuresCollapsed` 受控折叠组）默认折叠，点击头部展开后**保持展开**；点击二级目录打开视图后功能组不收起，且存在「任一功能视图激活时自动展开」的 `useEffect`（`anyFeatureActive`）。

用户诉求：把「功能」组当「一次性菜单」使用——点开 → 选择二级目录 → 打开视图后**只显示激活项**（其余项隐藏，保持展开）；点开但没点二级目录（点了别处/空白）→ 整体自动收起。同时保留自动展开能力，但自动展开时**只显示当前激活的那一个二级目录项**（对齐「项目会话列表」折叠态 peek 交互，2026-08-14 定稿的交互），而不是整组铺开。

## 二、行为规格（已与用户确认，不再讨论）

| 场景 | 行为 |
|---|---|
| 手动点开「功能」头部 | 菜单模式：显示全部二级目录（计划 / 看板 / 画布 / 插件 / 知识库，后四项仅 Agent 模式） |
| 点击某个二级目录项 | 打开对应视图 + 功能组**保持展开**，但只显示激活项（其余隐藏，高亮激活项）——修订后行为 |
| 点开后点击侧边栏其他区域 / 空白 / 内容区 | 功能组整体自动收起（无二级目录被选中） |
| 从折叠态图标、快捷键等外部入口激活功能视图 | 指示模式：功能组自动展开，**只显示当前激活的那一项**并高亮，其余项隐藏 |
| 退出功能视图（回到会话 / 发现等） | 功能组自动折叠（`anyFeatureActive` 变 false） |
| 指示模式下点击功能组头部 | 收起；再次点开进入菜单模式（显示全部） |
| Chat 模式 | 功能组仅「计划」一项，两种模式行为无感知差异，逻辑一致生效 |

## 三、实现要点

均在 `LeftSidebar.tsx` 展开态分支内完成，不涉及 `SidebarModule.tsx`（其受控接口已够用）。

### 3.1 状态

```ts
const [featuresCollapsed, setFeaturesCollapsed] = React.useState(true)
// true = 菜单模式（用户手动展开，显示全部二级目录）
// false = 指示模式（自动展开，只显示激活项）
const [featuresShowingAll, setFeaturesShowingAll] = React.useState(false)
```

### 3.2 自动展开 effect（改造现有）

```ts
React.useEffect(() => {
  if (anyFeatureActive) {
    setFeaturesCollapsed(false)
    setFeaturesShowingAll(false) // 有激活视图 → 展开 + 指示模式，只显示激活项
  } else {
    setFeaturesCollapsed(true) // 无激活视图（回到会话/发现）→ 默认折叠
  }
}, [anyFeatureActive])
```

关键点：早期设计（点击后整体收起）需要 `suppressAutoExpandRef` 抑制「点击后收起」与「自动展开」的冲突；修订后点击二级目录的目标状态（展开 + 指示模式）与 effect 一致，**不再需要 suppress**，effect 单一跟随 `anyFeatureActive`，逻辑更简。

### 3.3 功能组头部切换（onCollapsedChange）

```ts
onCollapsedChange={(next) => {
  setFeaturesCollapsed(next)
  if (!next) setFeaturesShowingAll(true) // 用户手动展开 → 菜单模式
}}
```

### 3.4 二级目录点击包装

给功能组内 5 个二级目录按钮的 `onClick` 统一包一层：

```ts
const navigateFromFeatureGroup = (action: () => void): void => {
  action()                    // 打开对应视图（复用现有 handleOpen*）
  setFeaturesShowingAll(false) // 同步切指示模式（与 effect 一致，消除中间帧）
}
```

### 3.5 外部点击自动收起

功能组展开期间挂全局 `pointerdown` 监听（`document`，捕获阶段），目标不在功能组容器内且功能组未折叠时 `setFeaturesCollapsed(true)`：

```ts
React.useEffect(() => {
  if (featuresCollapsed) return
  const onPointerDown = (e: PointerEvent): void => {
    if (featuresModuleRef.current && !featuresModuleRef.current.contains(e.target as Node)) {
      setFeaturesCollapsed(true)
    }
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  return () => document.removeEventListener('pointerdown', onPointerDown, true)
}, [featuresCollapsed])
```

功能组容器加 `ref={featuresModuleRef}`。头部本身在容器内，点击头部走 3.3 的 toggle，不会冲突。

### 3.6 二级目录渲染过滤

每项的渲染条件为：**`featuresShowingAll`（菜单模式）或 该项处于激活态**。激活判定与现有 `anyFeatureActive` 完全一致（`planning` / `agent-skills` / `repo-wiki` / `excalidraw-gallery` / `excalidraw-editor` / 看板的 `tasks+conversations`），并保留现有 mode 限制（看板/画布/插件/知识库仅 Agent 模式）与激活高亮样式：

```tsx
{!featuresCollapsed && (
  <div className="flex flex-col gap-0.5 pt-1">
    {(featuresShowingAll || activeView === 'planning') && (/* 计划按钮（无 mode 限制） */)}
    {(featuresShowingAll || (mode === 'agent' && codeMainView === 'tasks' && activeView === 'conversations')) && (/* 看板按钮 */)}
    {/* 画布 / 插件 / 知识库同理：featuresShowingAll || 对应激活判定 */}
  </div>
)}
```

指示模式下仅激活项渲染，仍保留现有激活高亮样式（`activeView === '...'` 判定不变）。

## 四、边界情况

| 情况 | 处理 |
|---|---|
| 指示模式下点激活项本身（如计划页点「计划」） | `handleOpen*` 对已激活项 toggle 回会话（现有行为）→ `anyFeatureActive` 变 false → effect 折叠，语义=退出该功能视图 |
| 指示模式下点击非激活项（不可见，无入口） | 不发生；指示模式只显示激活项 |
| 点击功能组头部快速连续切换 | 受控 state 同步，无额外风险 |
| 模式切换（Agent ↔ Chat） | 不重置 `featuresCollapsed` / `featuresShowingAll`；Chat 下只有计划一项，两种模式渲染一致 |
| 发现 / 搜索模块点击 | 属于「功能组外部」，触发外部收起；不触发 `anyFeatureActive` 展开（现有判定已排除 discover） |

## 五、影响面

- 仅 `LeftSidebar.tsx`（展开态功能组区域 + `anyFeatureActive` effect）
- `SidebarModule.tsx` 不改（`collapsible` 受控接口已支持）
- 折叠态窄图标栏不改（无功能组入口）
- 无 IPC / 主进程 / 持久化改动

## 六、测试点

1. 手动展开 → 显示全部 5 项；点击「计划」→ 计划页打开，功能组保持展开且**只显示「计划」一项**（其余隐藏，计划高亮）
2. 手动展开 → 点击侧边栏空白/会话列表 → 功能组整体收起
3. 折叠态点「看板」图标 → 展开态功能组自动展开且只显示「看板」一项（高亮）
4. 快捷键打开「计划」→ 同 3 的指示模式
5. 指示模式点头部 → 收起；再点开 → 菜单模式显示全部
6. 指示模式点激活项本身 → 退出该功能视图回会话，功能组折叠
7. 在功能视图内点会话 → 回会话且功能组折叠（`anyFeatureActive` 变 false）
8. Chat 模式下重复 1-7（只有「计划」）
