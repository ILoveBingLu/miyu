import React from 'react'
import { linkifyText } from '../utils/linkify'
import { parseWechatEmoji } from '../utils/wechatEmoji'

interface MessageContentProps {
  content: string
  className?: string
}

/**
 * 处理文本中的换行符，将 \n 转换为 <br /> 标签
 * 同时处理链接和表情
 */
function processTextWithLineBreaks(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  
  lines.forEach((line, lineIndex) => {
    // 在每行之间添加换行符（除了第一行之前）
    if (lineIndex > 0) {
      result.push(<br key={`br-${lineIndex}`} />)
    }
    
    // 处理当前行的链接
    const linkedContent = linkifyText(line)
    
    // 如果链接处理返回了数组，需要对每个部分处理表情
    if (Array.isArray(linkedContent)) {
      linkedContent.forEach((part, partIndex) => {
        if (typeof part === 'string') {
          // 处理表情
          result.push(
            <React.Fragment key={`line-${lineIndex}-part-${partIndex}`}>
              {parseWechatEmoji(part)}
            </React.Fragment>
          )
        } else {
          // 已经是 React 元素（如链接）
          result.push(
            <React.Fragment key={`line-${lineIndex}-part-${partIndex}`}>
              {part}
            </React.Fragment>
          )
        }
      })
    } else if (typeof linkedContent === 'string') {
      // 如果是字符串，处理表情
      result.push(
        <React.Fragment key={`line-${lineIndex}`}>
          {parseWechatEmoji(linkedContent)}
        </React.Fragment>
      )
    } else {
      // 其他情况直接添加
      result.push(
        <React.Fragment key={`line-${lineIndex}`}>
          {linkedContent}
        </React.Fragment>
      )
    }
  })
  
  return result
}

/**
 * 消息内容渲染组件
 * 处理：换行符、链接识别、微信表情
 */
function MessageContent({ content, className, disableLinks = false }: MessageContentProps & { disableLinks?: boolean }) {
  if (!content) return null

  // 如果禁用链接，只处理表情和换行
  if (disableLinks) {
    const lines = content.split('\n')
    const result: React.ReactNode[] = []
    
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        result.push(<br key={`br-${lineIndex}`} />)
      }
      result.push(
        <React.Fragment key={`line-${lineIndex}`}>
          {parseWechatEmoji(line)}
        </React.Fragment>
      )
    })
    
    return <span className={className}>{result}</span>
  }

  // 处理换行、链接和表情
  const processedContent = processTextWithLineBreaks(content)

  return (
    <span className={className}>
      {processedContent}
    </span>
  )
}

export default MessageContent
