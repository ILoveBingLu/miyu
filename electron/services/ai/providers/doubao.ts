import { BaseAIProvider } from './base'

/**
 * 豆包提供商元数据
 */
export const DoubaoMetadata = {
  id: 'doubao',
  name: 'doubao',
  displayName: '豆包',
  description: '字节跳动出品，响应快速',
  models: ['doubao-seed-1-8-251228', 'doubao-seed-1-6-251015', 'doubao-seed-1-6-lite-251015', 'doubao-seed-1-6-flash-250828', 'deepseek-v3-2-251201', 'glm-4-7-251222', 'doubao-1-5-pro-32k-250115'],
  pricing: '¥0.008/1K tokens',
  pricingDetail: {
    input: 0.008,   // 0.008元/1K tokens
    output: 0.008
  },
  website: 'https://www.volcengine.com/',
  logo: './AI-logo/doubao-color.svg'
}

/**
 * 豆包提供商
 */
export class DoubaoProvider extends BaseAIProvider {
  name = DoubaoMetadata.name
  displayName = DoubaoMetadata.displayName
  models = DoubaoMetadata.models
  pricing = DoubaoMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://ark.cn-beijing.volces.com/api/v3')
  }
}
