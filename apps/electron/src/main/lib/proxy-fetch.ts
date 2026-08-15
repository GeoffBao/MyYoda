/**
 * 代理 Fetch 工具
 *
 * 基于 undici ProxyAgent 创建支持 HTTP 代理的 fetch 函数。
 * 用于渠道配置了代理地址时，让 AI API 请求走指定代理。
 */

import { net } from 'electron'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { RequestInfo, RequestInit } from 'undici'

/**
 * 创建代理 fetch 函数
 *
 * @param proxyUrl 代理地址（如 http://127.0.0.1:7890）
 * @returns 走代理的 fetch 函数，签名兼容全局 fetch
 */
export function createProxyFetch(proxyUrl: string): typeof globalThis.fetch {
  const dispatcher = new ProxyAgent(proxyUrl)

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    return undiciFetch(input as RequestInfo, {
      ...init,
      dispatcher,
    })
  }) as unknown as typeof globalThis.fetch
}

/**
 * 根据代理地址获取 fetch 函数
 *
 * 如果 proxyUrl 有值则返回代理 fetch，否则返回全局 fetch。
 */
export function getFetchFn(proxyUrl?: string): typeof globalThis.fetch {
  if (proxyUrl?.trim()) {
    return createProxyFetch(proxyUrl.trim())
  }
  return fetch
}

/**
 * 代理感知请求 + 系统网络栈兜底
 *
 * `getFetchFn` 走 Node 全局 `fetch`（未显式配置代理时不会读取系统 HTTP 代理/VPN），
 * 而应用「代理配置」页明确标注是给 AI API 请求用的，大多数用户不会为了看一个官方视频
 * 去专门打开它。当用户系统层有代理/VPN（如 GFW 环境下访问 GitHub Release）但未在
 * MyYoda 里配置时，`getFetchFn` 的请求会直接失败——而渲染进程的其它资源请求（含内嵌
 * 浏览器）能通过 Chromium 网络栈自动读取系统代理正常访问。
 *
 * 因此这里在 `getFetchFn` 请求失败时，用 `net.fetch`（Electron/Chromium 网络栈，
 * 自动感知系统代理）重试一次作为兜底，不改变 `getFetchFn` 本身的行为，不影响现有
 * 大量 AI 渠道调用方。仅用于对首选路径语义要求不严格的场景（如「发现」视频播放）。
 */
export async function fetchWithSystemFallback(
  url: string,
  init: { headers?: HeadersInit; timeoutMs?: number },
  proxyUrl: string | undefined,
): Promise<Response> {
  const { headers, timeoutMs = 600_000 } = init
  const primaryFetch = getFetchFn(proxyUrl)
  try {
    return await primaryFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (primaryError) {
    try {
      return await net.fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw primaryError
    }
  }
}
