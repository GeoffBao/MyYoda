/**
 * 项目存储服务 — 文件系统 CRUD
 *
 * 项目存储在 {workspaceRootPath}/projects/{projectSlug}/
 *
 * 参照 OSS: packages/shared/src/projects/storage.ts
 * 适配: OSS 工具函数（atomicWriteFileSync/expandPath/toPortablePath 等）
 *       替换为 Bun/Node 标准 API
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, unlinkSync, readFileSync, renameSync } from 'fs';
import { basename, dirname, extname, isAbsolute, join } from 'path';
import { randomUUID } from 'crypto';
import type {
  ProjectConfig,
  ProjectAsset,
  LoadedProject,
  CreateProjectInput,
  UpdateProjectInput,
  UploadProjectAssetInput,
} from './types.ts';
import { estimateTokenCount, MEMORY_TOKEN_CAP } from './prompt.ts';

// ============================================================
// 辅助函数（替代 OSS utils）
// ============================================================

/** 获取文件的 MIME 类型（基于扩展名） */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.xml': 'application/xml',
  };
  return mimeMap[ext] ?? 'application/octet-stream';
}

/** JSON 文件安全读取 */
function readJsonFileSafe<T>(filePath: string): T | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 原子写入文件（写入临时文件后 rename） */
function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = filePath + '.tmp.' + randomUUID().slice(0, 8);
  writeFileSync(tmpPath, data, 'utf-8');
  renameSync(tmpPath, filePath);
}

/** 解析唯一资产路径（文件名冲突时添加后缀） */
function resolveUniqueAssetPath(assetsDir: string, filename: string): string {
  const candidate = join(assetsDir, filename);
  if (!existsSync(candidate)) return candidate;

  const ext = extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;

  let counter = 2;
  while (existsSync(join(assetsDir, `${stem}-${counter}${ext}`))) counter++;
  return join(assetsDir, `${stem}-${counter}${ext}`);
}

// ============================================================
// 路径辅助
// ============================================================

/** workspace 的项目目录路径 */
export function getWorkspaceProjectsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'projects');
}

/** 项目文件夹路径 */
export function getProjectPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getWorkspaceProjectsPath(workspaceRootPath), projectSlug);
}

/** 项目 assets 目录路径 */
export function getProjectAssetsPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getProjectPath(workspaceRootPath, projectSlug), 'assets');
}

/** MEMORY.md 文件名（放在 config.json 同级，不在 assets/ 内） */
export const MEMORY_FILENAME = 'MEMORY.md';

/** 本地目录项目的项目级记忆目录名，与会话级/空间级 `.context/` 同名但物理位置在项目真实文件夹下 */
const PROJECT_CONTEXT_DIRNAME = '.context';

/**
 * 项目 MEMORY.md 路径。
 *
 * `memoryLocation === 'project'`（创建时按是否提供 workingDirectory 一次性决定，不做事后迁移）
 * 的本地目录项目落在 `workingDirectory/.context/MEMORY.md`，跟随项目真实文件夹；
 * 其余（空白项目、隐藏容器 Project、老项目未设置该字段）沿用 MyYoda 托管目录，保持完全兼容。
 */
export function getProjectMemoryPath(workspaceRootPath: string, projectSlug: string): string {
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  const workingDirectory = config?.workingDirectory?.trim();
  if (config?.memoryLocation === 'project' && workingDirectory) {
    return join(workingDirectory, PROJECT_CONTEXT_DIRNAME, MEMORY_FILENAME);
  }
  return join(getProjectPath(workspaceRootPath, projectSlug), MEMORY_FILENAME);
}

/** 确保项目目录存在 */
export function ensureProjectsDir(workspaceRootPath: string): void {
  const dir = getWorkspaceProjectsPath(workspaceRootPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 确保项目 assets 目录存在 */
export function ensureProjectAssetsDir(workspaceRootPath: string, projectSlug: string): void {
  const dir = getProjectAssetsPath(workspaceRootPath, projectSlug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 项目托管 workdir 路径（与 assets / config 分离） */
export function getProjectWorkdirPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getProjectPath(workspaceRootPath, projectSlug), 'workdir');
}

/** 确保项目托管 workdir 存在 */
export function ensureProjectWorkdir(workspaceRootPath: string, projectSlug: string): string {
  const dir = getProjectWorkdirPath(workspaceRootPath, projectSlug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ============================================================
// Config CRUD
// ============================================================

/** 加载项目 config.json。不存在或解析失败时返回 null。 */
export function loadProjectConfig(workspaceRootPath: string, projectSlug: string): ProjectConfig | null {
  const configPath = join(getProjectPath(workspaceRootPath, projectSlug), 'config.json');
  if (!existsSync(configPath)) return null;
  return readJsonFileSafe<ProjectConfig>(configPath);
}

/** 保存项目 config.json（原子写入，保持调用方传入的时间戳） */
export function saveProjectConfig(workspaceRootPath: string, config: ProjectConfig): void {
  const dir = getProjectPath(workspaceRootPath, config.slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  atomicWriteFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

// ============================================================
// Memory
// ============================================================

/** 加载项目的 MEMORY.md，按 maxTokens 上限截断（保留头部，新内容在最前） */
export function loadProjectMemory(
  workspaceRootPath: string,
  projectSlug: string,
  maxTokens = MEMORY_TOKEN_CAP,
): string | null {
  const memoryPath = getProjectMemoryPath(workspaceRootPath, projectSlug);
  if (!existsSync(memoryPath)) return null;

  let content: string;
  try {
    content = readFileSync(memoryPath, 'utf-8');
  } catch {
    return null;
  }

  if (!content.trim()) return null;

  const tokens = estimateTokenCount(content);
  if (tokens <= maxTokens) return content;

  // 超限：保留头部、追加截断标记
  const marker = `\n\n…[MEMORY.md 已截断至 ${maxTokens} token 上限]`;
  const markerTokens = estimateTokenCount(marker);
  const bodyBudget = Math.max(0, maxTokens - markerTokens);
  const charsPerToken = content.length / tokens;
  const charBudget = Math.floor(bodyBudget * charsPerToken);
  const head = content.slice(0, charBudget).trimEnd();
  return `${head}${marker}`;
}

// ============================================================
// 加载
// ============================================================

/** 按 slug 加载单个项目 */
export function loadProject(workspaceRootPath: string, projectSlug: string): LoadedProject | null {
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!config) return null;

  return {
    config,
    folderPath: getProjectPath(workspaceRootPath, projectSlug),
    assetsPath: getProjectAssetsPath(workspaceRootPath, projectSlug),
    workspaceRootPath,
    workspaceId: basename(workspaceRootPath),
  };
}

/** 按 ID 加载项目（扫描所有项目匹配 id） */
export function loadProjectById(workspaceRootPath: string, projectId: string): LoadedProject | null {
  const projects = loadWorkspaceProjects(workspaceRootPath);
  return projects.find((p) => p.config.id === projectId) ?? null;
}

/** 加载 workspace 下所有项目 */
export function loadWorkspaceProjects(workspaceRootPath: string): LoadedProject[] {
  ensureProjectsDir(workspaceRootPath);
  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);
  if (!existsSync(projectsDir)) return [];

  const projects: LoadedProject[] = [];
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const project = loadProject(workspaceRootPath, entry.name);
    if (project) projects.push(project);
  }
  return projects;
}

// ============================================================
// CRUD
// ============================================================

/** 生成 URL-safe 且 workspace 内唯一的项目 slug */
export function generateProjectSlug(workspaceRootPath: string, name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  if (!slug) slug = 'project';

  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);
  const existingSlugs = new Set<string>();
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) existingSlugs.add(entry.name);
    }
  }

  if (!existingSlugs.has(slug)) return slug;
  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) counter++;
  return `${slug}-${counter}`;
}

/** 创建新项目 */
export function createProject(workspaceRootPath: string, input: CreateProjectInput): ProjectConfig {
  const slug = generateProjectSlug(workspaceRootPath, input.name);
  const now = Date.now();

  // memoryLocation 只在创建时决定一次，不做事后迁移：只有真正的本地目录项目（非历史隐藏容器）才把
  // 记忆放进项目真实文件夹；历史隐藏容器（home/ad-hoc）的 workingDirectory 指向 MyYoda 自己的托管目录，
  // 不算"项目真实文件夹"，仍走托管路径。新建项目不再产生隐藏容器 kind。
  const isRegularProject = !input.kind || input.kind === 'project';
  const hasWorkingDirectory = Boolean(input.workingDirectory?.trim());

  const config: ProjectConfig = {
    id: `proj_${randomUUID().slice(0, 8)}`,
    slug,
    name: input.name,
    description: input.description,
    workingDirectory: input.workingDirectory,
    details: input.details,
    colorTheme: input.colorTheme,
    color: input.color,
    kind: input.kind,
    createdAt: now,
    updatedAt: now,
    ...(isRegularProject && hasWorkingDirectory ? { memoryLocation: 'project' as const } : {}),
  };

  saveProjectConfig(workspaceRootPath, config);
  ensureProjectAssetsDir(workspaceRootPath, slug);
  ensureProjectWorkdir(workspaceRootPath, slug);
  return config;
}

/** 更新项目配置（id 和 slug 不可更改） */
export function updateProject(
  workspaceRootPath: string,
  projectSlug: string,
  patch: UpdateProjectInput,
): ProjectConfig {
  const existing = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!existing) throw new Error(`工作区不存在: ${projectSlug}`);

  const updated: ProjectConfig = {
    ...existing,
    ...patch,
    id: existing.id,
    slug: existing.slug,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  saveProjectConfig(workspaceRootPath, updated);
  return updated;
}

/** 删除项目（删除文件夹和所有资产） */
export function deleteProject(workspaceRootPath: string, projectSlug: string): void {
  const dir = getProjectPath(workspaceRootPath, projectSlug);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** 检查项目是否存在 */
export function projectExists(workspaceRootPath: string, projectSlug: string): boolean {
  return existsSync(join(getProjectPath(workspaceRootPath, projectSlug), 'config.json'));
}

// ============================================================
// 资产操作
// ============================================================

/** 净化文件名（移除路径分隔符和控制字符） */
export function sanitizeAssetFilename(filename: string): string {
  if (isAbsolute(filename)) {
    throw new Error(`不安全的资产文件名: ${filename}`);
  }
  if (filename.includes('/') || filename.includes('\\')) {
    throw new Error(`不安全的资产文件名: ${filename}`);
  }

  const base = basename(filename)
    .replace(/[\\/\x00-\x1f\x7f]+/g, '')
    .replace(/^\.+/, '');
  if (!base) {
    throw new Error(`不安全的资产文件名: ${filename}`);
  }
  return base.slice(0, 255);
}

/** 读取项目 MEMORY.md；文件不存在时返回空字符串 */
export function readProjectMemory(workspaceRootPath: string, projectSlug: string): string {
  const memoryPath = getProjectMemoryPath(workspaceRootPath, projectSlug);
  if (!existsSync(memoryPath)) return '';

  try {
    return readFileSync(memoryPath, 'utf-8');
  } catch {
    return '';
  }
}

/** 原子覆盖项目 MEMORY.md；工作区不存在时拒绝创建游离目录。 */
export function writeProjectMemory(workspaceRootPath: string, projectSlug: string, content: string): void {
  if (!projectExists(workspaceRootPath, projectSlug)) {
    throw new Error(`工作区不存在: ${projectSlug}`);
  }
  const memoryPath = getProjectMemoryPath(workspaceRootPath, projectSlug);
  const memoryDir = dirname(memoryPath);
  // project 模式的 .context/ 是项目真实文件夹下新目录，托管模式的项目目录已由 createProject 保证存在
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  atomicWriteFileSync(memoryPath, content);
}

/** 列出项目所有资产（按上传时间降序） */
export function listProjectAssets(workspaceRootPath: string, projectSlug: string): ProjectAsset[] {
  ensureProjectAssetsDir(workspaceRootPath, projectSlug);
  const assetsDir = getProjectAssetsPath(workspaceRootPath, projectSlug);
  if (!existsSync(assetsDir)) return [];

  const assets: ProjectAsset[] = [];
  for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = join(assetsDir, entry.name);
    try {
      const stats = statSync(filePath);
      assets.push({
        filename: entry.name,
        sizeBytes: stats.size,
        mimeType: getMimeType(filePath),
        uploadedAt: stats.mtimeMs,
        absolutePath: filePath,
      });
    } catch {
      // 跳过无法 stat 的文件
    }
  }

  assets.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return assets;
}

/** 上传项目资产（支持 base64/text/sourcePath 三种方式，文件名冲突自动加后缀） */
export function uploadProjectAsset(
  workspaceRootPath: string,
  projectSlug: string,
  input: UploadProjectAssetInput,
): ProjectAsset {
  if (!projectExists(workspaceRootPath, projectSlug)) {
    throw new Error(`工作区不存在: ${projectSlug}`);
  }

  ensureProjectAssetsDir(workspaceRootPath, projectSlug);
  const safeName = sanitizeAssetFilename(input.filename);
  const assetsDir = getProjectAssetsPath(workspaceRootPath, projectSlug);
  const targetPath = resolveUniqueAssetPath(assetsDir, safeName);

  if (input.base64 !== undefined) {
    writeFileSync(targetPath, Buffer.from(input.base64, 'base64'));
  } else if (input.text !== undefined) {
    writeFileSync(targetPath, input.text, 'utf-8');
  } else if (input.sourcePath) {
    if (!existsSync(input.sourcePath)) throw new Error(`源文件不存在: ${input.sourcePath}`);
    writeFileSync(targetPath, readFileSync(input.sourcePath));
  } else {
    throw new Error('uploadProjectAsset 需要 base64、text 或 sourcePath 之一');
  }

  const stats = statSync(targetPath);
  return {
    filename: basename(targetPath),
    sizeBytes: stats.size,
    mimeType: getMimeType(targetPath),
    uploadedAt: stats.mtimeMs,
    absolutePath: targetPath,
  };
}

/** 删除项目资产（不存在时无操作） */
export function deleteProjectAsset(workspaceRootPath: string, projectSlug: string, filename: string): void {
  const safe = sanitizeAssetFilename(filename);
  const target = join(getProjectAssetsPath(workspaceRootPath, projectSlug), safe);
  if (!existsSync(target)) return;
  if (basename(target) !== safe) throw new Error(`拒绝删除 assets 目录外的文件: ${filename}`);

  try {
    unlinkSync(target);
  } catch (error) {
    throw error;
  }
}
