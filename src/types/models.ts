// 聊天会话
export interface ChatSession {
  username: string
  type: number
  unreadCount: number
  summary: string
  sortTimestamp: number  // 用于排序
  lastTimestamp: number  // 用于显示时间
  lastMsgType: number
  displayName?: string
  avatarUrl?: string
}

// 联系人
export interface Contact {
  id: number
  username: string
  localType: number
  alias: string
  remark: string
  nickName: string
  bigHeadUrl: string
  smallHeadUrl: string
}

// 通讯录联系人（用于导出）
export interface ContactInfo {
  username: string
  displayName: string
  remark?: string
  nickname?: string
  avatarUrl?: string
  type: 'friend' | 'group' | 'official' | 'other'
}

// 消息
export interface Message {
  localId: number
  serverId: number
  localType: number
  createTime: number
  sortSeq: number  // 排序序列号，用于精确去重
  isSend: number | null
  senderUsername: string | null
  parsedContent: string
  imageMd5?: string
  imageDatName?: string
  emojiCdnUrl?: string
  emojiMd5?: string
  voiceDuration?: number  // 语音时长（秒）
  // 引用消息
  quotedContent?: string
  quotedSender?: string
  // 视频相关
  videoMd5?: string
  rawContent?: string
  productId?: string
}

// 分析数据
export interface AnalyticsData {
  totalMessages: number
  totalDays: number
  myMessages: number
  otherMessages: number
  messagesByType: Record<number, number>
  messagesByHour: number[]
  messagesByDay: number[]
}
