/**
 * GeneralSettings - 通用设置页
 *
 * 顶部：用户档案编辑（头像 + 用户名）
 * 下方：语言等通用设置
 */

import * as React from "react";
import { useAtom } from "jotai";
import { Camera, ImagePlus, Volume2 } from "lucide-react";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from "./primitives";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { UserAvatar } from "../chat/UserAvatar";
import { userProfileAtom } from "@/atoms/user-profile";
import {
  notificationsEnabledAtom,
  notificationSoundEnabledAtom,
  notificationSoundsAtom,
  updateNotificationsEnabled,
  updateNotificationSoundEnabled,
  updateNotificationSound,
  playNotificationSound,
  NOTIFICATION_SOUNDS,
  DEFAULT_NOTIFICATION_SOUNDS,
} from "@/atoms/notifications";
import {
  longTextPasteAsAttachmentEnabledAtom,
  richTextRenderingEnabledAtom,
  sessionHoverPreviewEnabledAtom,
  stickyUserMessageEnabledAtom,
  updateLongTextPasteAsAttachmentEnabled,
  updateRichTextRenderingEnabled,
  updateSessionHoverPreviewEnabled,
  updateStickyUserMessageEnabled,
} from "@/atoms/ui-preferences";
import { thinkingExpandedAtom } from "@/atoms/chat-atoms";
import { cn } from "@/lib/utils";
import { BUILTIN_AVATARS } from "@/lib/builtin-avatars";
import { Button } from "../ui/button";
import type {
  NotificationSoundId,
  NotificationSoundType,
  NotificationSoundSettings,
} from "@/types/settings";
import type { AgentThinkingLevel } from "@myyoda/shared";
import {
  DEFAULT_AGENT_THINKING_LEVEL,
} from "@myyoda/shared";
import {
  ThinkingLevelSlider,
  normalizeToUiIndex,
  uiIndexToLevel,
} from "@/components/ui/thinking-level-slider";

export function GeneralSettings(): React.ReactElement {
  const [userProfile, setUserProfile] = useAtom(userProfileAtom);
  const [notificationsEnabled, setNotificationsEnabled] = useAtom(
    notificationsEnabledAtom,
  );
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useAtom(
    notificationSoundEnabledAtom,
  );
  const [notificationSounds, setNotificationSounds] = useAtom(
    notificationSoundsAtom,
  );
  const [stickyUserMessageEnabled, setStickyUserMessageEnabled] = useAtom(
    stickyUserMessageEnabledAtom,
  );
  const [
    longTextPasteAsAttachmentEnabled,
    setLongTextPasteAsAttachmentEnabled,
  ] = useAtom(longTextPasteAsAttachmentEnabledAtom);
  const [richTextRenderingEnabled, setRichTextRenderingEnabled] = useAtom(
    richTextRenderingEnabledAtom,
  );
  const [sessionHoverPreviewEnabled, setSessionHoverPreviewEnabled] = useAtom(
    sessionHoverPreviewEnabledAtom,
  );
  const [thinkingExpanded, setThinkingExpanded] = useAtom(thinkingExpandedAtom);
  const [defaultThinkingLevel, setDefaultThinkingLevel] =
    React.useState<AgentThinkingLevel>(DEFAULT_AGENT_THINKING_LEVEL);
  const [codingMode, setCodingMode] = React.useState(false);
  const [isEditingName, setIsEditingName] = React.useState(false);
  const [nameInput, setNameInput] = React.useState(userProfile.userName);
  const [showAvatarPicker, setShowAvatarPicker] = React.useState(false);
  const [archiveAfterDays, setArchiveAfterDays] = React.useState<number>(7);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 加载归档天数 / 默认思考深度
  React.useEffect(() => {
    window.electronAPI
      .getSettings()
      .then((settings) => {
        setArchiveAfterDays(settings.archiveAfterDays ?? 7);
        setDefaultThinkingLevel(
          settings.defaultThinkingLevel ?? DEFAULT_AGENT_THINKING_LEVEL,
        );
        setCodingMode(settings.optimizedCoding ?? settings.codingMode ?? false);
      })
      .catch(console.error);
  }, []);

  /** 更新归档天数 */
  const handleArchiveDaysChange = async (value: string): Promise<void> => {
    const days = parseInt(value, 10);
    setArchiveAfterDays(days);
    try {
      await window.electronAPI.updateSettings({ archiveAfterDays: days });
    } catch (error) {
      console.error("[通用设置] 更新归档天数失败:", error);
    }
  };

  /** 更新新会话默认思考深度 */
  const handleDefaultThinkingLevelIndexChange = React.useCallback(
    (index: number): void => {
      const level = uiIndexToLevel(index);
      setDefaultThinkingLevel(level);
      window.electronAPI
        .updateSettings({ defaultThinkingLevel: level })
        .catch((error) => {
          console.error("[通用设置] 更新默认思考深度失败:", error);
        });
    },
    [],
  );

  /** 更新头像 */
  const handleAvatarChange = async (avatar: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateUserProfile({ avatar });
      setUserProfile(updated);
      setShowAvatarPicker(false);
    } catch (error) {
      console.error("[通用设置] 更新头像失败:", error);
    }
  };

  /** 上传图片作为头像 */
  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      await handleAvatarChange(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  /** 保存用户名 */
  const handleSaveName = async (): Promise<void> => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;

    try {
      const updated = await window.electronAPI.updateUserProfile({
        userName: trimmed,
      });
      setUserProfile(updated);
      setIsEditingName(false);
    } catch (error) {
      console.error("[通用设置] 更新用户名失败:", error);
    }
  };

  /** 用户名编辑键盘事件 */
  const handleNameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") {
      handleSaveName();
    } else if (e.key === "Escape") {
      setNameInput(userProfile.userName);
      setIsEditingName(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 用户档案区域 */}
      <SettingsSection title="用户档案" description="设置你的头像和显示名称">
        <SettingsCard>
          <div className="flex items-center gap-5 px-4 py-4">
            {/* 头像 + 内置头像选择器 */}
            <Popover open={showAvatarPicker} onOpenChange={setShowAvatarPicker}>
              <PopoverTrigger asChild>
                <div className="relative group/avatar cursor-pointer">
                  <UserAvatar avatar={userProfile.avatar} size={64} />
                  {/* 编辑覆盖层 */}
                  <div
                    className={cn(
                      "absolute inset-0 rounded-[20%] flex items-center justify-center",
                      "bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity",
                    )}
                  >
                    <Camera className="size-5 text-white" />
                  </div>
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={12}
                className="w-[336px] p-4 shadow-xl"
              >
                <p className="mb-3 text-sm font-medium text-foreground">
                  选择默认头像
                </p>
                <div className="grid grid-cols-6 gap-2">
                  {BUILTIN_AVATARS.map((avatar) => (
                    <button
                      key={avatar.id}
                      type="button"
                      title={avatar.label}
                      aria-label={`选择${avatar.label}头像`}
                      onClick={() => handleAvatarChange(avatar.id)}
                      className={cn(
                        "aspect-square overflow-hidden rounded-xl transition-transform duration-fast ease-out hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        userProfile.avatar === avatar.id
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                          : "hover:bg-foreground/[0.06]",
                      )}
                    >
                      <img
                        src={avatar.src}
                        alt=""
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
                {/* 上传自定义图片 */}
                <div className="mt-4 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px]",
                      "text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors",
                    )}
                  >
                    <ImagePlus className="size-4" />
                    上传自定义图片
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </div>
              </PopoverContent>
            </Popover>

            {/* 用户名 */}
            <div className="flex-1 min-w-0">
              {isEditingName ? (
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={handleNameKeyDown}
                  maxLength={30}
                  autoFocus
                  className={cn(
                    "text-lg font-semibold text-foreground bg-transparent border-b-2 border-primary",
                    "outline-none w-full max-w-[200px] pb-0.5",
                  )}
                />
              ) : (
                <button
                  onClick={() => {
                    setNameInput(userProfile.userName);
                    setIsEditingName(true);
                  }}
                  className="text-lg font-semibold text-foreground hover:text-primary transition-colors text-left"
                >
                  {userProfile.userName}
                </button>
              )}
              <p className="text-[12px] text-foreground/40 mt-0.5">
                点击头像更换，点击名字编辑
              </p>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 通用设置 */}
      <SettingsSection title="通用设置" description="应用的基本配置">
        <SettingsCard>
          <SettingsRow label="语言" description="更多语言支持即将推出">
            <span className="text-[13px] text-foreground/40">简体中文</span>
          </SettingsRow>
          <SettingsToggle
            label="桌面通知"
            description="Agent 完成任务或需要操作时发送通知"
            checked={notificationsEnabled}
            onCheckedChange={(checked) => {
              setNotificationsEnabled(checked);
              updateNotificationsEnabled(checked);
            }}
          />
          <SettingsToggle
            label="通知提示音"
            description="阻塞操作（权限确认、问题回答、计划审批）触发时播放提示音"
            checked={notificationSoundEnabled}
            disabled={!notificationsEnabled}
            onCheckedChange={(checked) => {
              setNotificationSoundEnabled(checked);
              updateNotificationSoundEnabled(checked);
            }}
          />
          <SoundPicker
            label="任务完成音效"
            type="taskComplete"
            sounds={notificationSounds}
            disabled={!notificationsEnabled || !notificationSoundEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(
                type,
                soundId,
                notificationSounds,
              );
              setNotificationSounds(newSounds);
            }}
          />
          <SoundPicker
            label="权限审批音效"
            type="permissionRequest"
            sounds={notificationSounds}
            disabled={!notificationsEnabled || !notificationSoundEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(
                type,
                soundId,
                notificationSounds,
              );
              setNotificationSounds(newSounds);
            }}
          />
          <SoundPicker
            label="计划审批音效"
            type="exitPlanMode"
            sounds={notificationSounds}
            disabled={!notificationsEnabled || !notificationSoundEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(
                type,
                soundId,
                notificationSounds,
              );
              setNotificationSounds(newSounds);
            }}
          />
          <SettingsRow
            label="自动归档"
            description="超过指定天数未更新的对话将自动归档（置顶对话除外）"
          >
            <Select
              value={String(archiveAfterDays)}
              onValueChange={handleArchiveDaysChange}
            >
              <SelectTrigger className="w-[120px] h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">禁用</SelectItem>
                <SelectItem value="3">3 天</SelectItem>
                <SelectItem value="7">7 天</SelectItem>
                <SelectItem value="14">14 天</SelectItem>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="60">60 天</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsToggle
            label="消息悬浮置顶条"
            description="滚动浏览对话时，在顶部显示最近的用户消息摘要"
            checked={stickyUserMessageEnabled}
            onCheckedChange={(checked) => {
              setStickyUserMessageEnabled(checked);
              updateStickyUserMessageEnabled(checked);
            }}
          />
          <SettingsToggle
            label="会话悬浮预览"
            description="开启后，鼠标悬浮左侧会话行时展示会话迷你地图；默认关闭以减少误触遮挡"
            checked={sessionHoverPreviewEnabled}
            onCheckedChange={(checked) => {
              setSessionHoverPreviewEnabled(checked);
              updateSessionHoverPreviewEnabled(checked);
            }}
          />
          <SettingsToggle
            label="长文本粘贴转附件"
            description="开启后，输入框粘贴超过 2000 字的文本会自动生成可预览编辑的附件"
            checked={longTextPasteAsAttachmentEnabled}
            onCheckedChange={(checked) => {
              setLongTextPasteAsAttachmentEnabled(checked);
              updateLongTextPasteAsAttachmentEnabled(checked);
            }}
          />
          <SettingsToggle
            label="输入框 Markdown 渲染"
            description="开启后，输入框中的 Markdown 语法（如 **粗体**、# 标题）会实时渲染为富文本；关闭后为纯文本模式，保留 @ 引用等功能"
            checked={richTextRenderingEnabled}
            onCheckedChange={(checked) => {
              setRichTextRenderingEnabled(checked);
              updateRichTextRenderingEnabled(checked);
            }}
          />
          <SettingsToggle
            label="默认展开思考过程"
            description="仅影响消息里 Thinking 块是否默认展开，不改变模型是否思考；本会话思考深度请在输入栏调节"
            checked={thinkingExpanded}
            onCheckedChange={setThinkingExpanded}
          />
          <SettingsRow
            label="新会话默认思考深度"
            description={
              codingMode
                ? "编码优化模式开启中：固定为 max（关闭开关后可调整）"
                : "仅作为新建会话的初始值，可在输入栏按会话覆盖"
            }
          >
            <div className="w-56">
              <ThinkingLevelSlider
                value={
                  codingMode
                    ? normalizeToUiIndex("max")
                    : normalizeToUiIndex(defaultThinkingLevel)
                }
                onValueChange={handleDefaultThinkingLevelIndexChange}
                disabled={codingMode}
                locale="cn"
              />
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

// ===== SoundPicker 内部组件 =====

interface SoundPickerProps {
  label: string;
  type: NotificationSoundType;
  sounds: NotificationSoundSettings;
  disabled: boolean;
  onSoundChange: (
    type: NotificationSoundType,
    soundId: NotificationSoundId,
  ) => void;
}

/** 单个场景的通知音选择器（下拉 + 试听按钮） */
function SoundPicker({
  label,
  type,
  sounds,
  disabled,
  onSoundChange,
}: SoundPickerProps): React.ReactElement {
  const currentId = sounds[type] ?? DEFAULT_NOTIFICATION_SOUNDS[type];

  return (
    <SettingsRow label={label}>
      <div className="flex items-center gap-1.5">
        <Select
          value={currentId}
          onValueChange={(value) =>
            onSoundChange(type, value as NotificationSoundId)
          }
          disabled={disabled}
        >
          <SelectTrigger className="w-[130px] h-8 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_SOUNDS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
            <SelectItem value="none">无</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled || currentId === "none"}
          onClick={() => {
            void playNotificationSound(currentId);
          }}
          title="试听"
        >
          <Volume2 size={14} />
        </Button>
      </div>
    </SettingsRow>
  );
}
