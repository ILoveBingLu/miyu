import { useState, useEffect } from 'react'
import { useSearchParams, useLocation } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useThemeStore, themes } from '../stores/themeStore'
import { useActivationStore } from '../stores/activationStore'
import { dialog } from '../services/ipc'
import * as configService from '../services/config'
import AISummarySettings from '../components/ai/AISummarySettings'
import {
  Eye, EyeOff, Key, FolderSearch, FolderOpen, Search,
  RotateCcw, Trash2, Save, Plug, X, Check, Sun, Moon,
  Palette, Database, ImageIcon, Download, HardDrive, Info, RefreshCw, Shield, Clock, CheckCircle, AlertCircle, FileText, Mic,
  Zap, Layers, User, Sparkles, Github
} from 'lucide-react'
import './SettingsPage.scss'

type SettingsTab = 'appearance' | 'database' | 'stt' | 'ai' | 'data' | 'activation' | 'about'

const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'database', label: '数据解密', icon: Database },
  { id: 'stt', label: '语音转文字', icon: Mic },
  { id: 'ai', label: 'AI 摘要', icon: Sparkles },
  { id: 'data', label: '数据管理', icon: HardDrive },
  // { id: 'activation', label: '激活', icon: Shield },
  { id: 'about', label: '关于', icon: Info }
]

const sttLanguageOptions = [
  { value: 'zh', label: '中文', enLabel: 'Chinese' },
  { value: 'en', label: '英语', enLabel: 'English' },
  { value: 'ja', label: '日语', enLabel: 'Japanese' },
  { value: 'ko', label: '韩语', enLabel: 'Korean' },
  { value: 'yue', label: '粤语', enLabel: 'Cantonese' }
]

const sttModelTypeOptions = [
  { value: 'int8', label: 'int8 量化版', size: '235 MB', desc: '推荐，体积小、速度快' },
  { value: 'float32', label: 'float32 完整版', size: '920 MB', desc: '更高精度，体积较大' }
]

function SettingsPage() {
  const [searchParams] = useSearchParams()
  const { setDbConnected, setLoading } = useAppStore()
  const { currentTheme, themeMode, setTheme, setThemeMode } = useThemeStore()
  const { status: activationStatus, checkStatus: checkActivationStatus } = useActivationStore()

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const tab = searchParams.get('tab')
    if (tab && tabs.some(t => t.id === tab)) {
      return tab as SettingsTab
    }
    return 'appearance'
  })

  // 切换到激活 tab 时自动刷新状态
  useEffect(() => {
    if (activeTab === 'activation') {
      checkActivationStatus()
    }
  }, [activeTab])

  const [decryptKey, setDecryptKey] = useState('')
  const [dbPath, setDbPath] = useState('')
  const [wxid, setWxid] = useState('')
  const [wxidOptions, setWxidOptions] = useState<string[]>([])
  const [showWxidDropdown, setShowWxidDropdown] = useState(false)
  const [isScanningWxid, setIsScanningWxid] = useState(false)
  const [cachePath, setCachePath] = useState('')
  const [imageXorKey, setImageXorKey] = useState('')
  const [imageAesKey, setImageAesKey] = useState('')
  const [exportPath, setExportPath] = useState('')
  const [defaultExportPath, setDefaultExportPath] = useState('')

  const [isLoading, setIsLoadingState] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isGettingKey, setIsGettingKey] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; version?: string; releaseNotes?: string } | null>(null)
  const [keyStatus, setKeyStatus] = useState('')
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null)
  const [showDecryptKey, setShowDecryptKey] = useState(false)
  const [showXorKey, setShowXorKey] = useState(false)
  const [showAesKey, setShowAesKey] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState<{
    type: 'images' | 'all' | 'config'
    title: string
    message: string
  } | null>(null)
  const [cacheSize, setCacheSize] = useState<{
    images: number
    emojis: number
    databases: number
    logs: number
    total: number
  } | null>(null)
  const [isLoadingCacheSize, setIsLoadingCacheSize] = useState(false)
  const [sttLanguages, setSttLanguagesState] = useState<string[]>([])
  const [sttModelType, setSttModelType] = useState<'int8' | 'float32'>('int8')
  const [quoteStyle, setQuoteStyle] = useState<'default' | 'wechat'>('default')
  const [skipIntegrityCheck, setSkipIntegrityCheck] = useState(false)
  const [exportDefaultDateRange, setExportDefaultDateRange] = useState<number>(0)
  const [exportDefaultAvatars, setExportDefaultAvatars] = useState<boolean>(true)

  // AI 相关配置状态
  const [aiProvider, setAiProviderState] = useState('zhipu')
  const [aiApiKey, setAiApiKeyState] = useState('')
  const [aiModel, setAiModelState] = useState('')
  const [aiDefaultTimeRange, setAiDefaultTimeRangeState] = useState<number>(7)
  const [aiSummaryDetail, setAiSummaryDetailState] = useState<'simple' | 'normal' | 'detailed'>('normal')
  const [aiEnableThinking, setAiEnableThinkingState] = useState<boolean>(true)

  // 日志相关状态
  const [logFiles, setLogFiles] = useState<Array<{ name: string; size: number; mtime: Date }>>([])
  const [selectedLogFile, setSelectedLogFile] = useState<string>('')
  const [logContent, setLogContent] = useState<string>('')
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [isLoadingLogContent, setIsLoadingLogContent] = useState(false)
  const [logSize, setLogSize] = useState<number>(0)
  const [currentLogLevel, setCurrentLogLevel] = useState<string>('WARN')

  useEffect(() => {
    loadConfig()
    loadDefaultExportPath()
    loadAppVersion()
    loadCacheSize()
    loadLogFiles()
  }, [])

  const loadConfig = async () => {
    try {
      const savedKey = await configService.getDecryptKey()
      const savedPath = await configService.getDbPath()
      const savedWxid = await configService.getMyWxid()
      const savedCachePath = await configService.getCachePath()
      const savedXorKey = await configService.getImageXorKey()
      const savedAesKey = await configService.getImageAesKey()
      const savedExportPath = await configService.getExportPath()
      const savedSttLanguages = await configService.getSttLanguages()
      const savedSttModelType = await configService.getSttModelType()
      const savedSkipIntegrityCheck = await configService.getSkipIntegrityCheck()

      if (savedKey) setDecryptKey(savedKey)
      if (savedPath) setDbPath(savedPath)
      if (savedWxid) setWxid(savedWxid)
      if (savedCachePath) setCachePath(savedCachePath)
      if (savedXorKey) setImageXorKey(savedXorKey)
      if (savedAesKey) setImageAesKey(savedAesKey)
      if (savedExportPath) setExportPath(savedExportPath)
      if (savedSttLanguages && savedSttLanguages.length > 0) {
        setSttLanguagesState(savedSttLanguages)
      } else {
        setSttLanguagesState(['zh'])
      }
      setSttModelType(savedSttModelType)
      setSkipIntegrityCheck(savedSkipIntegrityCheck)

      const savedQuoteStyle = await configService.getQuoteStyle()
      setQuoteStyle(savedQuoteStyle)

      const savedExportDefaultDateRange = await configService.getExportDefaultDateRange()
      setExportDefaultDateRange(savedExportDefaultDateRange)

      const savedExportDefaultAvatars = await configService.getExportDefaultAvatars()
      setExportDefaultAvatars(savedExportDefaultAvatars)

      // 加载 AI 配置
      const savedAiProvider = await configService.getAiProvider()
      const savedAiApiKey = await configService.getAiApiKey()
      const savedAiModel = await configService.getAiModel()
      const savedAiDefaultTimeRange = await configService.getAiDefaultTimeRange()
      const savedAiSummaryDetail = await configService.getAiSummaryDetail()
      const savedAiEnableThinking = await configService.getAiEnableThinking()

      setAiProviderState(savedAiProvider)
      setAiApiKeyState(savedAiApiKey)
      setAiModelState(savedAiModel)
      setAiDefaultTimeRangeState(savedAiDefaultTimeRange)
      setAiSummaryDetailState(savedAiSummaryDetail)
      setAiEnableThinkingState(savedAiEnableThinking)
    } catch (e) {
      console.error('加载配置失败:', e)
    }
  }

  const loadDefaultExportPath = async () => {
    try {
      const downloadsPath = await window.electronAPI.app.getDownloadsPath()
      setDefaultExportPath(downloadsPath)
    } catch (e) {
      console.error('获取默认导出路径失败:', e)
    }
  }

  const loadAppVersion = async () => {
    try {
      const version = await window.electronAPI.app.getVersion()
      setAppVersion(version)
    } catch (e) {
      console.error('获取版本号失败:', e)
    }
  }

  const loadCacheSize = async () => {
    setIsLoadingCacheSize(true)
    try {
      const result = await window.electronAPI.cache.getCacheSize()
      if (result.success && result.size) {
        setCacheSize(result.size)
      }
    } catch (e) {
      console.error('获取缓存大小失败:', e)
    } finally {
      setIsLoadingCacheSize(false)
    }
  }

  const loadLogFiles = async () => {
    setIsLoadingLogs(true)
    try {
      const [filesResult, sizeResult, levelResult] = await Promise.all([
        window.electronAPI.log.getLogFiles(),
        window.electronAPI.log.getLogSize(),
        window.electronAPI.log.getLogLevel()
      ])

      if (filesResult.success && filesResult.files) {
        setLogFiles(filesResult.files)
      }

      if (sizeResult.success && sizeResult.size !== undefined) {
        setLogSize(sizeResult.size)
      }

      if (levelResult.success && levelResult.level) {
        setCurrentLogLevel(levelResult.level)
      }
    } catch (e) {
      console.error('获取日志文件失败:', e)
    } finally {
      setIsLoadingLogs(false)
    }
  }

  const loadLogContent = async (filename: string) => {
    if (!filename) return

    setIsLoadingLogContent(true)
    try {
      const result = await window.electronAPI.log.readLogFile(filename)
      if (result.success && result.content) {
        setLogContent(result.content)
      } else {
        setLogContent('无法读取日志文件')
      }
    } catch (e) {
      console.error('读取日志文件失败:', e)
      setLogContent('读取日志文件失败')
    } finally {
      setIsLoadingLogContent(false)
    }
  }

  const handleClearLogs = async () => {
    try {
      const result = await window.electronAPI.log.clearLogs()
      if (result.success) {
        showMessage('日志清除成功', true)
        setLogFiles([])
        setLogContent('')
        setSelectedLogFile('')
        setLogSize(0)
        await loadCacheSize() // 重新加载缓存大小
      } else {
        showMessage(result.error || '日志清除失败', false)
      }
    } catch (e) {
      showMessage(`日志清除失败: ${e}`, false)
    }
  }

  const handleLogFileSelect = (filename: string) => {
    setSelectedLogFile(filename)
    loadLogContent(filename)
  }

  const handleOpenLogDirectory = async () => {
    try {
      const result = await window.electronAPI.log.getLogDirectory()
      if (result.success && result.directory) {
        await window.electronAPI.shell.openPath(result.directory)
      }
    } catch (e) {
      showMessage('打开日志目录失败', false)
    }
  }

  const handleLogLevelChange = async (level: string) => {
    try {
      const result = await window.electronAPI.log.setLogLevel(level)
      if (result.success) {
        setCurrentLogLevel(level)
        showMessage(`日志级别已设置为 ${level}`, true)
      } else {
        showMessage(result.error || '设置日志级别失败', false)
      }
    } catch (e) {
      showMessage('设置日志级别失败', false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  // 监听下载进度
  useEffect(() => {
    const removeListener = window.electronAPI.app.onDownloadProgress?.((progress: number) => {
      setDownloadProgress(progress)
    })
    return () => removeListener?.()
  }, [])

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true)
    setUpdateInfo(null)
    try {
      const result = await window.electronAPI.app.checkForUpdates()
      if (result.hasUpdate) {
        setUpdateInfo(result)
        showMessage(`发现新版本 ${result.version}`, true)
      } else {
        showMessage('当前已是最新版本', true)
      }
    } catch (e) {
      showMessage(`检查更新失败: ${e}`, false)
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const showMessage = (text: string, success: boolean) => {
    setMessage({ text, success })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleClearImages = () => {
    setShowClearDialog({
      type: 'images',
      title: '清除图片',
      message: '此操作将删除所有解密后的图片文件，清除后无法恢复。确定要继续吗？'
    })
  }

  const handleClearAllCache = () => {
    setShowClearDialog({
      type: 'all',
      title: '清除所有',
      message: '此操作将删除所有缓存数据（包括解密后的图片、表情包、数据库文件），清除后无法恢复。确定要继续吗？'
    })
  }

  const handleClearConfig = () => {
    setShowClearDialog({
      type: 'config',
      title: '清除配置',
      message: '此操作将删除所有保存的配置信息（包括密钥、路径等），清除后无法恢复。确定要继续吗？'
    })
  }

  const confirmClear = async () => {
    if (!showClearDialog) return

    try {
      let result
      switch (showClearDialog.type) {
        case 'images':
          result = await window.electronAPI.cache.clearImages()
          break
        case 'all':
          result = await window.electronAPI.cache.clearAll()
          break
        case 'config':
          result = await window.electronAPI.cache.clearConfig()
          break
      }

      if (result.success) {
        showMessage(`${showClearDialog.title}成功`, true)
        if (showClearDialog.type === 'config') {
          // 清除配置后重新加载
          await loadConfig()
        } else {
          // 清除缓存后重新加载缓存大小
          await loadCacheSize()
        }
      } else {
        showMessage(result.error || `${showClearDialog.title}失败`, false)
      }
    } catch (e) {
      showMessage(`${showClearDialog.title}失败: ${e}`, false)
    } finally {
      setShowClearDialog(null)
    }
  }

  const handleUpdateNow = async () => {
    setIsDownloading(true)
    setDownloadProgress(0)
    try {
      showMessage('正在下载更新...', true)
      await window.electronAPI.app.downloadAndInstall()
    } catch (e) {
      showMessage(`更新失败: ${e}`, false)
      setIsDownloading(false)
    }
  }

  const handleGetKey = async () => {
    if (isGettingKey) return
    setIsGettingKey(true)
    setKeyStatus('正在检查微信进程...')

    try {
      const isRunning = await window.electronAPI.wxKey.isWeChatRunning()
      if (isRunning) {
        const shouldKill = window.confirm('检测到微信正在运行，需要重启微信才能获取密钥。\n是否关闭当前微信？')
        if (!shouldKill) {
          setKeyStatus('已取消')
          setIsGettingKey(false)
          return
        }
        setKeyStatus('正在关闭微信...')
        await window.electronAPI.wxKey.killWeChat()
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      setKeyStatus('正在启动微信...')
      const launched = await window.electronAPI.wxKey.launchWeChat()
      if (!launched) {
        showMessage('微信启动失败，请检查安装路径', false)
        setKeyStatus('')
        setIsGettingKey(false)
        return
      }

      setKeyStatus('等待微信窗口加载...')
      const windowReady = await window.electronAPI.wxKey.waitForWindow(15)
      if (!windowReady) {
        showMessage('等待微信窗口超时', false)
        setKeyStatus('')
        setIsGettingKey(false)
        return
      }

      const removeListener = window.electronAPI.wxKey.onStatus(({ status }) => {
        setKeyStatus(status)
      })

      setKeyStatus('Hook 已安装，请登录微信...')
      const result = await window.electronAPI.wxKey.startGetKey()
      removeListener()

      if (result.success && result.key) {
        setDecryptKey(result.key)
        await configService.setDecryptKey(result.key)

        // 自动检测当前登录的微信账号
        setKeyStatus('正在检测当前登录账号...')

        // 先尝试较短的时间范围（刚登录的情况）
        let accountInfo = await window.electronAPI.wxKey.detectCurrentAccount(dbPath, 10) // 10分钟

        // 如果没找到，尝试更长的时间范围
        if (!accountInfo) {
          accountInfo = await window.electronAPI.wxKey.detectCurrentAccount(dbPath, 60) // 1小时
        }

        if (accountInfo) {
          setWxid(accountInfo.wxid)
          await configService.setMyWxid(accountInfo.wxid)
          showMessage(`密钥获取成功！已自动绑定账号: ${accountInfo.wxid}`, true)
        } else {
          showMessage('密钥获取成功，已自动保存！（未能自动检测账号，请手动输入 wxid）', true)
        }
        setKeyStatus('')
      } else {
        showMessage(result.error || '获取密钥失败', false)
        setKeyStatus('')
      }
    } catch (e) {
      showMessage(`获取密钥失败: ${e}`, false)
      setKeyStatus('')
    } finally {
      setIsGettingKey(false)
    }
  }

  const handleCancelGetKey = async () => {
    await window.electronAPI.wxKey.cancel()
    setIsGettingKey(false)
    setKeyStatus('')
  }

  const handleOpenWelcomeWindow = async () => {
    try {
      await window.electronAPI.window.openWelcomeWindow()
    } catch (e) {
      showMessage('打开引导窗口失败', false)
    }
  }

  const handleSelectDbPath = async () => {
    try {
      const result = await dialog.openFile({ title: '选择微信数据库根目录', properties: ['openDirectory'] })
      if (!result.canceled && result.filePaths.length > 0) {
        setDbPath(result.filePaths[0])
        showMessage('已选择数据库目录', true)
      }
    } catch (e) {
      showMessage('选择目录失败', false)
    }
  }

  const handleSelectCachePath = async () => {
    try {
      const result = await dialog.openFile({ title: '选择缓存目录', properties: ['openDirectory'] })
      if (!result.canceled && result.filePaths.length > 0) {
        setCachePath(result.filePaths[0])
        showMessage('已选择缓存目录', true)
      }
    } catch (e) {
      showMessage('选择目录失败', false)
    }
  }

  const handleSelectExportPath = async () => {
    try {
      const result = await dialog.openFile({ title: '选择导出目录', properties: ['openDirectory'] })
      if (!result.canceled && result.filePaths.length > 0) {
        setExportPath(result.filePaths[0])
        await configService.setExportPath(result.filePaths[0])
        showMessage('已设置导出目录', true)
      }
    } catch (e) {
      showMessage('选择目录失败', false)
    }
  }

  const handleResetExportPath = async () => {
    try {
      const downloadsPath = await window.electronAPI.app.getDownloadsPath()
      setExportPath(downloadsPath)
      await configService.setExportPath(downloadsPath)
      showMessage('已恢复为下载目录', true)
    } catch (e) {
      showMessage('恢复默认失败', false)
    }
  }

  // 扫描 wxid
  const handleScanWxid = async () => {
    if (!dbPath) {
      showMessage('请先配置数据库路径', false)
      return
    }
    if (isScanningWxid) return

    setIsScanningWxid(true)
    try {
      const wxids = await window.electronAPI.dbPath.scanWxids(dbPath)
      if (wxids.length === 0) {
        showMessage('未检测到账号目录（需包含 db_storage 文件夹）', false)
        setWxidOptions([])
      } else if (wxids.length === 1) {
        // 只有一个账号，直接设置
        setWxid(wxids[0])
        await configService.setMyWxid(wxids[0])
        showMessage(`已检测到账号：${wxids[0]}`, true)
        setWxidOptions([])
        setShowWxidDropdown(false)
      } else {
        // 多个账号，显示选择下拉框
        setWxidOptions(wxids)
        setShowWxidDropdown(true)
        showMessage(`检测到 ${wxids.length} 个账号，请选择`, true)
      }
    } catch (e) {
      showMessage(`扫描失败: ${e}`, false)
    } finally {
      setIsScanningWxid(false)
    }
  }

  // 选择 wxid
  const handleSelectWxid = async (selectedWxid: string) => {
    setWxid(selectedWxid)
    await configService.setMyWxid(selectedWxid)
    setShowWxidDropdown(false)
    showMessage(`已选择账号：${selectedWxid}`, true)
  }

  const handleTestConnection = async () => {
    if (!dbPath) { showMessage('请先选择数据库目录', false); return }
    if (!decryptKey) { showMessage('请先输入解密密钥', false); return }
    if (decryptKey.length !== 64) { showMessage('密钥长度必须为64个字符', false); return }
    if (!wxid) { showMessage('请先输入或扫描 wxid', false); return }

    setIsTesting(true)
    try {
      const result = await window.electronAPI.wcdb.testConnection(dbPath, decryptKey, wxid)
      if (result.success) {
        showMessage('连接测试成功！数据库可正常访问', true)
      } else {
        showMessage(result.error || '连接测试失败', false)
      }
    } catch (e) {
      showMessage(`连接测试失败: ${e}`, false)
    } finally {
      setIsTesting(false)
    }
  }

  const handleSaveConfig = async () => {
    setIsLoadingState(true)
    setLoading(true, '正在保存配置...')

    try {
      // 保存数据库相关配置
      if (decryptKey) await configService.setDecryptKey(decryptKey)
      if (dbPath) await configService.setDbPath(dbPath)
      if (wxid) await configService.setMyWxid(wxid)
      await configService.setCachePath(cachePath)

      // 保存图片密钥（包括空值）
      await configService.setImageXorKey(imageXorKey)
      await configService.setImageAesKey(imageAesKey)

      // 保存导出路径
      if (exportPath) await configService.setExportPath(exportPath)

      // 保存完整性检查设置
      await configService.setSkipIntegrityCheck(skipIntegrityCheck)

      // 保存引用样式
      await configService.setQuoteStyle(quoteStyle)

      // 保存导出默认设置
      await configService.setExportDefaultDateRange(exportDefaultDateRange)
      await configService.setExportDefaultAvatars(exportDefaultAvatars)

      // 保存 AI 配置
      await configService.setAiProvider(aiProvider)
      await configService.setAiApiKey(aiApiKey)
      await configService.setAiModel(aiModel)
      await configService.setAiDefaultTimeRange(aiDefaultTimeRange)
      await configService.setAiSummaryDetail(aiSummaryDetail)
      await configService.setAiEnableThinking(aiEnableThinking)

      // 如果数据库配置完整，尝试设置已连接状态（不进行耗时测试，仅标记）
      if (decryptKey && dbPath && wxid && decryptKey.length === 64) {
        setDbConnected(true, dbPath)
      }

      showMessage('配置保存成功', true)
    } catch (e) {
      showMessage(`保存配置失败: ${e}`, false)
    } finally {
      setIsLoadingState(false)
      setLoading(false)
    }
  }

  const renderAppearanceTab = () => (
    <div className="tab-content">
      <div className="theme-mode-toggle">
        <button className={`mode-btn ${themeMode === 'light' ? 'active' : ''}`} onClick={() => setThemeMode('light')}>
          <Sun size={16} /> 浅色
        </button>
        <button className={`mode-btn ${themeMode === 'dark' ? 'active' : ''}`} onClick={() => setThemeMode('dark')}>
          <Moon size={16} /> 深色
        </button>
      </div>
      <div className="theme-grid">
        {themes.map((theme) => (
          <div key={theme.id} className={`theme-card ${currentTheme === theme.id ? 'active' : ''}`} onClick={() => setTheme(theme.id)}>
            <div className="theme-preview" style={{ background: themeMode === 'dark' ? 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)' : `linear-gradient(135deg, ${theme.bgColor} 0%, ${theme.bgColor}dd 100%)` }}>
              <div className="theme-accent" style={{ background: theme.primaryColor }} />
            </div>
            <div className="theme-info">
              <span className="theme-name">{theme.name}</span>
              <span className="theme-desc">{theme.description}</span>
            </div>
            {currentTheme === theme.id && <div className="theme-check"><Check size={14} /></div>}
          </div>
        ))}
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>引用消息样式</h3>
      <div className="quote-style-options">
        <label className={`radio-label ${quoteStyle === 'default' ? 'active' : ''}`}>
          <input
            type="radio"
            name="quoteStyle"
            value="default"
            checked={quoteStyle === 'default'}
            onChange={() => setQuoteStyle('default')}
          />
          <div className="radio-content">
            <span className="radio-title">经典样式</span>
            <div className="style-preview">
              <div className="preview-bubble default">
                <div className="preview-quote">
                  张三: 那天去爬山的照片...
                </div>
                <div className="preview-text">
                  拍得真不错！
                </div>
              </div>
              <img src="./logo.png" className="preview-avatar" alt="我" />
            </div>
          </div>
        </label>

        <label className={`radio-label ${quoteStyle === 'wechat' ? 'active' : ''}`}>
          <input
            type="radio"
            name="quoteStyle"
            value="wechat"
            checked={quoteStyle === 'wechat'}
            onChange={() => setQuoteStyle('wechat')}
          />
          <div className="radio-content">
            <span className="radio-title">新版样式</span>
            <div className="style-preview">
              <div className="preview-group">
                <div className="preview-bubble wechat">
                  拍得真不错！
                </div>
                <div className="preview-quote-bubble">
                  张三: 那天去爬山的照片...
                </div>
              </div>
              <img src="./logo.png" className="preview-avatar" alt="我" />
            </div>
          </div>
        </label>
      </div>
    </div>
  )

  const renderDatabaseTab = () => (
    <div className="tab-content">
      {/* 引导窗口按钮 */}
      <div className="form-group">
        <button className="btn btn-secondary" onClick={handleOpenWelcomeWindow}>
          <Zap size={16} /> 打开配置引导窗口
        </button>
        <span className="form-hint">使用引导窗口一步步完成配置</span>
      </div>

      {/* 数据库解密部分 */}
      <h3 className="section-title">数据库解密（已支持自动更新）</h3>

      <div className="form-group">
        <label>解密密钥</label>
        <span className="form-hint">64位十六进制密钥</span>
        <div className="input-with-toggle">
          <input type={showDecryptKey ? 'text' : 'password'} placeholder="例如: a1b2c3d4e5f6..." value={decryptKey} onChange={(e) => setDecryptKey(e.target.value)} />
          <button type="button" className="toggle-visibility" onClick={() => setShowDecryptKey(!showDecryptKey)}>
            {showDecryptKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {keyStatus && <span className="key-status">{keyStatus}</span>}
        <div className="btn-row">
          <button className="btn btn-primary" onClick={handleGetKey} disabled={isGettingKey}>
            <Key size={16} /> {isGettingKey ? '获取中...' : '自动获取密钥'}
          </button>
          {isGettingKey && <button className="btn btn-secondary" onClick={handleCancelGetKey}><X size={16} /> 取消</button>}
        </div>
      </div>

      <div className="form-group">
        <label>数据库根目录</label>
        <span className="form-hint">xwechat_files 目录</span>
        <input type="text" placeholder="例如: C:\Users\xxx\Documents\xwechat_files" value={dbPath} onChange={(e) => setDbPath(e.target.value)} />
        <button className="btn btn-primary" onClick={handleSelectDbPath}><FolderOpen size={16} /> 浏览选择</button>
      </div>

      <div className="form-group">
        <label>账号 wxid</label>
        <span className="form-hint">微信账号标识（只包含 db_storage 子目录的文件夹会被识别）</span>
        <input
          type="text"
          placeholder="例如: wxid_xxxxxx"
          value={wxid}
          onChange={(e) => setWxid(e.target.value)}
        />
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={handleScanWxid} disabled={isScanningWxid}>
            <Search size={16} /> {isScanningWxid ? '扫描中...' : '扫描 wxid'}
          </button>
        </div>

        {/* 多账号选择列表 */}
        {showWxidDropdown && wxidOptions.length > 1 && (
          <>
            <div className="wxid-backdrop" onClick={() => setShowWxidDropdown(false)} />
            <div className="wxid-select-list">
              <div className="wxid-select-header">
                <span>检测到 {wxidOptions.length} 个账号，请选择：</span>
              </div>
              {wxidOptions.map((opt) => (
                <div
                  key={opt}
                  className={`wxid-select-item ${opt === wxid ? 'active' : ''}`}
                  onClick={() => handleSelectWxid(opt)}
                >
                  {opt}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="form-group">
        <label>缓存目录 <span className="optional">(可选)</span></label>
        <span className="form-hint">留空使用默认目录，尽可能不选择C盘</span>
        <input type="text" placeholder="留空使用默认目录" value={cachePath} onChange={(e) => setCachePath(e.target.value)} />
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={handleSelectCachePath}><FolderOpen size={16} /> 浏览选择</button>
          <button className="btn btn-secondary" onClick={() => setCachePath('')}><RotateCcw size={16} /> 恢复默认</button>
        </div>
      </div>

      <div className="form-group">
        <div className="toggle-setting">
          <div className="toggle-header">
            <label className="toggle-label">
              <span className="toggle-title">跳过数据库完整性检查</span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={skipIntegrityCheck}
                  onChange={(e) => setSkipIntegrityCheck(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </span>
            </label>
          </div>
          <div className="toggle-description">
            <p>启用后将跳过更新时的数据库完整性验证，可以加快更新速度并减少界面卡顿。</p>
            <p className="toggle-warning">
              <AlertCircle size={14} />
              注意：关闭完整性检查可能会错过损坏的数据库文件。
            </p>
          </div>
        </div>
      </div>

      {/* 图片解密部分 */}
      <h3 className="section-title" style={{ marginTop: '2rem' }}>图片解密</h3>
      <p className="section-desc">您只负责获取密钥，其他的交给密语-CipherTalk</p>

      <div className="form-group">
        <label>XOR 密钥</label>
        <span className="form-hint">2位十六进制，如 0x53</span>
        <div className="input-with-toggle">
          <input type={showXorKey ? 'text' : 'password'} placeholder="例如: 0x12" value={imageXorKey} onChange={(e) => setImageXorKey(e.target.value)} />
          <button type="button" className="toggle-visibility" onClick={() => setShowXorKey(!showXorKey)}>
            {showXorKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>AES 密钥</label>
        <span className="form-hint">至少16个字符（V4版本图片需要）</span>
        <div className="input-with-toggle">
          <input type={showAesKey ? 'text' : 'password'} placeholder="例如: b123456789012345..." value={imageAesKey} onChange={(e) => setImageAesKey(e.target.value)} />
          <button type="button" className="toggle-visibility" onClick={() => setShowAesKey(!showAesKey)}>
            {showAesKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {imageKeyStatus && <p className="key-status">{imageKeyStatus}</p>}

      <button className="btn btn-primary" onClick={handleGetImageKey} disabled={isGettingImageKey}>
        <ImageIcon size={16} /> {isGettingImageKey ? '获取中...' : '自动获取图片密钥'}
      </button>
    </div>
  )

  const [isGettingImageKey, setIsGettingImageKey] = useState(false)
  const [imageKeyStatus, setImageKeyStatus] = useState('')

  const handleGetImageKey = async () => {
    if (isGettingImageKey) return
    if (!dbPath) {
      showMessage('请先配置数据库路径', false)
      return
    }
    if (!wxid) {
      showMessage('请先配置 wxid', false)
      return
    }

    setIsGettingImageKey(true)
    setImageKeyStatus('正在检查微信进程...')

    try {
      const isRunning = await window.electronAPI.wxKey.isWeChatRunning()
      if (!isRunning) {
        showMessage('请先启动微信并登录', false)
        setImageKeyStatus('')
        setIsGettingImageKey(false)
        return
      }

      // 构建用户目录路径
      const userDir = `${dbPath}\\${wxid}`

      const removeListener = window.electronAPI.imageKey.onProgress((msg) => {
        setImageKeyStatus(msg)
      })

      const result = await window.electronAPI.imageKey.getImageKeys(userDir)
      removeListener()

      if (result.success) {
        if (result.xorKey !== undefined) {
          const xorKeyHex = `0x${result.xorKey.toString(16).padStart(2, '0')}`
          setImageXorKey(xorKeyHex)
          await configService.setImageXorKey(xorKeyHex)
        }
        if (result.aesKey) {
          setImageAesKey(result.aesKey)
          await configService.setImageAesKey(result.aesKey)
        }
        showMessage('图片密钥获取成功！', true)
        setImageKeyStatus('')
      } else {
        showMessage(result.error || '获取图片密钥失败', false)
        setImageKeyStatus('')
      }
    } catch (e) {
      showMessage(`获取图片密钥失败: ${e}`, false)
      setImageKeyStatus('')
    } finally {
      setIsGettingImageKey(false)
    }
  }

  // ========== 语音转文字 (STT) 相关状态 ==========
  const [sttModelStatus, setSttModelStatus] = useState<{ exists: boolean; sizeBytes?: number } | null>(null)
  const [isLoadingSttStatus, setIsLoadingSttStatus] = useState(false)
  const [isDownloadingSttModel, setIsDownloadingSttModel] = useState(false)
  const [sttDownloadProgress, setSttDownloadProgress] = useState(0)

  // 加载 STT 模型状态
  useEffect(() => {
    if (activeTab === 'stt') {
      loadSttModelStatus()
    }
  }, [activeTab])

  // 监听 STT 下载进度
  useEffect(() => {
    const removeListener = window.electronAPI.stt.onDownloadProgress((progress) => {
      setSttDownloadProgress(progress.percent || 0)
    })
    return () => removeListener()
  }, [])

  const loadSttModelStatus = async () => {
    setIsLoadingSttStatus(true)
    try {
      const result = await window.electronAPI.stt.getModelStatus()
      if (result.success) {
        setSttModelStatus({
          exists: result.exists || false,
          sizeBytes: result.sizeBytes
        })
      }
    } catch (e) {
      console.error('获取 STT 模型状态失败:', e)
    } finally {
      setIsLoadingSttStatus(false)
    }
  }

  const handleDownloadSttModel = async () => {
    if (isDownloadingSttModel) return
    setIsDownloadingSttModel(true)
    setSttDownloadProgress(0)

    try {
      showMessage('正在下载语音识别模型...', true)
      const result = await window.electronAPI.stt.downloadModel()
      if (result.success) {
        showMessage('语音识别模型下载完成！', true)
        await loadSttModelStatus()
      } else {
        showMessage(result.error || '模型下载失败', false)
      }
    } catch (e) {
      showMessage(`模型下载失败: ${e}`, false)
    } finally {
      setIsDownloadingSttModel(false)
    }
  }

  const handleSttLanguageToggle = async (lang: string) => {
    if (sttLanguages.includes(lang) && sttLanguages.length === 1) {
      showMessage('必须至少选择一种语言', false)
      return
    }

    const newLangs = sttLanguages.includes(lang)
      ? sttLanguages.filter(l => l !== lang)
      : [...sttLanguages, lang]
    setSttLanguagesState(newLangs)
    await configService.setSttLanguages(newLangs)
  }

  const handleSttModelTypeChange = async (type: 'int8' | 'float32') => {
    if (type === sttModelType) return

    // 如果已下载模型，切换类型需要重新下载
    if (sttModelStatus?.exists) {
      const confirmSwitch = confirm(
        `切换模型类型需要重新下载模型。\n\n` +
        `当前: ${sttModelTypeOptions.find(o => o.value === sttModelType)?.label}\n` +
        `切换到: ${sttModelTypeOptions.find(o => o.value === type)?.label} (${sttModelTypeOptions.find(o => o.value === type)?.size})\n\n` +
        `确定要切换吗？`
      )
      if (!confirmSwitch) return

      // 清除当前模型
      try {
        await window.electronAPI.stt.clearModel()
      } catch (e) {
        console.error('清除模型失败:', e)
      }
    }

    setSttModelType(type)
    await configService.setSttModelType(type)
    await loadSttModelStatus()
    showMessage(`模型类型已切换为 ${sttModelTypeOptions.find(o => o.value === type)?.label}`, true)
  }

  const renderSttTab = () => (
    <div className="tab-content">
      <h3 className="section-title">语音识别模型</h3>
      <p className="section-desc">
        使用 SenseVoice 模型进行本地离线语音转文字，支持中文、英语、日语、韩语、粤语。
        选择合适的模型版本后下载，仅需下载一次。
      </p>

      <h4 className="subsection-title" style={{ marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 500 }}>模型版本</h4>
      <div className="model-type-grid">
        {sttModelTypeOptions.map(opt => (
          <label
            key={opt.value}
            className={`model-card ${sttModelType === opt.value ? 'active' : ''} ${isDownloadingSttModel ? 'disabled' : ''}`}
          >
            <input
              type="radio"
              name="sttModelType"
              value={opt.value}
              checked={sttModelType === opt.value}
              onChange={() => handleSttModelTypeChange(opt.value as 'int8' | 'float32')}
              disabled={isDownloadingSttModel}
            />
            <div className="model-icon">
              {opt.value === 'int8' ? <Zap size={24} /> : <Layers size={24} />}
            </div>
            <div className="model-info">
              <div className="model-header">
                <span className="model-name">{opt.label}</span>
                <span className="model-size">{opt.size}</span>
              </div>
              <span className="model-desc">{opt.desc}</span>
            </div>
            {sttModelType === opt.value && <div className="model-check"><Check size={14} /></div>}
          </label>
        ))}
      </div>

      <div className="stt-model-status">
        {isLoadingSttStatus ? (
          <p>正在检查模型状态...</p>
        ) : sttModelStatus ? (
          <div className="model-info">
            <div className={`status-indicator ${sttModelStatus.exists ? 'ready' : 'missing'}`}>
              {sttModelStatus.exists ? (
                <>
                  <CheckCircle size={20} />
                  <span>模型已就绪</span>
                </>
              ) : (
                <>
                  <AlertCircle size={20} />
                  <span>模型未下载</span>
                </>
              )}
            </div>
            {sttModelStatus.exists && sttModelStatus.sizeBytes && (
              <p className="model-size">模型大小: {formatFileSize(sttModelStatus.sizeBytes)}</p>
            )}
          </div>
        ) : (
          <p>无法获取模型状态</p>
        )}
      </div>

      {isDownloadingSttModel && (
        <div className="download-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${sttDownloadProgress}%` }} />
          </div>
          <span className="progress-text">{sttDownloadProgress.toFixed(1)}%</span>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>支持语言</h3>
      <p className="section-desc">选择需要识别的语言，支持多选。若选择多种语言，模型将自动检测。</p>
      <div className="language-grid">
        {sttLanguageOptions.map(opt => (
          <label
            key={opt.value}
            className={`language-card ${sttLanguages.includes(opt.value) ? 'active' : ''}`}
          >
            <input
              type="checkbox"
              checked={sttLanguages.includes(opt.value)}
              onChange={() => handleSttLanguageToggle(opt.value)}
              disabled={sttLanguages.includes(opt.value) && sttLanguages.length === 1}
            />
            <div className="lang-info">
              <span className="lang-name">{opt.label}</span>
              <span className="lang-en">{opt.enLabel}</span>
            </div>
            {sttLanguages.includes(opt.value) && <div className="lang-check"><Check size={14} /></div>}
          </label>
        ))}
      </div>

      <div className="btn-row" style={{ marginTop: '1rem' }}>
        {!sttModelStatus?.exists && (
          <button
            className="btn btn-primary"
            onClick={handleDownloadSttModel}
            disabled={isDownloadingSttModel}
          >
            <Download size={16} /> {isDownloadingSttModel ? '下载中...' : '下载模型'}
          </button>
        )}
        {sttModelStatus?.exists && (
          <button
            className="btn btn-danger"
            onClick={async () => {
              const currentModelSize = sttModelTypeOptions.find(o => o.value === sttModelType)?.size || '235 MB'
              if (confirm(`确定要清除语音识别模型吗？下次使用需要重新下载 (${currentModelSize})。`)) {
                try {
                  const result = await window.electronAPI.stt.clearModel()
                  if (result.success) {
                    showMessage('模型清除成功', true)
                    await loadSttModelStatus()
                  } else {
                    showMessage(result.error || '模型清除失败', false)
                  }
                } catch (e) {
                  showMessage(`模型清除失败: ${e}`, false)
                }
              }
            }}
          >
            <Trash2 size={16} /> 清除模型
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={loadSttModelStatus}
          disabled={isLoadingSttStatus}
        >
          <RefreshCw size={16} className={isLoadingSttStatus ? 'spin' : ''} /> 刷新状态
        </button>
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>使用说明</h3>
      <div className="stt-instructions">
        <ol>
          <li>首先下载语音识别模型（仅需一次）</li>
          <li>在聊天记录中点击语音消息</li>
          <li>点击"转文字"按钮即可将语音转换为文字</li>
        </ol>
        <p className="note">
          <strong>注意：</strong>所有语音识别均在本地完成，不会上传任何数据，保护您的隐私。
        </p>
      </div>
    </div >
  )

  const renderDataManagementTab = () => (
    <div className="tab-content">
      {/* 导出设置 */}
      <section className="settings-section">
        <h3 className="section-title">导出设置</h3>

        <div className="form-group">
          <label>导出目录</label>
          <span className="form-hint">聊天记录导出的默认保存位置</span>
          <input type="text" placeholder={defaultExportPath || '系统下载目录'} value={exportPath || defaultExportPath} onChange={(e) => setExportPath(e.target.value)} />
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={handleSelectExportPath}><FolderOpen size={16} /> 浏览选择</button>
            <button className="btn btn-secondary" onClick={handleResetExportPath}><RotateCcw size={16} /> 恢复默认</button>
          </div>
        </div>

        <div className="form-group">
          <label>默认日期范围</label>
          <span className="form-hint">导出时自动填充的日期范围，0表示不限制</span>
          <div className="date-range-options">
            {[
              { value: 0, label: '不限制', desc: '全部消息' },
              { value: 1, label: '今天', desc: '仅今日消息' },
              { value: 7, label: '最近7天', desc: '过去一周' },
              { value: 30, label: '最近30天', desc: '过去一个月' },
              { value: 90, label: '最近90天', desc: '过去三个月' },
              { value: 180, label: '最近180天', desc: '过去半年' },
              { value: 365, label: '最近1年', desc: '过去一年' }
            ].map(option => (
              <label
                key={option.value}
                className={`date-range-card ${exportDefaultDateRange === option.value ? 'active' : ''}`}
              >
                <input
                  type="radio"
                  name="exportDefaultDateRange"
                  value={option.value}
                  checked={exportDefaultDateRange === option.value}
                  onChange={(e) => setExportDefaultDateRange(Number(e.target.value))}
                />
                <div className="date-range-content">
                  <span className="date-range-label">{option.label}</span>
                  <span className="date-range-desc">{option.desc}</span>
                </div>
                {exportDefaultDateRange === option.value && (
                  <div className="date-range-check"><Check size={14} /></div>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>默认导出选项</label>
          <div className="export-default-options">
            <label className={`export-option-card ${exportDefaultAvatars ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={exportDefaultAvatars}
                onChange={(e) => setExportDefaultAvatars(e.target.checked)}
              />
              <div className="option-content">
                <div className="option-icon">
                  <User size={20} />
                </div>
                <div className="option-info">
                  <span className="option-label">默认导出头像</span>
                  <span className="option-desc">勾选后导出时默认包含头像</span>
                </div>
              </div>
              {exportDefaultAvatars && (
                <div className="option-check"><Check size={14} /></div>
              )}
            </label>
          </div>
        </div>
      </section>

      <div className="divider" style={{ margin: '2rem 0', borderBottom: '1px solid var(--border-color)', opacity: 0.1 }} />

      {/* 缓存管理 */}
      <section className="settings-section">
        <h3 className="section-title">缓存管理</h3>
        <div className="cache-stats">
          {isLoadingCacheSize ? (
            <p>正在计算缓存大小...</p>
          ) : cacheSize ? (
            <div className="cache-info">
              <div className="cache-item">
                <span className="label">图片缓存:</span>
                <span className="value">{formatFileSize(cacheSize.images)}</span>
              </div>
              <div className="cache-item">
                <span className="label">表情包缓存:</span>
                <span className="value">{formatFileSize(cacheSize.emojis)}</span>
              </div>
              <div className="cache-item">
                <span className="label">数据库缓存:</span>
                <span className="value">{formatFileSize(cacheSize.databases)}</span>
              </div>
              <div className="cache-item total">
                <span className="label">总计:</span>
                <span className="value">{formatFileSize(cacheSize.total)}</span>
              </div>
            </div>
          ) : (
            <p>无法获取缓存信息</p>
          )}
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={handleClearImages}>
            <Trash2 size={16} /> 清除图片
          </button>
          <button className="btn btn-secondary" onClick={handleClearConfig}>
            <Trash2 size={16} /> 清除配置
          </button>
          <button className="btn btn-danger" onClick={handleClearAllCache}>
            <Trash2 size={16} /> 清除所有缓存
          </button>
        </div>
      </section>

      <div className="divider" style={{ margin: '2rem 0', borderBottom: '1px solid var(--border-color)', opacity: 0.1 }} />

      {/* 日志管理 */}
      <section className="settings-section">
        <h3 className="section-title">日志管理</h3>

        <div className="form-group">
          <div className="log-stats-lite" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
            <span className="log-value">日志文件: {logFiles.length}个</span>
            <span className="log-value">总大小: {formatFileSize(logSize)}</span>
            <span className="log-value">当前级别: {currentLogLevel}</span>
          </div>

          <div className="log-level-options" style={{ marginBottom: '1rem' }}>
            {['DEBUG', 'INFO', 'WARN', 'ERROR'].map((level) => (
              <button
                key={level}
                className={`log-level-btn ${currentLogLevel === level ? 'active' : ''}`}
                onClick={() => handleLogLevelChange(level)}
              >
                {level}
              </button>
            ))}
          </div>

          <div className="btn-row">
            <button className="btn btn-secondary" onClick={handleOpenLogDirectory}>
              <FolderOpen size={16} /> 打开日志目录
            </button>
            <button className="btn btn-secondary" onClick={loadLogFiles} disabled={isLoadingLogs}>
              <RefreshCw size={16} className={isLoadingLogs ? 'spin' : ''} /> 刷新
            </button>
            <button className="btn btn-danger" onClick={handleClearLogs}>
              <Trash2 size={16} /> 清除所有日志
            </button>
          </div>
        </div>

        <div className="log-files" style={{ marginTop: '1rem' }}>
          <h4>最近日志</h4>
          {isLoadingLogs ? (
            <p>正在加载...</p>
          ) : logFiles.length > 0 ? (
            <div className="log-file-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {logFiles.map((file) => (
                <div
                  key={file.name}
                  className={`log-file-item ${selectedLogFile === file.name ? 'selected' : ''}`}
                  onClick={() => handleLogFileSelect(file.name)}
                >
                  <div className="log-file-info">
                    <span className="log-file-name">{file.name}</span>
                    <span className="log-file-size">{formatFileSize(file.size)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>暂无日志文件</p>
          )}
        </div>

        {selectedLogFile && (
          <div className="log-content" style={{ marginTop: '1rem' }}>
            <div className="log-content-text" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <pre>{logContent}</pre>
            </div>
          </div>
        )}
      </section>
    </div>
  )





  const getTypeDisplayName = (type: string | null) => {
    if (!type) return '未激活'
    const typeMap: Record<string, string> = {
      '30days': '30天试用版',
      '90days': '90天标准版',
      '365days': '365天专业版',
      'permanent': '永久版'
    }
    return typeMap[type] || type
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '永久'
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const renderActivationTab = () => (
    <div className="tab-content activation-tab">
      <div className={`activation-status-card ${activationStatus?.isActivated ? 'activated' : 'inactive'}`}>
        <div className="status-icon">
          {activationStatus?.isActivated ? (
            <CheckCircle size={48} />
          ) : (
            <AlertCircle size={48} />
          )}
        </div>
        <div className="status-content">
          <h3>{activationStatus?.isActivated ? '已激活' : '未激活'}</h3>
          {activationStatus?.isActivated && (
            <>
              <p className="status-type">{getTypeDisplayName(activationStatus.type)}</p>
              {activationStatus.daysRemaining !== null && activationStatus.type !== 'permanent' && (
                <p className="status-expires">
                  <Clock size={14} />
                  {activationStatus.daysRemaining > 0
                    ? `剩余 ${activationStatus.daysRemaining} 天`
                    : '已过期'}
                </p>
              )}
              {activationStatus.expiresAt && (
                <p className="status-date">到期时间：{formatDate(activationStatus.expiresAt)}</p>
              )}
              {activationStatus.activatedAt && (
                <p className="status-date">激活时间：{formatDate(activationStatus.activatedAt)}</p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="device-info-card">
        <h4>设备信息</h4>
        <div className="device-id-row">
          <span className="label">设备标识：</span>
          <code>{activationStatus?.deviceId || '获取中...'}</code>
        </div>
      </div>

      <div className="activation-actions">
        <button className="btn btn-secondary" onClick={() => checkActivationStatus()}>
          <RefreshCw size={16} /> 刷新状态
        </button>
        <button className="btn btn-primary" onClick={() => window.electronAPI.window.openPurchaseWindow()}>
          <Key size={16} /> 获取激活码
        </button>
      </div>
    </div>
  )

  const location = useLocation()

  // 检查导航传递的更新信息
  useEffect(() => {
    if (location.state?.updateInfo) {
      setUpdateInfo(location.state.updateInfo)
    }
  }, [location.state])

  const renderAboutTab = () => (
    <div className="tab-content about-tab">
      <div className="about-card">
        <div className="about-logo">
          <img src="./logo.png" alt="密语" />
        </div>
        <h2 className="about-name">密语</h2>
        <p className="about-slogan">CipherTalk</p>
        <p className="about-version">v{appVersion || '...'}</p>

        <div className="about-update">
          {updateInfo?.hasUpdate ? (
            <>
              <p className="update-hint">新版本 v{updateInfo.version} 可用</p>
              {isDownloading ? (
                <div className="download-progress">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${downloadProgress}%` }} />
                  </div>
                  <span>{downloadProgress.toFixed(0)}%</span>
                </div>
              ) : (
                <button className="btn btn-primary" onClick={handleUpdateNow}>
                  <Download size={16} /> 立即更新
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-secondary" onClick={handleCheckUpdate} disabled={isCheckingUpdate}>
              <RefreshCw size={16} className={isCheckingUpdate ? 'spin' : ''} />
              {isCheckingUpdate ? '检查中...' : '检查更新'}
            </button>
          )}
        </div>
      </div>

      <div className="about-footer">
        <div className="github-capsules" style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px' }}>
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '20px' }}
            onClick={() => window.electronAPI.shell.openExternal('https://github.com/ILoveBingLu/miyu')}
          >
            <Github size={16} />
            <span>密语 CipherTalk</span>
          </button>
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '20px' }}
            onClick={() => window.electronAPI.shell.openExternal('https://github.com/hicccc77/WeFlow')}
          >
            <Github size={16} />
            <span>WeFlow</span>
          </button>
        </div>

        <p className="about-warning" style={{ color: '#ff4d4f', fontWeight: 500, marginBottom: '20px' }}>
          软件为免费，如果有人找你收钱，请骂死他，太贱了，拿别人东西卖钱！
        </p>

        <div className="about-links">
          <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI.shell.openExternal('https://miyu.aiqji.com') }}>官网</a>
          <span>·</span>
          <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI.shell.openExternal('https://chatlab.fun') }}>ChatLab</a>
          <span>·</span>
          <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI.window.openAgreementWindow() }}>用户协议</a>
        </div>
        <p className="copyright">© {new Date().getFullYear()} 密语-CipherTalk. All rights reserved.</p>
      </div>
    </div>
  )

  return (
    <div className="settings-page">
      {message && <div className={`message-toast ${message.success ? 'success' : 'error'}`}>{message.text}</div>}

      {/* 清除确认对话框 */}
      {showClearDialog && (
        <div className="clear-dialog-overlay">
          <div className="clear-dialog">
            <h3>{showClearDialog.title}</h3>
            <p>{showClearDialog.message}</p>
            <div className="dialog-actions">
              <button
                className="btn btn-danger"
                onClick={confirmClear}
              >
                确定
              </button>
              <button
                className="btn btn-secondary dialog-cancel"
                onClick={() => setShowClearDialog(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="settings-header">
        <h1>设置</h1>
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={handleTestConnection} disabled={isLoading || isTesting}>
            <Plug size={16} /> {isTesting ? '测试中...' : '测试连接'}
          </button>
          <button className="btn btn-primary" onClick={handleSaveConfig} disabled={isLoading}>
            <Save size={16} /> {isLoading ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>

      <div className="settings-tabs">
        {tabs.map(tab => (
          <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            <tab.icon size={16} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-body">
        {activeTab === 'appearance' && renderAppearanceTab()}
        {activeTab === 'database' && renderDatabaseTab()}
        {activeTab === 'stt' && renderSttTab()}
        {activeTab === 'ai' && (
          <AISummarySettings
            provider={aiProvider}
            setProvider={setAiProviderState}
            apiKey={aiApiKey}
            setApiKey={setAiApiKeyState}
            model={aiModel}
            setModel={setAiModelState}
            defaultTimeRange={aiDefaultTimeRange}
            setDefaultTimeRange={setAiDefaultTimeRangeState}
            summaryDetail={aiSummaryDetail}
            setSummaryDetail={setAiSummaryDetailState}
            enableThinking={aiEnableThinking}
            setEnableThinking={setAiEnableThinkingState}
            showMessage={showMessage}
          />
        )}
        {activeTab === 'data' && renderDataManagementTab()}
        {activeTab === 'activation' && renderActivationTab()}
        {activeTab === 'about' && renderAboutTab()}
      </div>
    </div>
  )
}

export default SettingsPage
