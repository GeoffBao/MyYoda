/**
 * electron-builder afterPack 钩子
 *
 * 确保打包产物中 node-pty 的 spawn-helper 具有可执行位。
 *
 * 背景：node-pty 在 macOS/Linux 上通过 posix_spawn 执行
 * `prebuilds/<platform>-<arch>/spawn-helper`，若该文件缺少执行权限
 * （electron-builder asarUnpack 复制时可能丢 x 位，或 zip 解压后权限被重置），
 * 会报 `posix_spawnp failed.`。运行时已有 best-effort chmod 兜底
 * （agent-terminal.ts ensureSpawnHelperExecutable），这里在打包阶段直接修正，
 * 避免用户首次打开终端时依赖运行时自愈。
 */

const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

/** 递归查找所有名为 spawn-helper 的文件并补执行位 */
function chmodSpawnHelpers(dir, depth = 0) {
  if (depth > 8 || !existsSync(dir)) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      chmodSpawnHelpers(full, depth + 1)
    } else if (entry.isFile() && entry.name === 'spawn-helper') {
      try {
        chmodSync(full, 0o755)
        console.log(`[afterPack] chmod +x spawn-helper: ${full}`)
      } catch (e) {
        console.warn(`[afterPack] chmod spawn-helper 失败: ${full}`, e)
      }
    }
  }
}

/** electron-builder afterPack 钩子入口 */
module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context
  // Windows 使用 conpty，不需要 spawn-helper
  if (electronPlatformName === 'win32') return

  // macOS: <app>/Contents/Resources/app.asar.unpacked；Linux/其他: <app>/resources/app.asar.unpacked
  const unpackedDir =
    electronPlatformName === 'darwin'
      ? join(appOutDir, 'Contents', 'Resources', 'app.asar.unpacked')
      : join(appOutDir, 'resources', 'app.asar.unpacked')

  if (existsSync(unpackedDir)) {
    chmodSpawnHelpers(unpackedDir)
  }
}
