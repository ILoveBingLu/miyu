import { BaseAIProvider } from './base'

/**
 * Xiaomi MiMo提供商元数据
 */
export const XiaomiMetadata = {
  id: 'xiaomi',
  name: 'xiaomi',
  displayName: 'Xiaomi MiMo',
  description: '小米大模型',
  models: [
    'mimo-v2-flash'
  ],
  pricing: '免费',
  pricingDetail: {
    input: 0.0,
    output: 0.0
  },
  website: 'https://api.xiaomimimo.com/',
  logo: './AI-logo/xiaomimimo.svg'
}

/**
 * Xiaomi MiMo提供商
 */
export class XiaomiProvider extends BaseAIProvider {
  name = XiaomiMetadata.name
  displayName = XiaomiMetadata.displayName
  models = XiaomiMetadata.models
  pricing = XiaomiMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://api.xiaomimimo.com/v1')
  }
}
