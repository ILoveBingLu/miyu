import { BaseAIProvider } from './base'

/**
 * DeepSeek 提供商元数据
 */
export const DeepSeekMetadata = {
  id: 'deepseek',
  name: 'deepseek',
  displayName: 'DeepSeek',
  description: '最便宜的选择，性价比极高',
  models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  pricing: '¥0.001/1K tokens',
  pricingDetail: {
    input: 0.001,   // 0.001元/1K tokens（最便宜）
    output: 0.002
  },
  website: 'https://www.deepseek.com/',
  logo: './AI-logo/deepseek-color.svg'
}

/**
 * DeepSeek 提供商
 */
export class DeepSeekProvider extends BaseAIProvider {
  name = DeepSeekMetadata.name
  displayName = DeepSeekMetadata.displayName
  models = DeepSeekMetadata.models
  pricing = DeepSeekMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://api.deepseek.com/v1')
  }
}
