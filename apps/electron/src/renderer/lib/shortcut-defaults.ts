/**
 * 快捷键默认配置
 *
 * 定义所有快捷键的 ID、名称、描述、默认绑定和分类。
 * 这是快捷键系统的基础数据层，由 shortcut-registry 消费。
 */

// ===== 类型定义 =====

/** 快捷键分类 */
export type ShortcutCategory = 'app' | 'edit' | 'navigation' | 'global'

/** 快捷键定义（不可变，内置于代码） */
export interface ShortcutDefinition {
  /** 唯一标识（如 'open-settings'） */
  id: string
  /** 中文名称 */
  name: string
  /** 中文描述 */
  description: string
  /** macOS 默认快捷键（如 'Cmd+,'） */
  defaultMac: string
  /** Windows 默认快捷键（如 'Ctrl+,'） */
  defaultWin: string
  /** 分类 */
  category: ShortcutCategory
  /** 是否为全局快捷键（由主进程 globalShortcut 注册） */
  global?: boolean
  /** 全局注册不可用时，是否仍保留应用内 keydown 回退 */
  localFallback?: boolean
  /** 是否为只读（仅展示，不可自定义） */
  readonly?: boolean
}

/**
 * 用户自定义快捷键覆盖（持久化到 settings.json）
 *
 * 类型在 `types/settings.ts` 中定义，此处转发以便渲染层就近使用。
 */
export type { ShortcutOverrides } from '../../types/settings'

// ===== 分类标签 =====

export const SHORTCUT_CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  app: '应用',
  edit: '编辑',
  navigation: '导航',
  global: '全局',
}

// ===== 默认快捷键列表 =====

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // 应用级
  {
    id: 'open-settings',
    name: '打开设置',
    description: '打开应用设置面板',
    defaultMac: 'Cmd+,',
    defaultWin: 'Ctrl+,',
    category: 'app',
  },
  {
    id: 'new-session',
    name: '新建对话',
    description: '根据当前模式创建 Chat 对话或 Agent 会话',
    defaultMac: 'Cmd+N',
    defaultWin: 'Ctrl+N',
    category: 'app',
  },
  {
    id: 'new-todo',
    name: '新建 Todo/日程/定时任务',
    description: '计划内按当前子页签新建 Todo、日程或定时任务',
    defaultMac: 'Cmd+T',
    defaultWin: 'Ctrl+T',
    category: 'app',
  },
  {
    id: 'new-task',
    name: '新建任务',
    description: '打开新建任务的工作区选择器（仅 Agent 模式）',
    defaultMac: 'Cmd+Shift+N',
    defaultWin: 'Ctrl+Shift+N',
    category: 'app',
  },
  {
    id: 'toggle-sidebar',
    name: '切换侧边栏',
    description: '显示或隐藏左侧边栏',
    defaultMac: 'Cmd+B',
    defaultWin: 'Ctrl+Shift+E',
    category: 'app',
  },
  {
    id: 'toggle-mode',
    name: '切换模式',
    description: '在 Chat 和 Agent 模式之间切换',
    defaultMac: 'Cmd+Shift+M',
    defaultWin: 'Ctrl+Shift+M',
    category: 'app',
  },
  {
    id: 'nav-back',
    name: '后退',
    description: '切换到最近访问的上一个标签页',
    defaultMac: 'Cmd+[',
    defaultWin: 'Ctrl+[',
    category: 'navigation',
  },
  {
    id: 'nav-forward',
    name: '前进',
    description: '切换到后退前访问的下一个标签页',
    defaultMac: 'Cmd+]',
    defaultWin: 'Ctrl+]',
    category: 'navigation',
  },
  {
    id: 'global-search',
    name: '搜索',
    description: '打开搜索弹窗（标题/内容搜索 + 最近会话按时间分组）',
    defaultMac: 'Cmd+Shift+F',
    defaultWin: 'Ctrl+Shift+F',
    category: 'navigation',
  },
  {
    id: 'browse-project-folder',
    name: '浏览工作区文件夹',
    description: '在新会话/新任务的工作区选择器中打开系统选目录',
    defaultMac: 'Cmd+O',
    defaultWin: 'Ctrl+O',
    category: 'navigation',
  },
  {
    id: 'file-find',
    name: '查找',
    description: '在对话中搜索消息，或在文件预览/Diff 面板中查找文件内容',
    defaultMac: 'Cmd+F',
    defaultWin: 'Ctrl+F',
    category: 'navigation',
  },
  {
    id: 'focus-input',
    name: '聚焦输入框',
    description: '快速跳转到输入框',
    defaultMac: 'Cmd+L',
    defaultWin: 'Ctrl+L',
    category: 'navigation',
  },
  {
    id: 'open-planning',
    name: '打开任务/日程',
    description: '打开或聚焦独立的 Todo、日程与定时任务窗口',
    defaultMac: 'Cmd+Shift+T',
    defaultWin: 'Ctrl+Shift+T',
    category: 'global',
    global: true,
    localFallback: true,
  },

  // 编辑级（输入框格式化 — macOS 上 Cmd+B 被切换侧边栏占用，改用 Ctrl+B；Windows 上 Ctrl+B 直接加粗）
  {
    id: 'editor-bold',
    name: '加粗 / 取消加粗',
    description: '输入框中切换文字加粗',
    defaultMac: 'Ctrl+B',
    defaultWin: 'Ctrl+B',
    category: 'edit',
    readonly: true,
  },
  {
    id: 'editor-strikethrough',
    name: '删除线 / 取消删除线',
    description: '输入框中切换文字删除线',
    defaultMac: 'Ctrl+S',
    defaultWin: '',
    category: 'edit',
    readonly: true,
  },

  // 编辑级
  {
    id: 'clear-context',
    name: '清除上下文',
    description: '清除当前对话的上下文',
    defaultMac: 'Cmd+K',
    defaultWin: 'Ctrl+K',
    category: 'edit',
  },
  {
    id: 'stop-generation',
    name: '停止 Agent',
    description: '中断当前 AI 响应',
    defaultMac: 'Cmd+Shift+Backspace',
    defaultWin: 'Ctrl+Shift+Backspace',
    category: 'edit',
  },
  {
    id: 'save-excalidraw',
    name: '保存画布',
    description: '在 Excalidraw 编辑器中保存当前画布',
    defaultMac: 'Cmd+S',
    defaultWin: 'Ctrl+S',
    category: 'edit',
    readonly: true,
  },
  {
    id: 'quick-task-chat',
    name: '快速任务·Chat 模式',
    description: '在快速任务浮窗中切换到 Chat 模式',
    defaultMac: 'Cmd+1',
    defaultWin: 'Ctrl+1',
    category: 'app',
    readonly: true,
  },
  {
    id: 'quick-task-agent',
    name: '快速任务·Agent 模式',
    description: '在快速任务浮窗中切换到 Agent 模式',
    defaultMac: 'Cmd+2',
    defaultWin: 'Ctrl+2',
    category: 'app',
    readonly: true,
  },
  {
    id: 'close-tab',
    name: '关闭当前标签',
    description: '关闭当前活跃的 Chat 或 Agent 标签页',
    defaultMac: 'Cmd+W',
    defaultWin: 'Ctrl+W',
    category: 'app',
  },
  {
    id: 'toggle-preview-panel',
    name: '切换预览面板',
    description: '显示或隐藏内联 Diff/文件预览面板',
    defaultMac: 'Cmd+\\',
    defaultWin: 'Ctrl+\\',
    category: 'navigation',
  },
  {
    id: 'toggle-right-panel',
    name: '切换文件面板',
    description: '显示或隐藏右侧文件面板',
    defaultMac: 'Cmd+Shift+B',
    defaultWin: 'Ctrl+Shift+B',
    category: 'app',
  },

  // 缩放（由 Electron 菜单 role 处理，仅展示，不可自定义）
  {
    id: 'zoom-in',
    name: '放大',
    description: '放大应用界面',
    defaultMac: 'Cmd+=',
    defaultWin: 'Ctrl+=',
    category: 'app',
    readonly: true,
  },
  {
    id: 'zoom-out',
    name: '缩小',
    description: '缩小应用界面',
    defaultMac: 'Cmd+-',
    defaultWin: 'Ctrl+-',
    category: 'app',
    readonly: true,
  },
  {
    id: 'reset-zoom',
    name: '重置缩放',
    description: '恢复 100% 缩放',
    defaultMac: 'Cmd+0',
    defaultWin: 'Ctrl+0',
    category: 'app',
    readonly: true,
  },

  // 侧边栏快捷切换会话（由 LeftSidebar 内核实现，仅展示，不可自定义）
  {
    id: 'quick-switch-session',
    name: '直达会话',
    description: '按住主修饰键后，继续按 1-9 跳转对应会话',
    defaultMac: 'Cmd+1-9',
    defaultWin: 'Ctrl+1-9',
    category: 'navigation',
    readonly: true,
  },
  // Tab 循环切换会话（由 TabSwitcher 内核实现，仅展示，不可自定义）
  {
    id: 'cycle-sessions',
    name: '循环切换会话',
    description: 'Ctrl+Shift+Tab 可反向切换，松开 Ctrl 确认',
    defaultMac: 'Ctrl+Tab',
    defaultWin: 'Ctrl+Tab',
    category: 'navigation',
    readonly: true,
  },

  // 全局快捷键（由主进程 globalShortcut 注册，应用外也生效）
  {
    id: 'quick-task',
    name: '快速任务',
    description: '唤起浮动快速任务输入窗口',
    defaultMac: 'Alt+Space',
    defaultWin: 'Alt+Space',
    category: 'global',
    global: true,
  },
  {
    id: 'show-main-window',
    name: '显示主窗口',
    description: '显示并聚焦 MyYoda 主窗口',
    defaultMac: 'Cmd+Shift+P',
    defaultWin: 'Ctrl+Shift+P',
    category: 'global',
    global: true,
  },
  {
    id: 'voice-dictation',
    name: '语音输入',
    description: '唤起豆包流式语音输入浮窗',
    defaultMac: 'Ctrl+`',
    defaultWin: 'Ctrl+`',
    category: 'global',
    global: true,
  },
]

/** 按 ID 索引的快捷键 Map（用于快速查找） */
export const SHORTCUT_MAP = new Map(
  DEFAULT_SHORTCUTS.map((s) => [s.id, s]),
)
