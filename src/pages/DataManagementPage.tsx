import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Database, Check, Circle, Unlock, RefreshCw, RefreshCcw } from 'lucide-react'
import './DataManagementPage.scss'

interface DatabaseFile {
  fileName: string
  filePath: string
  fileSize: number
  wxid: string
  isDecrypted: boolean
  decryptedPath?: string
  needsUpdate?: boolean
}

function DataManagementPage() {
  const [databases, setDatabases] = useState<DatabaseFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isDecrypting, setIsDecrypting] = useState(false)
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null)
  const [progress, setProgress] = useState<any>(null)
  const location = useLocation()

  const loadDatabases = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await window.electronAPI.dataManagement.scanDatabases()
      if (result.success) {
        setDatabases(result.databases || [])
      } else {
        showMessage(result.error || '扫描数据库失败', false)
      }
    } catch (e) {
      showMessage(`扫描失败: ${e}`, false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDatabases()

    // 监听进度（手动更新/解密时显示进度弹窗）
    const removeProgressListener = window.electronAPI.dataManagement.onProgress(async (data) => {
      // 解密/更新进度 - 显示弹窗
      if (data.type === 'decrypt' || data.type === 'update') {
        setProgress(data)
        return
      }

      // 完成/错误 - 清除弹窗并刷新数据库列表
      if (data.type === 'complete' || data.type === 'error') {
        setProgress(null)
        // 更新完成后自动刷新数据库列表（显示最新的解密状态和更新状态）
        if (data.type === 'complete') {
          await loadDatabases()
        }
      }
    })

    // 监听自动更新完成事件（静默更新时不会发送进度事件，但会触发此事件）
    // 注意：onUpdateAvailable 在更新完成时会传递 false
    let lastUpdateState = false
    const removeUpdateListener = window.electronAPI.dataManagement.onUpdateAvailable(async (hasUpdate) => {
      // 当 hasUpdate 从 true 变为 false 时，表示更新完成
      if (lastUpdateState && !hasUpdate) {
        // 更新完成，延迟一点刷新，确保后端更新完成
        setTimeout(async () => {
          await loadDatabases()
        }, 1000)
      }
      lastUpdateState = hasUpdate
    })

    return () => {
      removeProgressListener()
      removeUpdateListener()
    }
  }, [loadDatabases])

  // 当路由变化到数据管理页面时，重新加载数据
  useEffect(() => {
    if (location.pathname === '/data-management') {
      loadDatabases()
    }
  }, [location.pathname, loadDatabases])

  // 窗口可见性变化时刷新数据
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!document.hidden && location.pathname === '/data-management') {
        // 窗口从隐藏变为可见时，重新加载数据库列表
        await loadDatabases()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [location.pathname, loadDatabases])


  const showMessage = (text: string, success: boolean) => {
    setMessage({ text, success })
    setTimeout(() => setMessage(null), 3000)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleDecryptAll = async () => {
    // 检查聊天窗口是否打开
    const isChatOpen = await window.electronAPI.window.isChatWindowOpen()
    if (isChatOpen) {
      showMessage('请先关闭聊天窗口再进行解密操作', false)
      return
    }

    const pendingFiles = databases.filter(db => !db.isDecrypted)
    if (pendingFiles.length === 0) {
      showMessage('所有数据库都已解密', true)
      return
    }

    setIsDecrypting(true)
    try {
      const result = await window.electronAPI.dataManagement.decryptAll()
      if (result.success) {
        showMessage(`解密完成！成功: ${result.successCount}, 失败: ${result.failCount}`, result.failCount === 0)
        await loadDatabases()
      } else {
        showMessage(result.error || '解密失败', false)
      }
    } catch (e) {
      showMessage(`解密失败: ${e}`, false)
    } finally {
      setIsDecrypting(false)
    }
  }

  const handleIncrementalUpdate = async () => {
    // 检查聊天窗口是否打开
    const isChatOpen = await window.electronAPI.window.isChatWindowOpen()
    if (isChatOpen) {
      showMessage('请先关闭聊天窗口再进行增量更新', false)
      return
    }

    const filesToUpdate = databases.filter(db => db.needsUpdate)
    if (filesToUpdate.length === 0) {
      showMessage('没有需要更新的数据库', true)
      return
    }

    setIsDecrypting(true)
    try {
      const result = await window.electronAPI.dataManagement.incrementalUpdate()
      if (result.success) {
        showMessage(`增量更新完成！成功: ${result.successCount}, 失败: ${result.failCount}`, result.failCount === 0)
        await loadDatabases()
      } else {
        showMessage(result.error || '增量更新失败', false)
      }
    } catch (e) {
      showMessage(`增量更新失败: ${e}`, false)
    } finally {
      setIsDecrypting(false)
    }
  }

  const pendingCount = databases.filter(db => !db.isDecrypted).length
  const decryptedCount = databases.filter(db => db.isDecrypted).length
  const needsUpdateCount = databases.filter(db => db.needsUpdate).length


  return (
    <>
      {message && (
        <div className={`message-toast ${message.success ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      {progress && (progress.type === 'decrypt' || progress.type === 'update') && (
        <div className="decrypt-progress-overlay">
          <div className="progress-card">
            <h3>
              {progress.type === 'decrypt' ? '正在解密数据库' : '正在增量更新'}
            </h3>
            <p className="progress-file">{progress.fileName}</p>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress.fileProgress || 0}%` }}
              />
            </div>
            <p className="progress-text">
              文件 {(progress.current || 0) + 1} / {progress.total || 0} · {progress.fileProgress || 0}%
            </p>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1>数据管理</h1>
      </div>

      <div className="page-scroll">
        <section className="page-section">
          <div className="section-header">
            <div>
              <h2>数据库解密（已支持自动更新）</h2>
              <p className="section-desc">
                {isLoading ? '正在扫描...' : `已找到 ${databases.length} 个数据库，${decryptedCount} 个已解密，${pendingCount} 个待解密`}
              </p>
            </div>
            <div className="section-actions">
              <button className="btn btn-secondary" onClick={loadDatabases} disabled={isLoading}>
                <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
                刷新
              </button>
              {needsUpdateCount > 0 && (
                <button
                  className="btn btn-warning"
                  onClick={handleIncrementalUpdate}
                  disabled={isDecrypting}
                >
                  <RefreshCcw size={16} />
                  增量更新 ({needsUpdateCount})
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleDecryptAll}
                disabled={isDecrypting || pendingCount === 0}
              >
                <Unlock size={16} />
                {isDecrypting ? '解密中...' : '批量解密'}
              </button>
            </div>
          </div>

          <div className="database-list">
            {databases.map((db, index) => (
              <div key={index} className={`database-item ${db.isDecrypted ? (db.needsUpdate ? 'needs-update' : 'decrypted') : 'pending'}`}>
                <div className={`status-icon ${db.isDecrypted ? (db.needsUpdate ? 'needs-update' : 'decrypted') : 'pending'}`}>
                  {db.isDecrypted ? <Check size={16} /> : <Circle size={16} />}
                </div>
                <div className="db-info">
                  <div className="db-name">{db.fileName}</div>
                  <div className="db-meta">
                    <span>{db.wxid}</span>
                    <span>•</span>
                    <span>{formatFileSize(db.fileSize)}</span>
                  </div>
                </div>
                <div className={`db-status ${db.isDecrypted ? (db.needsUpdate ? 'needs-update' : 'decrypted') : 'pending'}`}>
                  {db.isDecrypted ? (db.needsUpdate ? '需更新' : '已解密') : '待解密'}
                </div>
              </div>
            ))}

            {!isLoading && databases.length === 0 && (
              <div className="empty-state">
                <Database size={48} strokeWidth={1} />
                <p>未找到数据库文件</p>
                <p className="hint">请先在设置页面配置数据库路径</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

export default DataManagementPage
