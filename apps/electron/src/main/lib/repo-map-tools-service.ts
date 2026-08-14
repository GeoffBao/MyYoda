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
import { execSync, spawn, spawnSync } from "node:child_process";
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
/** graphify 命令可用性短缓存（30s，避免每条消息 spawnSync 探测） */
const GRAPHIFY_CHECK_TTL_MS = 30_000;
/**
 * graphify MCP serve 可用性缓存（10 分钟，2026-08-14 review 修正）。
 * 检测代价高（python 启动 + import mcp ≈ 0.5~1.5s 同步阻塞主进程），
 * 30s TTL 会导致主进程周期性卡顿；mcp extra 安装状态极少变化，
 * install/uninstall 时已手动清缓存。
 */
const GRAPHIFY_MCP_CHECK_TTL_MS = 10 * 60_000;

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
   */
  private resolveGraphifyCommand(): GraphifyCommand {
    const now = Date.now();
    if (
      graphifyCommandCache &&
      now - graphifyCommandAt < GRAPHIFY_CHECK_TTL_MS
    ) {
      return graphifyCommandCache;
    }
    let resolved: GraphifyCommand = { command: "graphify", prefixArgs: [] };
    const direct = spawnSync("graphify", ["--version"], {
      stdio: "ignore",
      timeout: 5_000,
      shell: process.platform === "win32",
    });
    if (direct.error === undefined && direct.status === 0) {
      resolved = { command: "graphify", prefixArgs: [] };
    } else {
      const pyModule = spawnSync("python", ["-m", "graphify", "--version"], {
        stdio: "ignore",
        timeout: 8_000,
      });
      if (pyModule.error === undefined && pyModule.status === 0) {
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
   * 因此同时要求 python 可执行。独立短缓存（30s），不干扰 graphify 基础安装状态。
   */
  isGraphifyMcpAvailable(): boolean {
    const now = Date.now();
    if (
      this.graphifyMcpCheck &&
      now - this.graphifyMcpCheck.at < GRAPHIFY_MCP_CHECK_TTL_MS
    ) {
      return this.graphifyMcpCheck.available;
    }
    let available = false;
    try {
      const result = spawnSync("python", ["-c", "import mcp, graphify.serve"], {
        stdio: "ignore",
        timeout: 10_000,
      });
      available = result.error === undefined && result.status === 0;
    } catch {
      available = false;
    }
    this.graphifyMcpCheck = { available, at: now };
    return available;
  }

  /** graphify 命令可用性检测（PATH 探测 + 版本验证，短缓存） */
  isGraphifyInstalled(): boolean {
    const now = Date.now();
    if (
      this.graphifyCheck &&
      now - this.graphifyCheck.at < GRAPHIFY_CHECK_TTL_MS
    ) {
      return this.graphifyCheck.installed;
    }
    let installed = false;
    try {
      const { command, prefixArgs } = this.resolveGraphifyCommand();
      const result = spawnSync(command, [...prefixArgs, "--version"], {
        stdio: "ignore",
        timeout: 8_000,
        shell: process.platform === "win32" && command !== "python",
      });
      installed = result.error === undefined && result.status === 0;
    } catch {
      installed = false;
    }
    this.graphifyCheck = { installed, at: now };
    return installed;
  }

  /** 查询当前状态（按主仓库；纯读，无副作用）。cwd 为空时仅返回 graphify 安装状态（设置区用）。 */
  getState(cwd: string): RepoMapToolsState {
    if (!cwd) {
      return {
        status: "idle",
        mapReady: false,
        graphReady: false,
        graphifyInstalled: this.isGraphifyInstalled(),
      };
    }
    const mainRepo = getMainRepoRootSync(cwd);
    if (!mainRepo) {
      const state: RepoMapToolsState = {
        status: "unavailable",
        mapReady: false,
        graphReady: false,
        graphifyInstalled: this.isGraphifyInstalled(),
        mainRepo: undefined,
        error: "非 git 项目不支持代码图谱（需在 git 仓库中创建）",
      };
      this.states.set(cwd, state);
      return state;
    }

    const graphifyInstalled = this.isGraphifyInstalled();
    // 进行中的构建状态优先（跨调用保持 running）。仅当确有待决构建任务时才返回缓存，
    // 否则重算——修复 graphify 未装时 running 永无终态的死锁（PR #56 review，2026-08-14）。
    const active = this.states.get(mainRepo);
    if (active?.status === "running" && this.pendingBuilds.has(mainRepo)) return active;

    const mapReady =
      repoMapService.getRepoMapForPromptReadOnly(mainRepo) !== undefined;
    const graphReady = fs.existsSync(graphJsonPath(mainRepo));
    const status: RepoMapToolsStatus = mapReady && graphReady ? "done" : "idle";

    const state: RepoMapToolsState = {
      status,
      mapReady,
      graphReady,
      graphifyInstalled,
      mainRepo,
    };
    this.states.set(mainRepo, state);
    return state;
  }

  /**
   * 幂等创建（对话栏按钮唯一入口）：
   * - repo map：warmUp（主进程内生成，fire-and-forget，内置零依赖）
   * - Graphify：spawn 子进程 `graphify extract . --code-only`（cwd=主仓库）
   * - forceUpdate：图已就绪时点击按钮 → 差分更新 `graphify update .`（增量，非全量重建）
   * - 同主仓库并发去重（进行中复用）；非 git → unavailable；graphify 未装 → map 照建 + 终态 failed
   */
  ensureMapTools(cwd: string, options?: { forceUpdate?: boolean }): RepoMapToolsState {
    const mainRepo = getMainRepoRootSync(cwd);
    if (!mainRepo) {
      const state: RepoMapToolsState = {
        status: "unavailable",
        mapReady: false,
        graphReady: false,
        graphifyInstalled: this.isGraphifyInstalled(),
        mainRepo: undefined,
        error: "非 git 项目不支持代码图谱（需在 git 仓库中创建）",
      };
      this.states.set(cwd, state);
      this.emit(state);
      return state;
    }

    const existing = this.states.get(mainRepo);
    if (existing?.status === "running") return existing;

    const graphifyInstalled = this.isGraphifyInstalled();
    const mapReady =
      repoMapService.getRepoMapForPromptReadOnly(mainRepo) !== undefined;
    const graphReady = fs.existsSync(graphJsonPath(mainRepo));

    if (mapReady && graphReady) {
      // 已就绪：默认幂等返回 done；forceUpdate 时跑差分更新 `graphify update .`（PR #56 review）
      if (options?.forceUpdate) {
        if (!graphifyInstalled) {
          const failed: RepoMapToolsState = {
            status: "failed",
            mapReady: true,
            graphReady: true,
            graphifyInstalled: false,
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
        mainRepo,
      };
      this.states.set(mainRepo, state);
      this.emit(state);
      return state;
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

    // Graphify 部分（未安装则跳过，map 照建——部分失败语义）
    if (!graphReady && graphifyInstalled) {
      void this.buildGraphify(mainRepo, running, "extract");
    } else if (!graphReady) {
      // graphify 未装且无图：立即置终态 failed，修复 running 死锁（PR #56 review，2026-08-14）
      const failed: RepoMapToolsState = {
        ...running,
        status: "failed",
        error: "未安装 graphify，请到设置 → 通用 → Graphify 环境一键安装后重试",
      };
      this.states.set(mainRepo, failed);
      this.emit(failed);
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

    const promise = new Promise<void>((resolve) => {
      let settled = false;
      const finish = (next: RepoMapToolsState): void => {
        if (settled) return;
        settled = true;
        this.pendingBuilds.delete(mainRepo);
        this.states.set(mainRepo, next);
        this.emit(next);
        resolve();
      };

      let child;
      try {
        const { command, prefixArgs } = this.resolveGraphifyCommand();
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
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const mapReady =
          repoMapService.getRepoMapForPromptReadOnly(mainRepo) !== undefined;
        const graphReady = fs.existsSync(graphJsonPath(mainRepo));
        if (code === 0 && graphReady) {
          // 建图成功：确保 graphify-out/ 已加入主仓库 .gitignore（防止污染 git status；PR #56 review）
          if (mode === "extract") {
            this.ensureGitignore(mainRepo);
          }
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
      });
    });

    this.pendingBuilds.set(mainRepo, promise);
    return promise;
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

  /** 解析 pip 安装命令（优先 pip，回退 python -m pip） */
  private resolvePipCommand(): { command: string; prefixArgs: string[] } {
    const pipProbe = spawnSync("pip", ["--version"], {
      stdio: "ignore",
      timeout: 5_000,
      shell: process.platform === "win32",
    });
    if (pipProbe.error === undefined && pipProbe.status === 0) {
      return { command: "pip", prefixArgs: [] };
    }
    const pyProbe = spawnSync("python", ["-m", "pip", "--version"], {
      stdio: "ignore",
      timeout: 5_000,
      shell: process.platform === "win32",
    });
    if (pyProbe.error === undefined && pyProbe.status === 0) {
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
    return new Promise((resolve) => {
      const { command, prefixArgs } = this.resolvePipCommand();
      let child;
      try {
        child = spawn(command, [...prefixArgs, "install", "graphifyy[mcp]"], {
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
        });
      } catch (error) {
        resolve({ ok: false, error: `无法启动安装命令：${String(error)}` });
        return;
      }

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
        // 安装完成后清缓存，让状态检测立即生效（基础可用性 + MCP serve 可用性）
        this.graphifyCheck = undefined;
        this.graphifyMcpCheck = undefined;
        if (code === 0 && this.isGraphifyInstalled()) {
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error:
              code === 0
                ? "安装完成但 graphify 命令不可用（可能 PATH 未包含 Python Scripts 目录），请重启应用后重试"
                : `安装失败（退出码 ${code}），可查看日志或将「让 AI 帮你装」提示词发给 Agent`,
          });
        }
      });
    });
  }

  /** 卸载 graphify（设置区操作） */
  uninstallGraphify(
    onProgress: (line: string) => void,
  ): Promise<RepoMapToolsInstallResult> {
    return new Promise((resolve) => {
      const { command, prefixArgs } = this.resolvePipCommand();
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
        resolve({ ok: false, error: `无法启动卸载命令：${String(error)}` });
        return;
      }
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
  }
}

export const repoMapToolsService = new RepoMapToolsService();
