import { mock } from 'bun:test'

/**
 * 统一的 Electron mock 工厂（bun test）。
 *
 * bun 的 `mock.module('electron', ...)` 是进程级注册表：同一 `bun test` 进程中
 * 后注册的 mock 会覆盖先注册的。若各测试文件只 mock 自己用到的字段（例如
 * claude-oauth-service.test 只 mock `shell`），一旦与其他文件同进程运行，后续
 * 文件 import 缺失的导出（如 `safeStorage` / `BrowserWindow`）就会抛
 * `SyntaxError: Export named '...' not found`。
 *
 * 因此所有 mock electron 的测试文件必须使用同一个**字段完整的** mock 工厂，
 * 并通过 `overrides` 注入各自需要的专有实现（如可断言的 `shell.openExternal`）。
 */
export function mockElectronModule(overrides: Record<string, unknown> = {}): void {
  mock.module('electron', () => ({
    app: {
      isPackaged: true,
      getPath: () => '/tmp/myyoda-test',
      whenReady: async () => undefined,
      quit: () => undefined,
      on: () => undefined,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString('utf-8'),
    },
    shell: {
      openExternal: async () => undefined,
      openPath: async () => '',
      showItemInFolder: () => undefined,
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: '' }),
      showMessageBox: async () => ({ response: 0 }),
    },
    BrowserWindow: class BrowserWindow {
      isDestroyed(): boolean { return false }
      webContents = {
        isDestroyed: (): boolean => false,
        send: (): undefined => undefined,
      }
      // agent-service 的 IPC 转发中间件会调用 getAllWindows 定位主窗口
      static getAllWindows(): unknown[] { return [] }
    },
    clipboard: {
      writeText: () => undefined,
      readText: () => '',
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true }),
    },
    nativeTheme: {
      shouldUseDarkColors: false,
      on: () => undefined,
    },
    powerMonitor: {
      on: () => undefined,
    },
    powerSaveBlocker: {
      start: () => 0,
      stop: () => undefined,
    },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getCursorScreenPoint: () => ({ x: 960, y: 540 }),
    },
    Menu: {
      buildFromTemplate: () => ({ popup: () => undefined }),
    },
    ipcMain: {
      handle: () => undefined,
      on: () => undefined,
      removeHandler: () => undefined,
    },
    globalShortcut: {
      register: () => true,
      unregister: () => undefined,
    },
    net: {
      request: () => ({
        on: () => undefined,
        end: () => undefined,
      }),
    },
    // 供 `import type { WebContents }` 等类型导入；运行时不会真正使用。
    WebContents: class WebContents {},
    // browser-controller 以值导入 WebContentsView；测试中不真正创建视图。
    WebContentsView: class WebContentsView {
      webContents = { isDestroyed: () => false, send: () => undefined, loadURL: () => undefined }
      setBounds(): void {}
      setBackgroundColor(): void {}
    },
    // browser-controller 以值导入 session（浏览器分区/cookie 隔离）；测试中不真正使用。
    session: {
      fromPartition: () => ({
        on: () => undefined,
        setPermissionRequestHandler: () => undefined,
        setPermissionCheckHandler: () => undefined,
        webRequest: { onBeforeRequest: () => undefined, onHeadersReceived: () => undefined },
        cookies: { get: () => [], set: () => undefined, remove: () => undefined },
      }),
      defaultSession: { on: () => undefined },
    },
    webContents: {
      fromId: () => ({ send: () => undefined }),
    },
    ...overrides,
  }))
}
