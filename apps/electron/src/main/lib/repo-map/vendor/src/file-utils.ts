import * as path from 'node:path';

import { glob } from 'glob';

import logger from './logger';

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'out/**',
  'coverage/**',
  '*.min.js',
  '*.min.css',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

const getAllFilesFromFS = async (baseDir: string, ignore: string[]): Promise<string[]> => {
  try {
    const pattern = path.join(baseDir, '**/*').replace(/\\/g, '/');
    const files = await glob(pattern, {
      nodir: true,
      absolute: true,
      dot: false,
      ignore,
    });

    logger.debug(`Retrieved ${files.length} files from filesystem`);
    return files;
  } catch (error) {
    logger.error('Failed to get files from filesystem:', error);
    return [];
  }
};

const matchesPattern = (filePath: string, pattern: string): boolean => {
  // Convert glob pattern to regex for simple matching
  const regexPattern = pattern
    .replace(/\*\*/g, '<<DOUBLE_STAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<DOUBLE_STAR>>/g, '.*')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(regexPattern);
  return regex.test(filePath);
};

const filterByExcludePatterns = (files: string[], excludePatterns: string[], baseDir: string): string[] => {
  return files.filter((file) => {
    const relative = path.relative(baseDir, file).replace(/\\/g, '/');
    return !excludePatterns.some((pattern) => matchesPattern(relative, pattern));
  });
};

export const getAllFiles = async (baseDir: string, excludePatterns: string[] = []): Promise<string[]> => {
  const allIgnorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...excludePatterns];

  try {
    // 文件系统扫描（git ls-files 感知后续可接入 MyYoda git 服务，避免仅分析 git 跟踪文件的场景）
    const fsFiles = await getAllFilesFromFS(baseDir, allIgnorePatterns);

    // Filter by exclude patterns
    return filterByExcludePatterns(fsFiles, excludePatterns, baseDir);
  } catch (error) {
    logger.error('Failed to get files:', error);
    return [];
  }
};
