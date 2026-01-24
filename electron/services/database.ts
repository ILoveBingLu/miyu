import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync } from 'fs'

export class DatabaseService {
  private db: Database.Database | null = null

  /**
   * 打开解密后的数据库
   */
  open(dbPath: string): boolean {
    try {
      if (!existsSync(dbPath)) {
        console.error('数据库文件不存在:', dbPath)
        return false
      }
      
      this.db = new Database(dbPath, { readonly: true })
      return true
    } catch (error) {
      console.error('打开数据库失败:', error)
      return false
    }
  }

  /**
   * 执行查询
   */
  query<T = any>(sql: string, params?: any[]): T[] {
    if (!this.db) {
      throw new Error('数据库未打开')
    }

    try {
      const stmt = this.db.prepare(sql)
      if (params && params.length > 0) {
        return stmt.all(...params) as T[]
      }
      return stmt.all() as T[]
    } catch (error) {
      console.error('查询失败:', error)
      throw error
    }
  }

  /**
   * 执行单条查询
   */
  queryOne<T = any>(sql: string, params?: any[]): T | undefined {
    if (!this.db) {
      throw new Error('数据库未打开')
    }

    try {
      const stmt = this.db.prepare(sql)
      if (params && params.length > 0) {
        return stmt.get(...params) as T
      }
      return stmt.get() as T
    } catch (error) {
      console.error('查询失败:', error)
      throw error
    }
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

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.db !== null
  }
}
