import { BaseAIProvider } from './base'

/**
 * 硅基流动提供商元数据
 */
export const SiliconFlowMetadata = {
  id: 'siliconflow',
  name: 'siliconflow',
  displayName: '硅基流动',
  description: '提供免费额度，支持多种开源模型',
  models: [
    'deepseek-ai/DeepSeek-V3',
    'Qwen/Qwen2.5-7B-Instruct',
    'Qwen/Qwen2.5-72B-Instruct',
    'meta-llama/Llama-3.3-70B-Instruct',
    'THUDM/glm-4-9b-chat',
    'internlm/internlm2_5-20b-chat'
  ],
  pricing: '免费额度',
  pricingDetail: {
    input: 0.0,     // 硅基流动提供免费额度
    output: 0.0
  },
  website: 'https://siliconflow.cn/',
  logo: './AI-logo/siliconcloud-color.svg'
}

/**
 * 硅基流动提供商
 */
export class SiliconFlowProvider extends BaseAIProvider {
  name = SiliconFlowMetadata.name
  displayName = SiliconFlowMetadata.displayName
  models = SiliconFlowMetadata.models
  pricing = SiliconFlowMetadata.pricingDetail

  constructor(apiKey: string) {
    super(apiKey, 'https://api.siliconflow.cn/v1')
  }
}
