/**
 * SettingsPanel - 设置面板
 *
 * 在应用主工作区中展示左侧导航和右侧 ScrollArea 内容区域。
 * 使用 Jotai atom 管理当前标签页状态，保持已有设置项与分组顺序。
 */

import * as React from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { cn } from "@/lib/utils";
import { detectIsWindows, WINDOW_CONTROLS_INSET_RIGHT } from "@/lib/platform";
import {
  Settings,
  Radio,
  Palette,
  Info,
  Globe,
  BookOpen,
  Bot,
  ArrowLeft,
  Keyboard,
  Mic,
  HardDriveDownload,
  HardDrive,
  Layers,
  Eye,
  Building2,
  BarChart3,
  CircleHelp,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { activeViewAtom } from "@/atoms/active-view";
import {
  settingsTabAtom,
  channelFormDirtyAtom,
  settingsCloseRequestedAtom,
  settingsOpenAtom,
  settingsPendingSessionNavigationAtom,
  type SettingsSessionNavigation,
} from "@/atoms/settings-tab";
import type { SettingsTab } from "@/atoms/settings-tab";
import { automationFormAtom } from "@/atoms/automation-atoms";
import { hasUpdateAtom } from "@/atoms/updater";
import { hasEnvironmentIssuesAtom } from "@/atoms/environment";
import { faqDialogOpenAtom } from "@/atoms/faq-dialog";
import { tabsAtom, activeTabIdAtom, openTab, TUTORIAL_TAB_ID } from "@/atoms/tab-atoms";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChannelSettings } from "./ChannelSettings";
import { VisionRelaySettings } from "./VisionRelaySettings";
import { OrganizationSettings } from "./OrganizationSettings";
import { GeneralSettings } from "./GeneralSettings";
import { ProxySettings } from "./ProxySettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AboutSettings } from "./AboutSettings";
import { PromptSettings } from "./PromptSettings";
import { ToolSettings } from "./ToolSettings";
import { BotHubSettings } from "./BotHubSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { VoiceInputSettings } from "./VoiceInputSettings";
import { MigrationSettings } from "./MigrationSettings";
import { StorageSettings } from "./StorageSettings";
import { UsageSettings } from "./UsageSettings";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { useOpenSession } from '@/hooks/useOpenSession'
import { ShortcutKeycaps } from "@/components/shortcuts/ShortcutKeycaps";

/** 设置 Tab 定义 */
interface TabItem {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}

/** 导航分组：macOS System Settings 式分组，组间留白 + 弱化组标题 */
interface NavGroup {
  /** 组标题（首组无标题） */
  label?: string;
  tabs: TabItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    tabs: [
      { id: "general", label: "通用设置", icon: <Settings size={16} /> },
      { id: "appearance", label: "外观设置", icon: <Palette size={16} /> },
      { id: "shortcuts", label: "快捷键管理", icon: <Keyboard size={16} /> },
    ],
  },
  {
    label: "模型与工具",
    tabs: [
      { id: "channels", label: "模型配置", icon: <Radio size={16} /> },
      { id: "vision-relay", label: "视觉助手", icon: <Eye size={16} /> },
      { id: "organization", label: "企业组织技能", icon: <Building2 size={16} /> },
      { id: "prompts", label: "提示词管理", icon: <BookOpen size={16} /> },
      { id: "voice-input", label: "语音输入", icon: <Mic size={16} /> },
      { id: "proxy", label: "代理设置", icon: <Globe size={16} /> },
    ],
  },
  {
    label: "连接与数据",
    tabs: [
      { id: "workspace", label: "空间容器", icon: <Layers size={16} /> },
      { id: "bots", label: "远程连接", icon: <Bot size={16} /> },
      { id: "migration", label: "数据迁移", icon: <HardDriveDownload size={16} /> },
      { id: "storage", label: "磁盘管理", icon: <HardDrive size={16} /> },
      { id: "usage", label: "用量统计", icon: <BarChart3 size={16} /> },
    ],
  },
  {
    label: "帮助",
    tabs: [
      { id: "tutorial", label: "使用指南", icon: <CircleHelp size={16} /> },
      { id: "faq", label: "常见问题 FAQ", icon: <BookOpen size={16} /> },
      { id: "about", label: "关于/更新", icon: <Info size={16} /> },
    ],
  },
];

/** 暂时隐藏的 Tab（功能代码保留，待后续重新开放） */
const HIDDEN_TABS = new Set<SettingsTab>([
  "bots",
  "shortcuts",
]);

/** 根据标签页 id 渲染对应内容 */
function renderTabContent(tab: SettingsTab): React.ReactElement {
  switch (tab) {
    case "general":
      return <GeneralSettings />;
    case "channels":
      return <ChannelSettings />;
    case "organization":
      return <OrganizationSettings />;
    case "vision-relay":
      return <VisionRelaySettings />;
    case "prompts":
      return <PromptSettings />;
    case "proxy":
      return <ProxySettings />;
    case "tools":
      return <ToolSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "about":
      return <AboutSettings />;
    case "bots":
      return <BotHubSettings />;
    case "shortcuts":
      return <ShortcutSettings />;
    case "voice-input":
      return <VoiceInputSettings />;
    case "migration":
      return <MigrationSettings />;
    case "storage":
      return <StorageSettings />;
    case "usage":
      return <UsageSettings />;
    case "workspace":
      return <WorkspaceSettings />;
    default:
      // 使用指南和 FAQ 都由 handleTabChange 处理，不在设置内容区重复渲染。
      return <GeneralSettings />;
  }
}

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({
  onClose,
}: SettingsPanelProps): React.ReactElement {
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom);
  const channelFormDirty = useAtomValue(channelFormDirtyAtom);
  const [closeRequested, setCloseRequested] = useAtom(settingsCloseRequestedAtom);
  const [pendingSessionNavigation, setPendingSessionNavigation] = useAtom(settingsPendingSessionNavigationAtom);
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setActiveView = useSetAtom(activeViewAtom);
  const setAutomationForm = useSetAtom(automationFormAtom);
  const setFaqDialogOpen = useSetAtom(faqDialogOpenAtom);
  const hasUpdate = useAtomValue(hasUpdateAtom);
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom);
  const [mainTabs, setMainTabs] = useAtom(tabsAtom);
  const setMainActiveTabId = useSetAtom(activeTabIdAtom);
  const openSession = useOpenSession()
  const isWindows = React.useMemo(() => detectIsWindows(), [])

  /** 统一的退出拦截对话框状态 */
  type PendingAction =
    | { type: 'tab'; tabId: SettingsTab }
    | { type: 'close' }
    | { type: 'session'; navigation: SettingsSessionNavigation }
    | null
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null)
  const showNavDialog = pendingAction !== null

  /** 执行待处理的操作 */
  const executePendingAction = (): void => {
    if (!pendingAction) return
    if (pendingAction.type === 'tab') {
      setActiveTab(pendingAction.tabId)
    } else if (pendingAction.type === 'session') {
      openSession(
        pendingAction.navigation.type,
        pendingAction.navigation.sessionId,
        pendingAction.navigation.title,
        { bypassSettingsGuard: true },
      )
    } else {
      onClose?.()
    }
    setPendingAction(null)
  }

  /** 取消待处理的操作 */
  const cancelPendingAction = (): void => {
    setPendingAction(null)
  }

  /** 切换标签页时检测是否有未保存内容；使用指南和 FAQ 分别进入对应帮助入口。 */
  const handleTabChange = (tabId: SettingsTab): void => {
    if (tabId === 'tutorial') {
      const result = openTab(mainTabs, { type: 'tutorial', sessionId: TUTORIAL_TAB_ID, title: 'MyYoda 使用指南' })
      setMainTabs(result.tabs)
      setMainActiveTabId(result.activeTabId)
      setAutomationForm({ open: false, draft: null })
      setActiveView('conversations')
      setSettingsOpen(false)
      return
    }
    if (tabId === 'faq') {
      setFaqDialogOpen(true)
      return
    }
    if (tabId === activeTab) return
    if (activeTab === 'channels' && channelFormDirty) {
      setPendingAction({ type: 'tab', tabId })
      return
    }
    setActiveTab(tabId)
  }

  /** 关闭设置面板时检测是否有未保存内容 */
  const handleClose = React.useCallback((): void => {
    if (activeTab === 'channels' && channelFormDirty) {
      setPendingAction({ type: 'close' })
      return
    }
    onClose?.()
  }, [activeTab, channelFormDirty, onClose])

  /** 按 ESC 退出设置面板：window 级监听确保焦点在设置面板内任何位置（含 body）都生效；
   *  Radix 弹层（Select 下拉/AlertDialog/Popover 等）处理 ESC 时会 preventDefault，
   *  此时交给弹层自行关闭，不退出设置。 */
  React.useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (e.defaultPrevented) return
      handleClose()
    }
    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [handleClose])

  // 左侧会话点击在渠道表单有未保存内容时，由 useOpenSession 暂存目标并交给此处确认。
  React.useEffect(() => {
    if (!pendingSessionNavigation) return
    setPendingAction({ type: 'session', navigation: pendingSessionNavigation })
    setPendingSessionNavigation(null)
  }, [pendingSessionNavigation, setPendingSessionNavigation])

  // Cmd+W 等外部关闭请求：弹出确认对话框
  React.useEffect(() => {
    if (closeRequested && activeTab === 'channels') {
      setPendingAction({ type: 'close' })
      setCloseRequested(false)
    }
  }, [closeRequested, activeTab, setCloseRequested])

  // 过滤暂时下线/隐藏的设置页，保留数据迁移、磁盘管理、语音输入等可用入口。
  const navGroups = React.useMemo(() => {
    return NAV_GROUPS
      .map((group) => ({ ...group, tabs: group.tabs.filter((t) => !HIDDEN_TABS.has(t.id)) }))
      .filter((group) => group.tabs.length > 0);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-content-area text-foreground">
      {/* 顶部可拖动标题栏区域。背景层保持全宽；drag 层在 Windows 上必须避开右上角的
          WindowControls 按钮区域（WINDOW_CONTROLS_INSET_RIGHT），否则 OS hitmask 会把
          按钮点击误判为标题栏点击，导致最小化/最大化/关闭按钮无响应（与 AppShell/TabBar 一致）。 */}
      <div className="relative h-[35px] flex-shrink-0 bg-[hsl(var(--sidebar-surface))]">
        <div
          aria-hidden="true"
          className={cn(
            'titlebar-drag-region pointer-events-none absolute left-0 top-0 h-full',
            isWindows ? WINDOW_CONTROLS_INSET_RIGHT : 'right-0',
          )}
        />
      </div>

      {/* 主体：左导航 + 右内容 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧 Tab 导航：分组 + 弱化组标题，选中态走墨水填充；返回按钮 sticky 固定在底部 */}
        <div className="w-[168px] flex-shrink-0 flex flex-col" style={{ boxShadow: 'inset -1px 0 0 hsl(var(--foreground) / 0.06)' }}>
          <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pt-3 px-2.5 flex flex-col">
            {navGroups.map((group, groupIndex) => (
              <React.Fragment key={group.label ?? groupIndex}>
                {group.label && (
                  <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-foreground/35 select-none">
                    {group.label}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  {group.tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-[color,background-color,transform] duration-fast ease-out active:scale-[0.97]",
                        activeTab === tab.id
                          ? "bg-foreground/[0.08] text-foreground/90"
                          : "text-foreground/55 hover:bg-foreground/[0.04] hover:text-foreground/80",
                      )}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                      {tab.id === "about" && (hasUpdate || hasEnvironmentIssues) && (
                        <span className="w-2 h-2 rounded-full bg-destructive" />
                      )}
                    </button>
                  ))}
                </div>
              </React.Fragment>
            ))}
          </nav>
          <div className="flex-shrink-0 p-3">
            <button
              onClick={handleClose}
              className="group flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-[color,background-color,transform] duration-fast ease-out active:scale-[0.97] hover:bg-background/60 hover:text-foreground"
            >
              <ArrowLeft size={16} />
              <span>返回</span>
              <span className="ml-auto hidden group-hover:inline-flex">
                <ShortcutKeycaps accelerator="Esc" />
              </span>
            </button>
          </div>
        </div>

        {/* 右侧内容区域 */}
        <ScrollArea className="min-w-0 flex-1 bg-content-area">
          <div className="mx-auto w-full max-w-[1080px] px-5 py-8 pb-12 sm:px-8">
            {renderTabContent(activeTab)}
          </div>
        </ScrollArea>
      </div>

      {/* 退出拦截弹窗（侧边栏导航 / X 关闭 / Cmd+W） */}
      <AlertDialog open={showNavDialog} onOpenChange={(open) => { if (!open) cancelPendingAction() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前渠道配置尚未保存，确定要离开吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPendingAction}>留在当前页</AlertDialogCancel>
            <AlertDialogAction onClick={executePendingAction}>放弃并离开</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
