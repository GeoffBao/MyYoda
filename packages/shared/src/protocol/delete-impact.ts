export interface ProjectDeleteImpact {
  taskCount: number
  /** Historical run directories retained under project Tasks. */
  runCount: number
  /** Runs that have not reached a terminal state and remain resumable. */
  activeRunCount: number
  activeRunTaskSlugs: string[]
  sessionCount: number
  assetCount: number
  hasKnowledge: boolean
  /** True only for an existing Workspace-managed project workdir. */
  hasManagedWorkdir: boolean
  blockers: string[]
  canPurge: boolean
  /** 主进程签发的短时、单次确认凭证；影响快照变化后失效。 */
  confirmationToken?: string
}

export interface TaskDeleteImpact {
  runCount: number
  activeRunCount: number
  sessionCount: number
  canPurge: boolean
  blockers: string[]
  /** 主进程签发的短时、单次确认凭证；影响快照变化后失效。 */
  confirmationToken?: string
}
