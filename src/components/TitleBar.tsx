import { ReactNode, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTitleBarStore } from '../stores/titleBarStore'
import { useUpdateStatusStore } from '../stores/updateStatusStore'
import './TitleBar.scss'

interface TitleBarProps {
  rightContent?: ReactNode
  title?: string
}

function TitleBar({ rightContent, title }: TitleBarProps) {
  const storeRightContent = useTitleBarStore(state => state.rightContent)
  const displayContent = rightContent ?? storeRightContent
  const isUpdating = useUpdateStatusStore(state => state.isUpdating)

  // 调试：检查状态
  useEffect(() => {
    if (isUpdating) {
      console.log('[TitleBar] 更新指示器显示')
    }
  }, [isUpdating])

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <img src="./logo.png" alt="密语" className="title-logo" />
        <span className="titles">{title || 'CipherTalk'}</span>
        {isUpdating && (
          <div className="update-status">
            <RefreshCw
              className="update-indicator"
              size={16}
              strokeWidth={2.5}
            />
            <span className="update-text">正在同步数据...</span>
          </div>
        )}
      </div>
      {displayContent && (
        <div className="title-bar-right">
          {displayContent}
        </div>
      )}
    </div>
  )
}

export default TitleBar
