import React from 'react'
import { getEmojiPath, hasEmoji, type EmojiName } from 'wechat-emojis'

// 微信表情名称到图片的映射正则（不使用模块级带 g 标志的正则，避免 async 函数中 lastIndex 被并发修改）
const EMOJI_PATTERN_SOURCE = '\\[([^\\]]+)\\]'

/**
 * 获取表情图片的完整URL
 */
function getEmojiUrl(name: string): string | null {
  if (!hasEmoji(name)) return null
  const relativePath = getEmojiPath(name as EmojiName)
  if (!relativePath) return null
  // 转换为 public 目录下的路径
  return `./wechat-emojis/${relativePath.replace('assets/', '')}`
}

/**
 * 将文本中的微信表情 [xxx] 转换为图片
 */
export function parseWechatEmoji(text: string): React.ReactNode {
  if (!text) return text

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const emojiPattern = new RegExp(EMOJI_PATTERN_SOURCE, 'g')

  while ((match = emojiPattern.exec(text)) !== null) {
    const emojiName = match[1]

    // 检查是否是有效的微信表情
    if (hasEmoji(emojiName)) {
      // 添加表情前的文本
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index))
      }

      // 添加表情图片
      const emojiUrl = getEmojiUrl(emojiName)
      if (emojiUrl) {
        parts.push(
          <img
            key={match.index}
            src={emojiUrl}
            alt={`[${emojiName}]`}
            title={emojiName}
            className="wechat-emoji"
          />
        )
      } else {
        // 如果获取路径失败，保留原文本
        parts.push(match[0])
      }

      lastIndex = match.index + match[0].length
    }
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

/**
 * 检查文本是否包含微信表情
 */
export function hasWechatEmoji(text: string): boolean {
  if (!text) return false
  const emojiPattern = new RegExp(EMOJI_PATTERN_SOURCE, 'g')
  let match: RegExpExecArray | null
  while ((match = emojiPattern.exec(text)) !== null) {
    if (hasEmoji(match[1])) return true
  }
  return false
}

// 缓存 base64 数据，避免重复 fetch
const emojiBase64Cache = new Map<string, string>()

/**
 * 将文本中的微信表情 [xxx] 转换为 Base64 图片的 HTML 字符串 (常用于导出离线访问)
 */
export async function parseWechatEmojiHtml(text: string): Promise<string> {
  if (!text) return text

  const parts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const emojiPattern = new RegExp(EMOJI_PATTERN_SOURCE, 'g')

  while ((match = emojiPattern.exec(text)) !== null) {
    const emojiName = match[1]

    if (hasEmoji(emojiName)) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))
      }

      const relativePath = getEmojiPath(emojiName as EmojiName)
      if (relativePath) {
        // 构建完整的 URL，支持热更新 dev (/) 和打包后 prod (./)
        // 使用 encodeURI 处理中文名文件 (如 "失望.png")
        const baseUrl = import.meta.env.BASE_URL || '/'
        const rawPath = `${baseUrl}wechat-emojis/${relativePath.replace('assets/', '')}`
        const emojiUri = encodeURI(rawPath.replace(/\/\//g, '/'))

        let base64 = emojiBase64Cache.get(emojiUri)
        if (!base64) {
          try {
            const res = await fetch(emojiUri)
            const contentType = res.headers.get('content-type') || ''

            // 确保请求成功，并且返回的是图片而不是 HTML 回退页面
            if (res.ok && contentType.includes('image')) {
              const blob = await res.blob()
              base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve(reader.result as string)
                reader.readAsDataURL(blob)
              })
              if (base64) {
                emojiBase64Cache.set(emojiUri, base64)
              }
            } else {
              console.warn(`[Emoji] Failed to fetch: ${emojiUri}, status: ${res.status}, type: ${contentType}`)
            }
          } catch (e) {
            console.error(`[Emoji] Fetch error for: ${emojiUri}`, e)
          }
        }

        if (base64) {
          parts.push(`<img src="${base64}" alt="[${emojiName}]" title="${emojiName}" style="width: 20px; height: 20px; vertical-align: text-bottom; margin: 0 2px;" loading="lazy" />`)
        } else {
          // 如果获取失败，保留纯文本，避免渲染出损坏的图片造成“出现两个表情（破图+文字）”的情况
          parts.push(`[${emojiName}]`)
        }
      } else {
        parts.push(`[${emojiName}]`)
      }

      lastIndex = match.index + match[0].length
    }
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))
  }

  return parts.length > 0 ? parts.join('') : text
}

