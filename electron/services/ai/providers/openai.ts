import { BaseAIProvider } from './base'

/**
 * OpenAI提供商元数据
 */
export const OpenAIMetadata = {
  id: 'openai',
  name: 'openai',
  displayName: 'OpenAI',
  description: '全球领先的AI服务提供商',
  models: [
    'gpt-5.2-2025-12-11',
    'gpt-5-mini-2025-08-07',
    'gpt-5-nano-2025-08-07',
    'gpt-5.2-pro-2025-12-11',
    'gpt-5-2025-08-07',
    'gpt-4.1-2025-04-14',
    'o3-deep-research-2025-06-26',
    'o4-mini-deep-research-2025-06-26'
  ],
  pricing: '按量计费',
  pricingDetail: {
    input: 0.0025,     // gpt-4o 输入价格 $2.5/1M tokens
    output: 0.01       // gpt-4o 输出价格 $10/1M tokens
  },
  website: 'https://openai.com/',
  logo: './AI-logo/openai.svg'
}

/**
 * OpenAI提供商
 */
export class OpenAIProvider extends BaseAIProvider {
  name = OpenAIMetadata.name
  displayName = OpenAIMetadata.displayName
  models = OpenAIMetadata.models
  pricing = OpenAIMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://api.openai.com/v1')
  }
}
