/**
 * ToolSettings - 工具设置页
 *
 * Chat 模式「增强工具」统一管理 tab。
 * 联网搜索 + Nano Banana 生图 + 自定义 HTTP 工具配置。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { SettingsSection, SettingsCard } from './primitives'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { toolSettingsFocusAtom, type ToolSettingsFocus } from '@/atoms/settings-tab'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'

/** 企业微信内置 MCP 的 toolId（chat-tools.json toolCredentials 键） */
const WECOM_TOOL_ID = 'wecom'

/** Readwise 内置 MCP 的 toolId */
const READWISE_TOOL_ID = 'readwise'

/** 微信读书内置 MCP 的 toolId */
const WEREAD_TOOL_ID = 'weread'

/**
 * 企业微信工具设置区域
 *
 * 通过官方 wecom-cli 的 MCP server 模式（@wecom/cli mcp-server --transport stdio）
 * 让 Agent 直接操作企业微信：消息、文档、智能表格、日程、会议、待办、通讯录。
 * 凭据（Bot ID / Secret）保存到 chat-tools.json，注入时作为环境变量传给 CLI；
 * 也可在终端直接执行 wecom-cli auth init 扫码授权，两种方式互不冲突。
 */
function WecomSettings(): React.ReactElement {
  const { workspaces, currentWorkspaceId } = useWorkspaceActions()
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  const [botId, setBotId] = React.useState('')
  const [botSecret, setBotSecret] = React.useState('')
  const [showSecret, setShowSecret] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [available, setAvailable] = React.useState(false)
  const [availabilityReason, setAvailabilityReason] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)

  const savedRef = React.useRef({ botId: '', botSecret: '' })

  const refreshServerState = React.useCallback(async (slug: string): Promise<void> => {
    try {
      const caps = await window.electronAPI.getWorkspaceCapabilities(slug)
      const server = caps.builtinMcpServers.find((s) => s.id === WECOM_TOOL_ID)
      if (server) {
        setEnabled(server.enabled)
        setAvailable(server.available)
        setAvailabilityReason(server.availabilityReason)
      }
    } catch (err) {
      console.error('[企业微信设置] 刷新状态失败:', err)
    }
  }, [])

  // 加载已保存凭据 + 内置 MCP 开关/可用状态
  React.useEffect(() => {
    let cancelled = false
    if (!workspaceSlug) {
      setLoading(false)
      return
    }
    Promise.all([
      window.electronAPI.getChatToolCredentials(WECOM_TOOL_ID),
      window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
    ])
      .then(([credentials, caps]) => {
        if (cancelled) return
        if (credentials.botId) setBotId(credentials.botId)
        if (credentials.botSecret) setBotSecret(credentials.botSecret)
        savedRef.current = { botId: credentials.botId || '', botSecret: credentials.botSecret || '' }
        const server = caps.builtinMcpServers.find((s) => s.id === WECOM_TOOL_ID)
        if (server) {
          setEnabled(server.enabled)
          setAvailable(server.available)
          setAvailabilityReason(server.availabilityReason)
        }
      })
      .catch((err: unknown) => {
        console.error('[企业微信设置] 加载失败:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceSlug])

  /** 静默保存凭据（blur 时触发），保存后刷新可用状态 */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current = { botId: botId.trim(), botSecret: botSecret.trim() }
    const saved = savedRef.current
    if (current.botId === saved.botId && current.botSecret === saved.botSecret) return
    try {
      await window.electronAPI.updateChatToolCredentials(WECOM_TOOL_ID, current)
      savedRef.current = current
      toast.success('企业微信设置已保存')
      if (workspaceSlug) await refreshServerState(workspaceSlug)
    } catch (error) {
      console.error('[企业微信设置] 保存失败:', error)
    }
  }, [botId, botSecret, workspaceSlug, refreshServerState])

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!workspaceSlug) {
      toast.error('请先选择工作区')
      return
    }
    try {
      await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, WECOM_TOOL_ID, checked)
      setEnabled(checked)
      await refreshServerState(workspaceSlug)
      toast.success(checked ? '企业微信 MCP 已启用' : '企业微信 MCP 已关闭')
    } catch (error) {
      console.error('[企业微信设置] 切换失败:', error)
      toast.error('切换企业微信 MCP 状态失败')
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="企业微信"
      description="启用后 Agent 可以直接操作企业微信：消息、文档、智能表格、日程、会议、待办、通讯录"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={!workspaceSlug}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 状态提示 */}
          <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${available ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted/50 text-muted-foreground'}`}>
            {available ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
            <span>{available ? '凭据已就绪，Agent 会话可注入企业微信工具' : (availabilityReason ?? '尚未配置凭据')}</span>
          </div>

          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>企业微信基于官方开源 <span className="font-medium text-foreground">wecom-cli</span> 的 MCP server 模式接入，Agent 可发送消息、查会话、管日程/待办/会议、读写文档与智能表格。</p>
            <p className="text-xs">配置步骤（详细图文见{' '}
              <a
                href="https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21677"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                企微帮助中心「如何获取 Bot ID 和 Secret」
                <ExternalLink size={10} />
              </a>
              ）：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>打开企业微信 App → <span className="font-medium text-foreground">工作台 → 智能机器人 → 创建机器人 → 手动创建</span>，在创建页选择「API 模式」</li>
              <li>连接方式选「<span className="font-medium text-foreground">长连接</span>」（无需公网域名/IP），页面会自动生成 <span className="font-medium text-foreground">Bot ID</span> 和 <span className="font-medium text-foreground">Secret</span>，复制填入下方（也可不填，直接在终端执行 <code className="rounded bg-muted px-1 font-mono">wecom-cli auth init</code> 扫码授权）</li>
              <li>建议在机器人「编辑 → 可用权限」里确认可见范围与权限（通讯录/消息/文档等）</li>
              <li>开启上方开关，新会话中 Agent 即可调用企业微信工具</li>
            </ol>
            <p className="text-xs text-muted-foreground/70">
              权限说明：① ≤10 人小团队——个人创建即可用全部能力（消息/文档/日程/会议/待办/通讯录），无需审批；② 10 人以上企业——机器人以「机器人身份」调用，当前开放文档/待办能力，机器人默认只能访问自己创建的文档，读取成员既有文档需把文档授权给机器人（否则报 851003 无权限），如需调整机器人权限请联系企业管理员（管理后台可管理长连接机器人的成员权限）。
            </p>
            <p className="text-xs text-muted-foreground/70">
              环境要求：本机 Node.js ≥ 18 且能通过 npx 拉取 <code className="rounded bg-muted px-1 font-mono">@wecom/cli</code>；首次启用会下载 npm 包。
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bot ID</label>
            <Input
              type="text"
              placeholder="ww 开头的企业微信机器人 ID"
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              onBlur={handleBlurSave}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bot Secret</label>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                placeholder="智能机器人 Secret"
                value={botSecret}
                onChange={(e) => setBotSecret(e.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">留空则依赖终端 wecom-cli auth init 的本地授权</p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}


/** 刷新全局工具列表 atom */
async function refreshChatTools(setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getChatTools>>) => void): Promise<void> {
  try {
    const tools = await window.electronAPI.getChatTools()
    setter(tools)
  } catch (err) {
    console.error('[ToolSettings] 刷新工具列表失败:', err)
  }
}

/** 联网搜索工具设置区域 */
function WebSearchSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  const setChatTools = useSetAtom(chatToolsAtom)

  // 已保存的 API Key（用于判断是否有变更）
  const savedApiKeyRef = React.useRef('')

  // 从主进程加载当前配置 + 凭据
  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('web-search'),
    ]).then(([tools, credentials]) => {
      const searchTool = tools.find((t) => t.meta.id === 'web-search')
      if (searchTool) {
        setEnabled(searchTool.enabled)
      }
      if (credentials.apiKey) {
        setApiKey(credentials.apiKey)
        savedApiKeyRef.current = credentials.apiKey
      }
    }).catch((err: unknown) => {
      console.error('[联网搜索设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  /** 静默保存 API Key（blur 时触发） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (trimmed === savedApiKeyRef.current) return
    try {
      await window.electronAPI.updateChatToolCredentials('web-search', { apiKey: trimmed })
      savedApiKeyRef.current = trimmed
      // 刷新全局工具列表（available 状态可能变化）
      await refreshChatTools(setChatTools)
      toast.success('联网搜索设置已保存')
    } catch (error) {
      console.error('[联网搜索设置] 保存失败:', error)
    }
  }, [apiKey, setChatTools])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('web-search', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[联网搜索设置] 切换失败:', error)
    }
  }

  const handleTest = async (): Promise<void> => {
    // 先保存可能的变更
    const trimmed = apiKey.trim()
    if (trimmed !== savedApiKeyRef.current) {
      try {
        await window.electronAPI.updateChatToolCredentials('web-search', { apiKey: trimmed })
        savedApiKeyRef.current = trimmed
        await refreshChatTools(setChatTools)
      } catch (error) {
        console.error('[联网搜索设置] 保存失败:', error)
      }
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testChatTool('web-search')
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="联网搜索"
      description="启用后 AI 可以实时搜索互联网获取最新信息"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>联网搜索由 <span className="font-medium text-foreground">Tavily</span> 提供，启用后 AI 可以搜索互联网获取实时信息。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Tavily 官网
                  <ExternalLink size={10} />
                </a>
                {' '}注册账号
              </li>
              <li>在控制台获取 API Key（免费额度每月 1000 次搜索）</li>
              <li>将 API Key 填入下方，然后开启开关</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button
                size="sm"
                variant="outline"
                disabled={testing || !apiKey.trim()}
                onClick={handleTest}
              >
                {testing ? <><Loader2 size={14} className="animate-spin mr-1.5" />测试中...</> : '测试连接'}
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder="tvly-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${testResult.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
              {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** Nano Banana 生图工具设置区域 */
function NanoBananaSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [model, setModel] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  const setChatTools = useSetAtom(chatToolsAtom)

  const savedCredentialsRef = React.useRef({ apiKey: '', baseUrl: '', model: '' })

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('nano-banana'),
    ]).then(([tools, credentials]) => {
      const tool = tools.find((t) => t.meta.id === 'nano-banana')
      if (tool) setEnabled(tool.enabled)
      if (credentials.apiKey) setApiKey(credentials.apiKey)
      if (credentials.baseUrl) setBaseUrl(credentials.baseUrl)
      if (credentials.model) setModel(credentials.model)
      savedCredentialsRef.current = {
        apiKey: credentials.apiKey || '',
        baseUrl: credentials.baseUrl || '',
        model: credentials.model || '',
      }
    }).catch((err: unknown) => {
      console.error('[Nano Banana 设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  /** 静默保存凭据（blur 时触发） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey === saved.apiKey && current.baseUrl === saved.baseUrl && current.model === saved.model) return
    try {
      await window.electronAPI.updateChatToolCredentials('nano-banana', current)
      savedCredentialsRef.current = current
      await refreshChatTools(setChatTools)
      toast.success('Nano Banana 设置已保存')
    } catch (error) {
      console.error('[Nano Banana 设置] 保存失败:', error)
    }
  }, [apiKey, baseUrl, model, setChatTools])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('nano-banana', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[Nano Banana 设置] 切换失败:', error)
    }
  }

  const handleTest = async (): Promise<void> => {
    // 先保存可能的变更
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey !== saved.apiKey || current.baseUrl !== saved.baseUrl || current.model !== saved.model) {
      try {
        await window.electronAPI.updateChatToolCredentials('nano-banana', current)
        savedCredentialsRef.current = current
        await refreshChatTools(setChatTools)
      } catch (error) {
        console.error('[Nano Banana 设置] 保存失败:', error)
      }
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testChatTool('nano-banana')
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="Nano Banana"
      description="启用后 AI 可以生成和编辑图片（基于 Gemini Image Generation）"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>Nano Banana 基于 <span className="font-medium text-foreground">Gemini Image Generation</span> 提供 AI 图片生成与编辑能力。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Google AI Studio
                  <ExternalLink size={10} />
                </a>
                {' '}获取 Gemini API Key
              </li>
              <li>将 API Key 填入下方，可选修改 API 地址和模型</li>
              <li>开启开关即可在对话中使用生图能力</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button
                size="sm"
                variant="outline"
                disabled={testing || !apiKey.trim()}
                onClick={handleTest}
              >
                {testing ? <><Loader2 size={14} className="animate-spin mr-1.5" />测试中...</> : '测试连接'}
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">API 地址</label>
            <Input
              type="text"
              placeholder="https://generativelanguage.googleapis.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={handleBlurSave}
            />
            <p className="text-xs text-muted-foreground">留空则使用 Gemini 官方地址</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">模型</label>
            <Input
              type="text"
              placeholder="gemini-3.1-flash-image-preview"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={handleBlurSave}
            />
            <p className="text-xs text-muted-foreground">留空则使用默认模型 gemini-3.1-flash-image-preview</p>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${testResult.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
              {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/**
 * Readwise 工具设置区域
 *
 * Readwise 官方 MCP server 走 OAuth 动态授权，MyYoda 用 REST API + 静态 Token
 * 桥接（readwise.io/access_token 获取），Token 保存到 chat-tools.json。
 * 全只读：Agent 可检索你的划线/文库，用于回答问题和整理读书笔记。
 */
function ReadwiseSettings(): React.ReactElement {
  const { workspaces, currentWorkspaceId } = useWorkspaceActions()
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  const [token, setToken] = React.useState('')
  const [showToken, setShowToken] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [available, setAvailable] = React.useState(false)
  const [availabilityReason, setAvailabilityReason] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)

  const savedRef = React.useRef('')

  const refreshServerState = React.useCallback(async (slug: string): Promise<void> => {
    try {
      const caps = await window.electronAPI.getWorkspaceCapabilities(slug)
      const server = caps.builtinMcpServers.find((s) => s.id === READWISE_TOOL_ID)
      if (server) {
        setEnabled(server.enabled)
        setAvailable(server.available)
        setAvailabilityReason(server.availabilityReason)
      }
    } catch (err) {
      console.error('[Readwise 设置] 刷新状态失败:', err)
    }
  }, [])

  // 加载已保存 Token + 内置 MCP 开关/可用状态
  React.useEffect(() => {
    let cancelled = false
    if (!workspaceSlug) {
      setLoading(false)
      return
    }
    Promise.all([
      window.electronAPI.getChatToolCredentials(READWISE_TOOL_ID),
      window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
    ])
      .then(([credentials, caps]) => {
        if (cancelled) return
        if (credentials.token) setToken(credentials.token)
        savedRef.current = credentials.token || ''
        const server = caps.builtinMcpServers.find((s) => s.id === READWISE_TOOL_ID)
        if (server) {
          setEnabled(server.enabled)
          setAvailable(server.available)
          setAvailabilityReason(server.availabilityReason)
        }
      })
      .catch((err: unknown) => {
        console.error('[Readwise 设置] 加载失败:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceSlug])

  /** 静默保存 Token（blur 时触发），保存后刷新可用状态 */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current = token.trim()
    if (current === savedRef.current) return
    try {
      await window.electronAPI.updateChatToolCredentials(READWISE_TOOL_ID, { token: current })
      savedRef.current = current
      toast.success('Readwise 设置已保存')
      if (workspaceSlug) await refreshServerState(workspaceSlug)
    } catch (error) {
      console.error('[Readwise 设置] 保存失败:', error)
    }
  }, [token, workspaceSlug, refreshServerState])

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!workspaceSlug) {
      toast.error('请先选择工作区')
      return
    }
    try {
      await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, READWISE_TOOL_ID, checked)
      setEnabled(checked)
      await refreshServerState(workspaceSlug)
      toast.success(checked ? 'Readwise 已启用' : 'Readwise 已关闭')
    } catch (error) {
      console.error('[Readwise 设置] 切换失败:', error)
      toast.error('切换 Readwise 状态失败')
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="Readwise"
      description="启用后 Agent 可以检索你的 Readwise 划线笔记与 Reader 文库，回答问题时引用你的阅读积累"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={!workspaceSlug}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 状态提示 */}
          <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${available ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted/50 text-muted-foreground'}`}>
            {available ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
            <span>{available ? 'Token 已配置，Agent 会话可检索你的阅读数据' : (availabilityReason ?? '尚未配置 Token')}</span>
          </div>

          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>Readwise 提供划线笔记（Highlights）与 Reader 文库（文章/PDF/播客等）检索能力，全部<span className="font-medium text-foreground">只读</span>。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://readwise.io/access_token"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  readwise.io/access_token
                  <ExternalLink size={10} />
                </a>
                {' '}获取 API Token
              </li>
              <li>将 Token 填入下方</li>
              <li>开启上方开关，新会话中 Agent 即可检索你的阅读数据</li>
            </ol>
            <p className="text-xs text-muted-foreground/70">
              说明：官方 MCP server 为 OAuth 授权模式，MyYoda 采用 REST API 直连方式接入，Token 仅保存在本机。支持搜索文库、读取文档全文、查看划线/书单。
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">API Token</label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                placeholder="粘贴 Readwise API Token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">在 readwise.io/access_token 获取，仅存本机 chat-tools.json</p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/**
 * 微信读书工具设置区域
 *
 * 微信读书官方无 MCP server，走官方 Agent Gateway + API Key（wrk- 开头，
 * 官方页面登录获取）。Key 保存到 chat-tools.json，注入时作为 Bearer 认证。
 * 全只读：搜索书城、书架、划线/笔记、阅读统计。
 */
function WereadSettings(): React.ReactElement {
  const { workspaces, currentWorkspaceId } = useWorkspaceActions()
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  const [apiKey, setApiKey] = React.useState('')
  const [showKey, setShowKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [available, setAvailable] = React.useState(false)
  const [availabilityReason, setAvailabilityReason] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)

  const savedRef = React.useRef('')

  const refreshServerState = React.useCallback(async (slug: string): Promise<void> => {
    try {
      const caps = await window.electronAPI.getWorkspaceCapabilities(slug)
      const server = caps.builtinMcpServers.find((s) => s.id === WEREAD_TOOL_ID)
      if (server) {
        setEnabled(server.enabled)
        setAvailable(server.available)
        setAvailabilityReason(server.availabilityReason)
      }
    } catch (err) {
      console.error('[微信读书设置] 刷新状态失败:', err)
    }
  }, [])

  // 加载已保存 Key + 内置 MCP 开关/可用状态
  React.useEffect(() => {
    let cancelled = false
    if (!workspaceSlug) {
      setLoading(false)
      return
    }
    Promise.all([
      window.electronAPI.getChatToolCredentials(WEREAD_TOOL_ID),
      window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
    ])
      .then(([credentials, caps]) => {
        if (cancelled) return
        if (credentials.apiKey) setApiKey(credentials.apiKey)
        savedRef.current = credentials.apiKey || ''
        const server = caps.builtinMcpServers.find((s) => s.id === WEREAD_TOOL_ID)
        if (server) {
          setEnabled(server.enabled)
          setAvailable(server.available)
          setAvailabilityReason(server.availabilityReason)
        }
      })
      .catch((err: unknown) => {
        console.error('[微信读书设置] 加载失败:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceSlug])

  /** 静默保存 Key（blur 时触发），保存后刷新可用状态 */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current = apiKey.trim()
    if (current === savedRef.current) return
    try {
      await window.electronAPI.updateChatToolCredentials(WEREAD_TOOL_ID, { apiKey: current })
      savedRef.current = current
      toast.success('微信读书设置已保存')
      if (workspaceSlug) await refreshServerState(workspaceSlug)
    } catch (error) {
      console.error('[微信读书设置] 保存失败:', error)
    }
  }, [apiKey, workspaceSlug, refreshServerState])

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!workspaceSlug) {
      toast.error('请先选择工作区')
      return
    }
    try {
      await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, WEREAD_TOOL_ID, checked)
      setEnabled(checked)
      await refreshServerState(workspaceSlug)
      toast.success(checked ? '微信读书已启用' : '微信读书已关闭')
    } catch (error) {
      console.error('[微信读书设置] 切换失败:', error)
      toast.error('切换微信读书状态失败')
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="微信读书"
      description="启用后 Agent 可以读取你的微信读书数据：书架、划线/笔记、阅读统计，整理读书笔记时引用你的真实阅读记录"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={!workspaceSlug}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 状态提示 */}
          <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${available ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted/50 text-muted-foreground'}`}>
            {available ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
            <span>{available ? 'API Key 已配置，Agent 会话可读取你的微信读书数据' : (availabilityReason ?? '尚未配置 API Key')}</span>
          </div>

          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>微信读书通过官方 Agent Gateway 接入，Agent 可搜索书城、查看书架与阅读进度、导出划线/笔记、阅读统计，全部<span className="font-medium text-foreground">只读</span>。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://weread.qq.com/r/weread-skills"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  微信读书官方 Skill 页面
                  <ExternalLink size={10} />
                </a>
                {' '}登录后获取 API Key（wrk- 开头）
              </li>
              <li>将 API Key 填入下方</li>
              <li>开启上方开关，新会话中 Agent 即可读取你的阅读数据</li>
            </ol>
            <p className="text-xs text-muted-foreground/70">
              ⚠️ 注意：API Key 是 OAuth Token，<span className="font-medium text-foreground">会过期</span>；失效时到官方页面重新生成并更新即可。
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">API Key</label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder="wrk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">仅存本机 chat-tools.json；key 过期时重新生成即可</p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** 自定义工具列表区域 */
function CustomToolsSection(): React.ReactElement | null {
  const tools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)

  const customTools = tools.filter((t) => t.meta.category === 'custom')
  if (customTools.length === 0) return null

  const handleToggle = async (toolId: string, checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState(toolId, { enabled: checked })
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[自定义工具] 切换失败:', error)
    }
  }

  const handleDelete = async (toolId: string, toolName: string): Promise<void> => {
    try {
      await window.electronAPI.deleteCustomChatTool(toolId)
      await refreshChatTools(setChatTools)
      toast.success(`已删除工具: ${toolName}`)
    } catch (error) {
      console.error('[自定义工具] 删除失败:', error)
      toast.error('删除工具失败')
    }
  }

  return (
    <SettingsSection
      title="自定义工具"
      description="通过 Project 模式创建的 HTTP API 工具"
    >
      <SettingsCard divided>
        {customTools.map((tool) => (
          <div key={tool.meta.id} className="flex items-center justify-between p-4">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tool.meta.name}</span>
                {tool.meta.httpConfig && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {tool.meta.httpConfig.method}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {tool.meta.description}
              </p>
              {tool.meta.httpConfig && (
                <p className="text-xs text-muted-foreground/60 mt-0.5 truncate font-mono">
                  {tool.meta.httpConfig.urlTemplate}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={tool.enabled}
                onCheckedChange={(checked) => handleToggle(tool.meta.id, checked)}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(tool.meta.id, tool.meta.name)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

/**
 * 增强工具面板（联网搜索 + Nano Banana + 自定义 HTTP 工具）。
 *
 * 同时被 Yoda 插件中心的「API」Tab 与设置页薄壳 `ToolSettings` 复用，
 * 保证 Home / Code 两模式共享同一份增强工具配置。
 * `toolSettingsFocusAtom` 用于外部深链滚动到指定区块。
 */
export function EnhancedToolsPanel(): React.ReactElement {
  const [focusedTool, setFocusedTool] = useAtom(toolSettingsFocusAtom)
  const webSearchRef = React.useRef<HTMLDivElement>(null)
  const nanoBananaRef = React.useRef<HTMLDivElement>(null)
  const wecomRef = React.useRef<HTMLDivElement>(null)
  const readwiseRef = React.useRef<HTMLDivElement>(null)
  const wereadRef = React.useRef<HTMLDivElement>(null)
  const customToolsRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!focusedTool) return
    const refs: Record<ToolSettingsFocus, React.RefObject<HTMLDivElement>> = {
      'web-search': webSearchRef,
      'nano-banana': nanoBananaRef,
      'wecom': wecomRef,
      'readwise': readwiseRef,
      'weread': wereadRef,
      'custom-tools': customToolsRef,
    }
    window.requestAnimationFrame(() => {
      refs[focusedTool].current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setFocusedTool(null)
    })
  }, [focusedTool, setFocusedTool])

  return (
    <div className="space-y-8">
      {/* 联网搜索工具 */}
      <div ref={webSearchRef}>
        <WebSearchSettings />
      </div>

      {/* Nano Banana 生图工具 */}
      <div ref={nanoBananaRef}>
        <NanoBananaSettings />
      </div>

      {/* 企业微信工具 */}
      <div ref={wecomRef}>
        <WecomSettings />
      </div>

      {/* Readwise 工具 */}
      <div ref={readwiseRef}>
        <ReadwiseSettings />
      </div>

      {/* 微信读书工具 */}
      <div ref={wereadRef}>
        <WereadSettings />
      </div>

      {/* 自定义工具 */}
      <div ref={customToolsRef}>
        <CustomToolsSection />
      </div>
    </div>
  )
}

/** 设置页薄壳：复用 EnhancedToolsPanel（保留以兼容直达/回退）。 */
export function ToolSettings(): React.ReactElement {
  return <EnhancedToolsPanel />
}
