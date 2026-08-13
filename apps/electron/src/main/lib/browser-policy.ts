/** 受管浏览器的 URL 规范化与合法性校验；保持无 Electron 依赖，便于在普通 Bun 测试中验证。 */

function isLoopbackAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '')
  if (ipv6 === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  return Number(match?.[1]) === 127
}

/**
 * 地址栏可直接输入域名或路径（例如 `example.com/docs`）；缺省协议时按 HTTPS 打开。
 * 受管浏览器不再按网络地址、协议或 URL 认证信息设置访问限制，具体协议支持由 Chromium 决定。
 */
export function normalizeBrowserUrl(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('浏览器地址不能为空。')
  // 协议相对 URL 按 HTTPS 处理，和无协议域名保持一致。
  if (value.startsWith('//')) return `https:${value}`
  // `localhost:3000` 和 `example.com:8080` 是没有协议的常见地址栏输入，不能被误判为 scheme。
  if (/^[^/?#:\s]+:\d+(?:[/?#]|$)/.test(value)) {
    const localCandidate = new URL(`http://${value}`)
    // 本机开发服务通常未配置 TLS；其他地址仍默认 HTTPS。
    return isLoopbackAddress(localCandidate.hostname) ? `http://${value}` : `https://${value}`
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return value
  // `localhost` / `app.localhost` 没有端口时同样按 HTTP 打开。
  try {
    const localCandidate = new URL(`http://${value}`)
    if (isLoopbackAddress(localCandidate.hostname)) return `http://${value}`
  } catch { /* 交由后续 URL 校验输出统一错误 */ }
  return `https://${value}`
}

/** 仅拒绝空值或无法被 URL 标准解析的输入；不限制目标网络、协议或认证信息。 */
export function assertSafeBrowserUrl(input: string): string {
  const normalized = normalizeBrowserUrl(input)
  try {
    return new URL(normalized).toString()
  } catch {
    throw new Error('浏览器地址无效。')
  }
}

/**
 * 保持现有调用接口，导航前不再进行 DNS 解析或地址类型过滤。
 * Chromium 是实际加载 URL 的网络栈，并决定各协议是否可用。
 */
export async function assertSafeBrowserDestination(input: string): Promise<string> {
  return assertSafeBrowserUrl(input)
}
