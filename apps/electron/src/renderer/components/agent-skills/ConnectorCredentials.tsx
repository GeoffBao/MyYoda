/**
 * ConnectorCredentials — 外部 npx 连接器通用凭据配置表单
 *
 * Phase 2 接入的 8 个连接器（github/gitlab/notion/figma/brave-search/exa/
 * browserbase/sqlite）凭据字段各不相同，但交互一致：字段输入 blur 静默保存
 * 到 chat-tools.json toolCredentials[<id>] + 内置 MCP 开关 + 可用状态展示。
 * 用一个字段驱动组件覆盖全部，避免为每个连接器复制一份设置表单。
 */

import * as React from 'react'
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, PlugZap, ShieldCheck, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'

/** 单个凭据字段定义 */
export interface ConnectorCredentialField {
  /** toolCredentials[connectorId] 的键 */
  key: string
  label: string
  placeholder?: string
  /** 是否密文（眼睛切换） */
  secret?: boolean
  /** 可选字段（留空视为未配置，不阻断可用性） */
  optional?: boolean
}

export interface ConnectorCredentialSpec {
  /** 说明文案（显示在表单顶部） */
  description: string
  /** 认证方式展示文案（如「Personal Access Token」） */
  authType: string
  /** 本连接器将访问的数据/能力范围 */
  permissions?: string[]
  /** 获取凭据的直达链接（如 GitHub Settings → Tokens） */
  helpUrl?: string
  /** 链接按钮文案（默认「获取 Token」） */
  helpLabel?: string
  fields: ConnectorCredentialField[]
}

/** 各连接器的凭据字段与说明（与 npx-connector-mcp.ts 的 envMap 对应） */
export const CONNECTOR_CREDENTIAL_SPECS: Record<string, ConnectorCredentialSpec> = {
  github: {
    description: '在 GitHub Settings → Developer settings → Personal access tokens 创建 Token（建议只勾 repo 权限）。',
    authType: 'Personal Access Token',
    permissions: ['读取仓库、Issues、Pull Requests、Commits、Branches'],
    helpUrl: 'https://github.com/settings/tokens',
    helpLabel: '创建 Personal Access Token',
    fields: [
      { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...', secret: true },
    ],
  },
  gitlab: {
    description: '在 GitLab User Settings → Access Tokens 创建 Token（勾选 api 权限）。自建实例可填 API 地址。',
    authType: 'Personal Access Token',
    permissions: ['读取项目、Issues、Merge Requests、Commits'],
    helpUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    helpLabel: '创建 Access Token',
    fields: [
      { key: 'token', label: 'Personal Access Token', placeholder: 'glpat-...', secret: true },
      { key: 'apiUrl', label: 'API 地址（可选，自建实例填）', placeholder: 'https://gitlab.com/api/v4', optional: true },
    ],
  },
  notion: {
    description: '在 notion.so/my-integrations 创建集成并复制 Token（ntn_ 开头），然后把要访问的页面 Share 给该集成。',
    authType: 'API Token（ntn_）',
    permissions: ['读取已授权的页面与数据库内容'],
    helpUrl: 'https://notion.so/my-integrations',
    helpLabel: '创建 Notion 集成',
    fields: [
      { key: 'token', label: 'Notion Token', placeholder: 'ntn_...', secret: true },
    ],
  },
  figma: {
    description: '在 Figma Settings → Security → Personal access tokens 生成 Token（需 File content 读取权限）。',
    authType: 'Personal Access Token',
    permissions: ['读取文件、图层、样式与组件库'],
    helpUrl: 'https://www.figma.com/settings',
    helpLabel: '生成 Figma Token',
    fields: [
      { key: 'apiKey', label: 'Figma API Key', placeholder: 'figd_...', secret: true },
    ],
  },
  'brave-search': {
    description: '在 brave.com/search/api 免费申请 API Key（每月有免费额度）。',
    authType: 'API Key',
    permissions: ['发起公开网络搜索请求'],
    helpUrl: 'https://brave.com/search/api/',
    helpLabel: '申请 Brave API Key',
    fields: [
      { key: 'apiKey', label: 'Brave Search API Key', placeholder: 'BSA...', secret: true },
    ],
  },
  exa: {
    description: '在 dashboard.exa.ai/api-keys 获取 API Key。',
    authType: 'API Key',
    permissions: ['发起语义/关键词网络搜索'],
    helpUrl: 'https://dashboard.exa.ai/api-keys',
    helpLabel: '获取 Exa API Key',
    fields: [
      { key: 'apiKey', label: 'Exa API Key', placeholder: '...', secret: true },
    ],
  },
  browserbase: {
    description: '在 browserbase.com 控制台获取 API Key 与 Project ID（browserbase.com/dashboard）。',
    authType: 'API Key + Project ID',
    permissions: ['创建和管理云端浏览器会话'],
    helpUrl: 'https://www.browserbase.com/dashboard',
    helpLabel: '打开 Browserbase 控制台',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'bb_live_...', secret: true },
      { key: 'projectId', label: 'Project ID', placeholder: '...' },
    ],
  },
  sqlite: {
    description: '填写本地 SQLite 数据库文件路径，Agent 将获得只读查询能力（SELECT/PRAGMA）。',
    authType: '本地文件路径',
    permissions: ['只读查询本地 SQLite 数据库'],
    fields: [
      { key: 'dbPath', label: '数据库文件路径', placeholder: '/Users/you/data/app.db' },
    ],
  },
}

interface ConnectorCredentialsProps {
  connectorId: string
  /** 外部 spec 覆盖（市场连接器用：CONNECTOR_CREDENTIAL_SPECS 查不到时用条目动态构造） */
  specOverride?: ConnectorCredentialSpec
  /** 凭据保存/开关切换成功后回调（用于刷新卡片网格状态） */
  onChanged?: () => void
}

export function ConnectorCredentials({ connectorId, specOverride, onChanged }: ConnectorCredentialsProps): React.ReactElement {
  const spec = CONNECTOR_CREDENTIAL_SPECS[connectorId] ?? specOverride
  if (!spec) {
    return <div className="text-sm text-muted-foreground">该连接器无需凭据配置。</div>
  }
  /** 市场 CLI 连接器：无凭据字段（specOverride 且 fields 为空）→ 隐藏开关/测试连接 */
  const isCliLike = Boolean(specOverride && spec.fields.length === 0)

  const { workspaces, currentWorkspaceId } = useWorkspaceActions()
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [visible, setVisible] = React.useState<Record<string, boolean>>({})
  const [enabled, setEnabled] = React.useState(false)
  const [available, setAvailable] = React.useState(false)
  const [availabilityReason, setAvailabilityReason] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)

  const savedRef = React.useRef<Record<string, string>>({})

  const refreshServerState = React.useCallback(async (slug: string): Promise<void> => {
    try {
      const caps = await window.electronAPI.getWorkspaceCapabilities(slug)
      const server = caps.builtinMcpServers.find((s) => s.id === connectorId)
      if (server) {
        setEnabled(server.enabled)
        setAvailable(server.available)
        setAvailabilityReason(server.availabilityReason)
      }
    } catch (err) {
      console.error(`[连接器凭据] 刷新状态失败（${connectorId}）:`, err)
    }
  }, [connectorId])

  React.useEffect(() => {
    let cancelled = false
    const init: Record<string, string> = {}
    for (const field of spec.fields) init[field.key] = ''
    if (!workspaceSlug) {
      setValues(init)
      savedRef.current = init
      setLoading(false)
      return
    }
    Promise.all([
      window.electronAPI.getChatToolCredentials(connectorId),
      window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
    ])
      .then(([credentials, caps]) => {
        if (cancelled) return
        const next: Record<string, string> = {}
        for (const field of spec.fields) {
          next[field.key] = (credentials as Record<string, string | undefined>)[field.key] ?? ''
        }
        setValues(next)
        savedRef.current = next
        const server = caps.builtinMcpServers.find((s) => s.id === connectorId)
        if (server) {
          setEnabled(server.enabled)
          setAvailable(server.available)
          setAvailabilityReason(server.availabilityReason)
        }
      })
      .catch((err: unknown) => console.error(`[连接器凭据] 加载失败（${connectorId}）:`, err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [connectorId, workspaceSlug, spec])

  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current: Record<string, string> = {}
    for (const field of spec.fields) current[field.key] = (values[field.key] ?? '').trim()
    const saved = savedRef.current
    const changed = spec.fields.some((f) => current[f.key] !== saved[f.key])
    if (!changed) return
    try {
      await window.electronAPI.updateChatToolCredentials(connectorId, current)
      savedRef.current = current
      toast.success('凭据已保存')
      if (workspaceSlug) await refreshServerState(workspaceSlug)
      onChanged?.()
    } catch (error) {
      console.error(`[连接器凭据] 保存失败（${connectorId}）:`, error)
      toast.error('保存失败')
    }
  }, [connectorId, values, workspaceSlug, spec, refreshServerState, onChanged])

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!workspaceSlug) {
      toast.error('请先选择工作区')
      return
    }
    try {
      await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, connectorId, checked)
      setEnabled(checked)
      await refreshServerState(workspaceSlug)
      onChanged?.()
    } catch (error) {
      console.error(`[连接器凭据] 切换失败（${connectorId}）:`, error)
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
  }

  const handleTest = async (): Promise<void> => {
    // 先保存可能的未落盘修改
    await handleBlurSave()
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testBuiltinConnector(connectorId)
      setTestResult(result)
      if (result.success && workspaceSlug) await refreshServerState(workspaceSlug)
    } catch (error) {
      console.error(`[连接器凭据] 测试失败（${connectorId}）:`, error)
      setTestResult({ success: false, message: '测试请求失败，请重试' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
          认证方式：{spec.authType}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{spec.description}</p>

      {spec.helpUrl && (
        <a
          href={spec.helpUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border/60 bg-content-area/40 px-3 py-1.5 text-[12px] font-medium text-blue-600 transition-colors hover:bg-muted/60 hover:text-blue-500 dark:text-blue-400"
        >
          <ExternalLink size={13} />
          {spec.helpLabel ?? '获取 Token'}
        </a>
      )}

      {spec.permissions && spec.permissions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-content-area/40 p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            <ShieldCheck size={14} className="text-muted-foreground" />
            <span>本连接器可访问的范围</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {spec.permissions.map((permission) => (
              <span
                key={permission}
                className="rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {permission}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {spec.fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-foreground">
              {field.label}
              {field.optional && <span className="ml-1 text-[11px] font-normal text-muted-foreground">可选</span>}
            </label>
            <div className="relative">
              <input
                type={field.secret && !visible[field.key] ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={() => void handleBlurSave()}
                className={cn(
                  'h-9 w-full rounded-lg border border-border/60 bg-content-area px-3 text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40',
                  field.secret && 'pr-9',
                )}
              />
              {field.secret && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setVisible((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground/70"
                >
                  {visible[field.key] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 市场 CLI 连接器：无凭据字段，隐藏开关/测试连接，仅展示说明 */}
      {!isCliLike && (
        <>
          <div className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-foreground">启用连接器</span>
              <span className="text-[11px] text-muted-foreground">
                {available ? '凭据有效，启用后即可注入 Agent 会话' : (availabilityReason ?? '凭据未配置')}
              </span>
            </div>
            <Switch checked={enabled} onCheckedChange={(checked) => void handleToggle(checked)} />
          </div>

          {/* 测试连接 */}
          <div className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-foreground">测试连接</span>
              <span className="text-[11px] text-muted-foreground">用当前凭据调用官方 API 验证有效性</span>
            </div>
            <Button variant="outline" size="sm" disabled={testing} onClick={() => void handleTest()}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
              <span>{testing ? '测试中...' : '测试连接'}</span>
            </Button>
          </div>
        </>
      )}
      {testResult && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] leading-relaxed',
            testResult.success
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-500/10 text-red-600 dark:text-red-400',
          )}
        >
          {testResult.success ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
          <span>{testResult.message}</span>
        </div>
      )}
    </div>
  )
}
