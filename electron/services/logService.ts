import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { ConfigService } from './config'

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  category: string
  message: string
  data?: any
}

export class LogService {
  private configService: ConfigService
  private logDir: string = ''
  private maxLogFiles: number = 10
  private maxLogFileSize: number = 10 * 1024 * 1024 // 10MB
  private minLogLevel: LogLevel = LogLevel.WARN // 默认只记录警告及以上级别

  constructor(configService: ConfigService) {
    this.configService = configService
    this.initLogDirectory()
    this.loadLogLevel()
  }

  /**
   * 加载日志级别配置
   */
  private loadLogLevel(): void {
    try {
      // 从配置中读取日志级别，默认为WARN
      const logLevel = this.configService.get('logLevel' as any) || 'WARN'
      switch (logLevel.toUpperCase()) {
        case 'DEBUG':
          this.minLogLevel = LogLevel.DEBUG
          break
        case 'INFO':
          this.minLogLevel = LogLevel.INFO
          break
        case 'WARN':
          this.minLogLevel = LogLevel.WARN
          break
        case 'ERROR':
          this.minLogLevel = LogLevel.ERROR
          break
        default:
          this.minLogLevel = LogLevel.WARN
      }
    } catch (e) {
      this.minLogLevel = LogLevel.WARN
    }
  }

  /**
   * 设置日志级别
   */
  setLogLevel(level: LogLevel): void {
    this.minLogLevel = level
    const levelName = LogLevel[level]
    this.configService.set('logLevel' as any, levelName)
  }

  /**
   * 获取当前日志级别
   */
  getLogLevel(): LogLevel {
    return this.minLogLevel
  }
  private initLogDirectory(): void {
    try {
      const cachePath = this.configService.get('cachePath')
      if (cachePath) {
        this.logDir = join(cachePath, 'logs')
      } else {
        // 使用默认缓存目录
        const { app } = require('electron')
        const defaultCachePath = join(app.getPath('userData'), 'cache')
        this.logDir = join(defaultCachePath, 'logs')
      }

      // 确保日志目录存在
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true })
      }

      // 清理旧日志文件
      this.cleanupOldLogs()
    } catch (e) {
      console.error('初始化日志目录失败:', e)
    }
  }

  /**
   * 获取当前日志文件路径
   */
  private getCurrentLogFile(): string {
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return join(this.logDir, `ciphertalk-${today}.log`)
  }

  /**
   * 格式化日志条目
   */
  private formatLogEntry(entry: LogEntry): string {
    const levelName = LogLevel[entry.level]
    let logLine = `[${entry.timestamp}] [${levelName}] [${entry.category}] ${entry.message}`
    
    if (entry.data) {
      try {
        logLine += ` | Data: ${JSON.stringify(entry.data)}`
      } catch (e) {
        logLine += ` | Data: [Circular or Invalid JSON]`
      }
    }
    
    return logLine + '\n'
  }

  /**
   * 写入日志
   */
  private writeLog(level: LogLevel, category: string, message: string, data?: any): void {
    try {
      // 检查日志级别，只记录达到最小级别的日志
      if (level < this.minLogLevel) {
        return
      }

      // 重新初始化日志目录（以防缓存路径发生变化）
      this.initLogDirectory()

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        data
      }

      const logFile = this.getCurrentLogFile()
      const formattedEntry = this.formatLogEntry(entry)

      // 检查文件大小，如果超过限制则轮转
      if (existsSync(logFile)) {
        const stats = statSync(logFile)
        if (stats.size > this.maxLogFileSize) {
          this.rotateLogFile(logFile)
        }
      }

      appendFileSync(logFile, formattedEntry, 'utf8')
    } catch (e) {
      console.error('写入日志失败:', e)
    }
  }

  /**
   * 轮转日志文件
   */
  private rotateLogFile(logFile: string): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const rotatedFile = logFile.replace('.log', `-${timestamp}.log`)
      
      // 重命名当前日志文件
      require('fs').renameSync(logFile, rotatedFile)
    } catch (e) {
      console.error('轮转日志文件失败:', e)
    }
  }

  /**
   * 清理旧日志文件
   */
  private cleanupOldLogs(): void {
    try {
      if (!existsSync(this.logDir)) return

      const files = readdirSync(this.logDir)
        .filter(file => file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: join(this.logDir, file),
          mtime: statSync(join(this.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

      // 保留最新的 maxLogFiles 个文件，删除其余的
      if (files.length > this.maxLogFiles) {
        const filesToDelete = files.slice(this.maxLogFiles)
        for (const file of filesToDelete) {
          try {
            unlinkSync(file.path)
          } catch (e) {
            console.error(`删除旧日志文件失败: ${file.name}`, e)
          }
        }
      }
    } catch (e) {
      console.error('清理旧日志失败:', e)
    }
  }

  /**
   * 记录调试信息
   */
  debug(category: string, message: string, data?: any): void {
    this.writeLog(LogLevel.DEBUG, category, message, data)
  }

  /**
   * 记录一般信息
   */
  info(category: string, message: string, data?: any): void {
    this.writeLog(LogLevel.INFO, category, message, data)
  }

  /**
   * 记录警告信息
   */
  warn(category: string, message: string, data?: any): void {
    this.writeLog(LogLevel.WARN, category, message, data)
  }

  /**
   * 记录错误信息
   */
  error(category: string, message: string, data?: any): void {
    this.writeLog(LogLevel.ERROR, category, message, data)
  }

  /**
   * 获取日志文件列表
   */
  getLogFiles(): Array<{ name: string; size: number; mtime: Date }> {
    try {
      if (!existsSync(this.logDir)) return []

      return readdirSync(this.logDir)
        .filter(file => file.endsWith('.log'))
        .map(file => {
          const filePath = join(this.logDir, file)
          const stats = statSync(filePath)
          return {
            name: file,
            size: stats.size,
            mtime: stats.mtime
          }
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    } catch (e) {
      console.error('获取日志文件列表失败:', e)
      return []
    }
  }

  /**
   * 读取日志文件内容
   */
  readLogFile(filename: string): string {
    try {
      const filePath = join(this.logDir, filename)
      if (!existsSync(filePath)) {
        throw new Error('日志文件不存在')
      }
      return require('fs').readFileSync(filePath, 'utf8')
    } catch (e) {
      console.error('读取日志文件失败:', e)
      throw e
    }
  }

  /**
   * 清除所有日志文件
   */
  clearLogs(): { success: boolean; error?: string } {
    try {
      if (!existsSync(this.logDir)) {
        return { success: true }
      }

      const files = readdirSync(this.logDir).filter(file => file.endsWith('.log'))
      for (const file of files) {
        unlinkSync(join(this.logDir, file))
      }

      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  /**
   * 获取日志目录大小
   */
  getLogSize(): number {
    try {
      if (!existsSync(this.logDir)) return 0

      let totalSize = 0
      const files = readdirSync(this.logDir)
      
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = join(this.logDir, file)
          const stats = statSync(filePath)
          totalSize += stats.size
        }
      }

      return totalSize
    } catch (e) {
      console.error('获取日志大小失败:', e)
      return 0
    }
  }

  /**
   * 获取日志目录路径
   */
  getLogDirectory(): string {
    return this.logDir
  }
}