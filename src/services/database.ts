// 数据库服务 - 封装 Electron IPC 调用
import { db } from './ipc'
import type { ChatSession, Contact, Message } from '../types/models'

// 系统账号过滤列表
const SYSTEM_ACCOUNTS = [
  'weixin', 'qqmail', 'fmessage', 'medianote', 'floatbottle', 
  'newsapp', 'brandsessionholder', 'brandservicesessionholder',
  'notifymessage', 'opencustomerservicemsg', 'notification_messages',
  'userexperience_alarm'
]

// 判断是否应该保留会话
function shouldKeepSession(username: string): boolean {
  if (username.startsWith('gh_')) return false
  if (SYSTEM_ACCOUNTS.some(s => username.startsWith(s) || username === s)) return false
  if (username.includes('@kefu.openim') || username.includes('@openim')) return false
  if (username.includes('service_')) return false
  
  return username.includes('@chatroom') || 
         username.startsWith('wxid_') || 
         !username.includes('@')
}

// 获取会话列表
export async function getSessions(limit?: number): Promise<ChatSession[]> {
  const sql = `
    SELECT * FROM SessionTable 
    ORDER BY sort_timestamp DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `
  const rows = await db.query<Record<string, unknown>>(sql)
  
  return rows
    .map(row => ({
      username: String(row.username || ''),
      type: Number(row.type || 0),
      unreadCount: Number(row.unread_count || 0),
      summary: String(row.summary || ''),
      sortTimestamp: Number(row.sort_timestamp || 0),
      lastTimestamp: Number(row.last_timestamp || row.sort_timestamp || 0),
      lastMsgType: Number(row.last_msg_type || 0),
      displayName: undefined,
      avatarUrl: undefined
    }))
    .filter(session => shouldKeepSession(session.username))
}

// 获取联系人信息
export async function getContact(username: string): Promise<Contact | null> {
  const sql = `SELECT * FROM contact WHERE username = ? LIMIT 1`
  const rows = await db.query<Record<string, unknown>>(sql, [username])
  
  if (rows.length === 0) return null
  
  const row = rows[0]
  return {
    id: Number(row.id || 0),
    username: String(row.username || ''),
    localType: Number(row.local_type || 0),
    alias: String(row.alias || ''),
    remark: String(row.remark || ''),
    nickName: String(row.nick_name || ''),
    bigHeadUrl: String(row.big_head_url || ''),
    smallHeadUrl: String(row.small_head_url || '')
  }
}

// 获取消息列表
export async function getMessages(
  sessionId: string, 
  limit = 50, 
  offset = 0
): Promise<Message[]> {
  // 消息表名格式: Msg_{md5(username)前16位}
  const tableName = await findMessageTable(sessionId)
  if (!tableName) return []
  
  const sql = `
    SELECT * FROM "${tableName}"
    ORDER BY create_time DESC
    LIMIT ? OFFSET ?
  `
  const rows = await db.query<Record<string, unknown>>(sql, [limit, offset])
  
  return rows.map(row => ({
    localId: Number(row.local_id || 0),
    serverId: Number(row.server_id || 0),
    localType: Number(row.local_type || 0),
    createTime: Number(row.create_time || 0),
    isSend: row.is_send != null ? Number(row.is_send) : null,
    senderUsername: row.sender_username ? String(row.sender_username) : null,
    parsedContent: parseMessageContent(row),
    rawContent: String(row.message_content || row.compress_content || ''),
    imageMd5: extractImageMd5(row),
    emojiCdnUrl: extractEmojiCdnUrl(row),
    voiceDurationSeconds: extractVoiceDuration(row),
    sortSeq: Number(row.sort_seq || 0)
  }))
}

// 查找消息表名
async function findMessageTable(sessionId: string): Promise<string | null> {
  const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'`
  const tables = await db.query<{ name: string }>(sql)
  
  // 遍历查找包含该会话消息的表
  for (const { name } of tables) {
    const checkSql = `SELECT 1 FROM "${name}" LIMIT 1`
    try {
      const result = await db.query(checkSql)
      if (result.length > 0) {
        return name
      }
    } catch {
      continue
    }
  }
  
  return null
}

// 解析消息内容
function parseMessageContent(row: Record<string, unknown>): string {
  const localType = Number(row.local_type || 0)
  const content = String(row.message_content || row.compress_content || '')
  
  switch (localType) {
    case 1: return content // 文本
    case 3: return '[图片]'
    case 34: return '[语音]'
    case 43: return '[视频]'
    case 47: return '[表情]'
    case 48: return '[位置]'
    case 10000: return cleanSystemMessage(content)
    default: return content || `[消息类型:${localType}]`
  }
}

// 清理系统消息 / XML（尽量提取可读文本，兼容拍一拍）
function cleanSystemMessage(content: string): string {
  if (!content) return '[系统消息]'

  // 1) 拍一拍：优先 title
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(content)
  if (titleMatch?.[1]) {
    const title = titleMatch[1]
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .trim()
    if (title) return title
  }

  // 2) 拍一拍：template（把 ${wxid_xxx} 这种占位符去掉）
  const templateMatch = /<template>([\s\S]*?)<\/template>/i.exec(content)
  if (templateMatch?.[1]) {
    const t = templateMatch[1]
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .replace(/\$\{[^}]+\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (t) return t
  }

  // 3) 尝试提取 sysmsg/replacemsg（撤回等）
  const replaceMsgMatch = /<replacemsg><!\[CDATA\[(.*?)\]\]><\/replacemsg>/i.exec(content)
  if (replaceMsgMatch?.[1]) return replaceMsgMatch[1].trim()

  // 4) 通用：去标签 + CDATA
  const cleaned = content
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?[a-zA-Z0-9_:]+[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || '[系统消息]'
}

// 提取图片 MD5
function extractImageMd5(row: Record<string, unknown>): string | undefined {
  const content = String(row.message_content || row.compress_content || '')
  const match = content.match(/md5\s*=\s*['"]([a-fA-F0-9]+)['"]/i)
  return match?.[1]
}

// 提取表情 CDN URL
function extractEmojiCdnUrl(row: Record<string, unknown>): string | undefined {
  const content = String(row.message_content || row.compress_content || '')
  const match = content.match(/cdnurl\s*=\s*['"]([^'"]+)['"]/i)
  return match?.[1]?.replace(/&amp;/g, '&')
}

// 提取语音时长
function extractVoiceDuration(row: Record<string, unknown>): number | undefined {
  const content = String(row.message_content || row.compress_content || '')
  const match = content.match(/voicelength\s*=\s*['"]?(\d+)['"]?/i)
  if (!match) return undefined
  const ms = parseInt(match[1], 10)
  return ms > 1000 ? Math.round(ms / 1000) : ms
}

// 获取消息总数
export async function getMessageCount(sessionId: string): Promise<number> {
  const tableName = await findMessageTable(sessionId)
  if (!tableName) return 0
  
  const sql = `SELECT COUNT(*) as count FROM "${tableName}"`
  const rows = await db.query<{ count: number }>(sql)
  return rows[0]?.count || 0
}

// 搜索消息
export async function searchMessages(
  sessionId: string, 
  keyword: string, 
  limit = 50
): Promise<Message[]> {
  const tableName = await findMessageTable(sessionId)
  if (!tableName) return []
  
  const sql = `
    SELECT * FROM "${tableName}"
    WHERE message_content LIKE ?
    ORDER BY create_time DESC
    LIMIT ?
  `
  const rows = await db.query<Record<string, unknown>>(sql, [`%${keyword}%`, limit])
  
  return rows.map(row => ({
    localId: Number(row.local_id || 0),
    serverId: Number(row.server_id || 0),
    localType: Number(row.local_type || 0),
    createTime: Number(row.create_time || 0),
    isSend: row.is_send != null ? Number(row.is_send) : null,
    senderUsername: row.sender_username ? String(row.sender_username) : null,
    parsedContent: parseMessageContent(row),
    sortSeq: Number(row.sort_seq || 0)
  }))
}
