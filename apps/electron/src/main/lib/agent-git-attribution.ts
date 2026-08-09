/**
 * MyYoda Git / PR 归因标识
 *
 * 目标：当 Agent 代用户创建 commit / PR 时，附带可搜索、可关闭的 MyYoda 标识，
 * 用于产品曝光，同时标注实际执行的模型；避免污染 GitHub contributors——
 * `Co-Authored-By` trailer 只有值满足 `Name <email>` 格式才会被 GitHub 计入 co-author，
 * 本项目的值固定是 `<模型名> in MyYoda`（无邮箱），不会匹配该格式，不会产生虚假 contributor。
 *
 * v1（最小版）两层保障：
 * 1. System prompt 指令（Claude / Pi 通用）— 引导 Agent 在 git commit / gh pr 时附加标识，
 *    模型名由 Agent 自己填入（它在 preset 中已知道自己的展示名，如「Sonnet 5」）
 * 2. Claude SDK session `.claude/settings.json` 的 `attribution` 字段 — 覆盖 SDK 默认 Co-Authored-By，
 *    用当前会话选定的 modelId 作为标识（该路径无法感知 Agent 自称的展示名，直接用 modelId）
 *
 * 后续可增强：canUseTool 对 Bash 的确定性 --trailer / body 注入。
 */

/** 默认开启：对齐 Claude Code / Cursor「默认归因 + 可关」策略 */
export const DEFAULT_GIT_ATTRIBUTION_ENABLED = true

/** 开源仓库完整地址 */
export const MYYODA_GITHUB_URL = 'https://github.com/GeoffBao/MyYoda'

/** Commit trailer key（标准 git trailer key） */
export const MYYODA_COMMIT_TRAILER_KEY = 'Co-Authored-By'

/** Commit trailer 值的固定后缀，标识来自 MyYoda */
const MYYODA_COMMIT_TRAILER_SUFFIX = 'in MyYoda'

/** 未知模型时的兜底展示名 */
const FALLBACK_MODEL_LABEL = 'MyYoda Agent'

/**
 * 生成 commit trailer：`Co-Authored-By: <模型名> in MyYoda`
 * @param modelLabel 模型展示名或 modelId；缺省时退化为通用标签
 */
export function buildMyYodaCommitTrailer(modelLabel?: string): string {
  const label = modelLabel?.trim() || FALLBACK_MODEL_LABEL
  return `${MYYODA_COMMIT_TRAILER_KEY}: ${label} ${MYYODA_COMMIT_TRAILER_SUFFIX}`
}

/**
 * PR / MR 描述底部标识。
 * 含开源仓库完整链接，便于推广与引流。
 */
export const MYYODA_PR_ATTRIBUTION =
  `Made with [MyYoda](${MYYODA_GITHUB_URL})`

export interface GitAttributionConfig {
  /** 是否启用；undefined 视为默认开启 */
  enabled?: boolean
}

/** 解析最终是否启用（缺省 = 默认开启） */
export function isGitAttributionEnabled(config?: GitAttributionConfig | boolean | null): boolean {
  if (typeof config === 'boolean') return config
  if (config && typeof config === 'object' && typeof config.enabled === 'boolean') {
    return config.enabled
  }
  return DEFAULT_GIT_ATTRIBUTION_ENABLED
}

/**
 * Claude Code settings.json 的 attribution 字段。
 * 空字符串会禁用 SDK 内置 Co-Authored-By / Generated with 归因。
 * @param modelLabel 当前会话选定的模型（modelId 或展示名），用于填入 trailer
 * @see https://code.claude.com/docs/en/settings#attribution-settings
 */
export function buildClaudeSdkAttribution(enabled: boolean, modelLabel?: string): { commit: string; pr: string } {
  if (!enabled) {
    return { commit: '', pr: '' }
  }
  return {
    commit: buildMyYodaCommitTrailer(modelLabel),
    pr: MYYODA_PR_ATTRIBUTION,
  }
}

/**
 * 将 MyYoda attribution 合并进 Claude session 的 settings 对象。
 * @returns 是否发生了变更（调用方可据此决定是否写盘）
 */
export function applyClaudeSdkAttributionSettings(
  sdkSettings: Record<string, unknown>,
  enabled: boolean,
  modelLabel?: string,
): boolean {
  const next = buildClaudeSdkAttribution(enabled, modelLabel)
  const prev = sdkSettings.attribution
  const prevObj = prev && typeof prev === 'object' && !Array.isArray(prev)
    ? (prev as Record<string, unknown>)
    : null

  if (prevObj?.commit === next.commit && prevObj?.pr === next.pr) {
    return false
  }

  sdkSettings.attribution = next
  return true
}

/** 注入到 buildSystemPrompt 的 Git/PR 标识规范 */
export function buildGitAttributionPromptSection(enabled: boolean): string {
  if (!enabled) {
    return `## Git / PR 标识

用户已在 MyYoda 设置中关闭「Git/PR 标识」。当你创建 git commit 或 Pull Request / Merge Request 时：
- **不要**添加任何 MyYoda 相关归因（包括 \`${MYYODA_COMMIT_TRAILER_KEY}: ... ${MYYODA_COMMIT_TRAILER_SUFFIX}\`、\`${MYYODA_PR_ATTRIBUTION}\`、\`Generated with MyYoda\` 等）
- 也不要主动建议用户打开该标识；仅当用户明确要求时再添加`
  }

  return `## Git / PR 标识（推广归因，默认开启）

当**你**通过 Bash 等工具代用户创建 git commit 或 Pull Request / Merge Request 时，必须附加 MyYoda 标识（用户当次明确说「不要带标识」除外）。

### Commit
在 commit message **末尾**追加标准 git trailer（与正文之间空一行）：

\`\`\`text
${MYYODA_COMMIT_TRAILER_KEY}: <当前模型展示名> ${MYYODA_COMMIT_TRAILER_SUFFIX}
\`\`\`

\`<当前模型展示名>\` 用你在本次会话中实际运行的模型的展示名（preset 里「You are powered by the model named ...」给出的名字，例如 \`Claude Opus 4.8\`、\`Sonnet 5\`）；不要写成模型 ID（如 \`claude-opus-4-8\`），也不要固定写死某个模型名——如果委派了使用不同模型的子会话去提交，用那个子会话实际运行的模型名。

规则：
- trailer 值不含邮箱，格式不匹配 GitHub \`Name <email>\` 的 co-author 识别规则，不会污染 contributors 列表，可放心使用
- 若 message 已含匹配 \`${MYYODA_COMMIT_TRAILER_KEY}:.*${MYYODA_COMMIT_TRAILER_SUFFIX}\`（大小写不敏感）的行，不要重复添加
- 推荐：\`git commit --trailer "${MYYODA_COMMIT_TRAILER_KEY}: <当前模型展示名> ${MYYODA_COMMIT_TRAILER_SUFFIX}" -m "subject"\`；或多段 \`-m\`，确保 trailer 单独处于最后一段且格式为 \`Key: Value\`
- 不要改 author / committer 身份；标识只出现在 message trailer

### Pull Request / Merge Request
在 PR/MR 描述 **末尾**追加（与正文空一行）：

\`\`\`text
${MYYODA_PR_ATTRIBUTION}
\`\`\`

- 开源仓库：\`${MYYODA_GITHUB_URL}\`（不要写成其他错误地址）
- 若 body 已含 \`github.com/GeoffBao/MyYoda\` 的 Made with / Generated with 行，不要重复
- \`gh pr create\` 时把上述行放进 \`--body\` 末尾；若用 body 文件，同样追加在文件末尾

### 关闭方式
用户可在 **设置 → 通用 → Git/PR 标识** 关闭。关闭后本段指令会被替换为「禁止添加标识」。`
}
