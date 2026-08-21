import { isConnectorAttentionStatus, type ConnectorItem } from './connectors-model'

export interface ConnectorDetailMeta {
  permissionLabel: string
  configMethodLabel: string
  capabilities: string[]
  nextStep?: string
}

export function describeConnectorDetail(item: ConnectorItem): ConnectorDetailMeta {
  // 按带 kind 命名空间的完整 id 判定，避免用户自建同名 MCP（如 mcp:web-search）误拿内置连接器的配置文案。
  switch (item.id) {
    case 'builtin:chrome-devtools':
      return {
        permissionLabel: '可控制本机浏览器（打开网页、点击、输入）',
        configMethodLabel: '本机 Chrome，无需 API Key',
        capabilities: ['打开真实网页', '截图并检查页面结构', '点击、输入、查看网络请求'],
        nextStep: nextStepOf(item, '安装 Google Chrome 后点启用，或检查本机是否有 Node.js（npx）'),
      }
    case 'builtin:nano-banana':
      return {
        permissionLabel: '网络 · 调用 Gemini 生成或编辑图片',
        configMethodLabel: 'Gemini API Key',
        capabilities: ['按描述生成图片', '在已有图片上继续编辑'],
        nextStep: nextStepOf(item, '填写 Gemini API Key，然后启用'),
      }
    case 'api:web-search':
      return {
        permissionLabel: '网络 · 调用搜索 API',
        configMethodLabel: 'Tavily API Key',
        capabilities: ['搜索互联网获取实时信息'],
        nextStep: nextStepOf(item, '填写 Tavily API Key，然后启用'),
      }
    default:
      break
  }

  switch (item.kind) {
    case 'user-mcp':
      return {
        permissionLabel: item.description.includes('远程')
          ? '网络 · 连接你配置的远程服务'
          : '可运行本机命令并向 Agent 暴露工具',
        configMethodLabel: '命令或 URL',
        capabilities: ['按你添加的服务，向 Agent 暴露对应工具'],
        nextStep: nextStepOf(item, '补全命令或 URL，然后启用'),
      }
    case 'custom-http':
      return {
        permissionLabel: '网络 · 按你配置的 HTTP 请求访问外部 API',
        configMethodLabel: 'HTTP 方法与 URL 模板',
        capabilities: ['在对话中按模板发起 HTTP 请求'],
        nextStep: nextStepOf(item, '检查 URL 模板后启用'),
      }
    case 'builtin-mcp':
    case 'api-tool':
      return {
        permissionLabel: '由 MyYoda 托管的外部能力',
        configMethodLabel: isConnectorAttentionStatus(item.status) ? '需要配置后才能使用' : '按连接器说明配置',
        capabilities: [item.description],
        nextStep: nextStepOf(item, item.nextActionLabel),
      }
    default: {
      const _exhaustive: never = item.kind
      return _exhaustive
    }
  }
}

function nextStepOf(item: ConnectorItem, fallback?: string): string | undefined {
  if (item.status === 'enabled' || item.status === 'disabled') return undefined
  if (item.statusReason) {
    return item.nextActionLabel
      ? `${item.statusReason}。${item.nextActionLabel}`
      : item.statusReason
  }
  return fallback
}
