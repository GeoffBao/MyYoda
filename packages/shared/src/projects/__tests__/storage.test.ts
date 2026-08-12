import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import type { ProjectConfig } from '@myyoda/shared/projects';
import * as projectContracts from '@myyoda/shared/projects';
import * as projectStorage from '../storage.ts';

const tempRoots: string[] = [];

function createTempWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'myyoda-project-storage-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function withMockedNow<T>(values: number[], run: () => T): T {
  const originalNow = Date.now;
  let index = 0;

  Date.now = () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    if (value === undefined) {
      throw new Error('withMockedNow 需要至少一个时间值');
    }
    return value;
  };

  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

describe('projects package contracts', () => {
  test('package root 仅暴露 renderer-safe contract', () => {
    const sampleConfig: ProjectConfig = {
      id: 'proj_demo',
      slug: 'demo',
      name: 'Demo',
      createdAt: 1,
      updatedAt: 1,
    };

    expect(sampleConfig.slug).toBe('demo');

    const leakedStorageExports = Object.keys(projectStorage).filter((exportName) =>
      Object.prototype.hasOwnProperty.call(projectContracts, exportName),
    );

    expect(leakedStorageExports).toEqual([]);
  });

  test('storage 模块保留完整导出面', () => {
    expect(Object.keys(projectStorage).sort()).toEqual([
      'MEMORY_FILENAME',
      'createProject',
      'deleteProject',
      'deleteProjectAsset',
      'ensureProjectAssetsDir',
      'ensureProjectWorkdir',
      'ensureProjectsDir',
      'generateProjectSlug',
      'getProjectAssetsPath',
      'getProjectMemoryPath',
      'getProjectPath',
      'getProjectWorkdirPath',
      'getWorkspaceProjectsPath',
      'listProjectAssets',
      'loadProject',
      'loadProjectById',
      'loadProjectConfig',
      'loadProjectMemory',
      'loadWorkspaceProjects',
      'projectExists',
      'readProjectMemory',
      'sanitizeAssetFilename',
      'saveProjectConfig',
      'updateProject',
      'uploadProjectAsset',
      'writeProjectMemory',
    ]);
  });
});

describe('workspace project storage', () => {
  test('创建项目会生成 URL-safe 唯一 slug 并持久化 config', () => {
    const workspaceRoot = createTempWorkspaceRoot();

    const firstProject = withMockedNow([1000, 1001], () =>
      projectStorage.createProject(workspaceRoot, {
        name: 'Alpha Project!!!',
        description: '第一个项目',
      }),
    );
    const secondProject = projectStorage.createProject(workspaceRoot, {
      name: 'Alpha Project!!!',
    });

    expect(firstProject.slug).toBe('alpha-project');
    expect(secondProject.slug).toBe('alpha-project-2');

    const loadedProjects = projectStorage.loadWorkspaceProjects(workspaceRoot);
    expect(loadedProjects).toHaveLength(2);
    expect(loadedProjects.map((project) => project.config.slug)).toEqual([
      'alpha-project',
      'alpha-project-2',
    ]);

    const configPath = join(projectStorage.getProjectPath(workspaceRoot, firstProject.slug), 'config.json');
    const storedConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      id: string;
      slug: string;
      description?: string;
      absolutePath?: string;
      updatedAt: number;
    };

    expect(storedConfig.id).toBe(firstProject.id);
    expect(storedConfig.slug).toBe('alpha-project');
    expect(storedConfig.description).toBe('第一个项目');
    expect(storedConfig.updatedAt).toBe(firstProject.updatedAt);
    expect(storedConfig.absolutePath).toBeUndefined();

    const projectFiles = readdirSync(projectStorage.getProjectPath(workspaceRoot, firstProject.slug));
    expect(projectFiles.some((entry) => entry.includes('.tmp.'))).toBe(false);
  });

  test('归档和取消归档只更新配置，不删除已有资产与 Memory', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, { name: 'Archive Me' });

    projectStorage.uploadProjectAsset(workspaceRoot, project.slug, {
      filename: 'brief.md',
      text: '# 项目简报',
    });
    const memoryPath = projectStorage.getProjectMemoryPath(workspaceRoot, project.slug);
    writeFileSync(memoryPath, '已归档前的记忆', 'utf-8');

    const archived = withMockedNow([2000, 2001], () =>
      projectStorage.updateProject(workspaceRoot, project.slug, {
        archivedAt: 123456789,
      }),
    );
    expect(archived.archivedAt).toBe(123456789);
    expect(archived.updatedAt).toBe(2000);

    const reloadedArchived = projectStorage.loadProjectConfig(workspaceRoot, project.slug);
    expect(reloadedArchived).not.toBeNull();
    expect(reloadedArchived?.archivedAt).toBe(123456789);
    expect(reloadedArchived?.updatedAt).toBe(archived.updatedAt);

    const unarchived = withMockedNow([3000, 3001], () =>
      projectStorage.updateProject(workspaceRoot, project.slug, {
        archivedAt: undefined,
      }),
    );
    expect(unarchived.archivedAt).toBeUndefined();
    expect(unarchived.updatedAt).toBe(3000);

    const reloadedUnarchived = projectStorage.loadProjectConfig(workspaceRoot, project.slug);
    expect(reloadedUnarchived).not.toBeNull();
    expect(reloadedUnarchived?.archivedAt).toBeUndefined();
    expect(reloadedUnarchived?.updatedAt).toBe(unarchived.updatedAt);

    expect(projectStorage.listProjectAssets(workspaceRoot, project.slug)).toHaveLength(1);
    expect(projectStorage.readProjectMemory(workspaceRoot, project.slug)).toBe('已归档前的记忆');
  });

  test('更新项目能持久化自定义看板列 kanbanColumns', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, { name: 'Kanban Columns' });

    const columns = [
      { id: 'todo', name: '待办', color: '#6366f1', dropStatusId: 'todo' },
      { id: 'col-abc123', name: '设计稿', color: '#ec4899', dropStatusId: 'in-progress' },
      { id: 'done', name: '已完成', color: '#10b981' },
    ];
    const updated = withMockedNow([2000, 2001], () =>
      projectStorage.updateProject(workspaceRoot, project.slug, { kanbanColumns: columns }),
    );
    expect(updated.kanbanColumns).toEqual(columns);
    expect(updated.updatedAt).toBe(2000);

    const reloaded = projectStorage.loadProjectConfig(workspaceRoot, project.slug);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.kanbanColumns).toEqual(columns);

    // 传 undefined 保持现状
    const untouched = projectStorage.updateProject(workspaceRoot, project.slug, {});
    expect(untouched.kanbanColumns).toEqual(columns);
  });

  test('更新项目后返回值与重载 config.json 的 updatedAt 完全一致', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, {
      name: 'Timestamp Project',
      description: 'before',
    });

    const updated = withMockedNow([4000, 4001], () =>
      projectStorage.updateProject(workspaceRoot, project.slug, {
        description: 'after',
      }),
    );

    expect(updated.description).toBe('after');

    const reloaded = projectStorage.loadProjectConfig(workspaceRoot, project.slug);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.description).toBe('after');
    expect(reloaded?.updatedAt).toBe(updated.updatedAt);
  });

  test('上传资产会保留 runtime absolutePath，并拒绝不安全路径名', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, { name: 'Assets' });

    const asset = projectStorage.uploadProjectAsset(workspaceRoot, project.slug, {
      filename: '设计说明.md',
      text: 'safe asset',
    });
    expect(asset.absolutePath).toContain(join('projects', project.slug, 'assets'));
    expect(existsSync(asset.absolutePath)).toBe(true);

    expect(() =>
      projectStorage.uploadProjectAsset(workspaceRoot, project.slug, {
        filename: '../escape.txt',
        text: 'bad',
      }),
    ).toThrow('不安全');

    expect(() =>
      projectStorage.uploadProjectAsset(workspaceRoot, project.slug, {
        filename: '/tmp/escape.txt',
        text: 'bad',
      }),
    ).toThrow('不安全');
  });

  test('Memory 文件可按固定路径读写，缺失时返回空字符串', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, { name: 'Memory' });

    expect(projectStorage.readProjectMemory(workspaceRoot, project.slug)).toBe('');

    const memoryPath = projectStorage.getProjectMemoryPath(workspaceRoot, project.slug);
    writeFileSync(memoryPath, '# MEMORY\n- item 1', 'utf-8');

    expect(projectStorage.readProjectMemory(workspaceRoot, project.slug)).toBe('# MEMORY\n- item 1');
  });

  test('writeProjectMemory 原子写入并可覆盖已有内容', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, { name: 'Memory Writer' });

    projectStorage.writeProjectMemory(workspaceRoot, project.slug, '# 项目记忆\n第一次');
    expect(projectStorage.readProjectMemory(workspaceRoot, project.slug)).toBe('# 项目记忆\n第一次');

    projectStorage.writeProjectMemory(workspaceRoot, project.slug, '# 项目记忆\n第二次');
    expect(projectStorage.readProjectMemory(workspaceRoot, project.slug)).toBe('# 项目记忆\n第二次');
    expect(existsSync(`${projectStorage.getProjectMemoryPath(workspaceRoot, project.slug)}.tmp`)).toBe(false);
  });

  test('createProject 确保 projects/{slug}/workdir/ 存在且与 assets 分离', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, { name: 'AI Dev' });
    const workdir = projectStorage.getProjectWorkdirPath(workspaceRoot, project.slug);
    const assets = projectStorage.getProjectAssetsPath(workspaceRoot, project.slug);
    expect(existsSync(workdir)).toBe(true);
    expect(workdir.endsWith(join(project.slug, 'workdir'))).toBe(true);
    expect(assets.includes(`${project.slug}${sep}assets`)).toBe(true);
    expect(workdir).not.toBe(assets);
  });

  test('无 workingDirectory 的空白项目不设置 memoryLocation，Memory 沿用托管路径', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const project = projectStorage.createProject(workspaceRoot, { name: 'Blank' });

    expect(project.memoryLocation).toBeUndefined();
    const memoryPath = projectStorage.getProjectMemoryPath(workspaceRoot, project.slug);
    expect(memoryPath).toBe(join(projectStorage.getProjectPath(workspaceRoot, project.slug), 'MEMORY.md'));
  });

  test('带真实 workingDirectory 的本地目录项目 memoryLocation 为 project，Memory 落在 <workingDirectory>/.context/MEMORY.md', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const externalDir = mkdtempSync(join(tmpdir(), 'myyoda-project-external-'));
    tempRoots.push(externalDir);

    const project = projectStorage.createProject(workspaceRoot, {
      name: 'Local Repo',
      workingDirectory: externalDir,
    });

    expect(project.memoryLocation).toBe('project');
    const memoryPath = projectStorage.getProjectMemoryPath(workspaceRoot, project.slug);
    expect(memoryPath).toBe(join(externalDir, '.context', 'MEMORY.md'));

    // 写入时自动创建 .context/ 目录，且不落在 MyYoda 托管的 projects/{slug}/ 下
    projectStorage.writeProjectMemory(workspaceRoot, project.slug, '# 项目记忆\n第一次');
    expect(existsSync(join(externalDir, '.context', 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(projectStorage.getProjectPath(workspaceRoot, project.slug), 'MEMORY.md'))).toBe(false);
    expect(projectStorage.readProjectMemory(workspaceRoot, project.slug)).toBe('# 项目记忆\n第一次');
  });

  test('隐藏容器 Project（home/ad-hoc）即使带 workingDirectory 也不启用 project 记忆位置', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const workspaceFilesDir = join(workspaceRoot, 'workspace-files');

    const homeProject = projectStorage.createProject(workspaceRoot, {
      name: '首页工作区',
      workingDirectory: workspaceFilesDir,
      kind: 'home',
    });

    expect(homeProject.memoryLocation).toBeUndefined();
    expect(projectStorage.getProjectMemoryPath(workspaceRoot, homeProject.slug)).toBe(
      join(projectStorage.getProjectPath(workspaceRoot, homeProject.slug), 'MEMORY.md'),
    );
  });

  test('老项目（config.json 无 memoryLocation 字段）行为不受影响：手写 config 也解析回托管路径', () => {
    const workspaceRoot = createTempWorkspaceRoot();
    const externalDir = mkdtempSync(join(tmpdir(), 'myyoda-project-legacy-'));
    tempRoots.push(externalDir);

    // 模拟功能上线前已存在的项目：config.json 已有 workingDirectory 但没有 memoryLocation 字段
    const project = projectStorage.createProject(workspaceRoot, { name: 'Legacy' });
    const legacyConfig: ProjectConfig = {
      ...project,
      workingDirectory: externalDir,
    };
    projectStorage.saveProjectConfig(workspaceRoot, legacyConfig);

    expect(projectStorage.getProjectMemoryPath(workspaceRoot, project.slug)).toBe(
      join(projectStorage.getProjectPath(workspaceRoot, project.slug), 'MEMORY.md'),
    );
  });
});
