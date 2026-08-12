/**
 * Onboarding 视图组件
 *
 * 首次启动时显示的全屏欢迎界面。
 *
 * 流程：
 *  Step 1：欢迎 + 教程入口
 *  Step 2：Windows 环境检测（仅 Windows，其他平台自动跳过）
 */

import { useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { BookOpen, ChevronRight, ChevronLeft, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EnvironmentCheckPanel } from '@/components/environment/EnvironmentCheckPanel'
import { isShellEnvironmentOkAtom } from '@/atoms/environment'
import { detectIsWindows } from '@/lib/platform'

/** Onboarding 完成后的后续动作：打开教程 Tab / 打开渠道设置；不传则直接进入主界面 */
export type OnboardingCompleteAction = 'tutorial' | 'channels'

interface OnboardingViewProps {
  onComplete: (action?: OnboardingCompleteAction) => void
}

const TUTORIAL_ASSETS_BASE = 'https://github.com/GeoffBao/MyYoda/releases/download/tutorial-assets'

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState<'welcome' | 'environment'>('welcome')
  const isWindows = useMemo(() => detectIsWindows(), [])
  const shellOk = useAtomValue(isShellEnvironmentOkAtom)

  const handleFinish = async (action?: OnboardingCompleteAction) => {
    await window.electronAPI.updateSettings({ onboardingCompleted: true })
    onComplete(action)
  }

  const handleNextFromWelcome = () => {
    if (isWindows) {
      setStep('environment')
    } else {
      handleFinish()
    }
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-8">
      {step === 'welcome' && (
        <>
          <div className="mb-10 text-center">
            <h1 className="text-4xl font-bold mb-3">欢迎使用 MyYoda</h1>
            <p className="text-base text-muted-foreground max-w-md">
              面向研发组织的 AI Agent 工作台，整合 Chat、Code 两种工作模式
            </p>
          </div>

          {/* 宣传视频 */}
          <div className="w-full max-w-lg mb-6">
            <video
              controls
              muted
              poster={`${TUTORIAL_ASSETS_BASE}/promo-thumbnail.png`}
              className="w-full rounded-xl border border-border/30 shadow-lg"
              style={{ aspectRatio: '16/9' }}
            >
              <source src={`${TUTORIAL_ASSETS_BASE}/myyoda-promo-30s.mp4`} type="video/mp4" />
            </video>
          </div>

          <div className="w-full max-w-2xl space-y-3">
            {/* 主推：查看使用指南 */}
            <button
              onClick={() => handleFinish('tutorial')}
              className="w-full rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/15 p-4 flex items-center gap-4 hover:from-primary/10 hover:via-primary/15 hover:to-primary/10 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BookOpen size={20} className="text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">查看使用指南</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  了解 Chat / Project 模式、工作区管理、任务编排、Skills 系统等核心功能
                </p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground/50 flex-shrink-0" />
            </button>

            {/* 配置 AI 渠道：可跳过，避免首次进入 Chat/Code 因未配置渠道而空转 */}
            <button
              onClick={() => handleFinish('channels')}
              className="w-full rounded-xl border border-border/60 bg-card/50 p-4 flex items-center gap-4 hover:bg-card hover:border-border transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <KeyRound size={18} className="text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-foreground">配置 AI 渠道</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  添加 API Key，Chat / Code 才能正常对话（也可稍后随时在设置中配置）
                </p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground/50 flex-shrink-0" />
            </button>
          </div>

          <div className="w-full max-w-2xl mt-8 flex flex-col items-center gap-2">
            <Button className="w-full h-11 text-sm" onClick={handleNextFromWelcome}>
              {isWindows ? (
                <>
                  下一步：环境检测
                  <ChevronRight className="ml-1 h-4 w-4" />
                </>
              ) : (
                '直接开始使用'
              )}
            </Button>
            <p className="text-xs text-muted-foreground/50">
              以上内容均可在设置中随时访问
            </p>
          </div>
        </>
      )}

      {step === 'environment' && isWindows && (
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold mb-2">运行环境检测</h2>
            <p className="text-sm text-muted-foreground">
              Project 模式在 Windows 上需要 Git Bash 或 WSL 才能执行 Shell 命令
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 mb-6">
            <EnvironmentCheckPanel autoDetectOnMount />
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
                onClick={() => handleFinish()}
                variant={shellOk ? 'default' : 'outline'}
              >
                {shellOk ? '开始使用' : '稍后处理，进入主界面'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
