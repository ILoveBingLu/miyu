import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

/**
 * AI 专用数据库管理
 */
export class AIDatabase {
  private db: Database.Database | null = null
  private dbPath: string | null = null

  /**
   * 初始化数据库
   */
  init(cachePath: string, wxid: string): void {
    // AI 数据库放在缓存根目录下，不放在账号目录内
    this.dbPath = join(cachePath, 'ai_summary.db')

    // 确保目录存在
    const dir = dirname(this.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // 打开数据库
    this.db = new Database(this.dbPath)

    // 创建表
    this.createTables()
  }

  /**
   * 创建表结构
   */
  private createTables(): void {
    if (!this.db) return

    // 摘要记录表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        time_range_start INTEGER NOT NULL,
        time_range_end INTEGER NOT NULL,
        time_range_days INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        summary_text TEXT NOT NULL,
        tokens_used INTEGER,
        cost REAL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_created ON summaries(created_at);
      CREATE INDEX IF NOT EXISTS idx_summaries_time_range ON summaries(time_range_start, time_range_end);
    `)

    // 使用统计表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        total_tokens INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0,
        request_count INTEGER DEFAULT 0,
        UNIQUE(date, provider, model)
      );
      
      CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_stats(date);
    `)

    // 缓存表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS summary_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT UNIQUE NOT NULL,
        summary_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (summary_id) REFERENCES summaries(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_cache_key ON summary_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON summary_cache(expires_at);
    `)
    
    // 添加新列（如果不存在）
    try {
      this.db.exec("ALTER TABLE summaries ADD COLUMN prompt_text TEXT")
    } catch (e) {
      // 忽略错误，列已存在
    }
    
    try {
      this.db.exec("ALTER TABLE summaries ADD COLUMN custom_name TEXT")
    } catch (e) {
      // 忽略错误，列已存在
    }
  }

  /**
   * 获取数据库实例
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('数据库未初始化')
    }
    return this.db
  }

  /**
   * 保存摘要
   */
  saveSummary(summary: {
    sessionId: string
    timeRangeStart: number
    timeRangeEnd: number
    timeRangeDays: number
    messageCount: number
    summaryText: string
    tokensUsed: number
    cost: number
    provider: string
    model: string
    promptText?: string
  }): number {
    const db = this.getDb()

    console.log('[AIDatabase] 保存摘要:', {
      sessionId: summary.sessionId,
      timeRangeDays: summary.timeRangeDays,
      messageCount: summary.messageCount,
      provider: summary.provider,
      model: summary.model
    })

    const result = db.prepare(`
      INSERT INTO summaries (
        session_id, time_range_start, time_range_end, time_range_days,
        message_count, summary_text, tokens_used, cost,
        provider, model, created_at, prompt_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      summary.sessionId,
      summary.timeRangeStart,
      summary.timeRangeEnd,
      summary.timeRangeDays,
      summary.messageCount,
      summary.summaryText,
      summary.tokensUsed,
      summary.cost,
      summary.provider,
      summary.model,
      Date.now(),
      summary.promptText || ''
    )

    console.log('[AIDatabase] 摘要已保存，ID:', result.lastInsertRowid)

    return result.lastInsertRowid as number
  }

  /**
   * 保存缓存
   */
  saveCache(cacheKey: string, summaryId: number, expiresAt: number): void {
    const db = this.getDb()

    db.prepare(`
      INSERT OR REPLACE INTO summary_cache (cache_key, summary_id, expires_at)
      VALUES (?, ?, ?)
    `).run(cacheKey, summaryId, expiresAt)
  }

  /**
   * 获取缓存的摘要
   */
  getCachedSummary(cacheKey: string): any | null {
    const db = this.getDb()
    const now = Date.now()

    const row: any = db.prepare(`
      SELECT s.* FROM summaries s
      JOIN summary_cache c ON s.id = c.summary_id
      WHERE c.cache_key = ? AND c.expires_at > ?
    `).get(cacheKey, now)

    if (!row) return null

    // 转换为 camelCase 格式
    return {
      id: row.id,
      sessionId: row.session_id,
      timeRangeStart: row.time_range_start,
      timeRangeEnd: row.time_range_end,
      timeRangeDays: row.time_range_days,
      messageCount: row.message_count,
      summaryText: row.summary_text,
      tokensUsed: row.tokens_used,
      cost: row.cost,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
      promptText: row.prompt_text
    }
  }

  /**
   * 更新使用统计
   */
  updateUsageStats(provider: string, model: string, tokens: number, cost: number): void {
    const db = this.getDb()
    const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    db.prepare(`
      INSERT INTO usage_stats (date, provider, model, total_tokens, total_cost, request_count)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(date, provider, model) DO UPDATE SET
        total_tokens = total_tokens + excluded.total_tokens,
        total_cost = total_cost + excluded.total_cost,
        request_count = request_count + 1
    `).run(date, provider, model, tokens, cost)
  }

  /**
   * 获取使用统计
   */
  getUsageStats(startDate?: string, endDate?: string): any[] {
    const db = this.getDb()

    let query = 'SELECT * FROM usage_stats'
    const params: any[] = []

    if (startDate && endDate) {
      query += ' WHERE date >= ? AND date <= ?'
      params.push(startDate, endDate)
    } else if (startDate) {
      query += ' WHERE date >= ?'
      params.push(startDate)
    } else if (endDate) {
      query += ' WHERE date <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY date DESC'

    return db.prepare(query).all(...params)
  }

  /**
   * 获取会话的摘要历史
   */
  getSummaryHistory(sessionId: string, limit: number = 10): any[] {
    const db = this.getDb()

    console.log('[AIDatabase] 查询历史记录:', { sessionId, limit })

    const rows = db.prepare(`
      SELECT * FROM summaries
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit)

    console.log('[AIDatabase] 查询到', rows.length, '条历史记录')

    // 转换为 camelCase 格式
    return rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      timeRangeStart: row.time_range_start,
      timeRangeEnd: row.time_range_end,
      timeRangeDays: row.time_range_days,
      messageCount: row.message_count,
      summaryText: row.summary_text,
      tokensUsed: row.tokens_used,
      cost: row.cost,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
      promptText: row.prompt_text,
      customName: row.custom_name
    }))
  }

  /**
   * 删除摘要
   */
  deleteSummary(id: number): boolean {
    const db = this.getDb()

    try {
      // 先删除相关的缓存
      db.prepare('DELETE FROM summary_cache WHERE summary_id = ?').run(id)
      
      // 删除摘要记录
      const result = db.prepare('DELETE FROM summaries WHERE id = ?').run(id)
      
      return result.changes > 0
    } catch (e) {
      console.error('[AIDatabase] 删除摘要失败:', e)
      return false
    }
  }

  /**
   * 重命名摘要
   */
  renameSummary(id: number, customName: string): boolean {
    const db = this.getDb()

    try {
      const result = db.prepare('UPDATE summaries SET custom_name = ? WHERE id = ?').run(customName, id)
      return result.changes > 0
    } catch (e) {
      console.error('[AIDatabase] 重命名摘要失败:', e)
      return false
    }
  }

  /**
   * 清理过期缓存
   */
  cleanExpiredCache(): void {
    const db = this.getDb()
    const now = Date.now()

    db.prepare('DELETE FROM summary_cache WHERE expires_at <= ?').run(now)
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// 导出单例
export const aiDatabase = new AIDatabase()
