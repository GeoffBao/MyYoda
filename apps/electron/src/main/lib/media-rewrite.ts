/**
 * 媒体 URL 重写纯逻辑（无 IO，便于单测）
 *
 * - 把 markdown 中的图片地址（GitHub 媒体域）重写为代理转发 URL（由调用方注入 register 函数）
 * - 剥离 GitHub「图片上传未完成」的占位符 ![Uploading xxx…]()
 * - 相对路径图片（/xxx）解析为 https://github.com/xxx
 */
export type RemoteMediaRegister = (url: string) => string | null

/** 图片引用正则：![](...)，容忍空格与换行 */
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g

/** 上传未完成占位符（GitHub 粘贴图片未等上传完成即发布时残留） */
const UPLOADING_PLACEHOLDER_RE = /!\[Uploading [^\]]*\]\(\)/g

/** 重写 markdown 正文中的图片地址；register 返回 null 时保持原地址 */
export function rewriteMarkdownMedia(markdown: string, register: RemoteMediaRegister): string {
  return markdown
    .replace(UPLOADING_PLACEHOLDER_RE, '')
    .replace(MARKDOWN_IMAGE_RE, (_match: string, src: string) => {
      const resolved = src.startsWith('/') ? `https://github.com${src}` : src
      const proxied = register(resolved)
      return proxied ? `![image](${proxied})` : `![image](${src})`
    })
}

/** 重写头像/单图地址（非 markdown 场景）；register 返回 null 或地址非法时保持原值 */
export function rewriteRemoteMediaUrl(
  url: string | undefined,
  register: RemoteMediaRegister,
): string | undefined {
  if (!url) return url
  if (url.startsWith('/')) {
    const proxied = register(`https://github.com${url}`)
    return proxied ?? url
  }
  const proxied = register(url)
  return proxied ?? url
}
