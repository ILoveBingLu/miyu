import { BaseAIProvider } from './base'

/**
 * 智谱AI提供商元数据
 */
export const ZhipuMetadata = {
  id: 'zhipu',
  name: 'zhipu',
  displayName: '智谱AI',
  description: '国产大模型，性能优秀',
  models: ['glm-4.7-flash', 'glm-4.6v-flash', 'glm-4.5-flash', 'glm-4.7', 'glm-4.6', 'glm-4.5'],
  pricing: '¥0.005/1K tokens',
  pricingDetail: {
    input: 0.005,   // 0.005元/1K tokens
    output: 0.005
  },
  website: 'https://open.bigmodel.cn/',
  logo: './AI-logo/zhipu-color.svg'
}

/**
 * 智谱AI提供商
 */
export class ZhipuProvider extends BaseAIProvider {
  name = ZhipuMetadata.name
  displayName = ZhipuMetadata.displayName
  models = ZhipuMetadata.models
  pricing = ZhipuMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://open.bigmodel.cn/api/paas/v4')
  }
}
