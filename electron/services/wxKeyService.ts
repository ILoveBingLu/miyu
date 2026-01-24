import { spawn, execSync } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, copyFileSync, readdirSync, unlinkSync, statSync } from 'fs'

export class WxKeyService {
  private lib: any = null
  private pollingTimer: NodeJS.Timeout | null = null
  private onKeyReceived: ((key: string) => void) | null = null
  private onStatus: ((status: string, level: number) => void) | null = null

  /**
   * 获取 DLL 路径
   */
  getDllPath(): string {
    // 开发环境: dist-electron/ -> resources/
    // 打包环境: resources/resources/
    const resourcesPath = app.isPackaged
      ? join(process.resourcesPath, 'resources')
      : join(app.getAppPath(), 'resources')
    
    return join(resourcesPath, 'wx_key.dll')
  }

  /**
   * 检查微信进程是否运行 (仅微信4.x Weixin.exe)
   */
  isWeChatRunning(): boolean {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq Weixin.exe" /NH', { encoding: 'utf8' })
      return result.toLowerCase().includes('weixin.exe')
    } catch {
      return false
    }
  }

  /**
   * 获取微信进程 PID (仅微信4.x Weixin.exe)
   */
  getWeChatPid(): number | null {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq Weixin.exe" /FO CSV /NH', { encoding: 'utf8' })
      const lines = result.trim().split('\n')
      
      for (const line of lines) {
        if (line.toLowerCase().includes('weixin.exe')) {
          const parts = line.split(',')
          if (parts.length >= 2) {
            const pid = parseInt(parts[1].replace(/"/g, ''), 10)
            if (!isNaN(pid)) {
              return pid
            }
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * 关闭微信进程 (仅微信4.x Weixin.exe)
   */
  killWeChat(): boolean {
    try {
      execSync('taskkill /F /IM Weixin.exe', { encoding: 'utf8' })
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取微信安装路径 (仅微信4.x Weixin.exe)
   */
  getWeChatPath(): string | null {
    // 从注册表查找
    try {
      // 查找 Uninstall 注册表
      const regPaths = [
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
      ]

      for (const regPath of regPaths) {
        try {
          const result = execSync(`reg query "${regPath}" /s /f "WeChat" 2>nul`, { encoding: 'utf8' })
          const match = result.match(/InstallLocation\s+REG_SZ\s+(.+)/i)
          if (match) {
            const installPath = match[1].trim()
            // 只查找 Weixin.exe (微信4.x)
            const weixinPath = join(installPath, 'Weixin.exe')
            if (existsSync(weixinPath)) {
              return weixinPath
            }
          }
        } catch {
          continue
        }
      }

      // 查找 Tencent 注册表
      const tencentKeys = [
        'HKCU\\Software\\Tencent\\WeChat',
        'HKCU\\Software\\Tencent\\Weixin',
        'HKLM\\Software\\Tencent\\WeChat'
      ]

      for (const key of tencentKeys) {
        try {
          const result = execSync(`reg query "${key}" /v InstallPath 2>nul`, { encoding: 'utf8' })
          const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i)
          if (match) {
            const installPath = match[1].trim()
            const weixinPath = join(installPath, 'Weixin.exe')
            if (existsSync(weixinPath)) {
              return weixinPath
            }
          }
        } catch {
          continue
        }
      }
    } catch {}

    // 常见路径 - 只查找 Weixin.exe
    const drives = ['C', 'D', 'E', 'F']
    const pathPatterns = [
      '\\Program Files\\Tencent\\WeChat\\Weixin.exe',
      '\\Program Files (x86)\\Tencent\\WeChat\\Weixin.exe'
    ]

    for (const drive of drives) {
      for (const pattern of pathPatterns) {
        const fullPath = `${drive}:${pattern}`
        if (existsSync(fullPath)) {
          return fullPath
        }
      }
    }

    return null
  }

  /**
   * 启动微信
   */
  async launchWeChat(customPath?: string): Promise<boolean> {
    const wechatPath = customPath || this.getWeChatPath()
    if (!wechatPath) {
      return false
    }

    try {
      spawn(wechatPath, [], { detached: true, stdio: 'ignore' }).unref()
      
      // 等待微信启动
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      return this.isWeChatRunning()
    } catch {
      return false
    }
  }

  /**
   * 等待微信窗口出现
   */
  async waitForWeChatWindow(maxWaitSeconds = 15): Promise<boolean> {
    for (let i = 0; i < maxWaitSeconds * 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // 检查 Weixin.exe 或 WeChat.exe 进程
      const pid = this.getWeChatPid()
      if (pid !== null) {
        return true
      }
    }
    return false
  }

  /**
   * 初始化 DLL (使用 koffi)
   */
  async initialize(): Promise<boolean> {
    try {
      const koffi = require('koffi')
      const dllPath = this.getDllPath()
      
      console.log('加载 DLL:', dllPath)
      
      if (!existsSync(dllPath)) {
        console.error('DLL 文件不存在:', dllPath)
        return false
      }

      this.lib = koffi.load(dllPath)

      return true
    } catch (e) {
      console.error('初始化 DLL 失败:', e)
      return false
    }
  }

  /**
   * 安装 Hook
   */
  installHook(
    targetPid: number,
    onKeyReceived: (key: string) => void,
    onStatus?: (status: string, level: number) => void
  ): boolean {
    if (!this.lib) {
      return false
    }

    try {
      const koffi = require('koffi')
      
      this.onKeyReceived = onKeyReceived
      this.onStatus = onStatus || null

      // 定义函数
      const InitializeHook = this.lib.func('bool InitializeHook(uint32_t)')
      const success = InitializeHook(targetPid)
      
      if (success) {
        this.startPolling()
      }

      return success
    } catch (e) {
      console.error('安装 Hook 失败:', e)
      return false
    }
  }

  /**
   * 开始轮询
   */
  private startPolling(): void {
    this.stopPolling()
    
    this.pollingTimer = setInterval(() => {
      this.pollData()
    }, 100)
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  /**
   * 轮询数据
   */
  private pollData(): void {
    if (!this.lib) return

    try {
      const koffi = require('koffi')
      
      // 定义函数
      const PollKeyData = this.lib.func('bool PollKeyData(char*, int32_t)')
      const GetStatusMessage = this.lib.func('bool GetStatusMessage(char*, int32_t, int32_t*)')
      
      // 轮询密钥
      const keyBuffer = Buffer.alloc(65)
      if (PollKeyData(keyBuffer, 65)) {
        const key = keyBuffer.toString('utf8').replace(/\0/g, '').trim()
        console.log('轮询到密钥:', key, '长度:', key.length)
        if (key && this.onKeyReceived) {
          this.onKeyReceived(key)
        }
      }

      // 轮询状态消息
      for (let i = 0; i < 5; i++) {
        const statusBuffer = Buffer.alloc(256)
        const levelBuffer = Buffer.alloc(4)
        
        if (GetStatusMessage(statusBuffer, 256, levelBuffer)) {
          const status = statusBuffer.toString('utf8').replace(/\0/g, '').trim()
          const level = levelBuffer.readInt32LE(0)
          
          if (this.onStatus) {
            this.onStatus(status, level)
          }
        } else {
          break
        }
      }
    } catch (e) {
      console.error('轮询数据失败:', e)
    }
  }

  /**
   * 卸载 Hook
   */
  uninstallHook(): boolean {
    this.stopPolling()
    
    if (!this.lib) {
      return false
    }

    try {
      const CleanupHook = this.lib.func('bool CleanupHook()')
      return CleanupHook()
    } catch {
      return false
    }
  }

  /**
   * 获取最后错误信息
   */
  getLastError(): string {
    if (!this.lib) {
      return '未知错误'
    }

    try {
      const GetLastErrorMsg = this.lib.func('const char* GetLastErrorMsg()')
      return GetLastErrorMsg() || '无错误'
    } catch {
      return '获取错误信息失败'
    }
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.uninstallHook()
    this.lib = null
    this.onKeyReceived = null
    this.onStatus = null
  }

  /**
   * 检测当前登录的微信账号
   * 通过扫描数据库目录下的账号目录，根据最近修改时间判断当前活跃账号
   * @param dbPath 数据库根路径
   * @param maxTimeDiffMinutes 最大时间差（分钟），默认5分钟
   */
  detectCurrentAccount(dbPath?: string, maxTimeDiffMinutes: number = 5): { wxid: string; dbPath: string } | null {
    try {
      if (!dbPath) {
        return null
      }

      if (!existsSync(dbPath)) {
        return null
      }

      const now = Date.now()
      const maxTimeDiffMs = maxTimeDiffMinutes * 60 * 1000
      let bestMatch: { wxid: string; dbPath: string; timeDiff: number } | null = null
      let fallbackMatch: { wxid: string; dbPath: string; timeDiff: number } | null = null

      // 遍历数据库目录下的所有账号目录
      const entries = readdirSync(dbPath, { withFileTypes: true })
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        
        const accountDirName = entry.name
        const accountDir = join(dbPath, accountDirName)
        
        // 检查是否是有效的账号目录（包含 db_storage）
        const dbStorageDir = join(accountDir, 'db_storage')
        if (!existsSync(dbStorageDir)) continue

        // 过滤掉系统目录
        if (this.isSystemDirectory(accountDirName)) continue

        // 获取账号目录的最近活动时间
        const modifiedTime = this.getAccountModifiedTime(accountDir)
        const timeDiff = Math.abs(now - modifiedTime)
        
        // 检查是否在时间范围内
        if (timeDiff <= maxTimeDiffMs) {
          if (!bestMatch || timeDiff < bestMatch.timeDiff) {
            bestMatch = {
              wxid: accountDirName,
              dbPath: accountDir,
              timeDiff
            }
          }
        }

        // 记录最近的账号作为备选（即使超过时间限制）
        if (!fallbackMatch || timeDiff < fallbackMatch.timeDiff) {
          fallbackMatch = {
            wxid: accountDirName,
            dbPath: accountDir,
            timeDiff
          }
        }
      }

      if (bestMatch) {
        return { wxid: bestMatch.wxid, dbPath: bestMatch.dbPath }
      }

      // 如果没有在时间范围内的账号，但有备选账号，询问用户是否使用
      if (fallbackMatch) {
        // 如果只有一个有效账号，直接使用（不管时间差）
        if (entries.filter(e => e.isDirectory() && 
            existsSync(join(dbPath, e.name, 'db_storage')) && 
            !this.isSystemDirectory(e.name)).length === 1) {
          return { wxid: fallbackMatch.wxid, dbPath: fallbackMatch.dbPath }
        }
        
        // 如果时间差在24小时内，自动使用这个账号
        if (fallbackMatch.timeDiff <= 24 * 60 * 60 * 1000) {
          return { wxid: fallbackMatch.wxid, dbPath: fallbackMatch.dbPath }
        }
      }

      return null
    } catch (e) {
      return null
    }
  }

  /**
   * 判断是否为系统目录
   */
  private isSystemDirectory(name: string): boolean {
    const lower = name.toLowerCase()
    const systemDirs = ['all', 'applet', 'backup', 'wmpf', 'system', 'temp', 'cache']
    return systemDirs.some(dir => lower.startsWith(dir))
  }

  /**
   * 获取账号目录的最近修改时间
   * 直接返回账号目录本身的修改时间
   */
  private getAccountModifiedTime(accountDir: string): number {
    try {
      const stats = statSync(accountDir)
      return stats.mtimeMs
    } catch {
      return 0
    }
  }
}

// 单例
export const wxKeyService = new WxKeyService()
