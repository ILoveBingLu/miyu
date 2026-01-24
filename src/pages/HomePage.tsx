import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, CheckCircle, XCircle, User } from 'lucide-react'
import { useAppStore, UserInfo } from '../stores/appStore'
import WhatsNewModal from '../components/WhatsNewModal'
import './HomePage.scss'

interface LocalUserInfo {
  connected: boolean
  wxid: string
  nickName: string
  alias: string
  avatarUrl: string
}

function HomePage() {
  const navigate = useNavigate()
  const { isDbConnected, userInfo: preloadedUserInfo, userInfoLoaded } = useAppStore()
  const [userInfo, setUserInfo] = useState<LocalUserInfo>({
    connected: false,
    wxid: '',
    nickName: '',
    alias: '',
    avatarUrl: ''
  })

  // 新版本弹窗状态
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [currentVersion, setCurrentVersion] = useState('')

  useEffect(() => {
    checkNewVersion()
  }, [])

  useEffect(() => {
    // 如果已经预加载了用户信息，直接使用
    if (userInfoLoaded && preloadedUserInfo) {
      setUserInfo({
        connected: true,
        wxid: preloadedUserInfo.wxid,
        nickName: preloadedUserInfo.nickName,
        alias: preloadedUserInfo.alias,
        avatarUrl: preloadedUserInfo.avatarUrl
      })
    } else if (userInfoLoaded && !preloadedUserInfo && isDbConnected) {
      // 预加载完成但没有数据，尝试重新加载
      loadUserInfo()
    } else if (!userInfoLoaded && isDbConnected) {
      // 未预加载，手动加载
      loadUserInfo()
    } else if (!isDbConnected) {
      setUserInfo({
        connected: false,
        wxid: '',
        nickName: '',
        alias: '',
        avatarUrl: ''
      })
    }
  }, [isDbConnected, userInfoLoaded, preloadedUserInfo])

  const checkNewVersion = async () => {
    try {
      // 获取当前应用版本
      const version = await window.electronAPI.app.getVersion()
      setCurrentVersion(version)

      // 获取上次查看的版本
      const lastSeenVersion = localStorage.getItem('lastSeenVersion')

      // 简单的版本比较逻辑：如果版本不同且未记录，或者是新安装，则显示
      // 为了防止每次开发时版本号不变也弹，这里只在版本确实不同时弹
      // 注意：这里假设版本号格式为 x.y.z

      if (version !== lastSeenVersion) {
        // 如果是全新安装（没有 lastSeenVersion），也显示
        // 实际上这通常用于引导新用户
        setShowWhatsNew(true)
      }
    } catch (e) {
      console.error('检查新版本失败:', e)
    }
  }

  const handleCloseWhatsNew = () => {
    setShowWhatsNew(false)
    if (currentVersion) {
      localStorage.setItem('lastSeenVersion', currentVersion)
    }
  }

  const loadUserInfo = async () => {
    try {
      const result = await window.electronAPI.chat.getMyUserInfo()
      if (result.success && result.userInfo) {
        setUserInfo({
          connected: true,
          wxid: result.userInfo.wxid,
          nickName: result.userInfo.nickName,
          alias: result.userInfo.alias,
          avatarUrl: result.userInfo.avatarUrl
        })
      } else {
        setUserInfo({
          connected: true,
          wxid: '',
          nickName: '',
          alias: '',
          avatarUrl: ''
        })
      }
    } catch (e) {
      console.error('加载用户信息失败:', e)
    }
  }

  return (
    <div className="home-page">
      {showWhatsNew && (
        <WhatsNewModal
          version={currentVersion}
          onClose={handleCloseWhatsNew}
        />
      )}

      {/* 用户状态卡片 */}
      <div className="user-status-card">
        {userInfo.connected ? (
          <div className="user-info">
            <div className="user-avatar">
              {userInfo.avatarUrl ? (
                <img src={userInfo.avatarUrl} alt="" />
              ) : (
                <User size={24} />
              )}
            </div>
            <div className="user-details">
              <div className="user-name">{userInfo.nickName || userInfo.wxid}</div>
              {userInfo.alias && <div className="user-alias">微信号: {userInfo.alias}</div>}
              <div className="user-status">
                <CheckCircle size={12} />
                <span>已连接</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="disconnected-info">
            <div className="status-icon">
              <XCircle size={20} />
            </div>
            <div className="status-text">
              <span className="title">未连接数据库</span>
              <span className="desc">请先配置解密密钥</span>
            </div>
            <button className="config-btn" onClick={() => navigate('/settings?tab=database')}>
              去配置
            </button>
          </div>
        )}
      </div>

      <div className="tips">
        <h3><FileText size={16} /> 使用提示</h3>
        <ul>
          <li>联网功能仅用来支持在线更新！</li>
          <li>记得到「数据管理」界面解密数据库哦！</li>
          <li>除使用 AI 功能外，所有数据仅在本地处理，不会上传到任何服务器！</li>
        </ul>
      </div>
    </div>
  )
}

export default HomePage
