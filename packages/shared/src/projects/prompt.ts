/**
 * 项目上下文 → Agent 提示词（纯函数，renderer-safe）
 */
import type { ProjectPromptContext } from './types.ts';

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 剥离控制字符与可能逃逸 XML 块的闭合标签 */
function sanitizeProjectBodyText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/<\s*\/\s*project_(?:context|assets|memory|assets_path|memory_path|working_directory)\s*>/gi, '');
}

function sanitizeProjectFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return sanitizeProjectBodyText(name.replace(/[\x00-\x1f\x7f]/g, ''));
}

/** MEMORY.md 注入系统提示词的 token 上限；超过此值 loadProjectMemory 会从尾部截断（保留头部最新内容） */
export const MEMORY_TOKEN_CAP = 5000;

/** 估算文本的 token 数（简略版：中英混合用 char/2，纯英文 char/4）；renderer 与 main 进程共用同一份估算口径 */
export function estimateTokenCount(text: string): number {
  let ascii = 0, nonAscii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4 + nonAscii * 1.5);
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 将项目上下文格式化为可注入 system/dynamic prompt 的 XML 块 */
export function formatProjectContextForPrompt(ctx: ProjectPromptContext): string {
  const lines: string[] = [];
  lines.push(`<project_context project="${escapeAttr(ctx.name)}">`);

  if (ctx.description?.trim()) {
    lines.push(sanitizeProjectBodyText(ctx.description.trim()));
    lines.push('');
  }
  if (ctx.details?.trim()) {
    lines.push(sanitizeProjectBodyText(ctx.details.trim()));
    lines.push('');
  }

  if (ctx.workingDirectory?.trim()) {
    lines.push(`<project_working_directory>${sanitizeProjectBodyText(ctx.workingDirectory.trim())}</project_working_directory>`);
  }

  lines.push(`<project_assets_path>${sanitizeProjectBodyText(ctx.assetsPath)}</project_assets_path>`);
  if (ctx.assets.length > 0) {
    lines.push('<project_assets>');
    for (const asset of ctx.assets) {
      lines.push(
        `- ${sanitizeProjectFilename(asset.filename)} (${sanitizeProjectBodyText(asset.mimeType)}, ${formatBytes(asset.sizeBytes)})`,
      );
    }
    lines.push('</project_assets>');
  }

  lines.push(`<project_memory_path>${sanitizeProjectBodyText(ctx.memoryPath)}</project_memory_path>`);
  if (ctx.memoryContent?.trim()) {
    lines.push('<project_memory>');
    lines.push(sanitizeProjectBodyText(ctx.memoryContent.trim()));
    lines.push('</project_memory>');
  }

  lines.push('');
  lines.push('当前会话已绑定到上述项目。');
  if (ctx.workingDirectory?.trim()) {
    lines.push(
      ctx.isWorktree
        ? '`<project_working_directory>` 当前指向本会话绑定的 Git Worktree 隔离目录（与 `<working_directory>` 一致）；改动只会落在这个独立分支/工作树里，不影响项目主目录或其他会话。需要读代码、改代码、跑命令时，直接以该目录为基准，不要跳转到项目原始目录。'
        : '`<project_working_directory>` 是用户指定的项目工程代码根目录；会话 cwd 是会话隔离目录，不要在这里找代码。需要读代码、改代码、跑命令时，直接以该目录为基准，不要猜测或搜索其他路径。',
    );
    lines.push('如果 `<project_working_directory>` 下存在 AGENTS.md（旧版为 CLAUDE.md），那是人写指令（可能同时被其他 CLI 等外部工具读取），只读不要自动创建或修改；这个项目的自动记忆一律通过 `<project_memory_path>` 写入 MEMORY.md，不要写入指令文件。');
  }
  if (ctx.assets.length > 0) {
    lines.push('`<project_assets>` 列出用户提供的参考文件；仅在相关时按绝对路径按需读取，不必全部读完。');
  }
  lines.push('`<project_assets_path>` 是项目资产库：可作为项目参考文件读取；不要把下载/生成产物写进去（该目录保留给用户提供的项目资产，会话级交付物写入当前会话的 Outbox，项目内文件写入 `<project_working_directory>` 对应目录）。');
  lines.push('`<project_memory>` 是该项目的权威累积知识；学到项目专属的持久决策、约定或经验时，用 Write/Edit 写入 MEMORY.md（最新/重要优先，约 5000 token 内）。');
  lines.push('</project_context>');
  return lines.join('\n');
}
