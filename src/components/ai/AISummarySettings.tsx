import { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff, Sparkles, Check, ChevronDown, ChevronUp, Zap, Star, FileText } from 'lucide-react'
import { getAIProviders, type AIProviderInfo } from '../../types/ai'
import './AISummarySettings.scss'

interface CustomSelectProps {
  value: string | number
  onChange: (value: any) => void
  options: { value: string | number; label: string }[]
  placeholder?: string
  editable?: boolean
}

function CustomSelect({ value, onChange, options, placeholder = '请选择', editable = false }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value
    setInputValue(newVal)
    onChange(newVal)
    setIsOpen(true)
  }

  const handleOptionClick = (val: string | number) => {
    onChange(val)
    setInputValue(val)
    setIsOpen(false)
  }

  return (
    <div className={`custom-select-container ${isOpen ? 'open' : ''}`} ref={containerRef}>
      <div className="select-trigger" onClick={() => !editable && setIsOpen(!isOpen)}>
        {editable ? (
          <input
            type="text"
            className="select-input"
            value={inputValue}
            onChange={handleInputChange}
            onClick={() => setIsOpen(true)}
            placeholder={placeholder}
          />
        ) : (
          <span>{options.find(o => o.value === value?.toString())?.label || value || placeholder}</span>
        )}
        <div className="trigger-icon" onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {isOpen && (
        <div className="select-options">
          {options.map(opt => (
            <div
              key={opt.value}
              className={`select-option ${value === opt.value ? 'selected' : ''}`}
              onClick={() => handleOptionClick(opt.value)}
            >
              <span className="option-label">{opt.label}</span>
              {value === opt.value && <Check size={14} className="check-icon" />}
            </div>
          ))}
          {editable && inputValue && !options.some(o => o.value === inputValue) && (
            <div className="select-option custom-value">
              <span className="option-label">使用自定义值: {inputValue}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Props 接口定义，接收父组件传递的状态和修改函数
interface AISummarySettingsProps {
  provider: string
  setProvider: (val: string) => void
  apiKey: string
  setApiKey: (val: string) => void
  model: string
  setModel: (val: string) => void
  defaultTimeRange: number
  setDefaultTimeRange: (val: number) => void
  summaryDetail: 'simple' | 'normal' | 'detailed'
  setSummaryDetail: (val: 'simple' | 'normal' | 'detailed') => void
  enableThinking: boolean
  setEnableThinking: (val: boolean) => void
  showMessage: (text: string, success: boolean) => void
}

function AISummarySettings({
  provider,
  setProvider,
  apiKey,
  setApiKey,
  model,
  setModel,
  defaultTimeRange,
  setDefaultTimeRange,
  summaryDetail,
  setSummaryDetail,
  enableThinking,
  setEnableThinking,
  showMessage
}: AISummarySettingsProps) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [usageStats, setUsageStats] = useState<any>(null)
  const [providers, setProviders] = useState<AIProviderInfo[]>([])
  const [providerConfigs, setProviderConfigs] = useState<{ [key: string]: { apiKey: string; model: string } }>({})

  useEffect(() => {
    // 加载提供商列表和统计数据
    loadProviders()
    loadUsageStats()
    loadAllProviderConfigs()
  }, [])

  const loadProviders = async () => {
    try {
      const providerList = await getAIProviders()
      setProviders(providerList)
    } catch (e) {
      console.error('加载提供商列表失败:', e)
    }
  }

  const loadAllProviderConfigs = async () => {
    try {
      const { getAllAiProviderConfigs } = await import('../../services/config')
      const configs = await getAllAiProviderConfigs()
      setProviderConfigs(configs)
    } catch (e) {
      console.error('加载提供商配置失败:', e)
    }
  }

  const handleProviderChange = async (newProvider: string) => {
    // 先保存当前提供商的配置
    if (provider && (apiKey || model)) {
      const { setAiProviderConfig } = await import('../../services/config')
      await setAiProviderConfig(provider, { apiKey, model })
      setProviderConfigs(prev => ({
        ...prev,
        [provider]: { apiKey, model }
      }))
    }

    // 切换到新提供商
    setProvider(newProvider)
    
    // 加载新提供商的配置
    const newProviderData = providers.find(p => p.id === newProvider)
    const savedConfig = providerConfigs[newProvider]
    
    if (savedConfig) {
      // 使用已保存的配置
      setApiKey(savedConfig.apiKey)
      setModel(savedConfig.model)
    } else if (newProviderData) {
      // 使用默认配置
      setApiKey('')
      setModel(newProviderData.models[0])
    }
  }

  const loadUsageStats = async () => {
    try {
      const result = await window.electronAPI.ai.getUsageStats()
      if (result.success) {
        setUsageStats(result.stats)
      }
    } catch (e) {
      console.error('加载使用统计失败:', e)
    }
  }

  const handleTestConnection = async () => {
    if (!apiKey) {
      showMessage('请先输入 API 密钥', false)
      return
    }

    setIsTesting(true)

    try {
      const result = await window.electronAPI.ai.testConnection(provider, apiKey)
      if (result.success) {
        showMessage('连接成功！', true)
      } else {
        // 使用后端返回的详细错误信息
        showMessage(result.error || '连接失败，请开启代理或检查网络', false)
        
        // 如果需要代理，额外提示
        if (result.needsProxy) {
          console.warn('[AI] 连接失败，可能需要代理。请检查：')
          console.warn('1. 系统代理是否已开启（Clash/V2Ray 等）')
          console.warn('2. API Key 是否正确')
          console.warn('3. 网络连接是否正常')
        }
      }
    } catch (e) {
      showMessage('连接失败，请开启代理或检查网络', false)
      console.error('[AI] 测试连接异常:', e)
    } finally {
      setIsTesting(false)
    }
  }

  const currentProvider = providers.find(p => p.id === provider) || providers[0]
  const modelOptions = currentProvider?.models.map(m => ({ value: m, label: m })) || []
  const timeRangeOptions = [
    { value: 1, label: '最近 1 天' },
    { value: 3, label: '最近 3 天' },
    { value: 7, label: '最近 7 天' },
    { value: 30, label: '最近 30 天' }
  ]

  return (
    <div className="tab-content ai-summary-settings">
      {/* 1. 提供商选择 - 胶囊样式 */}
      <h3 className="section-title">AI 服务商</h3>
      <div className="provider-selector-capsule">
        {providers.map(p => (
          <div
            key={p.id}
            className={`provider-capsule ${provider === p.id ? 'active' : ''}`}
            onClick={() => handleProviderChange(p.id)}
          >
            {p.logo ? (
              <img src={p.logo} alt={p.displayName} className="provider-logo" />
            ) : (
              <div className="provider-logo-skeleton" />
            )}
            <span className="provider-name">{p.displayName}</span>
            {provider === p.id && <Check size={14} className="check-icon" />}

            {/* 悬浮提示胶囊 */}
            <div className="provider-tooltip">
              <div className="tooltip-content">
                <p className="tooltip-desc">{p.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 2. 核心配置 */}
      <h3 className="section-title">核心配置</h3>
      <div className="settings-form">
        <div className="form-group">
          <label>API 密钥</label>

          <div className="input-with-actions">
            <input
              type={showApiKey ? 'text' : 'password'}
              placeholder={`请输入 ${currentProvider?.displayName} API 密钥`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="api-key-input"
            />
            <button
              type="button"
              className="input-action-btn"
              onClick={() => setShowApiKey(!showApiKey)}
              title={showApiKey ? '隐藏' : '显示'}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              type="button"
              className="input-action-btn primary"
              onClick={handleTestConnection}
              disabled={isTesting || !apiKey}
              title="测试连接"
            >
              {isTesting ? <Sparkles size={16} className="spin" /> : <Sparkles size={16} />}
            </button>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>选择模型 (支持手动输入)</label>
            <CustomSelect
              value={model}
              onChange={setModel}
              options={modelOptions}
              placeholder="请选择或输入模型名称"
              editable={true}
            />
          </div>

          <div className="form-group">
            <label>默认分析范围</label>
            <CustomSelect
              value={defaultTimeRange}
              onChange={setDefaultTimeRange}
              options={timeRangeOptions}
            />
          </div>
        </div>

        {/* 思考模式开关 */}
        <div className="form-group">
          <label className="toggle-label">
            <div className="toggle-header">
              <span className="toggle-title">启用思考模式</span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={enableThinking}
                  onChange={(e) => setEnableThinking(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </span>
            </div>
          </label>
          <div className="toggle-description">
            <p>控制 AI 的推理深度（部分模型无法完全关闭推理功能，仍会显示思考过程）</p>
          </div>
        </div>
      </div>

      {/* 3. 摘要偏好 */}
      <h3 className="section-title">摘要详细程度</h3>
      <div className="detail-options">
        <div
          className={`detail-card ${summaryDetail === 'simple' ? 'active' : ''}`}
          onClick={() => setSummaryDetail('simple')}
        >
          <div className="detail-icon"><Zap size={24} /></div>
          <div className="detail-content">
            <span className="detail-title">简洁</span>
            <span className="detail-desc">快速概览</span>
          </div>
        </div>

        <div
          className={`detail-card ${summaryDetail === 'normal' ? 'active' : ''}`}
          onClick={() => setSummaryDetail('normal')}
        >
          <div className="detail-icon"><Star size={24} /></div>
          <div className="detail-content">
            <span className="detail-title">标准</span>
            <span className="detail-desc">推荐使用</span>
          </div>
        </div>

        <div
          className={`detail-card ${summaryDetail === 'detailed' ? 'active' : ''}`}
          onClick={() => setSummaryDetail('detailed')}
        >
          <div className="detail-icon"><FileText size={24} /></div>
          <div className="detail-content">
            <span className="detail-title">详细</span>
            <span className="detail-desc">完整分析</span>
          </div>
        </div>
      </div>

      {/* 4. 使用统计 */}
      {usageStats && (
        <>
          <h3 className="section-title">使用统计</h3>
          <div className="usage-stats">
            <div className="stat-card">
              <div className="stat-label">总摘要次数</div>
              <div className="stat-value">{usageStats.totalCount || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">总消耗 Tokens</div>
              <div className="stat-value">{(usageStats.totalTokens || 0).toLocaleString()}</div>
            </div>
          </div>
        </>
      )}

      <div className="info-box-simple">
        <p>💡 提示：API 密钥存储在本地，不会上传到任何服务器。摘要内容仅用于本地展示。</p>
      </div>
    </div>
  )
}

export default AISummarySettings
