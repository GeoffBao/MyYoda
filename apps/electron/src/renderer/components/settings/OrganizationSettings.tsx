/**
 * OrganizationSettings — 企业组织技能分发设置
 *
 * 功能：
 * - 连接/登出组织服务端（登录/注册）
 * - 显示我的组织与角色
 * - 创建组织 / 凭邀请码加入组织
 * - 查看组织成员
 * - 浏览企业组织技能（导入到当前工作区由 agent-skills 面板完成）
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Building2, LogOut, Plus, Ticket, Users, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SettingsCard, SettingsInput, SettingsSection } from './primitives'
import type {
  OrganizationConnection,
  OrganizationInfo,
  OrganizationMember,
  OrganizationMembership,
  OrganizationSkill,
} from '@myyoda/shared'

interface OrganizationSettingsProps {
  /** 当前工作区 slug（Skills 导入目标） */
  workspaceSlug?: string
}

export function OrganizationSettings({ workspaceSlug }: OrganizationSettingsProps): React.ReactElement {
  const [conn, setConn] = React.useState<OrganizationConnection | null>(null)
  const [loading, setLoading] = React.useState(false)

  // 登录表单
  const [serverUrl, setServerUrl] = React.useState('http://localhost:8787')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [authMode, setAuthMode] = React.useState<'account' | 'apikey'>('account')

  // 组织数据
  const [memberships, setMemberships] = React.useState<OrganizationMembership[]>([])
  const [members, setMembers] = React.useState<OrganizationMember[]>([])
  const [skills, setSkills] = React.useState<OrganizationSkill[]>([])
  const [selectedOrgId, setSelectedOrgId] = React.useState<string>('')
  const [inviteCode, setInviteCode] = React.useState('')
  const [newOrgName, setNewOrgName] = React.useState('')

  React.useEffect(() => {
    void loadConnection()
  }, [])

  const loadConnection = async (): Promise<void> => {
    try {
      const current = await window.electronAPI.orgGetConnection()
      setConn(current)
      if (current) {
        await refreshOrgData(current)
      }
    } catch (error) {
      console.error('[组织设置] 加载连接失败:', error)
    }
  }

  const refreshOrgData = async (current: OrganizationConnection): Promise<void> => {
    try {
      const membershipsData = await window.electronAPI.orgMe()
      setMemberships(membershipsData)
      if (membershipsData.length > 0) {
        const orgId = membershipsData[0]!.orgId
        setSelectedOrgId(orgId)
        const [memberData, skillData] = await Promise.all([
          window.electronAPI.orgListMembers(orgId),
          window.electronAPI.orgListSkills(orgId),
        ])
        setMembers(memberData)
        setSkills(skillData)
      }
    } catch (error) {
      console.error('[组织设置] 刷新组织数据失败:', error)
      toast.error('刷新组织数据失败，请确认组织服务端在线')
    }
  }

  const handleLogin = async (action: 'login' | 'register'): Promise<void> => {
    if (!serverUrl || !email || !password) {
      toast.error('请填写服务端地址、邮箱和密码')
      return
    }
    setLoading(true)
    try {
      const current = await window.electronAPI.orgAuthenticate(action, serverUrl.trim(), email.trim(), password, displayName || undefined)
      setConn(current)
      setPassword('')
      await refreshOrgData(current)
      toast.success(action === 'register' ? '注册成功，已连接企业组织服务' : '登录成功')
    } catch (error) {
      console.error('[组织设置] 认证失败:', error)
      toast.error((error as Error).message || '认证失败')
    } finally {
      setLoading(false)
    }
  }

  const handleApiKeyConnect = async (): Promise<void> => {
    if (!serverUrl || !apiKey) {
      toast.error('请填写服务端地址和 API Key')
      return
    }
    setLoading(true)
    try {
      const current = await window.electronAPI.orgAuthenticate('apikey', serverUrl.trim(), '', '', undefined, apiKey.trim())
      setConn(current)
      setApiKey('')
      await refreshOrgData(current)
      toast.success('已通过 API Key 连接企业组织服务')
    } catch (error) {
      console.error('[组织设置] API Key 连接失败:', error)
      toast.error((error as Error).message || 'API Key 连接失败')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async (): Promise<void> => {
    await window.electronAPI.orgSetConnection('logout')
    setConn(null)
    setMemberships([])
    setMembers([])
    setSkills([])
    setSelectedOrgId('')
    toast.success('已登出组织服务')
  }

  const handleCreateOrg = async (): Promise<void> => {
    if (!newOrgName.trim()) {
      toast.error('请输入组织名称')
      return
    }
    setLoading(true)
    try {
      await window.electronAPI.orgCreate(newOrgName.trim())
      setNewOrgName('')
      const current = await window.electronAPI.orgGetConnection()
      if (current) await refreshOrgData(current)
      toast.success('组织创建成功')
    } catch (error) {
      toast.error((error as Error).message || '创建组织失败')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinOrg = async (): Promise<void> => {
    if (!inviteCode.trim()) {
      toast.error('请输入邀请码')
      return
    }
    setLoading(true)
    try {
      await window.electronAPI.orgJoin(inviteCode.trim())
      setInviteCode('')
      const current = await window.electronAPI.orgGetConnection()
      if (current) await refreshOrgData(current)
      toast.success('已加入组织')
    } catch (error) {
      toast.error((error as Error).message || '加入组织失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    if (!conn) return
    setLoading(true)
    try {
      await refreshOrgData(conn)
      toast.success('已刷新')
    } finally {
      setLoading(false)
    }
  }

  // ── 未连接 ────────────────────────────────────────────

  if (!conn) {
    return (
      <div className="space-y-8">
        <SettingsSection
          title="企业组织技能"
          description="连接企业组织服务端，集中管理组织级技能分发与协作。管理员可一键下发，成员免安装使用。"
        >
          <SettingsCard>
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-indigo-500" />
                <span className="text-sm font-medium">连接企业组织服务</span>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAuthMode('account')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${authMode === 'account'
                    ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                    : 'border-border/60 text-muted-foreground hover:bg-foreground/[0.04]'}`}
                >
                  企业账号
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('apikey')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${authMode === 'apikey'
                    ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                    : 'border-border/60 text-muted-foreground hover:bg-foreground/[0.04]'}`}
                >
                  API Key
                </button>
              </div>

              <SettingsInput
                label="服务端地址"
                description="部署的企业版 MyYoda Server 地址，如 http://your-org.example.com"
                value={serverUrl}
                onChange={setServerUrl}
                placeholder="http://localhost:8787"
              />

              {authMode === 'account' ? (
                <>
                  <SettingsInput
                    label="邮箱"
                    value={email}
                    onChange={setEmail}
                    placeholder="you@company.com"
                  />
                  <SettingsInput
                    label="密码"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    placeholder="至少 8 位"
                  />
                  <SettingsInput
                    label="显示名称（仅注册时使用）"
                    value={displayName}
                    onChange={setDisplayName}
                    placeholder="张三"
                  />
                  <div className="flex gap-3 pt-1">
                    <Button
                      onClick={() => void handleLogin('login')}
                      disabled={loading}
                      className="bg-indigo-600 hover:bg-indigo-500"
                    >
                      登录
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleLogin('register')}
                      disabled={loading}
                    >
                      注册新账号
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <SettingsInput
                    label="API Key"
                    description="在服务端账号登录后生成（lx_ 开头），用于脚本/轻量接入"
                    value={apiKey}
                    onChange={setApiKey}
                    placeholder="lx_xxxxxxxx"
                  />
                  <Button
                    onClick={() => void handleApiKeyConnect()}
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-500"
                  >
                    连接
                  </Button>
                </>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>
      </div>
    )
  }

  // ── 已连接 ────────────────────────────────────────────

  return (
    <div className="space-y-8">
      <SettingsSection
        title="企业组织技能"
        description={`已连接组织服务：${conn.serverUrl}`}
      >
        <SettingsCard>
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="size-4 text-indigo-500" />
                <span className="font-medium">{conn.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => void handleRefresh()} disabled={loading}>
                  <RefreshCw className="size-4" /> 刷新
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
                  <LogOut className="size-4" /> 登出
                </Button>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">我的组织</div>
              {memberships.length === 0 ? (
                <p className="text-sm text-muted-foreground">你尚未加入任何组织。创建组织或使用邀请码加入。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {memberships.map((m) => (
                    <Badge key={m.orgId} variant={m.role === 'admin' ? 'default' : 'secondary'} className="gap-1">
                      <Building2 className="size-3" /> {m.orgName}
                      <span className="text-[10px] opacity-70">{m.role === 'admin' ? '管理员' : '成员'}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Plus className="size-3" /> 创建组织
                </div>
                <SettingsInput label="" value={newOrgName} onChange={setNewOrgName} placeholder="组织名称" />
                <Button size="sm" onClick={() => void handleCreateOrg()} disabled={loading}>创建</Button>
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Ticket className="size-3" /> 凭邀请码加入
                </div>
                <SettingsInput label="" value={inviteCode} onChange={setInviteCode} placeholder="如 ABC12345" />
                <Button size="sm" variant="outline" onClick={() => void handleJoinOrg()} disabled={loading}>加入</Button>
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      {selectedOrgId && memberships.length > 0 && (
        <SettingsSection
          title={`成员 (${members.length})`}
          description="当前选中组织的成员列表。管理员可在服务端管理成员。"
        >
          <SettingsCard>
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Users className="size-3" /> 成员
              </div>
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无成员</p>
              ) : (
                <div className="space-y-1">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <span>{m.displayName || m.email}</span>
                      <Badge variant={m.role === 'admin' ? 'default' : 'secondary'}>{m.role === 'admin' ? '管理员' : '成员'}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {selectedOrgId && (
        <SettingsSection
          title={`企业组织技能 (${skills.length})`}
          description="组织管理员发布的 Skills。可在工作区的「Agent 技能」面板中导入/更新这些 Skills。"
        >
          <SettingsCard>
            <div className="px-4 py-3 space-y-2">
              {skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无已发布的 Skills</p>
              ) : (
                <div className="space-y-1">
                  {skills.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        <Badge variant="outline" className="text-[10px]">v{s.version}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground truncate max-w-[40%]">{s.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <p className="text-xs text-muted-foreground px-1">
        导入企业组织技能到当前工作区：前往「Agent 技能」面板，选择「从组织导入」。
      </p>
    </div>
  )
}
