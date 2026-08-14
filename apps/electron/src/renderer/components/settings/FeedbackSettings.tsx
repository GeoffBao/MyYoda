/**
 * FeedbackSettings - 反馈渠道配置页
 *
 * 配置 Notion 内部集成（token + 数据库 ID），
 * 支持「测试连接」即时验证。token 用 safeStorage 加密存储，不回显明文。
 */

import * as React from 'react'
import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsSecretInput,
  SettingsInput,
} from './primitives'
import type { FeedbackTestConnectionResult } from '@myyoda/shared'

const NOTION_CONNECTIONS_URL = 'https://www.notion.so/profile/integrations'

export function FeedbackSettings(): React.ReactElement {
  const [token, setToken] = React.useState('')
  const [databaseId, setDatabaseId] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<FeedbackTestConnectionResult | null>(null)
  const [savedHint, setSavedHint] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI
      .feedbackGetConfig()
      .then((config) => {
        setDatabaseId(config.databaseId)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setSavedHint(false)
    try {
      await window.electronAPI.feedbackSaveConfig({ token: token || undefined, databaseId })
      setToken('')
      setSavedHint(true)
      window.setTimeout(() => setSavedHint(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.feedbackTestConnection({ token: token || undefined, databaseId })
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsSection
        title="意见反馈渠道"
        description="把应用内提交的反馈直接写入你的 Notion 数据库。需要先在 Notion 创建一个内部连接（Connection），并把反馈页面授权给它。"
      >
        <SettingsCard>
          <SettingsSecretInput
            label="连接 Token"
            description="Notion Connections 页里集成（Connection）的 Internal token，形如 ntn_xxx。使用系统加密存储，仅保存在本机。"
            value={token}
            onChange={setToken}
            placeholder={loaded ? (token ? '已填写（留空保持不变）' : 'ntn_...') : '加载中...'}
          />
          <SettingsInput
            label="数据库 ID"
            description="反馈数据库的 32 位 ID（打开数据库页面，从地址栏复制；或粘贴数据库完整链接后只保留 ID 部分）。"
            value={databaseId}
            onChange={setDatabaseId}
            placeholder="例如 4bdde411-b205-42a7-9be5-a9f51fa02698"
          />
        </SettingsCard>
      </SettingsSection>

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
            disabled={saving || !databaseId.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            保存配置
          </button>
          {savedHint && <span className="text-xs text-primary">已保存 ✓</span>}
          <a
            href={NOTION_CONNECTIONS_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink size={12} />
            打开 Notion Connections 页面
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
