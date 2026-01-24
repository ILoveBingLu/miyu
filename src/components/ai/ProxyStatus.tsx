import { useState, useEffect } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import './ProxyStatus.scss'

/**
 * 代理状态指示器组件
 * 显示当前系统代理状态，支持手动刷新
 */
export function ProxyStatus() {
  const [proxyStatus, setProxyStatus] = useState<{
    hasProxy: boolean
    proxyUrl: string | null
    loading: boolean
  }>({
    hasProxy: false,
    proxyUrl: null,
    loading: true
  })

  const [refreshing, setRefreshing] = useState(false)

  // 获取代理状态
  const fetchProxyStatus = async () => {
    try {
      const result = await window.electronAPI.ai.getProxyStatus()
      if (result.success) {
        setProxyStatus({
          hasProxy: result.hasProxy || false,
          proxyUrl: result.proxyUrl || null,
          loading: false
        })
      }
    } catch (error) {
      console.error('[ProxyStatus] 获取代理状态失败:', error)
      setProxyStatus({
        hasProxy: false,
        proxyUrl: null,
        loading: false
      })
    }
  }

  // 刷新代理配置
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const result = await window.electronAPI.ai.refreshProxy()
      if (result.success) {
        setProxyStatus({
          hasProxy: result.hasProxy || false,
          proxyUrl: result.proxyUrl || null,
          loading: false
        })
      }
    } catch (error) {
      console.error('[ProxyStatus] 刷新代理失败:', error)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchProxyStatus()
  }, [])

  if (proxyStatus.loading) {
    return null
  }

  return (
    <div className="proxy-status">
      <div className="proxy-status-content">
        {proxyStatus.hasProxy ? (
          <>
            <Wifi size={14} className="proxy-icon active" />
            <span className="proxy-text">
              代理: <code>{proxyStatus.proxyUrl}</code>
            </span>
          </>
        ) : (
          <>
            <WifiOff size={14} className="proxy-icon inactive" />
            <span className="proxy-text">直连</span>
          </>
        )}
      </div>
      
      <button
        className="proxy-refresh-btn"
        onClick={handleRefresh}
        disabled={refreshing}
        title="刷新代理配置"
      >
        <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
      </button>
    </div>
  )
}
