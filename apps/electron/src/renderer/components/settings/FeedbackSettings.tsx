/**
 * FeedbackSettings - 反馈渠道配置页
 *
 * 配置 GitHub fine-grained PAT（Issues 写权限，仅 GeoffBao/MyYoda 仓库），
 * 支持「测试连接」即时验证。token 用 safeStorage 加密存储，不回显明文。
 * 反馈会公开提交到仓库 Issues，页面给出创建 PAT 的指引链接。
 */

import * as React from 'react'
import { CheckCircle2, ExternalLink, Info, Loader2, XCircle } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsSecretInput,
  SettingsInput,
} from './primitives'
import type { FeedbackTestConnectionResult } from '@myyoda/shared'

const PAT_NEW_URL = 'https://github.com/settings/personal-access-tokens/new'

export function FeedbackSettings(): React.ReactElement {
  const [token, setToken] = React.useState('')
  const [repo, setRepo] = React.useState('GeoffBao/MyYoda')
  const [legacyNotionDetected, setLegacyNotionDetected] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<FeedbackTestConnectionResult | null>(null)
  const [savedHint, setSavedHint] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI
      .feedbackGetConfig()
      .then((config) => {
        setRepo(config.repo)
        setLegacyNotionDetected(config.legacyNotionDetected)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setSavedHint(false)
    try {
      await window.electronAPI.feedbackSaveConfig({ token: token || undefined })
      setToken('')
      setSavedHint(true)
      setLegacyNotionDetected(false)
      window.setTimeout(() => setSavedHint(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.feedbackTestConnection({ token: token || undefined })
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsSection
        title="意见反馈渠道"
        description="应用内提交的反馈会作为 Issue 公开提交到 GeoffBao/MyYoda 仓库。需要配置一个 GitHub fine-grained Personal Access Token（Issues 写权限）。"
      >
        <SettingsCard>
          <SettingsSecretInput
            label="GitHub Personal Access Token"
            description="在 GitHub 生成 fine-grained PAT：Repository access 选「Only select repositories」→ GeoffBao/MyYoda，Permissions → Issues → Read and write。使用系统加密存储，仅保存在本机。"
            value={token}
            onChange={setToken}
            placeholder={loaded ? (token ? '已填写（留空保持不变）' : 'github_pat_...') : '加载中...'}
          />
          <SettingsInput
            label="承载仓库"
            description="反馈提交的目标仓库（固定，无需修改）。"
            value={repo}
            onChange={() => undefined}
            disabled
            placeholder="GeoffBao/MyYoda"
          />
        </SettingsCard>
      </SettingsSection>

      {legacyNotionDetected && (
        <SettingsSection title="迁移提示">
          <SettingsCard divided={false}>
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-foreground/80">
              <Info size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <span>
                反馈已切换到 GitHub Issues，检测到旧的 Notion 配置不再使用。保存新配置后本条提示消失；旧字段可自行删除（~/.myyoda/feedback.json 中的 databaseId/tokenEncrypted）。
              </span>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection title="验证与保存">
        <SettingsCard divided={false}>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              测试连接
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !token.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              保存配置
            </button>
            {savedHint && <span className="text-xs text-primary">已保存 ✓</span>}
            <a
              href={PAT_NEW_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink size={12} />
              创建 Personal Access Token
            </a>
          </div>

          {testResult && (
            <div
              className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
                testResult.success
                  ? 'border-green-500/30 bg-green-500/[0.06] text-foreground'
                  : 'border-red-500/30 bg-red-500/[0.06] text-foreground'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-500" />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
