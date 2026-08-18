/**
 * 代码图谱工具服务（2026-08-13）
 *
 * 管理「repo map + Graphify 知识图谱」的主动创建、状态机、安装与 git 防护。
 *
 * 设计决策（详见 .context/plan/repo-map-tools-plan.md v2）：
 * - 首次创建仅主动：入口只有对话栏按钮；会话消息注入走纯读，绝不触发生成
 * - 存储：repo map → 主仓库 .git/repo-map/maps/；Graphify → 主仓库 graphify-out/
 * - 非 git 项目严格不支持（unavailable，不创建任何东西）
 * - repo map（内置零依赖）与 Graphify（外部命令）独立建、独立计状态（部分失败语义）
 */
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type {
  RepoMapToolsState,
  RepoMapToolsStatus,
  RepoMapToolsInstallResult,
} from "@myyoda/shared";

import { repoMapService } from "./repo-map/repo-map-service";

/** 状态变更监听器（IPC 层注册，经 STATUS 通道推送给渲染进程） */
export type RepoMapToolsStateListener = (state: RepoMapToolsState) => void;

/** Graphify build 超时上限（30 分钟强制 failed，防大仓库/网络卡死） */
const GRAPHIFY_BUILD_TIMEOUT_MS = 30 * 60_000;
/** graphify 命令可用性短缓存（30s，避免每条消息探测） */
const GRAPHIFY_CHECK_TTL_MS = 30_000;
/**
 * graphify MCP serve 可用性缓存（10 分钟，2026-08-14 review 修正）。
 * 检测代价高（python 启动 + import mcp ≈ 0.5~1.5s），
 * 30s TTL 会导致主进程周期性卡顿；mcp extra 安装状态极少变化，
 * install/uninstall 时已手动清缓存。
 */
const GRAPHIFY_MCP_CHECK_TTL_MS = 10 * 60_000;

/**
 * 异步探测子进程退出码是否为 0（spawn 而非 spawnSync：探测期间不阻塞主线程）。
 * 命令不存在 / 超时 / 非零退出码均视为探测失败。
 */
function runProbe(
  command: string,
  args: string[],
  timeoutMs: number,
  useShell: boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: "ignore",
        shell: useShell,
      });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try {
        if (process.platform === "win32" && child.pid) {
          // shell:true 时 child.kill() 只杀 shell，孙进程（如 python）可能残留：
          // taskkill /T 杀整棵进程树（仅超时路径执行，同步开销可接受）
          execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
        } else {
          child.kill();
        }
      } catch {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
      settle(false);
    }, timeoutMs);
    child.on("error", () => settle(false));
    child.on("close", (code) => settle(code === 0));
  });
}

/** 解析出的 graphify 命令（含缓存） */
interface GraphifyCommand {
  command: string;
  prefixArgs: string[];
}

let graphifyCommandCache: GraphifyCommand | undefined;
let graphifyCommandAt = 0;

/** 从任意目录解析主仓库根（worktree 经 --git-common-dir；非 git 返回 undefined） */
export function getMainRepoRootSync(cwd: string): string | undefined {
  try {
    const common = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      },
    ).trim();
    if (!common) return undefined;
    return path.dirname(common);
  } catch {
    return undefined;
  }
}

/** 读取仓库当前 HEAD（图谱过期检测用；失败返回 undefined）。仅在状态查询路径低频调用。 */
function getGitHeadSync(cwd: string): string | undefined {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function graphifyOutDir(mainRepo: string): string {
  return path.join(mainRepo, "graphify-out");
}

/** 主仓库 graphify 图谱文件路径（orchestrator 就绪引导存在性检查用） */
export function graphJsonPath(mainRepo: string): string {
  return path.join(graphifyOutDir(mainRepo), "graph.json");
}

export class RepoMapToolsService {
  private readonly states = new Map<string, RepoMapToolsState>();
  private readonly pendingBuilds = new Map<string, Promise<void>>();
  private readonly listeners = new Set<RepoMapToolsStateListener>();
  private graphifyCheck: { installed: boolean; at: number } | undefined;
  private graphifyMcpCheck: { available: boolean; at: number } | undefined;
  /** 探测 in-flight 去重（多消息并发触发时只探测一次） */
  private graphifyProbeInFlight: Promise<boolean> | undefined;
  private graphifyMcpProbeInFlight: Promise<boolean> | undefined;
  /** 安装/卸载 in-flight 操作（跨窗口防重入：并发点击复用同一操作） */
  private pendingInstall: Promise<RepoMapToolsInstallResult> | undefined;
  private pendingUninstall: Promise<RepoMapToolsInstallResult> | undefined;

  onStateChange(listener: RepoMapToolsStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(state: RepoMapToolsState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // 监听器异常不影响主流程
      }
    }
  }

  /**
   * 解析 graphify 调用命令（回退链：PATH 中的 graphify → python -m graphify）。
   * pip 安装时 Python Scripts 目录不一定在 PATH（尤其 Windows），
   * 因此必须支持 `python -m` 回退，否则安装成功却无法调用。
   * 异步探测（spawn 而非 spawnSync）：探测期间不阻塞主线程。
   */
  private async resolveGraphifyCommand(): Promise<GraphifyCommand> {
    const now = Date.now();
    if (
      graphifyCommandCache &&
      now - graphifyCommandAt < GRAPHIFY_CHECK_TTL_MS
    ) {
      return graphifyCommandCache;
    }
    let resolved: GraphifyCommand = { command: "graphify", prefixArgs: [] };
    // shell 仅 Windows 需要（.cmd 解析）；unix 上直接 spawn，避免多一层 shell 进程且超时 kill 不会只杀 shell 留下孙进程
    const direct = await runProbe("graphify", ["--version"], 5_000, process.platform === "win32");
    if (direct) {
      resolved = { command: "graphify", prefixArgs: [] };
    } else {
      const pyModule = await runProbe(
        "python",
        ["-m", "graphify", "--version"],
        8_000,
        false,
      );
      if (pyModule) {
        resolved = { command: "python", prefixArgs: ["-m", "graphify"] };
      }
    }
    graphifyCommandCache = resolved;
    graphifyCommandAt = now;
    return resolved;
  }

  /**
   * graphify MCP serve 可用性检测（graphifyy[mcp] extra 已装：mcp 包 + graphify.serve 模块）。
   * serve 只能通过 `python -m graphify.serve` 启动（graphify.exe 无 serve 子命令），
   * 因此同时要求 python 可执行。独立短缓存（10min，探测代价高）。异步探测，不阻塞主线程。
   */
  async isGraphifyMcpAvailable(): Promise<boolean> {
    const now = Date.now();
    if (
      this.graphifyMcpCheck &&
      now - this.graphifyMcpCheck.at < GRAPHIFY_MCP_CHECK_TTL_MS
    ) {
      return this.graphifyMcpCheck.available;
    }
    // 并发去重：多条消息同时触发时只探测一次
    if (this.graphifyMcpProbeInFlight) return this.graphifyMcpProbeInFlight;
    const probe = (async () => {
      let available = false;
      try {
        available = await runProbe(
          "python",
          ["-c", "import mcp, graphify.serve"],
          10_000,
          false,
        );
      } catch {
        available = false;
      }
      this.graphifyMcpCheck = { available, at: Date.now() };
      return available;
    })();
    this.graphifyMcpProbeInFlight = probe;
    try {
      return await probe;
    } finally {
      this.graphifyMcpProbeInFlight = undefined;
    }
  }

  /** graphify 命令可用性检测（PATH 探测 + 版本验证，短缓存）。异步探测，不阻塞主线程。 */
  async isGraphifyInstalled(): Promise<boolean> {
    const now = Date.now();
    if (
      this.graphifyCheck &&
      now - this.graphifyCheck.at < GRAPHIFY_CHECK_TTL_MS
    ) {
      return this.graphifyCheck.installed;
    }
    if (this.graphifyProbeInFlight) return this.graphifyProbeInFlight;
    const probe = (async () => {
      let installed = false;
      try {
        const { command, prefixArgs } = await this.resolveGraphifyCommand();
        installed = await runProbe(
          command,
          [...prefixArgs, "--version"],
          8_000,
          process.platform === "win32" && command !== "python",
        );
      } catch {
        installed = false;
      }
      this.graphifyCheck = { installed, at: Date.now() };
      return installed;
    })();
    this.graphifyProbeInFlight = probe;
    try {
      return await probe;
    } finally {
      this.graphifyProbeInFlight = undefined;
    }
  }

  /**
   * 查询当前状态（按主仓库；纯读，无副作用）。cwd 为空时仅返回 graphify 安装状态（设置区用）。
   * 异步：内部 graphify 探测改为异步 spawn，不阻塞主线程（IPC handler 可 await）。
   */
  async getState(cwd: string): Promise<RepoMapToolsState> {
    if (!cwd) {
      return {
        status: "idle",
        mapReady: false,
        graphReady: false,
        graphifyInstalled: await this.isGraphifyInstalled(),
      };
    }
    const mainRepo = getMainRepoRootSync(cwd);
    if (!mainRepo) {
      const state: RepoMapToolsState = {
        status: "unavailable",
        mapReady: false,
        graphReady: false,
        graphifyInstalled: await this.isGraphifyInstalled(),
        mainRepo: undefined,
        error: "非 git 项目不支持代码图谱（需在 git 仓库中创建）",
      };
      this.states.set(cwd, state);
      return state;
    }

    const graphifyInstalled = await this.isGraphifyInstalled();
    // 进行中的构建状态优先（跨调用保持 running）。仅当确有待决构建任务时才返回缓存，
    // 否则重算——修复 graphify 未装时 running 永无终态的死锁（PR #56 review，2026-08-14）。
    const active = this.states.get(mainRepo);
    if (active?.status === "running" && this.pendingBuilds.has(mainRepo)) return active;

    const mapReady =
      repoMapService.getRepoMapForPromptReadOnly(mainRepo) !== undefined;
    const { graphReady, graphStale } = this.checkGraphReady(mainRepo);
    const status: RepoMapToolsStatus = mapReady && graphReady ? "done" : "idle";

    const state: RepoMapToolsState = {
      status,
      mapReady,
      graphReady,
      graphifyInstalled,
      graphStale,
      mainRepo,
    };
    this.states.set(mainRepo, state);
    return state;
  }

  /**
   * 图谱就绪检查（graph.json 存在 + 轻量冒烟校验）+ HEAD 过期检测。
   *
   * 冒烟校验只读文件头（graph.json 可达几十 MB，全量 JSON.parse 会阻塞主线程）：
   * 文件非空且以 JSON 起始字符（{ / [）开头视为有效；被清空/写坏/非 JSON 文件一律视为未就绪，
   * 用户点击按钮可重试重建（review：用户清理/损坏后无重校验）。
   * HEAD 对比：构建时记录 .graphify_head，与当前 HEAD 不一致 → graphStale（图谱基于旧代码）。
   */
  private checkGraphReady(mainRepo: string): { graphReady: boolean; graphStale: boolean } {
    const graphPath = graphJsonPath(mainRepo);
    let graphReady = false;
    try {
      const st = fs.statSync(graphPath);
      if (st.size > 0) {
        const fd = fs.openSync(graphPath, "r");
        try {
          const head = Buffer.alloc(16);
          const read = fs.readSync(fd, head, 0, 16, 0);
          const prefix = head.subarray(0, read).toString("utf-8").trimStart();
          graphReady = prefix.startsWith("{") || prefix.startsWith("[");
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch {
      graphReady = false;
    }
    let graphStale = false;
    if (graphReady) {
      const headFile = path.join(graphifyOutDir(mainRepo), ".graphify_head");
      try {
        const builtHead = fs.readFileSync(headFile, "utf-8").trim();
        const currentHead = getGitHeadSync(mainRepo);
        graphStale = builtHead !== "" && currentHead !== undefined && builtHead !== currentHead;
      } catch {
        // 无 .graphify_head（旧图或上游工具直建）：不标记 stale
        graphStale = false;
      }
    }
    return { graphReady, graphStale };
  }

  /**
   * 幂等创建（对话栏按钮唯一入口）：
   * - repo map：warmUp（主进程内生成，fire-and-forget，内置零依赖）
   * - Graphify：spawn 子进程 `graphify extract . --code-only`（cwd=主仓库）
   * - forceUpdate：图已就绪时点击按钮 → 差分更新 `graphify update .`（增量，非全量重建）
   * - 同主仓库并发去重（进行中复用）；非 git → unavailable；graphify 未装 → map 照建 + 终态 failed
   */
  async ensureMapTools(cwd: string, options?: { forceUpdate?: boolean }): Promise<RepoMapToolsState> {
    const mainRepo = getMainRepoRootSync(cwd);
    if (!mainRepo) {
      const state: RepoMapToolsState = {
        status: "unavailable",
        mapReady: false,
        graphReady: false,
        graphifyInstalled: await this.isGraphifyInstalled(),
        mainRepo: undefined,
        error: "非 git 项目不支持代码图谱（需在 git 仓库中创建）",
      };
      this.states.set(cwd, state);
      this.emit(state);
      return state;
    }

    const existing = this.states.get(mainRepo);
    if (existing?.status === "running") return existing;

    const graphifyInstalled = await this.isGraphifyInstalled();
    const mapReady =
      repoMapService.getRepoMapForPromptReadOnly(mainRepo) !== undefined;
    const { graphReady, graphStale } = this.checkGraphReady(mainRepo);

    if (mapReady && graphReady) {
      // 已就绪：默认幂等返回 done；forceUpdate 时跑差分更新 `graphify update .`（PR #56 review）
      if (options?.forceUpdate) {
        if (!graphifyInstalled) {
          const failed: RepoMapToolsState = {
            status: "failed",
            mapReady: true,
            graphReady: true,
            graphifyInstalled: false,
            graphStale,
            mainRepo,
            error: "未安装 graphify，无法更新图谱（设置 → 通用 → Graphify 环境一键安装）",
          };
          this.states.set(mainRepo, failed);
          this.emit(failed);
          return failed;
        }
        const updating: RepoMapToolsState = {
          status: "running",
          mapReady: true,
          graphReady: true,
          graphifyInstalled,
          graphStale,
          mainRepo,
          progress: "增量更新图谱…",
        };
        this.states.set(mainRepo, updating);
        this.emit(updating);
        void this.buildGraphify(mainRepo, updating, "update");
        return updating;
      }
      const state: RepoMapToolsState = {
        status: "done",
        mapReady: true,
        graphReady: true,
        graphifyInstalled,
        graphStale,
        mainRepo,
      };
      this.states.set(mainRepo, state);
      this.emit(state);
      return state;
    }

    // graphify 未装且无图：不经过 running（避免 running→failed 连续两次推送闪烁，review #3），
    // 直接置终态 failed；repo map 照建（部分失败语义，PR #56）。
    if (!graphReady && !graphifyInstalled) {
      if (!mapReady) {
        repoMapService.warmUp(mainRepo);
      }
      const failed: RepoMapToolsState = {
        status: "failed",
        mapReady,
        graphReady: false,
        graphifyInstalled: false,
        mainRepo,
        error: "未安装 graphify，请到设置 → 通用 → Graphify 环境一键安装后重试",
      };
      this.states.set(mainRepo, failed);
      this.emit(failed);
      return failed;
    }

    // 开始创建（running 状态）
    const running: RepoMapToolsState = {
      status: "running",
      mapReady,
      graphReady,
      graphifyInstalled,
      mainRepo,
      progress: !mapReady ? "生成代码地图…" : "构建知识图谱…",
    };
    this.states.set(mainRepo, running);
    this.emit(running);

    // repo map 部分（内置，无依赖；未就绪则触发后台生成）
    if (!mapReady) {
      repoMapService.warmUp(mainRepo);
    }

    // Graphify 部分（已安装且有 pending 构建或图未就绪）
    if (!graphReady && graphifyInstalled) {
      void this.buildGraphify(mainRepo, running, "extract");
    }

    return this.states.get(mainRepo) ?? running;
  }

  /**
   * spawn graphify 构建（异步，完成后更新状态并推送）。
   * mode: extract=首次建图（全量 AST 提取）；update=增量更新（代码变更后同步）。
   */
  private async buildGraphify(
    mainRepo: string,
    initial: RepoMapToolsState,
    mode: "extract" | "update",
  ): Promise<void> {
    const existing = this.pendingBuilds.get(mainRepo);
    if (existing) return existing;

    const promise = (async () => {
      let settled = false;
      const finish = (next: RepoMapToolsState): void => {
        if (settled) return;
        settled = true;
        this.pendingBuilds.delete(mainRepo);
        this.states.set(mainRepo, next);
        this.emit(next);
      };

      let child;
      try {
        const { command, prefixArgs } = await this.resolveGraphifyCommand();
        const buildArgs =
          mode === "update" ? ["update", "."] : ["extract", ".", "--code-only"];
        child = spawn(command, [...prefixArgs, ...buildArgs], {
          cwd: mainRepo,
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32" && command !== "python",
        });
      } catch (error) {
        finish({
          ...initial,
          status: "failed",
          error: `启动 graphify 失败：${String(error)}`,
        });
        return;
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // ignore
          }
          finish({
            ...initial,
            status: "failed",
            error: "图谱构建超时（30 分钟），请重试",
          });
          resolve();
        }, GRAPHIFY_BUILD_TIMEOUT_MS);

        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
          if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
        });

        child.on("error", (error) => {
          clearTimeout(timer);
          finish({
            ...initial,
            status: "failed",
            error: `graphify 执行失败：${error.message}`,
          });
          resolve();
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          const mapReady =
            repoMapService.getRepoMapForPromptReadOnly(mainRepo) !== undefined;
          const { graphReady } = this.checkGraphReady(mainRepo);
          if (code === 0 && graphReady) {
            // 建图成功：确保 graphify-out/ 已加入主仓库 .gitignore（防止污染 git status；PR #56 review）
            if (mode === "extract") {
              this.ensureGitignore(mainRepo);
            }
            // 记录构建时的 HEAD：下次 getState 对比当前 HEAD，不一致时标记 graphStale（图谱过期）
            this.writeGraphifyHead(mainRepo);
            finish({
              status: "done",
              mapReady,
              graphReady: true,
              graphifyInstalled: true,
              mainRepo,
            });
          } else {
            finish({
              status: "failed",
              mapReady,
              graphReady,
              graphifyInstalled: true,
              mainRepo,
              error:
                code === 0
                  ? "graph.json 未生成，构建可能不完整，请重试"
                  : `图谱构建失败（退出码 ${code}）${stderr ? `：${stderr.trim().split("\n").pop()}` : ""}`,
            });
          }
          resolve();
        });
      });
    })();

    this.pendingBuilds.set(mainRepo, promise);
    return promise;
  }

  /** 记录构建时的 HEAD（写入 graphify-out/.graphify_head，供 getState 过期检测） */
  private writeGraphifyHead(mainRepo: string): void {
    try {
      const head = getGitHeadSync(mainRepo);
      if (head) {
        fs.writeFileSync(path.join(graphifyOutDir(mainRepo), ".graphify_head"), head, "utf-8");
      }
    } catch {
      // 记录失败不影响主流程（无 .graphify_head 时不标记 stale）
    }
  }

  /**
   * git 防护：确保主仓库 .gitignore 忽略 graphify-out/（缺条目则追加）。
   * 返回是否追加（供 UI 提示）。
   */
  ensureGitignore(mainRepo: string): boolean {
    const gitignorePath = path.join(mainRepo, ".gitignore");
    const entry = "graphify-out/";
    try {
      const content = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, "utf-8")
        : "";
      const lines = content.split(/\r?\n/);
      if (lines.some((line) => line.trim() === entry)) return false;
      const appended =
        content.endsWith("\n") || content === ""
          ? `${content}${entry}\n`
          : `${content}\n${entry}\n`;
      fs.writeFileSync(gitignorePath, appended, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /** 解析 pip 安装命令（优先 pip，回退 python -m pip）。异步探测，不阻塞主线程。 */
  private async resolvePipCommand(): Promise<{ command: string; prefixArgs: string[] }> {
    const pipProbe = await runProbe("pip", ["--version"], 5_000, process.platform === "win32");
    if (pipProbe) {
      return { command: "pip", prefixArgs: [] };
    }
    const pyProbe = await runProbe("python", ["-m", "pip", "--version"], 5_000, false);
    if (pyProbe) {
      return { command: "python", prefixArgs: ["-m", "pip"] };
    }
    return { command: "pip", prefixArgs: [] };
  }

  /**
   * 一键安装 graphify（半内置：MyYoda 触发 pip，进度经回调实时可见）。
   * 安装 graphifyy[mcp]：基础包 + MCP serve 依赖（mcp/uvicorn），一体装齐。
   * 安装完成后 graphify 可用性缓存立即刷新。
   */
  installGraphify(
    onProgress: (line: string) => void,
  ): Promise<RepoMapToolsInstallResult> {
    // 并发保护：两个窗口同时点「一键安装」时复用同一 in-flight 操作，避免并发 pip 进程
    if (this.pendingInstall) return this.pendingInstall.then((r) => {
      onProgress(r.error ?? '安装操作已在另一窗口进行，已复用其结果')
      return r
    })
    return this.pendingInstall = (async () => {
      let command: string;
      let prefixArgs: string[];
      try {
        ({ command, prefixArgs } = await this.resolvePipCommand());
      } catch (error) {
        this.pendingInstall = undefined;
        return { ok: false, error: `无法启动安装命令：${String(error)}` };
      }
      let child;
      try {
        child = spawn(command, [...prefixArgs, "install", "graphifyy[mcp]"], {
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
        });
      } catch (error) {
        this.pendingInstall = undefined;
        return { ok: false, error: `无法启动安装命令：${String(error)}` };
      }

      const result = await new Promise<RepoMapToolsInstallResult>((resolve) => {
        let output = "";
        const feed = (chunk: Buffer): void => {
          const text = chunk.toString();
          output += text;
          if (output.length > 8_000) output = output.slice(-8_000);
          onProgress(text);
        };
        child.stdout?.on("data", feed);
        child.stderr?.on("data", feed);

        child.on("error", (error) => {
          resolve({ ok: false, error: `安装进程失败：${error.message}` });
        });
        child.on("close", (code) => {
          // 安装完成后清缓存，让状态检测立即生效（基础可用性 + MCP serve 可用性 + 命令解析缓存）。
          // graphifyCommandCache 也必须清：安装前 30s 内的探测结果可能是「graphify 不在 PATH」的默认值，
          // 不清会导致安装后验证命中旧缓存、不走 python -m 回退，误报「请重启应用」。
          this.graphifyCheck = undefined;
          this.graphifyMcpCheck = undefined;
          graphifyCommandCache = undefined;
          graphifyCommandAt = 0;
          if (code === 0) {
            resolve({ ok: true });
          } else {
            resolve({
              ok: false,
              error: `安装失败（退出码 ${code}），可查看日志或将「让 AI 帮你装」提示词发给 Agent`,
            });
          }
        });
      });
      // 安装成功后验证命令可用（异步探测，不阻塞）
      if (result.ok && !(await this.isGraphifyInstalled())) {
        this.pendingInstall = undefined;
        return {
          ok: false,
          error: "安装完成但 graphify 命令不可用（可能 PATH 未包含 Python Scripts 目录），请重启应用后重试",
        };
      }
      this.pendingInstall = undefined;
      return result;
    })();
  }

  /** 卸载 graphify（设置区操作） */
  uninstallGraphify(
    onProgress: (line: string) => void,
  ): Promise<RepoMapToolsInstallResult> {
    // 并发保护：与安装同理，多窗口重复点击复用同一 in-flight 操作
    if (this.pendingUninstall) return this.pendingUninstall.then((r) => {
      onProgress(r.error ?? '卸载操作已在另一窗口进行，已复用其结果')
      return r
    })
    return this.pendingUninstall = (async () => {
      let command: string;
      let prefixArgs: string[];
      try {
        ({ command, prefixArgs } = await this.resolvePipCommand());
      } catch (error) {
        this.pendingUninstall = undefined;
        return { ok: false, error: `无法启动卸载命令：${String(error)}` };
      }
      let child;
      try {
        child = spawn(
          command,
          [...prefixArgs, "uninstall", "-y", "graphifyy"],
          {
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
          },
        );
      } catch (error) {
        this.pendingUninstall = undefined;
        return { ok: false, error: `无法启动卸载命令：${String(error)}` };
      }
      const result = await new Promise<RepoMapToolsInstallResult>((resolve) => {
        let output = "";
        const feed = (chunk: Buffer): void => {
          const text = chunk.toString();
          output += text;
          if (output.length > 8_000) output = output.slice(-8_000);
          onProgress(text);
        };
        child.stdout?.on("data", feed);
        child.stderr?.on("data", feed);
        child.on("error", (error) => {
          resolve({ ok: false, error: `卸载进程失败：${error.message}` });
        });
        child.on("close", (code) => {
          this.graphifyCheck = undefined;
          resolve({
            ok: code === 0,
            error: code === 0 ? undefined : `卸载失败（退出码 ${code}）`,
          });
        });
      });
      this.pendingUninstall = undefined;
      return result;
    })();
  }
}

export const repoMapToolsService = new RepoMapToolsService();
