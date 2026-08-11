/**
 * ExpertDetailSheet — Agent 专家详情右侧抽屉
 *
 * 编辑 IDENTITY / SOUL / RULES；Skills / MCP 多选绑定（写 expert.json 引用）。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Bot, Save, Users } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/settings/primitives'
import type { ExpertPackage } from '@myyoda/shared/experts'
import {
  mergeReferenceOptions,
  ReferenceMultiSelect,
  type ReferenceOption,
} from './ReferenceMultiSelect'

interface ExpertDetailSheetProps {
  expert: ExpertPackage | null
  onOpenChange: (open: boolean) => void
  onSaved: (expert: ExpertPackage) => void
}

export function ExpertDetailSheet({
  expert,
  onOpenChange,
  onSaved,
}: ExpertDetailSheetProps): React.ReactElement {
  return (
    <Sheet open={expert !== null} onOpenChange={onOpenChange}>
      <SheetContent
        hideClose
        side="right"
        className="w-[62vw] min-w-[680px] max-w-[1100px] sm:max-w-[1100px] p-0 flex flex-col gap-0"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Agent 专家详情</SheetTitle>
        {expert && <ExpertDetailBody key={expert.id} expert={expert} onOpenChange={onOpenChange} onSaved={onSaved} />}
      </SheetContent>
    </Sheet>
  )
}

interface ExpertDetailBodyProps {
  expert: ExpertPackage
  onOpenChange: (open: boolean) => void
  onSaved: (expert: ExpertPackage) => void
}

function ExpertDetailBody({ expert, onOpenChange, onSaved }: ExpertDetailBodyProps): React.ReactElement {
  const isTeam = expert.kind === 'team'
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaceSlug = workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.slug ?? ''

  const [label, setLabel] = React.useState(expert.label)
  const [identityMd, setIdentityMd] = React.useState(expert.identityMd)
  const [soulMd, setSoulMd] = React.useState(expert.soulMd)
  const [rulesMd, setRulesMd] = React.useState(expert.rulesMd)
  const [skillSlugs, setSkillSlugs] = React.useState<string[]>(expert.skillSlugs)
  const [mcpIds, setMcpIds] = React.useState<string[]>(expert.mcpIds)
  const [skillCatalog, setSkillCatalog] = React.useState<ReferenceOption[]>([])
  const [mcpCatalog, setMcpCatalog] = React.useState<ReferenceOption[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setLabel(expert.label)
    setIdentityMd(expert.identityMd)
    setSoulMd(expert.soulMd)
    setRulesMd(expert.rulesMd)
    setSkillSlugs(expert.skillSlugs)
    setMcpIds(expert.mcpIds)
  }, [expert])

  React.useEffect(() => {
    let cancelled = false
    if (!workspaceSlug) {
      setSkillCatalog([])
      setMcpCatalog([])
      setCatalogLoading(false)
      return
    }
    setCatalogLoading(true)
    void Promise.all([
      window.electronAPI.getWorkspaceSkills(workspaceSlug),
      window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
    ]).then(([skills, capabilities]) => {
      if (cancelled) return
      setSkillCatalog(skills.map((skill) => ({
        id: skill.slug,
        label: skill.name || skill.slug,
        hint: skill.enabled === false ? '已禁用' : undefined,
      })))
      const mcpOptions: ReferenceOption[] = [
        ...capabilities.mcpServers.map((server) => ({
          id: server.name,
          label: server.name,
          hint: server.type,
        })),
        ...capabilities.builtinMcpServers.map((server) => ({
          id: server.id,
          label: server.name || server.id,
          hint: '内置',
        })),
      ]
      const seen = new Set<string>()
      setMcpCatalog(mcpOptions.filter((option) => {
        if (seen.has(option.id)) return false
        seen.add(option.id)
        return true
      }))
    }).catch((cause) => {
      console.error('[ExpertDetail] 加载 Skills/MCP 目录失败:', cause)
      if (!cancelled) {
        setSkillCatalog([])
        setMcpCatalog([])
      }
    }).finally(() => {
      if (!cancelled) setCatalogLoading(false)
    })
    return () => { cancelled = true }
  }, [workspaceSlug])

  const skillOptions = React.useMemo(
    () => mergeReferenceOptions(skillCatalog, skillSlugs),
    [skillCatalog, skillSlugs],
  )
  const mcpOptions = React.useMemo(
    () => mergeReferenceOptions(mcpCatalog, mcpIds),
    [mcpCatalog, mcpIds],
  )

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.electronAPI.experts.updateFiles(expert.id, {
        identityMd,
        soulMd,
        rulesMd,
      })
      const updated = await window.electronAPI.experts.updateManifest(expert.id, {
        label: label.trim() || expert.label,
        skillSlugs,
        mcpIds,
      })
      onSaved({ ...updated, identityMd, soulMd, rulesMd })
      toast.success('专家配置已保存')
    } catch (cause) {
      console.error('[ExpertDetail] 保存失败:', cause)
      toast.error('保存失败', {
        description: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'rounded-xl p-2',
              isTeam
                ? 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400'
                : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
            )}
          >
            {isTeam ? <Users size={20} /> : <Bot size={20} />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-foreground">{expert.label}</div>
            <div className="truncate text-[13px] text-muted-foreground">{expert.id}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            <Save size={14} className="mr-1.5" />
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <ExpertFieldSection title="显示名称">
            <SettingsCard divided={false}>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="w-full rounded-lg border border-border/60 bg-content-area px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="专家显示名称"
              />
            </SettingsCard>
          </ExpertFieldSection>

          <ExpertFieldSection title="IDENTITY.md" description="角色名与一句话定位">
            <SettingsCard divided={false}>
              <textarea
                value={identityMd}
                onChange={(event) => setIdentityMd(event.target.value)}
                rows={6}
                className="w-full resize-y rounded-lg border border-border/60 bg-content-area px-3 py-2 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </SettingsCard>
          </ExpertFieldSection>

          <ExpertFieldSection title="SOUL.md" description="语气与协作立场">
            <SettingsCard divided={false}>
              <textarea
                value={soulMd}
                onChange={(event) => setSoulMd(event.target.value)}
                rows={6}
                className="w-full resize-y rounded-lg border border-border/60 bg-content-area px-3 py-2 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </SettingsCard>
          </ExpertFieldSection>

          <ExpertFieldSection title="RULES.md" description="操作边界与行为约束">
            <SettingsCard divided={false}>
              <textarea
                value={rulesMd}
                onChange={(event) => setRulesMd(event.target.value)}
                rows={8}
                className="w-full resize-y rounded-lg border border-border/60 bg-content-area px-3 py-2 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </SettingsCard>
          </ExpertFieldSection>

          <ExpertFieldSection
            title="Skill 引用"
            description="勾选当前工作区 Skills；跑 Kanban 任务时会与任务 skills 合并注入。完整内容仍由 Agent 技能模块管理。"
          >
            <SettingsCard divided={false}>
              {catalogLoading ? (
                <p className="px-1 py-2 text-[13px] text-muted-foreground">加载 Skills…</p>
              ) : (
                <ReferenceMultiSelect
                  options={skillOptions}
                  value={skillSlugs}
                  onChange={setSkillSlugs}
                  emptyHint={workspaceSlug ? '当前工作区暂无 Skill' : '请先选择工作区后再绑定 Skill'}
                />
              )}
            </SettingsCard>
          </ExpertFieldSection>

          <ExpertFieldSection
            title="MCP 引用"
            description="勾选当前工作区 MCP；跑 Kanban 任务时经 mentionedMcpServers 注入（与 #mcp: 同路）。"
          >
            <SettingsCard divided={false}>
              {catalogLoading ? (
                <p className="px-1 py-2 text-[13px] text-muted-foreground">加载 MCP…</p>
              ) : (
                <ReferenceMultiSelect
                  options={mcpOptions}
                  value={mcpIds}
                  onChange={setMcpIds}
                  emptyHint={workspaceSlug ? '当前工作区暂无 MCP' : '请先选择工作区后再绑定 MCP'}
                />
              )}
            </SettingsCard>
          </ExpertFieldSection>

          <ExpertFieldSection title="渠道绑定" description="飞书 / Discord Bot 路由将在后续版本接入。">
            <SettingsCard divided={false}>
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
                后续接入
              </div>
            </SettingsCard>
          </ExpertFieldSection>
        </div>
      </div>
    </div>
  )
}

function ExpertFieldSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
        {description && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}
