import { BaseAIProvider } from './base'
import OpenAI from 'openai'

/**
 * Gemini 提供商元数据
 */
export const GeminiMetadata = {
  id: 'gemini',
  name: 'gemini',
  displayName: 'Gemini',
  description: 'Google 最新的多模态 AI 模型',
  models: [
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
  ],
  pricing: '按量计费',
  pricingDetail: {
    input: 0.00015,   // gemini-1.5-flash 输入价格 $0.15/1M tokens
    output: 0.0006    // gemini-1.5-flash 输出价格 $0.60/1M tokens
  },
  website: 'https://ai.google.dev/',
  logo: './AI-logo/gemini-color.svg'
}

/**
 * Gemini 提供商
 * 使用 OpenAI 兼容的 API 格式
 */
export class GeminiProvider extends BaseAIProvider {
  name = GeminiMetadata.name
  displayName = GeminiMetadata.displayName
  models = GeminiMetadata.models
  pricing = GeminiMetadata.pricingDetail

  constructor(apiKey: string) {
    // 使用 OpenAI 兼容的端点
    super(apiKey, 'https://generativelanguage.googleapis.com/v1beta/openai')
  }

  /**
   * 重写 streamChat 以适配 Gemini API
   * Gemini 使用 XML 标签 <thought> 来标记思考内容，需要特殊处理
   */
  async streamChat(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    options: any,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const client = await this.getClient()
    const enableThinking = options?.enableThinking !== false
    const model = options?.model || this.models[0]
    
    // 构建请求参数
    const requestParams: any = {
      model: model,
      messages: messages,
      temperature: options?.temperature || 0.7,
      stream: true
    }
    
    if (options?.maxTokens) {
      requestParams.max_tokens = options.maxTokens
    }
    
    // Gemini 的思考模式控制
    // 注意：reasoning_effort 和 thinking_config 不能同时使用
    // 我们使用 thinking_config 因为它支持 include_thoughts
    const isGemini3 = model.includes('gemini-3')
    const isGemini25 = model.includes('gemini-2.5') || model.includes('gemini-2-5')
    
    // 使用 extra_body 配置思考模式
    if (isGemini3) {
      // Gemini 3: 使用 thinking_level (low/high)
      requestParams.extra_body = {
        google: {
          thinking_config: {
            thinking_level: enableThinking ? 'low' : 'minimal',
            include_thoughts: true
          }
        }
      }
    } else if (isGemini25) {
      // Gemini 2.5: 使用 thinking_budget (数值)
      requestParams.extra_body = {
        google: {
          thinking_config: {
            thinking_budget: enableThinking ? 8192 : 1024,
            include_thoughts: true
          }
        }
      }
    } else {
      // 其他模型：使用 reasoning_effort
      requestParams.reasoning_effort = enableThinking ? 'medium' : 'none'
    }
    
    const stream = await client.chat.completions.create(requestParams) as any

    let buffer = ''
    let isInThought = false

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const content = delta?.content || ''
      
      if (!content) continue
      
      buffer += content
      
      // 处理 Gemini 的 <thought> 标签
      // 检测开始标签
      if (buffer.includes('<thought>')) {
        const parts = buffer.split('<thought>')
        // 发送标签前的内容
        if (parts[0]) {
          onChunk(parts[0])
        }
        // 切换到思考模式，使用我们的标签
        onChunk('<think>')
        isInThought = true
        buffer = parts[1] || ''
      }
      
      // 检测结束标签
      if (buffer.includes('</thought>')) {
        const parts = buffer.split('</thought>')
        // 发送思考内容
        if (parts[0]) {
          onChunk(parts[0])
        }
        // 结束思考模式
        onChunk('</think>')
        isInThought = false
        buffer = parts[1] || ''
        
        // 如果还有剩余内容，继续发送
        if (buffer) {
          onChunk(buffer)
          buffer = ''
        }
      } else if (buffer.length > 100 || !buffer.includes('<') && !buffer.includes('>')) {
        // 如果缓冲区太大或明确不包含标签，直接发送
        onChunk(buffer)
        buffer = ''
      }
    }
    
    // 发送剩余内容
    if (buffer) {
      onChunk(buffer)
    }
    
    // 确保思考标签闭合
    if (isInThought) {
      onChunk('</think>')
    }
  }
}
