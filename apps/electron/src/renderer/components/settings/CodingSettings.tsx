/**
 * CodingSettings - 编码优化设置页
 *
 * 收纳编码优化相关设置：
 * - Coding 加强（DeepSeek 编码增强一体开关）
 * - Graphify 环境（图谱引擎安装/卸载）
 * - CodeClaw 桌面助手（开关 + 宠物主题）
 * - Git/PR 标识（Agent 代提交时的推广标识）
 *
 * 2026-08-18 自「通用设置」独立：编码优化成为单独左侧标签（同步 Yoda PR #65）。
 */

import * as React from "react";
import { useAtom } from "jotai";
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from "./primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from '../ui/button'
import type { CodeClawThemeId } from '@myyoda/shared'
import { CODECLAW_THEMES, DEFAULT_CODECLAW_THEME_ID, isCodeClawThemeId } from '@myyoda/shared'
import { repoMapToolsAtom } from '@/atoms/settings-tab'

export function CodingSettings(): React.ReactElement {
  const [codingMode, setCodingMode] = React.useState(false);
  /** Git/PR 推广标识：默认开启 */
  const [gitAttributionEnabled, setGitAttributionEnabled] =
    React.useState(true);
  const [codeClawEnabled, setCodeClawEnabled] = React.useState(false);
  const [codeClawThemeId, setCodeClawThemeId] = React.useState<CodeClawThemeId>(
    DEFAULT_CODECLAW_THEME_ID,
  );
  /** 代码图谱工具开关（repo map 注入 + Graphify 知识图谱；与设置浮窗/会话页共享 atom 即时联动） */
  const [, setRepoMapTools] = useAtom(repoMapToolsAtom);
  /** graphify 安装状态（设置区仅依赖全局命令可用性） */
  const [graphifyInstalled, setGraphifyInstalled] = React.useState<
    boolean | undefined
  >(undefined);
  /** 一键安装/卸载进行中 */
  const [graphifyOpRunning, setGraphifyOpRunning] = React.useState(false);
  /** 安装/卸载日志（最近若干行） */
  const [graphifyOpLog, setGraphifyOpLog] = React.useState<string[]>([]);

  // 加载编码优化相关设置
  React.useEffect(() => {
    window.electronAPI
      .getSettings()
      .then((settings) => {
        setCodingMode(settings.optimizedCoding ?? settings.codingMode ?? false);
        setGitAttributionEnabled(settings.gitAttributionEnabled ?? true);
        setCodeClawEnabled(settings.codeClaw?.enabled ?? false);
        setCodeClawThemeId(
          isCodeClawThemeId(settings.codeClaw?.themeId)
            ? settings.codeClaw.themeId
            : DEFAULT_CODECLAW_THEME_ID,
        );
        setRepoMapTools(settings.repoMapTools ?? false);
      })
      .catch(console.error);
  }, []);

  // 图谱工具：读取 graphify 安装状态 + 订阅安装/卸载进度
  React.useEffect(() => {
    window.electronAPI
      .getRepoMapToolsState("")
      .then((state) => {
        setGraphifyInstalled(state.graphifyInstalled);
      })
      .catch(console.error);
    const offProgress = window.electronAPI.onRepoMapToolsInstallProgress(
      (line) => {
        setGraphifyOpLog((prev) => [...prev.slice(-30), line]);
      },
    );
    const offStatus = window.electronAPI.onRepoMapToolsStatus((state) => {
      setGraphifyInstalled(state.graphifyInstalled);
    });
    return () => {
      offProgress();
      offStatus();
    };
  }, []);

  /** 更新 Git/PR 推广标识开关 */
  const handleGitAttributionChange = async (
    checked: boolean,
  ): Promise<void> => {
    setGitAttributionEnabled(checked);
    try {
      await window.electronAPI.updateSettings({
        gitAttributionEnabled: checked,
      });
    } catch (error) {
      console.error("[编码优化] 更新 Git/PR 标识失败:", error);
      setGitAttributionEnabled(!checked);
    }
  };

  /** 更新 CodeClaw 开关 */
  const handleCodeClawChange = async (checked: boolean): Promise<void> => {
    setCodeClawEnabled(checked);
    try {
      const settings = await window.electronAPI.getSettings();
      await window.electronAPI.updateSettings({
        codeClaw: { ...(settings.codeClaw ?? {}), enabled: checked },
      });
    } catch (error) {
      console.error("[编码优化] 更新 CodeClaw 失败:", error);
      setCodeClawEnabled(!checked);
    }
  };

  /** 更新 CodeClaw 宠物主题 */
  const handleCodeClawThemeChange = async (value: string): Promise<void> => {
    if (!isCodeClawThemeId(value)) return;
    const previous = codeClawThemeId;
    setCodeClawThemeId(value);
    try {
      const settings = await window.electronAPI.getSettings();
      await window.electronAPI.updateSettings({
        codeClaw: { ...(settings.codeClaw ?? {}), themeId: value },
      });
      await window.electronAPI.codeClaw.setTheme(value);
    } catch (error) {
      console.error("[编码优化] 更新 CodeClaw 主题失败:", error);
      setCodeClawThemeId(previous);
    }
  };

  return (
    <div>
      <SettingsSection title="编码优化" description="编码增强、代码图谱、桌面助手与推广标识">
        <SettingsCard>
          {/* ===== Coding 加强 ===== */}
          <SettingsToggle
            label="Coding 加强"
            description={
              <>
                一键开启全部编码增强（默认关闭）
                <div className="mt-2 space-y-1 text-[12px] leading-relaxed text-foreground/55">
                  <div>
                    <span className="text-foreground/90 font-medium">
                      模型与输出
                    </span>
                    <span className="ml-1">
                      ：DeepSeek 专属编码规范 · Chat 输出预算 64K ·
                      新会话思考深度默认 max
                    </span>
                  </div>
                  <div>
                    <span className="text-foreground/90 font-medium">
                      编码技能
                    </span>
                    <span className="ml-1">
                      ：code-review · ultraqa · deep-interview ·
                      ai-slop-cleaner 预置技能
                    </span>
                  </div>
                  <div>
                    <span className="text-foreground/90 font-medium">
                      代码知识
                    </span>
                    <span className="ml-1">
                      ：仓库代码地图（repo map）自动注入 · Graphify
                      图谱（对话栏主动创建）
                    </span>
                  </div>
                </div>
              </>
            }
            checked={codingMode}
            onCheckedChange={(checked) => {
              // 乐观更新：先切 UI 再持久化，失败回滚（对齐 gitAttribution 开关模式）
              // 总开关同时控制 optimizedCoding 与 repoMapTools（编码增强一体开启）
              setCodingMode(checked);
              setRepoMapTools(checked);
              void window.electronAPI
                .updateSettings({
                  optimizedCoding: checked,
                  repoMapTools: checked,
                })
                .catch((error) => {
                  console.error("[编码优化] 更新 Coding 加强失败:", error);
                  setCodingMode(!checked);
                  setRepoMapTools(!checked);
                });
            }}
          />
          {/* 子菜单标题：与行 label 同款（14px），与 Coding 加强 label 同级 */}
          <div className="px-4 pt-3 pb-1 text-sm text-foreground/90">
            Graphify 环境
          </div>
          <SettingsRow
            label="图谱引擎"
            description={
              graphifyInstalled === undefined
                ? "检测中…"
                : graphifyInstalled
                  ? "已安装。纯本地 AST 构建（零 LLM、代码不出本机），大仓库首次构建约 40 秒~2 分钟。"
                  : "未安装。一键安装 graphify（Python 生态，PyPI 包名 graphifyy）；也可把「让 AI 帮你装」提示词发给 Agent 会话。"
            }
          >
            <div className="flex flex-col gap-2 w-full min-w-0">
              <div className="flex items-center gap-2">
                {!graphifyInstalled && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={graphifyOpRunning}
                    onClick={() => {
                      setGraphifyOpRunning(true);
                      setGraphifyOpLog([]);
                      void window.electronAPI
                        .installGraphify()
                        .then((result) => {
                          setGraphifyOpRunning(false);
                          if (!result.ok) {
                            setGraphifyOpLog((prev) => [
                              ...prev,
                              `[失败] ${result.error ?? "未知错误"}`,
                            ]);
                          } else {
                            setGraphifyInstalled(true);
                          }
                        });
                    }}
                  >
                    {graphifyOpRunning ? "安装中…" : "一键安装"}
                  </Button>
                )}
                {graphifyInstalled && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={graphifyOpRunning}
                    onClick={() => {
                      setGraphifyOpRunning(true);
                      setGraphifyOpLog([]);
                      void window.electronAPI
                        .uninstallGraphify()
                        .then((result) => {
                          setGraphifyOpRunning(false);
                          if (result.ok) {
                            setGraphifyInstalled(false);
                          } else {
                            setGraphifyOpLog((prev) => [
                              ...prev,
                              `[失败] ${result.error ?? "未知错误"}`,
                            ]);
                          }
                        });
                    }}
                  >
                    {graphifyOpRunning ? "卸载中…" : "卸载"}
                  </Button>
                )}
                {graphifyInstalled !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void window.electronAPI
                        .getRepoMapToolsState("")
                        .then((state) => {
                          setGraphifyInstalled(state.graphifyInstalled);
                        })
                        .catch(console.error);
                    }}
                  >
                    重新检测
                  </Button>
                )}
              </div>
              {graphifyOpLog.length > 0 && (
                <pre className="text-xs text-muted-foreground max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border p-2">
                  {/* pip 进度条用 \r 回车刷新：转成换行，避免累积成超长单行撑破布局（2026-08-14） */}
                  {graphifyOpLog.join("").replace(/\r/g, "\n")}
                </pre>
              )}
            </div>
          </SettingsRow>
          <SettingsToggle
            label="CodeClaw"
            description="在桌面显示 MyYoda Agent 助手：执行中、完成、错误或需要你接手时用动画提醒"
            checked={codeClawEnabled}
            onCheckedChange={(checked) => {
              void handleCodeClawChange(checked);
            }}
          />
          <SettingsRow
            label="CodeClaw 宠物"
            description="Calico / Clawd / Cloudling 使用 clawd-on-desk 的 AGPL 主题素材并保留许可证说明"
          >
            <Select
              value={codeClawThemeId}
              onValueChange={(value) => {
                void handleCodeClawThemeChange(value);
              }}
              disabled={!codeClawEnabled}
            >
              <SelectTrigger className="w-[180px] h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODECLAW_THEMES.map((theme) => (
                  <SelectItem key={theme.id} value={theme.id}>
                    {theme.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsToggle
            label="Git/PR 标识"
            description="Agent 代你提交 commit 或创建 PR 时，附加 Co-Authored-By: MyYoda <MyYoda@noreply.github.com> 与仓库链接，便于推广；可随时关闭"
            checked={gitAttributionEnabled}
            onCheckedChange={(checked) => {
              void handleGitAttributionChange(checked);
            }}
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
