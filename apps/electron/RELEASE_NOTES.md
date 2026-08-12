# MyYoda v0.8.2 更新

## Bug Fixes

### Repo Map 稳定性修复（#48）

- **缓存并发损坏自愈**：多实例并发写缓存损坏/清空问题——唯一临时文件 + 进程写锁 + 读-合并-写；损坏自动备份重建；残留锁自愈
- **CDN 离线可用**：内置 10 种常用语言解析器（ts/tsx/js/python/go/java/c/cpp/rust/php），离线符号索引开箱可用；多源回退 + 冷却 + 超时
- **多 worktree 卡顿**：代码地图按主仓库 main 共享（本地 commit/push 零触发重扫）；main 更新时旧地图兜底 + 后台增量重扫；盘上缓存跨进程秒回；首条消息预热
- **CRG 共享图谱**：worktree 会话引导使用主仓库图谱（不再每个 worktree 重复建图）

## Improvements

- 地图质量：排除 default-skills/测试等噪声目录，核心源码排名靠前
- 主进程性能：git 调用/目录扫描短缓存

## Breaking Changes

无。
