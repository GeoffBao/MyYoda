/**
 * Browser 内置工具（Pi runtime）
 *
 * Pi SDK 用 sdk.defineTool() + TypeBox schema 注册 customTools，
 * 复用同一个 DesktopBrowserAutomationHost，与 Claude runtime 行为一致。
 */

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { getBrowserHost } from './browser-tools-injector'

export interface PiBrowserToolsContext {
  sessionId: string
  channelId: string
  workspaceSlug?: string
  workspaceRoot?: string
}

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

function browserToolResult(payload: { text: string; structured?: unknown; images?: Array<{ mimeType: string; data: string; width?: number; height?: number }> }): AgentToolResult<unknown> {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> =
    [{ type: 'text', text: payload.text }]
  for (const image of payload.images ?? []) {
    content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
  }
  return {
    content,
    details: payload.structured,
  } as AgentToolResult<unknown>
}

function browserToolError(error: unknown): AgentToolResult<unknown> {
  const message = error instanceof Error ? error.message : String(error)
  const envelope = error && typeof error === 'object' && 'envelope' in error
    ? (error as { envelope?: { error?: { code?: string; retryable?: boolean } } }).envelope?.error
    : undefined
  const prefix = envelope?.code ? `[${envelope.code}]${envelope.retryable ? ' (retryable)' : ''} ` : ''
  return {
    content: [{ type: 'text', text: `浏览器工具失败: ${prefix}${message}` }],
    details: undefined,
    isError: true,
  } as AgentToolResult<unknown>
}

const targetSchema = Type.Object({
  ref: Type.Optional(Type.String({ description: 'Element ref from the latest browser_snapshot, e.g. "e3".' })),
  snapshotId: Type.Optional(Type.String({ description: 'Snapshot id the ref came from. Omit to use the latest snapshot.' })),
  selector: Type.Optional(Type.String({ description: 'CSS selector matching exactly one element.' })),
  locator: Type.Optional(Type.Object({
    kind: Type.Union([Type.Literal('role'), Type.Literal('text'), Type.Literal('placeholder'), Type.Literal('testId'), Type.Literal('label')], { description: 'Locator kind.' }),
    role: Type.Optional(Type.String({ description: 'ARIA role (for kind=role).' })),
    name: Type.Optional(Type.String({ description: 'Accessible name (for kind=role).' })),
    text: Type.Optional(Type.String({ description: 'Visible text to match (for kind=text/placeholder/label).' })),
    value: Type.Optional(Type.String({ description: 'Exact attribute value (for kind=testId).' })),
    exact: Type.Optional(Type.Boolean({ description: 'Exact match instead of substring.' })),
  }, { description: 'Semantic locator.' })),
  point: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() }, { description: 'Exact viewport coordinates.' })),
}, { description: 'Target element: provide exactly one of ref/selector/locator/point.' })

export function buildPiBrowserTools(sdk: PiSdk, ctx: PiBrowserToolsContext): ToolDefinition[] {
  const host = getBrowserHost()
  const exec = (name: Parameters<typeof host.executeTool>[0]['name'], args: unknown) =>
    host.executeTool({ sessionId: ctx.sessionId, provider: 'pi', threadId: ctx.sessionId, name, arguments: args, workspaceRoot: ctx.workspaceRoot })

  return [
    sdk.defineTool({
      name: 'browser_status',
      label: '浏览器状态',
      description: 'Check whether the in-app browser is open for this session and how many tabs are attached. Use before other browser tools to know if you must call browser_open first.',
      promptSnippet: 'browser_status: check the in-app browser state.',
      parameters: Type.Object({}),
      async execute() {
        try {
          return browserToolResult(await exec('browser_status', {}))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_open',
      label: '打开浏览器',
      description: 'Open the in-app browser panel and load a URL (default about:blank). This is the FIRST tool to call for any browser task. The browser uses its own persisted session (login state is kept across sessions). Pass newTab=true to open another tab without disturbing the current one.',
      promptSnippet: 'browser_open: open the in-app browser (optionally at a URL).',
      parameters: Type.Object({
        url: Type.Optional(Type.String({ description: 'URL to open. Omit for a blank tab.' })),
        newTab: Type.Optional(Type.Boolean({ description: 'Open in a new tab (keep current tabs).' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_open', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_navigate',
      label: '浏览器导航',
      description: 'Navigate the active tab to a new URL. Use http(s) URLs.',
      promptSnippet: 'browser_navigate: navigate the browser to a URL.',
      parameters: Type.Object({
        url: Type.String({ description: 'URL to navigate to.' }),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_navigate', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_back',
      label: '浏览器后退',
      description: 'Go back in the active tab navigation history.',
      promptSnippet: 'browser_back: go back in browser history.',
      parameters: Type.Object({}),
      async execute() {
        try {
          return browserToolResult(await exec('browser_back', {}))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_forward',
      label: '浏览器前进',
      description: 'Go forward in the active tab navigation history.',
      promptSnippet: 'browser_forward: go forward in browser history.',
      parameters: Type.Object({}),
      async execute() {
        try {
          return browserToolResult(await exec('browser_forward', {}))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_reload',
      label: '浏览器刷新',
      description: 'Reload the active tab.',
      promptSnippet: 'browser_reload: reload the browser tab.',
      parameters: Type.Object({}),
      async execute() {
        try {
          return browserToolResult(await exec('browser_reload', {}))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_snapshot',
      label: '浏览器快照',
      description: 'Capture a semantic snapshot of the active page: interactive elements with refs, coordinates, states, values, plus visible text. Call this after navigation and before clicking/typing to learn element refs. Pass includeImage=true to also capture a screenshot.',
      promptSnippet: 'browser_snapshot: capture the page semantic snapshot (element refs + visible text).',
      parameters: Type.Object({
        includeImage: Type.Optional(Type.Boolean({ description: 'Also capture a screenshot with the snapshot.' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_snapshot', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_screenshot',
      label: '浏览器截图',
      description: 'Capture a screenshot of the active tab as a PNG image.',
      promptSnippet: 'browser_screenshot: capture a screenshot of the browser tab.',
      parameters: Type.Object({}),
      async execute() {
        try {
          return browserToolResult(await exec('browser_screenshot', {}))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_click',
      label: '浏览器点击',
      description: 'Click an element in the active tab. Prefer a ref from browser_snapshot (stable across navigation). You can also use a CSS selector, a semantic locator, or exact coordinates.',
      promptSnippet: 'browser_click: click an element (by ref/selector/locator/point).',
      parameters: Type.Object({
        target: Type.Optional(targetSchema),
        ref: Type.Optional(Type.String({ description: 'Element ref from browser_snapshot.' })),
        selector: Type.Optional(Type.String({ description: 'CSS selector.' })),
        point: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_click', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_type',
      label: '浏览器输入',
      description: 'Type text into an editable element (or the focused element if no target). Optionally press Enter after typing.',
      promptSnippet: 'browser_type: type text into a target (or focused element).',
      parameters: Type.Object({
        target: Type.Optional(targetSchema),
        ref: Type.Optional(Type.String({ description: 'Element ref from browser_snapshot.' })),
        selector: Type.Optional(Type.String({ description: 'CSS selector.' })),
        text: Type.String({ description: 'Text to type.' }),
        enter: Type.Optional(Type.Boolean({ description: 'Press Enter after typing.' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_type', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_press',
      label: '浏览器按键',
      description: 'Press a keyboard key (e.g. Enter, Escape, Tab, ArrowDown, "a"). Optionally click a target first to focus it.',
      promptSnippet: 'browser_press: press a keyboard key.',
      parameters: Type.Object({
        key: Type.String({ description: 'Key to press.' }),
        target: Type.Optional(targetSchema),
        ref: Type.Optional(Type.String({ description: 'Element ref to focus first.' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_press', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_scroll',
      label: '浏览器滚动',
      description: 'Scroll the active page by delta pixels (or by direction/amount).',
      promptSnippet: 'browser_scroll: scroll the page.',
      parameters: Type.Object({
        deltaX: Type.Optional(Type.Number({ description: 'Horizontal scroll delta.' })),
        deltaY: Type.Optional(Type.Number({ description: 'Vertical scroll delta.' })),
        direction: Type.Optional(Type.Union([Type.Literal('up'), Type.Literal('down')], { description: 'Scroll direction (uses amount).' })),
        amount: Type.Optional(Type.Number({ description: 'Scroll amount for direction (default 300).' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_scroll', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_wait',
      label: '浏览器等待',
      description: 'Wait for a fixed duration (ms). Useful before snapshotting after navigation or after interactions.',
      promptSnippet: 'browser_wait: wait a fixed duration.',
      parameters: Type.Object({
        ms: Type.Optional(Type.Number({ description: 'Milliseconds to wait (default 500, max 30000).' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_wait', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_evaluate',
      label: '浏览器执行脚本',
      description: 'Execute a JavaScript expression in the active page and return the JSON-serialized result. Powerful but risky: it can mutate the page. Prefer the dedicated tools (click/type/select/scroll) when possible. Returns at most 256KB.',
      promptSnippet: 'browser_evaluate: execute JS in the page (use with caution).',
      parameters: Type.Object({
        expression: Type.String({ description: 'JavaScript expression to evaluate (awaitPromise enabled, return by value).' }),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_evaluate', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_hover',
      label: '浏览器悬停',
      description: 'Move the mouse over an element (by ref/selector/locator/point) without clicking. Useful to reveal hover menus or tooltips.',
      promptSnippet: 'browser_hover: hover over an element.',
      parameters: Type.Object({
        target: Type.Optional(targetSchema),
        ref: Type.Optional(Type.String({ description: 'Element ref from browser_snapshot.' })),
        selector: Type.Optional(Type.String({ description: 'CSS selector.' })),
        point: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_hover', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_drag',
      label: '浏览器拖拽',
      description: 'Drag from a source element to a target element (HTML5 drag-and-drop). Both endpoints can be ref/selector/locator/point.',
      promptSnippet: 'browser_drag: drag from source to target.',
      parameters: Type.Object({
        source: targetSchema,
        target: targetSchema,
        steps: Type.Optional(Type.Number({ description: 'Number of intermediate mouse-move steps (default 10).' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_drag', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_select',
      label: '浏览器选择',
      description: 'Select one or more options in a <select> element (by value or visible text).',
      promptSnippet: 'browser_select: select options in a <select>.',
      parameters: Type.Object({
        target: Type.Optional(targetSchema),
        ref: Type.Optional(Type.String({ description: 'Element ref from browser_snapshot.' })),
        selector: Type.Optional(Type.String({ description: 'CSS selector.' })),
        values: Type.Union([Type.String({ description: 'Option value or text.' }), Type.Array(Type.String({ description: 'Option values or texts.' }))], { description: 'Option value(s) or visible text to select.' }),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_select', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_upload',
      label: '浏览器上传文件',
      description: 'Upload local files to a file input element. File paths are resolved against the session workspace root; only files inside the workspace are allowed.',
      promptSnippet: 'browser_upload: upload workspace files to a file input.',
      parameters: Type.Object({
        target: Type.Optional(targetSchema),
        ref: Type.Optional(Type.String({ description: 'Element ref from browser_snapshot.' })),
        selector: Type.Optional(Type.String({ description: 'CSS selector.' })),
        files: Type.Union([Type.String({ description: 'File path.' }), Type.Array(Type.String({ description: 'File paths.' }))], { description: 'Absolute or workspace-relative file path(s) to upload.' }),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_upload', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_logs',
      label: '浏览器日志',
      description: 'Read recent console logs from the active tab (page errors/warnings are most useful for debugging).',
      promptSnippet: 'browser_logs: read page console logs.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: 'Maximum entries (default 100, max 500).' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_logs', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_resize',
      label: '浏览器视口调整',
      description: 'Resize the browser viewport (affects responsive layout). Defaults to 1280x800.',
      promptSnippet: 'browser_resize: resize the viewport.',
      parameters: Type.Object({
        width: Type.Optional(Type.Number({ description: 'Viewport width (320-3840).' })),
        height: Type.Optional(Type.Number({ description: 'Viewport height (240-2160).' })),
      }),
      async execute(_toolCallId, params) {
        try {
          return browserToolResult(await exec('browser_resize', params))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
    sdk.defineTool({
      name: 'browser_close',
      label: '关闭浏览器',
      description: 'Close the in-app browser for this session (all tabs). Pass tabId to close only that tab.',
      promptSnippet: 'browser_close: close the browser (or one tab).',
      parameters: Type.Object({
        tabId: Type.Optional(Type.String({ description: 'Optional tab id to close instead of the whole browser.' })),
      }),
      async execute() {
        try {
          return browserToolResult(await exec('browser_close', {}))
        } catch (error) {
          return browserToolError(error)
        }
      },
    }),
  ] as unknown as ToolDefinition[]
}
