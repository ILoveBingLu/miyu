import { BaseAIProvider } from './base'

/**
 * Kimi提供商元数据
 */
export const KimiMetadata = {
  id: 'kimi',
  name: 'kimi',
  displayName: 'Kimi',
  description: '支持超长上下文',
  models: ['kimi-k2-0711-preview', 'kimi-k2-0905-preview', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-turbo-preview', 'kimi-k2-turbo', 'kimi-latest', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k', 'moonshot-v1-8k-flash', 'moonshot-v1-auto'],
  pricing: '¥0.012/1K tokens',
  pricingDetail: {
    input: 0.012,   // 0.012元/1K tokens
    output: 0.012
  },
  website: 'https://platform.moonshot.cn/',
  logo: './AI-logo/kimi-color.svg'
}

/**
 * Kimi提供商
 */
export class KimiProvider extends BaseAIProvider {
  name = KimiMetadata.name
  displayName = KimiMetadata.displayName
  models = KimiMetadata.models
  pricing = KimiMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://api.moonshot.cn/v1')
  }
}
