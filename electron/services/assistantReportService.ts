import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ConfigService } from './config'
import type { LogService } from './logService'

export type AssistantFilterMode = 'all' | 'whitelist' | 'blacklist'

export interface AssistantScheduleConfig {
  enabled: boolean
  time: string
  rangeDays: number
  filterMode: AssistantFilterMode
  sessionIds: string[]
  excludeSessionIds: string[]
  lastRunDate?: string
}

export interface AssistantReportInfo {
  id: string
  filePath: string
  createdAt: number
  title: string
}

type ChatService = {
  getMessagesInRange: (options: {
    startTime: number
    endTime: number
    sessionIds?: string[]
    excludeSessionIds?: string[]
    limit?: number
  }) => Promise<{ success: boolean; messages?: any[]; error?: string }>
  getSessions: () => Promise<{ success: boolean; sessions?: Array<{ username: string; displayName?: string }>; error?: string }>
}

const DEFAULT_SCHEDULE: AssistantScheduleConfig = {
  enabled: false,
  time: '03:00',
  rangeDays: 1,
  filterMode: 'all',
  sessionIds: [],
  excludeSessionIds: []
}

const REPORT_SYSTEM_PROMPT = `你是我的个人业务助理，负责将聊天记录整理为结构化日报与待办清单。请始终使用中文输出，要求内容客观、可执行、条理清晰。`

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString()
}

export class AssistantReportService {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private configService: ConfigService) {}

  getSchedule(): AssistantScheduleConfig {
    const config = this.configService.get('assistantSchedule') as AssistantScheduleConfig | undefined
    return { ...DEFAULT_SCHEDULE, ...(config || {}) }
  }

  setSchedule(config: AssistantScheduleConfig): AssistantScheduleConfig {
    const merged = { ...DEFAULT_SCHEDULE, ...config }
    this.configService.set('assistantSchedule', merged)
    return merged
  }

  start(chatService: ChatService, logService?: LogService): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick(chatService, logService).catch(() => undefined)
    }, 60 * 1000)
    this.tick(chatService, logService).catch(() => undefined)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async runNow(chatService: ChatService, logService?: LogService, override?: Partial<AssistantScheduleConfig>) {
    const config = { ...this.getSchedule(), ...(override || {}) }
    return this.generateAndSaveReport(chatService, config, logService)
  }

  getReports(): AssistantReportInfo[] {
    const reportDir = this.getReportDir()
    if (!fs.existsSync(reportDir)) return []

    const files = fs.readdirSync(reportDir)
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const fullPath = path.join(reportDir, file)
        const stat = fs.statSync(fullPath)
        return {
          id: file,
          filePath: fullPath,
          createdAt: stat.mtimeMs,
          title: file.replace(/\.md$/, '')
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)

    return files
  }

  readReport(reportId: string): { success: boolean; content?: string; error?: string } {
    try {
      const reportDir = this.getReportDir()
      const fullPath = path.join(reportDir, reportId)
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: '报告不存在' }
      }
      const content = fs.readFileSync(fullPath, 'utf-8')
      return { success: true, content }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  private async tick(chatService: ChatService, logService?: LogService) {
    const config = this.getSchedule()
    if (!config.enabled || this.running) return

    const now = new Date()
    const [hourStr, minuteStr] = config.time.split(':')
    const targetHour = Number(hourStr)
    const targetMinute = Number(minuteStr)

    if (Number.isNaN(targetHour) || Number.isNaN(targetMinute)) return
    if (now.getHours() !== targetHour || now.getMinutes() !== targetMinute) return

    const today = formatDate(now)
    if (config.lastRunDate === today) return

    await this.generateAndSaveReport(chatService, config, logService)

    const updated = { ...config, lastRunDate: today }
    this.configService.set('assistantSchedule', updated)
  }

  private getReportDir(): string {
    const cachePath = this.configService.get('cachePath')
    const baseDir = cachePath || app.getPath('documents')
    const reportDir = path.join(baseDir, 'assistant-reports')
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true })
    }
    return reportDir
  }

  private async generateAndSaveReport(chatService: ChatService, config: AssistantScheduleConfig, logService?: LogService) {
    if (this.running) return { success: false, error: '报告生成中' }
    this.running = true

    try {
      const endTime = Math.floor(Date.now() / 1000)
      const startTime = endTime - config.rangeDays * 24 * 60 * 60
      const messageLimit = this.configService.get('aiMessageLimit') || 3000

      const filterPayload: { sessionIds?: string[]; excludeSessionIds?: string[] } = {}
      if (config.filterMode === 'whitelist') {
        filterPayload.sessionIds = config.sessionIds
      } else if (config.filterMode === 'blacklist') {
        filterPayload.excludeSessionIds = config.excludeSessionIds
      }

      const messagesResult = await chatService.getMessagesInRange({
        startTime,
        endTime,
        limit: messageLimit,
        ...filterPayload
      })

      if (!messagesResult.success) {
        return { success: false, error: messagesResult.error || '获取消息失败' }
      }

      const messages = messagesResult.messages || []
      const sessionsResult = await chatService.getSessions()
      const sessionNameMap = new Map(
        sessionsResult.success && sessionsResult.sessions
          ? sessionsResult.sessions.map(session => [session.username, session.displayName || session.username])
          : []
      )

      const prompt = this.buildSummaryPrompt(config, messages, sessionNameMap)
      let summaryText = ''

      if (messages.length > 0) {
        const { aiService } = await import('./ai/aiService')
        const provider = this.configService.get('aiCurrentProvider') || 'zhipu'
        const providerConfig = this.configService.get('aiProviderConfigs')?.[provider]
        const apiKey = providerConfig?.apiKey
        const model = providerConfig?.model
        const enableThinking = this.configService.get('aiEnableThinking')

        await aiService.streamChat(
          [
            { role: 'system', content: REPORT_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          {
            provider,
            apiKey,
            model,
            enableThinking
          },
          (chunk) => {
            summaryText += chunk
          }
        )
      } else {
        summaryText = '在设定时间范围内未发现可总结的消息。'
      }

      const fileName = `assistant-report-${formatDate(new Date())}-${Date.now()}.md`
      const filePath = path.join(this.getReportDir(), fileName)

      const header = `# 自动总结日报\n\n- 生成时间：${new Date().toLocaleString()}\n- 时间跨度：最近 ${config.rangeDays} 天\n- 过滤模式：${config.filterMode}\n- 覆盖会话数量：${new Set(messages.map(msg => msg.sessionId)).size}\n- 记录条数：${messages.length}\n\n---\n\n`

      fs.writeFileSync(filePath, `${header}${summaryText}`)

      logService?.info('AssistantReport', '自动总结已生成', { filePath })

      return { success: true, filePath, summaryText }
    } catch (e) {
      logService?.error('AssistantReport', '自动总结失败', { error: String(e) })
      return { success: false, error: String(e) }
    } finally {
      this.running = false
    }
  }

  private buildSummaryPrompt(
    config: AssistantScheduleConfig,
    messages: Array<{ sessionId: string; senderUsername: string | null; isSend: number | null; parsedContent: string; rawContent: string; createTime: number }>,
    sessionNameMap: Map<string, string>
  ) {
    const lines = messages.map((msg) => {
      const sessionName = sessionNameMap.get(msg.sessionId) || msg.sessionId
      const sender = msg.senderUsername || (msg.isSend ? '我' : sessionName)
      const content = msg.parsedContent || msg.rawContent
      return `[${formatTime(msg.createTime)}] ${sessionName} · ${sender}: ${content}`
    })

    return `请根据以下聊天记录生成最近 ${config.rangeDays} 天的业务总结日报，输出：\n\n1. 关键进展（按客户/项目/群组归类）\n2. 重要决策/结论\n3. 待办清单（包含负责人、截止时间，如未明确则标注待确认）\n4. 风险/异常点与需要跟进的问题\n\n要求：\n- 只基于记录事实，不要臆测\n- 无价值寒暄可忽略\n- 输出清晰的标题与列表\n\n聊天记录：\n${lines.join('\n')}`
  }
}

export const assistantReportService = (configService: ConfigService) => new AssistantReportService(configService)
