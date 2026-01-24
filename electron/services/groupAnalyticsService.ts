import { ConfigService } from './config'
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface GroupChatInfo {
  username: string
  displayName: string
  memberCount: number
  avatarUrl?: string
  sortTimestamp?: number
}

export interface GroupMember {
  username: string
  displayName: string
  avatarUrl?: string
}

export interface GroupMessageRank {
  member: GroupMember
  messageCount: number
}

export interface GroupActiveHours {
  hourlyDistribution: Record<number, number>
}

export interface MediaTypeCount {
  type: number
  name: string
  count: number
}

export interface GroupMediaStats {
  typeCounts: MediaTypeCount[]
  total: number
}

class GroupAnalyticsService {
  private configService: ConfigService
  private messageDbCache: Map<string, Database.Database> = new Map()

  constructor() {
    this.configService = new ConfigService()
  }

  private getDecryptedDbDir(): string {
    const cachePath = this.configService.get('cachePath')
    if (cachePath) return cachePath
    
    // 开发环境使用文档目录
    if (process.env.VITE_DEV_SERVER_URL) {
      const documentsPath = app.getPath('documents')
      return path.join(documentsPath, 'CipherTalkData')
    }
    
    // 生产环境
    const exePath = app.getPath('exe')
    const installDir = path.dirname(exePath)
    
    // 检查是否安装在 C 盘
    const isOnCDrive = /^[cC]:/i.test(installDir) || installDir.startsWith('\\')
    
    if (isOnCDrive) {
      const documentsPath = app.getPath('documents')
      return path.join(documentsPath, 'CipherTalkData')
    }
    
    return path.join(installDir, 'CipherTalkData')
  }

  private cleanAccountDirName(name: string): string {
    const trimmed = name.trim()
    if (!trimmed) return trimmed
    
    // wxid_ 开头的标准格式: wxid_xxx_yyyy -> wxid_xxx
    if (trimmed.toLowerCase().startsWith('wxid_')) {
      const match = trimmed.match(/^(wxid_[a-zA-Z0-9]+)/i)
      if (match) return match[1]
      return trimmed
    }
    
    // 自定义微信号格式: xxx_yyyy (4位后缀) -> xxx
    const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
    if (suffixMatch) return suffixMatch[1]
    
    return trimmed
  }

  /**
   * 查找账号对应的实际目录名
   * 支持多种匹配方式以兼容不同版本的目录命名
   */
  private findAccountDir(baseDir: string, wxid: string): string | null {
    if (!fs.existsSync(baseDir)) return null

    const cleanedWxid = this.cleanAccountDirName(wxid)
    
    // 1. 直接匹配原始 wxid
    const directPath = path.join(baseDir, wxid)
    if (fs.existsSync(directPath)) {
      return wxid
    }
    
    // 2. 直接匹配清理后的 wxid
    if (cleanedWxid !== wxid) {
      const cleanedPath = path.join(baseDir, cleanedWxid)
      if (fs.existsSync(cleanedPath)) {
        return cleanedWxid
      }
    }

    // 3. 扫描目录查找匹配
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        
        const dirName = entry.name
        const dirNameLower = dirName.toLowerCase()
        const wxidLower = wxid.toLowerCase()
        const cleanedWxidLower = cleanedWxid.toLowerCase()
        
        if (dirNameLower === wxidLower || dirNameLower === cleanedWxidLower) return dirName
        if (dirNameLower.startsWith(wxidLower + '_') || dirNameLower.startsWith(cleanedWxidLower + '_')) return dirName
        if (wxidLower.startsWith(dirNameLower + '_') || cleanedWxidLower.startsWith(dirNameLower + '_')) return dirName
        
        const cleanedDirName = this.cleanAccountDirName(dirName)
        if (cleanedDirName.toLowerCase() === wxidLower || cleanedDirName.toLowerCase() === cleanedWxidLower) return dirName
      }
    } catch (e) {
      console.error('查找账号目录失败:', e)
    }

    return null
  }

  private findMessageDbFiles(dbDir: string): string[] {
    try {
      const files = fs.readdirSync(dbDir)
      return files.filter(f => {
        const lower = f.toLowerCase()
        return (lower.startsWith('msg') || lower.startsWith('message')) && lower.endsWith('.db')
      }).map(f => path.join(dbDir, f))
    } catch {
      return []
    }
  }

  private getMessageDb(dbPath: string): Database.Database | null {
    if (this.messageDbCache.has(dbPath)) {
      return this.messageDbCache.get(dbPath)!
    }
    try {
      const db = new Database(dbPath, { readonly: true })
      this.messageDbCache.set(dbPath, db)
      return db
    } catch {
      return null
    }
  }

  /**
   * 从 head_image.db 批量获取头像（转换为 base64 data URL）
   */
  private async getAvatarsFromHeadImageDb(dbDir: string, usernames: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {}
    if (usernames.length === 0) return result

    try {
      const headImageDbPath = path.join(dbDir, 'head_image.db')
      if (!fs.existsSync(headImageDbPath)) return result

      const db = new Database(headImageDbPath, { readonly: true })

      try {
        const stmt = db.prepare('SELECT username, image_buffer FROM head_image WHERE username = ?')
        
        for (const username of usernames) {
          try {
            const row = stmt.get(username) as any
            if (row && row.image_buffer) {
              const buffer = Buffer.from(row.image_buffer)
              const base64 = buffer.toString('base64')
              result[username] = `data:image/jpeg;base64,${base64}`
            }
          } catch (e) {
            console.error(`获取 ${username} 的头像失败:`, e)
          }
        }
      } finally {
        db.close()
      }
    } catch (e) {
      console.error('从 head_image.db 获取头像失败:', e)
    }

    return result
  }


  async getGroupChats(): Promise<{ success: boolean; data?: GroupChatInfo[]; error?: string }> {
    try {
      const wxid = this.configService.get('myWxid')
      if (!wxid) {
        return { success: false, error: '未配置微信ID' }
      }

      const baseDir = this.getDecryptedDbDir()
      const accountDir = this.findAccountDir(baseDir, wxid)
      
      if (!accountDir) {
        return { success: false, error: `未找到账号 ${wxid} 的数据库目录` }
      }

      const dbDir = path.join(baseDir, accountDir)

      const sessionDbPath = path.join(dbDir, 'session.db')
      if (!fs.existsSync(sessionDbPath)) {
        return { success: false, error: '未找到 session.db' }
      }

      const sessionDb = new Database(sessionDbPath, { readonly: true })
      
      // 查询所有群聊会话，包含时间戳用于排序
      const sessions = sessionDb.prepare(`
        SELECT username, sort_timestamp, last_timestamp 
        FROM SessionTable 
        WHERE username LIKE '%@chatroom'
      `).all() as { username: string; sort_timestamp?: number; last_timestamp?: number }[]
      
      sessionDb.close()

      const contactDbPath = path.join(dbDir, 'contact.db')
      const groupInfoMap: Map<string, { displayName: string; avatarUrl?: string }> = new Map()
      const memberCountMap: Map<string, number> = new Map()

      if (fs.existsSync(contactDbPath)) {
        const contactDb = new Database(contactDbPath, { readonly: true })
        
        // 获取群名称和头像
        const columns = contactDb.prepare("PRAGMA table_info(contact)").all() as { name: string }[]
        const columnNames = columns.map(c => c.name)
        const hasBigHeadUrl = columnNames.includes('big_head_url')
        const hasSmallHeadUrl = columnNames.includes('small_head_url')

        // 收集没有头像 URL 的用户名
        const missingAvatars: string[] = []

        for (const { username } of sessions) {
          try {
            const selectCols = ['nick_name', 'remark']
            if (hasBigHeadUrl) selectCols.push('big_head_url')
            if (hasSmallHeadUrl) selectCols.push('small_head_url')

            const contact = contactDb.prepare(`
              SELECT ${selectCols.join(', ')} FROM contact WHERE username = ?
            `).get(username) as any

            if (contact) {
              const avatarUrl = (hasBigHeadUrl && contact.big_head_url)
                ? contact.big_head_url
                : (hasSmallHeadUrl && contact.small_head_url)
                  ? contact.small_head_url
                  : undefined
              
              groupInfoMap.set(username, {
                displayName: contact.remark || contact.nick_name || username,
                avatarUrl
              })

              // 如果没有头像 URL，记录下来
              if (!avatarUrl) {
                missingAvatars.push(username)
              }
            }
          } catch { /* skip */ }
        }

        contactDb.close()

        // 从 head_image.db 获取缺失的头像
        if (missingAvatars.length > 0) {
          const headImageAvatars = await this.getAvatarsFromHeadImageDb(dbDir, missingAvatars)
          for (const username of missingAvatars) {
            const avatarUrl = headImageAvatars[username]
            if (avatarUrl) {
              const info = groupInfoMap.get(username)
              if (info) {
                info.avatarUrl = avatarUrl
              }
            }
          }
        }
      } else {
        return { success: false, error: '未找到 contact.db' }
      }

      // 获取群成员数量
      if (fs.existsSync(contactDbPath)) {
        const contactDb = new Database(contactDbPath, { readonly: true })

        // 获取群成员数量
        try {
          const tables = contactDb.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chatroom_member', 'name2id')
          `).all() as { name: string }[]
          
          const hasChatroomMember = tables.some(t => t.name === 'chatroom_member')
          const hasName2Id = tables.some(t => t.name === 'name2id')

          if (hasChatroomMember && hasName2Id) {
            for (const { username } of sessions) {
              try {
                const result = contactDb.prepare(`
                  SELECT COUNT(*) as count FROM chatroom_member 
                  WHERE room_id = (SELECT rowid FROM name2id WHERE username = ?)
                `).get(username) as { count: number }
                memberCountMap.set(username, result?.count || 0)
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }

        contactDb.close()
      } else {
        return { success: false, error: '未找到 contact.db' }
      }

      const groups: GroupChatInfo[] = sessions.map(({ username, sort_timestamp, last_timestamp }) => {
        const info = groupInfoMap.get(username)
        return {
          username,
          displayName: info?.displayName || username,
          memberCount: memberCountMap.get(username) || 0,
          avatarUrl: info?.avatarUrl,
          sortTimestamp: sort_timestamp || last_timestamp || 0
        }
      }).sort((a, b) => {
        // 按最新消息时间降序排列（最新的在前）
        return (b.sortTimestamp || 0) - (a.sortTimestamp || 0)
      })

      return { success: true, data: groups }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }


  async getGroupMembers(chatroomId: string): Promise<{ success: boolean; data?: GroupMember[]; error?: string }> {
    try {
      const wxid = this.configService.get('myWxid')
      if (!wxid) {
        return { success: false, error: '未配置微信ID' }
      }

      const baseDir = this.getDecryptedDbDir()
      const accountDir = this.findAccountDir(baseDir, wxid)
      
      if (!accountDir) {
        return { success: false, error: `未找到账号 ${wxid} 的数据库目录` }
      }

      const dbDir = path.join(baseDir, accountDir)
      const contactDbPath = path.join(dbDir, 'contact.db')

      if (!fs.existsSync(contactDbPath)) {
        return { success: false, error: '未找到 contact.db' }
      }

      const contactDb = new Database(contactDbPath, { readonly: true })
      const members: GroupMember[] = []
      const missingAvatars: string[] = []

      try {
        const memberRows = contactDb.prepare(`
          SELECT n.username, c.nick_name, c.remark, c.small_head_url 
          FROM chatroom_member m
          JOIN name2id n ON m.member_id = n.rowid
          LEFT JOIN contact c ON n.username = c.username
          WHERE m.room_id = (SELECT rowid FROM name2id WHERE username = ?)
        `).all(chatroomId) as { username: string; nick_name?: string; remark?: string; small_head_url?: string }[]

        for (const row of memberRows) {
          const avatarUrl = row.small_head_url
          members.push({
            username: row.username,
            displayName: row.remark || row.nick_name || row.username,
            avatarUrl
          })
          
          // 如果没有头像 URL，记录下来
          if (!avatarUrl) {
            missingAvatars.push(row.username)
          }
        }
      } catch { /* skip */ }

      contactDb.close()

      // 从 head_image.db 获取缺失的头像
      if (missingAvatars.length > 0) {
        const headImageAvatars = await this.getAvatarsFromHeadImageDb(dbDir, missingAvatars)
        for (const member of members) {
          if (!member.avatarUrl) {
            const avatarUrl = headImageAvatars[member.username]
            if (avatarUrl) {
              member.avatarUrl = avatarUrl
            }
          }
        }
      }

      return { success: true, data: members }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getGroupMessageRanking(chatroomId: string, limit: number = 20, startTime?: number, endTime?: number): Promise<{ success: boolean; data?: GroupMessageRank[]; error?: string }> {
    try {
      const wxid = this.configService.get('myWxid')
      if (!wxid) {
        return { success: false, error: '未配置微信ID' }
      }

      const baseDir = this.getDecryptedDbDir()
      const accountDir = this.findAccountDir(baseDir, wxid)
      
      if (!accountDir) {
        return { success: false, error: `未找到账号 ${wxid} 的数据库目录` }
      }

      const dbDir = path.join(baseDir, accountDir)
      const dbFiles = this.findMessageDbFiles(dbDir)

      if (dbFiles.length === 0) {
        return { success: false, error: '未找到消息数据库' }
      }

      const crypto = require('crypto')
      const tableHash = crypto.createHash('md5').update(chatroomId).digest('hex')
      const messageCounts: Map<string, number> = new Map()

      // 构建时间条件
      let timeCondition = ''
      if (startTime && endTime) {
        timeCondition = `WHERE create_time >= ${startTime} AND create_time <= ${endTime}`
      } else if (startTime) {
        timeCondition = `WHERE create_time >= ${startTime}`
      } else if (endTime) {
        timeCondition = `WHERE create_time <= ${endTime}`
      }

      for (const dbPath of dbFiles) {
        const db = this.getMessageDb(dbPath)
        if (!db) continue

        const tables = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name LIKE 'Msg_%'
        `).all() as { name: string }[]

        for (const { name: tableName } of tables) {
          if (!tableName.includes(tableHash)) continue

          try {
            // 群聊消息的 real_sender_id 对应发送者
            const hasName2Id = db.prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name = 'Name2Id'"
            ).get()

            let senderCounts: { sender: string; count: number }[]

            if (hasName2Id) {
              const whereClause = timeCondition ? timeCondition.replace('WHERE', 'AND') : ''
              senderCounts = db.prepare(`
                SELECT n.user_name as sender, COUNT(*) as count
                FROM "${tableName}" m
                JOIN Name2Id n ON m.real_sender_id = n.rowid
                ${timeCondition ? `WHERE m.create_time >= ${startTime} AND m.create_time <= ${endTime}` : ''}
                GROUP BY m.real_sender_id
              `).all() as { sender: string; count: number }[]
            } else {
              // 备用方案：使用 sender 字段
              const baseCondition = "sender IS NOT NULL AND sender != ''"
              const fullCondition = timeCondition 
                ? `WHERE ${baseCondition} AND create_time >= ${startTime} AND create_time <= ${endTime}`
                : `WHERE ${baseCondition}`
              senderCounts = db.prepare(`
                SELECT sender, COUNT(*) as count
                FROM "${tableName}"
                ${fullCondition}
                GROUP BY sender
              `).all() as { sender: string; count: number }[]
            }

            for (const { sender, count } of senderCounts) {
              if (sender) {
                messageCounts.set(sender, (messageCounts.get(sender) || 0) + count)
              }
            }
          } catch { /* skip */ }
        }
      }

      // 获取成员信息
      const membersResult = await this.getGroupMembers(chatroomId)
      const memberMap: Map<string, GroupMember> = new Map()
      if (membersResult.success && membersResult.data) {
        for (const m of membersResult.data) {
          memberMap.set(m.username, m)
        }
      }

      const rankings: GroupMessageRank[] = Array.from(messageCounts.entries())
        .map(([username, count]) => ({
          member: memberMap.get(username) || { username, displayName: username },
          messageCount: count
        }))
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, limit)

      return { success: true, data: rankings }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }


  async getGroupActiveHours(chatroomId: string, startTime?: number, endTime?: number): Promise<{ success: boolean; data?: GroupActiveHours; error?: string }> {
    try {
      const wxid = this.configService.get('myWxid')
      if (!wxid) {
        return { success: false, error: '未配置微信ID' }
      }

      const baseDir = this.getDecryptedDbDir()
      const accountDir = this.findAccountDir(baseDir, wxid)
      
      if (!accountDir) {
        return { success: false, error: `未找到账号 ${wxid} 的数据库目录` }
      }

      const dbDir = path.join(baseDir, accountDir)
      const dbFiles = this.findMessageDbFiles(dbDir)

      if (dbFiles.length === 0) {
        return { success: false, error: '未找到消息数据库' }
      }

      const crypto = require('crypto')
      const tableHash = crypto.createHash('md5').update(chatroomId).digest('hex')
      const hourlyDistribution: Record<number, number> = {}

      for (let i = 0; i < 24; i++) hourlyDistribution[i] = 0

      // 构建时间条件
      let timeCondition = ''
      if (startTime && endTime) {
        timeCondition = `WHERE create_time >= ${startTime} AND create_time <= ${endTime}`
      } else if (startTime) {
        timeCondition = `WHERE create_time >= ${startTime}`
      } else if (endTime) {
        timeCondition = `WHERE create_time <= ${endTime}`
      }

      for (const dbPath of dbFiles) {
        const db = this.getMessageDb(dbPath)
        if (!db) continue

        const tables = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name LIKE 'Msg_%'
        `).all() as { name: string }[]

        for (const { name: tableName } of tables) {
          if (!tableName.includes(tableHash)) continue

          try {
            const hourly = db.prepare(`
              SELECT 
                CAST(strftime('%H', create_time, 'unixepoch', 'localtime') AS INTEGER) as hour,
                COUNT(*) as count
              FROM "${tableName}"
              ${timeCondition}
              GROUP BY hour
            `).all() as { hour: number; count: number }[]

            for (const { hour, count } of hourly) {
              hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + count
            }
          } catch { /* skip */ }
        }
      }

      return { success: true, data: { hourlyDistribution } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getGroupMediaStats(chatroomId: string, startTime?: number, endTime?: number): Promise<{ success: boolean; data?: GroupMediaStats; error?: string }> {
    try {
      const wxid = this.configService.get('myWxid')
      if (!wxid) {
        return { success: false, error: '未配置微信ID' }
      }

      const baseDir = this.getDecryptedDbDir()
      const accountDir = this.findAccountDir(baseDir, wxid)
      
      if (!accountDir) {
        return { success: false, error: `未找到账号 ${wxid} 的数据库目录` }
      }

      const dbDir = path.join(baseDir, accountDir)
      const dbFiles = this.findMessageDbFiles(dbDir)

      if (dbFiles.length === 0) {
        return { success: false, error: '未找到消息数据库' }
      }

      const crypto = require('crypto')
      const tableHash = crypto.createHash('md5').update(chatroomId).digest('hex')

      // 主要类型（会单独显示）
      const mainTypes = new Set([1, 3, 34, 43, 47, 49])

      // 类型名称映射
      const typeNames: Record<number, string> = {
        1: '文本',
        3: '图片',
        34: '语音',
        43: '视频',
        47: '表情包',
        49: '链接/文件',
      }

      const typeCounts: Map<number, number> = new Map()

      // 构建时间条件
      let timeCondition = ''
      if (startTime && endTime) {
        timeCondition = `WHERE create_time >= ${startTime} AND create_time <= ${endTime}`
      } else if (startTime) {
        timeCondition = `WHERE create_time >= ${startTime}`
      } else if (endTime) {
        timeCondition = `WHERE create_time <= ${endTime}`
      }

      for (const dbPath of dbFiles) {
        const db = this.getMessageDb(dbPath)
        if (!db) continue

        const tables = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name LIKE 'Msg_%'
        `).all() as { name: string }[]

        for (const { name: tableName } of tables) {
          if (!tableName.includes(tableHash)) continue

          try {
            const stats = db.prepare(`
              SELECT local_type, COUNT(*) as count
              FROM "${tableName}"
              ${timeCondition}
              GROUP BY local_type
            `).all() as { local_type: number; count: number }[]

            for (const { local_type, count } of stats) {
              // 只统计主要类型，其他归为"其他"
              if (mainTypes.has(local_type)) {
                typeCounts.set(local_type, (typeCounts.get(local_type) || 0) + count)
              } else {
                // 其他类型合并到 -1
                typeCounts.set(-1, (typeCounts.get(-1) || 0) + count)
              }
            }
          } catch { /* skip */ }
        }
      }

      // 转换为数组格式，过滤掉数量为0的
      const result: MediaTypeCount[] = Array.from(typeCounts.entries())
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({
          type,
          name: type === -1 ? '其他' : (typeNames[type] || `其他`),
          count
        }))
        .sort((a, b) => b.count - a.count)

      const total = result.reduce((sum, item) => sum + item.count, 0)

      return {
        success: true,
        data: { typeCounts: result, total }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  close() {
    this.messageDbCache.forEach(db => {
      try { db.close() } catch { /* ignore */ }
    })
    this.messageDbCache.clear()
  }
}

export const groupAnalyticsService = new GroupAnalyticsService()
