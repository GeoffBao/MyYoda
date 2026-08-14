import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { RankedDefinition } from './types';
import logger from './logger';

export class TreeRenderer {
  async render(rankedDefinitions: RankedDefinition[], chatFiles: Set<string>, maxLines?: number, rootDir?: string): Promise<string> {
    // Filter out chat files
    const filtered = rankedDefinitions.filter((def) => !chatFiles.has(def.rel_fname));

    // Group by file
    const byFile = new Map<string, RankedDefinition[]>();
    for (const def of filtered) {
      const fileDefs = byFile.get(def.rel_fname) || [];
      fileDefs.push(def);
      byFile.set(def.rel_fname, fileDefs);
    }

    // Sort files by highest rank in file
    const sortedFiles = Array.from(byFile.entries()).sort((a, b) => {
      const maxRankA = Math.max(...a[1].map((d) => d.rank));
      const maxRankB = Math.max(...b[1].map((d) => d.rank));
      return maxRankB - maxRankA;
    });

    const totalFiles = sortedFiles.length;

    // If no maxLines specified, render everything
    if (!maxLines) {
      return this.renderAllFiles(sortedFiles, rootDir);
    }

    // If more files than maxLines, render a directory tree instead of a flat file list
    // （2026-08-13 修复：大仓库下平铺路径列表导航价值≈零，目录树 + Top 符号承载全景）
    if (totalFiles > maxLines) {
      return this.renderDirectoryTree(sortedFiles, maxLines, rootDir);
    }

    // Calculate lines per file (at least 2 lines per file: 1 for content + 1 for "..." if truncated)
    // Account for the filename line (1 line per file)
    const headerLines = totalFiles;
    const availableLines = maxLines - headerLines;
    const linesPerFile = Math.max(1, Math.floor(availableLines / totalFiles));

    return this.renderWithLineLimit(sortedFiles, linesPerFile, rootDir);
  }

  private async renderAllFiles(sortedFiles: [string, RankedDefinition[]][], rootDir?: string): Promise<string> {
    let output = '';
    for (const [file, definitions] of sortedFiles) {
      output += `\n${file}:\n`;

      // Sort definitions by line number
      definitions.sort((a, b) => a.line - b.line);

      // Get unique lines and render
      const lines = Array.from(new Set(definitions.map((d) => d.line)));
      const treeLines = await this.renderFileTree(file, lines, Infinity, false, rootDir);
      output += treeLines;
    }

    return output.trim();
  }

  /**
   * 大仓库目录树渲染（2026-08-13）：文件数超过行预算时不再退化为平铺路径列表，
   * 而是输出目录层级树（缩进 + 每目录文件数）+ PageRank Top 文件的符号签名，
   * 让预算内的地图承载仓库全景与关键符号（平铺列表只能展示前 maxLines 个文件）。
   */
  private async renderDirectoryTree(
    sortedFiles: [string, RankedDefinition[]][],
    maxLines: number,
    rootDir?: string,
  ): Promise<string> {
    // 预算分配：目录树占约 70%，Top 文件符号占约 30%
    const treeBudget = Math.max(10, Math.floor(maxLines * 0.7))
    const topBudget = Math.max(3, maxLines - treeBudget)

    // 1) 目录聚合（含祖先目录计数，单文件也计入）
    const dirCounts = new Map<string, number>()
    for (const [file] of sortedFiles) {
      let dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'
      for (;;) {
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1)
        if (dir === '.') break
        const idx = dir.lastIndexOf('/')
        dir = idx > 0 ? dir.slice(0, idx) : '.'
      }
    }

    // 2) 目录树文本（深度缩进，预算控制）
    const dirPaths = Array.from(dirCounts.keys()).sort()
    let output = ''
    let lines = 0
    for (const dir of dirPaths) {
      if (lines >= treeBudget) break
      const depth = dir === '.' ? 0 : dir.split('/').length
      const name = dir === '.' ? './' : dir.slice(dir.lastIndexOf('/') + 1) + '/'
      const count = dirCounts.get(dir) ?? 0
      output += `${'  '.repeat(depth)}${name} (${count} files)\n`
      lines += 1
    }

    // 3) Top 文件符号段（PageRank 最高文件的签名，提升大仓库导航价值）
    const topFiles = sortedFiles.slice(0, Math.min(topBudget, 8))
    if (topFiles.length > 0) {
      output += '\n重点文件（PageRank Top）:\n'
      for (const [file, definitions] of topFiles) {
        output += `${file}:\n`
        const topDef = definitions.reduce((a, b) => (a.rank >= b.rank ? a : b))
        if (topDef?.name) {
          output += `└── ${topDef.name} (L${topDef.line})\n`
        }
      }
    }

    return output.trim()
  }

  private async renderWithLineLimit(sortedFiles: [string, RankedDefinition[]][], linesPerFile: number, rootDir?: string): Promise<string> {
    let output = '';

    for (const [file, definitions] of sortedFiles) {
      // Sort definitions by rank (highest first) then by line number
      definitions.sort((a, b) => {
        if (a.rank !== b.rank) {
          return b.rank - a.rank;
        }
        return a.line - b.line;
      });

      // Get unique lines, limited to linesPerFile
      const uniqueLines = Array.from(new Set(definitions.map((d) => d.line)));
      const limitedLines = uniqueLines.slice(0, linesPerFile);
      const isTruncated = uniqueLines.length > linesPerFile;

      output += `${file}:\n`;

      const treeLines = await this.renderFileTree(file, limitedLines, linesPerFile, isTruncated, rootDir);
      output += treeLines;
    }

    return output.trim();
  }

  private async renderFileTree(filePath: string, lines: number[], maxLines: number, isTruncated: boolean = false, rootDir?: string): Promise<string> {
    if (lines.length === 0) {
      return '';
    }

    try {
      // rel_fname 是相对路径，需要以 root 为基准解析成绝对路径（上游原实现直接 readFile 相对路径会 ENOENT）
      const absolutePath = rootDir ? path.resolve(rootDir, filePath) : filePath
      const content = await fs.readFile(absolutePath, 'utf-8');
      const fileLines = content.split('\n');

      let output = '';
      // truncated 时保留至少 1 行内容（上游实现 maxLines-1 可能为 0，导致只剩省略号）
      const maxContentLines = isTruncated ? Math.max(1, maxLines - 1) : maxLines;
      const linesToRender = lines.slice(0, maxContentLines);

      for (let i = 0; i < linesToRender.length; i++) {
        const lineNum = linesToRender[i]!;
        const lineContent = fileLines[lineNum]?.trim() || '';

        if (lineContent) {
          // Truncate long lines
          const truncated = lineContent.length > 100 ? lineContent.substring(0, 97) + '...' : lineContent;

          // Determine if this is the last line
          const isLast = i === linesToRender.length - 1 && !isTruncated;
          const prefix = isLast ? '└── ' : '├── ';
          output += `${prefix}${truncated}\n`;
        }
      }

      // Add truncation indicator
      if (isTruncated) {
        output += '└── ...\n';
      }

      return output;
    } catch (error) {
      logger.error(`[TreeRenderer] Error reading file ${filePath}:`, error);
      return '';
    }
  }
}
