/**
 * Browser 内置 MCP 服务器（Claude runtime）
 *
 * 通过 sdk.createSdkMcpServer() 创建，注入到每个 Agent 会话。
 * 提供 browser_* 工具集（移植自 synara 的 browser_use 风格）。
 * Pi runtime 见 browser-pi-tools.ts。
 */

import { getBrowserHost } from './browser-tools-injector'

export async function injectBrowserMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  sessionId: string,
  channelId: string,
  workspaceSlug?: string,
  agentCwd?: string,
): Promise<void> {
  const { z } = await import('zod')
  const serverName = 'browser'

  if (mcpServers[serverName]) return

  const host = getBrowserHost()

  const targetSchema = z.object({
    ref: z.string().optional().describe('Element ref from the latest browser_snapshot, e.g. "e3".'),
    snapshotId: z.string().optional().describe('Snapshot id the ref came from. Omit to use the latest snapshot.'),
    selector: z.string().optional().describe('CSS selector matching exactly one element.'),
    locator: z.object({
      kind: z.enum(['role', 'text', 'placeholder', 'testId', 'label']).describe('Locator kind.'),
      role: z.string().optional().describe('ARIA role (for kind=role).'),
      name: z.string().optional().describe('Accessible name (for kind=role).'),
      text: z.string().optional().describe('Visible text to match (for kind=text/placeholder/label).'),
      value: z.string().optional().describe('Exact attribute value (for kind=testId).'),
      exact: z.boolean().optional().describe('Exact match instead of substring.'),
    }).optional().describe('Semantic locator.'),
    point: z.object({ x: z.number(), y: z.number() }).optional().describe('Exact viewport coordinates.'),
  }).describe('Target element: provide exactly one of ref/selector/locator/point.')

  const server = sdk.createSdkMcpServer({
    name: serverName,
    version: '1.0.0',
    tools: [
      sdk.tool(
        'browser_status',
        'Check whether the in-app browser is open for this session and how many tabs are attached. Use before other browser tools to know if you must call browser_open first.',
        {},
        async () => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_status', arguments: {} })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_tabs',
        'List open tabs for this session with their URL and title.',
        {},
        async () => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_tabs', arguments: {} })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_open',
        'Open the in-app browser panel and load a URL (default about:blank). This is the FIRST tool to call for any browser task. Use http(s) URLs. The browser uses its own persisted session (login state is kept across sessions).',
        {
          url: z.string().optional().describe('URL to open. Omit for a blank tab.'),
          newTab: z.boolean().optional().describe('Open in a new tab (future; MVP reuses the active tab).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_open', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_navigate',
        'Navigate the active tab to a new URL. Use http(s) URLs.',
        {
          url: z.string().describe('URL to navigate to.'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_navigate', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_back',
        'Go back in the active tab navigation history.',
        {},
        async () => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_back', arguments: {} })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_forward',
        'Go forward in the active tab navigation history.',
        {},
        async () => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_forward', arguments: {} })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_reload',
        'Reload the active tab.',
        {},
        async () => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_reload', arguments: {} })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_snapshot',
        'Capture a semantic snapshot of the active page: interactive elements with refs, coordinates, states, values, plus visible text. Call this after navigation and before clicking/typing to learn element refs. Pass includeImage=true to also capture a screenshot.',
        {
          includeImage: z.boolean().optional().describe('Also capture a screenshot with the snapshot.'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_snapshot', arguments: args })
            return {
              content: [{ type: 'text' as const, text: result.text }],
              structuredContent: result.structured as Record<string, unknown> | undefined,
              ...(result.images?.length
                ? { images: result.images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mimeType, data: img.data } })) }
                : {}),
            }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_screenshot',
        'Capture a screenshot of the active tab as a PNG image.',
        {
          fullPage: z.boolean().optional().describe('Capture full page (future).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_screenshot', arguments: args })
            return {
              content: [{ type: 'text' as const, text: result.text }],
              ...(result.images?.length
                ? { images: result.images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mimeType, data: img.data } })) }
                : {}),
            }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_click',
        'Click an element in the active tab. Prefer a ref from browser_snapshot (stable across navigation). You can also use a CSS selector, a semantic locator, or exact coordinates.',
        {
          target: targetSchema.optional(),
          ref: z.string().optional(),
          selector: z.string().optional(),
          point: z.object({ x: z.number(), y: z.number() }).optional(),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_click', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_type',
        'Type text into an editable element (or the focused element if no target). Optionally press Enter after typing.',
        {
          target: targetSchema.optional(),
          ref: z.string().optional(),
          selector: z.string().optional(),
          text: z.string().describe('Text to type.'),
          enter: z.boolean().optional().describe('Press Enter after typing.'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_type', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_press',
        'Press a keyboard key (e.g. Enter, Escape, Tab, ArrowDown, "a"). Optionally click a target first to focus it.',
        {
          key: z.string().describe('Key to press.'),
          target: targetSchema.optional(),
          ref: z.string().optional(),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_press', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_scroll',
        'Scroll the active page by delta pixels (or by direction/amount).',
        {
          deltaX: z.number().optional().describe('Horizontal scroll delta.'),
          deltaY: z.number().optional().describe('Vertical scroll delta.'),
          direction: z.enum(['up', 'down']).optional().describe('Scroll direction (uses amount).'),
          amount: z.number().optional().describe('Scroll amount for direction (default 300).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_scroll', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_wait',
        'Wait for a fixed duration (ms). Useful before snapshotting after navigation or after interactions.',
        {
          ms: z.number().optional().describe('Milliseconds to wait (default 500, max 30000).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_wait', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_evaluate',
        'Execute a JavaScript expression in the active page and return the JSON-serialized result. Powerful but risky: it can mutate the page. Prefer the dedicated tools (click/type/select/scroll) when possible. Returns at most 256KB.',
        {
          expression: z.string().describe('JavaScript expression to evaluate (awaitPromise is enabled, return by value).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_evaluate', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_hover',
        'Move the mouse over an element (by ref/selector/locator/point) without clicking. Useful to reveal hover menus or tooltips.',
        {
          target: targetSchema.optional(),
          ref: z.string().optional(),
          selector: z.string().optional(),
          point: z.object({ x: z.number(), y: z.number() }).optional(),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_hover', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_drag',
        'Drag from a source element to a target element (HTML5 drag-and-drop). Both endpoints can be ref/selector/locator/point.',
        {
          source: targetSchema.describe('Source element.'),
          target: targetSchema.describe('Drop target element.'),
          steps: z.number().optional().describe('Number of intermediate mouse-move steps (default 10).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_drag', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_select',
        'Select one or more options in a <select> element (by value or visible text).',
        {
          target: targetSchema.optional(),
          ref: z.string().optional(),
          selector: z.string().optional(),
          values: z.union([z.string(), z.array(z.string())]).describe('Option value(s) or visible text to select.'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_select', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_upload',
        'Upload local files to a file input element. File paths are resolved against the session workspace root; only files inside the workspace are allowed.',
        {
          target: targetSchema.optional(),
          ref: z.string().optional(),
          selector: z.string().optional(),
          files: z.union([z.string(), z.array(z.string())]).describe('Absolute or workspace-relative file path(s) to upload.'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_upload', arguments: args, workspaceRoot: agentCwd })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_logs',
        'Read recent console logs from the active tab (page errors/warnings are most useful for debugging).',
        {
          limit: z.number().optional().describe('Maximum entries (default 100, max 500).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_logs', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_resize',
        'Resize the browser viewport (affects responsive layout). Defaults to 1280x800.',
        {
          width: z.number().optional().describe('Viewport width (320-3840).'),
          height: z.number().optional().describe('Viewport height (240-2160).'),
        },
        async (args) => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_resize', arguments: args })
            return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured as Record<string, unknown> | undefined }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
      sdk.tool(
        'browser_close',
        'Close the in-app browser for this session.',
        {},
        async () => {
          try {
            const result = await host.executeTool({ sessionId, provider: 'claude', threadId: sessionId, name: 'browser_close', arguments: {} })
            return { content: [{ type: 'text' as const, text: result.text }] }
          } catch (error) {
            return toolError(error)
          }
        },
      ),
    ],
  })

  mcpServers[serverName] = server as unknown as Record<string, unknown>
  console.log(`[Browser MCP] 已注入内置浏览器工具 (${serverName}, session=${sessionId}, workspace=${workspaceSlug ?? 'none'})`)
}

function toolError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const message = error instanceof Error ? error.message : String(error)
  const envelope = error && typeof error === 'object' && 'envelope' in error
    ? (error as { envelope?: { error?: { code?: string; retryable?: boolean } } }).envelope?.error
    : undefined
  const prefix = envelope?.code ? `[${envelope.code}]${envelope.retryable ? ' (retryable)' : ''} ` : ''
  return { content: [{ type: 'text', text: `${prefix}${message}` }], isError: true }
}
