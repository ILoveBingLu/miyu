import { BaseAIProvider } from './base'

/**
 * 通义千问提供商元数据
 */
export const QwenMetadata = {
  id: 'qwen',
  name: 'qwen',
  displayName: '通义千问',
  description: '阿里云出品，稳定可靠',
  models: ['qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwq-plus', 'qwq-flash', 'qwq-turbo', 'qwen3-omni-flash', 'qwen3-omni-turbo', 'qwen3-omni-flash-turbo', 'qwen3-omni-flash-turbo-flash', 'qwen3-next-80b-a3b-thinking', 'qwen3-next-80b-a3b-instruct', 'deepseek-v3.2', 'kimi-k2-thinking', 'glm-4.7'],
  pricing: '¥0.008/1K tokens',
  pricingDetail: {
    input: 0.008,   // 0.008元/1K tokens
    output: 0.008
  },
  website: 'https://dashscope.aliyun.com/',
  logo: './AI-logo/qwen-color.svg'
}

/**
 * 通义千问提供商
 */
export class QwenProvider extends BaseAIProvider {
  name = QwenMetadata.name
  displayName = QwenMetadata.displayName
  models = QwenMetadata.models
  pricing = QwenMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  }
}
