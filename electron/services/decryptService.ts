import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

// 常量定义
const PAGE_SIZE = 4096
const KEY_SIZE = 32
const SALT_SIZE = 16
const IV_SIZE = 16
const HMAC_SIZE = 64  // SHA512
const AES_BLOCK_SIZE = 16
const ITER_COUNT = 256000  // Windows v4 迭代次数
const SQLITE_HEADER = 'SQLite format 3\x00'

// 计算保留字节数 (IV + HMAC, 向上取整到 AES 块大小)
const RESERVE = Math.ceil((IV_SIZE + HMAC_SIZE) / AES_BLOCK_SIZE) * AES_BLOCK_SIZE

/**
 * 微信数据库解密服务 (Windows v4)
 */
export class WeChatDecryptService {

  /**
   * XOR 字节数组
   */
  private xorBytes(data: Buffer, xorValue: number): Buffer {
    const result = Buffer.alloc(data.length)
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i] ^ xorValue
    }
    return result
  }

  /**
   * 派生加密密钥和 MAC 密钥
   */
  private deriveKeys(key: Buffer, salt: Buffer): { encKey: Buffer; macKey: Buffer } {
    // 生成加密密钥
    const encKey = crypto.pbkdf2Sync(key, salt, ITER_COUNT, KEY_SIZE, 'sha512')

    // 生成 MAC 密钥的盐 (XOR 0x3a)
    const macSalt = this.xorBytes(salt, 0x3a)

    // 生成 MAC 密钥
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, KEY_SIZE, 'sha512')

    return { encKey, macKey }
  }

  /**
   * 验证密钥是否正确
   */
  validateKey(dbPath: string, hexKey: string): boolean {
    try {
      const key = Buffer.from(hexKey, 'hex')
      if (key.length !== KEY_SIZE) {
        console.error('密钥长度错误:', key.length)
        return false
      }

      // 读取第一页
      const fd = fs.openSync(dbPath, 'r')
      const page1 = Buffer.alloc(PAGE_SIZE)
      fs.readSync(fd, page1, 0, PAGE_SIZE, 0)
      fs.closeSync(fd)

      // 检查是否已解密
      if (page1.slice(0, 15).toString() === SQLITE_HEADER.slice(0, 15)) {
        console.log('数据库已经是解密状态')
        return true
      }

      // 获取盐值
      const salt = page1.slice(0, SALT_SIZE)

      // 派生密钥
      const { macKey } = this.deriveKeys(key, salt)

      // 计算 HMAC
      const dataEnd = PAGE_SIZE - RESERVE + IV_SIZE
      const hmac = crypto.createHmac('sha512', macKey)
      hmac.update(page1.slice(SALT_SIZE, dataEnd))

      // 添加页码 (little-endian, 从1开始)
      const pageNoBytes = Buffer.alloc(4)
      pageNoBytes.writeUInt32LE(1, 0)
      hmac.update(pageNoBytes)

      const calculatedMAC = hmac.digest()
      const storedMAC = page1.slice(dataEnd, dataEnd + HMAC_SIZE)

      return calculatedMAC.equals(storedMAC)
    } catch (e) {
      console.error('验证密钥失败:', e)
      return false
    }
  }

  /**
   * 解密数据库
   */
  async decryptDatabase(
    inputPath: string,
    outputPath: string,
    hexKey: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const key = Buffer.from(hexKey, 'hex')
      if (key.length !== KEY_SIZE) {
        return { success: false, error: '密钥长度错误' }
      }

      // 获取文件信息
      const stats = fs.statSync(inputPath)
      const fileSize = stats.size
      const totalPages = Math.ceil(fileSize / PAGE_SIZE)

      // 读取第一页获取盐值
      const fd = fs.openSync(inputPath, 'r')
      const page1 = Buffer.alloc(PAGE_SIZE)
      fs.readSync(fd, page1, 0, PAGE_SIZE, 0)

      // 检查是否已解密
      if (page1.slice(0, 15).toString() === SQLITE_HEADER.slice(0, 15)) {
        fs.closeSync(fd)
        // 已解密，直接复制
        fs.copyFileSync(inputPath, outputPath)
        return { success: true }
      }

      const salt = page1.slice(0, SALT_SIZE)

      // 验证密钥
      if (!this.validateKey(inputPath, hexKey)) {
        fs.closeSync(fd)
        return { success: false, error: '密钥验证失败' }
      }

      // 派生密钥
      const { encKey, macKey } = this.deriveKeys(key, salt)

      // 确保输出目录存在
      const outputDir = path.dirname(outputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      // 创建输出文件
      const outFd = fs.openSync(outputPath, 'w')

      // 写入 SQLite 头
      fs.writeSync(outFd, Buffer.from(SQLITE_HEADER))

      // 处理每一页
      const pageBuf = Buffer.alloc(PAGE_SIZE)

      for (let pageNum = 0; pageNum < totalPages; pageNum++) {
        // 读取一页
        const bytesRead = fs.readSync(fd, pageBuf, 0, PAGE_SIZE, pageNum * PAGE_SIZE)

        if (bytesRead === 0) break

        // 检查是否全为零
        let allZeros = true
        for (let i = 0; i < bytesRead; i++) {
          if (pageBuf[i] !== 0) {
            allZeros = false
            break
          }
        }

        if (allZeros) {
          // 写入零页面（第一页需要减去盐值大小）
          if (pageNum === 0) {
            fs.writeSync(outFd, pageBuf.slice(SALT_SIZE, bytesRead))
          } else {
            fs.writeSync(outFd, pageBuf.slice(0, bytesRead))
          }
          continue
        }

        // 解密页面
        const decrypted = this.decryptPage(pageBuf, encKey, macKey, pageNum)

        // 直接写入解密后的页面数据
        fs.writeSync(outFd, decrypted)

        // 进度回调 与 让出时间片
        // 减少到每50页让出一次，提高响应性（对于大文件更重要）
        if (pageNum % 50 === 0) {
          if (onProgress) {
            onProgress(pageNum + 1, totalPages)
          }
          // 让出事件循环，防止界面卡死
          await new Promise<void>(resolve => setImmediate(resolve))
        }
      }

      fs.closeSync(fd)
      fs.closeSync(outFd)

      if (onProgress) {
        onProgress(totalPages, totalPages)
      }

      return { success: true }
    } catch (e) {
      console.error('解密数据库失败:', e)
      return { success: false, error: String(e) }
    }
  }

  /**
   * 解密单个页面
   */
  private decryptPage(pageBuf: Buffer, encKey: Buffer, macKey: Buffer, pageNum: number): Buffer {
    const offset = pageNum === 0 ? SALT_SIZE : 0

    // 验证 HMAC
    const hmac = crypto.createHmac('sha512', macKey)
    hmac.update(pageBuf.slice(offset, PAGE_SIZE - RESERVE + IV_SIZE))

    const pageNoBytes = Buffer.alloc(4)
    pageNoBytes.writeUInt32LE(pageNum + 1, 0)
    hmac.update(pageNoBytes)

    const calculatedMAC = hmac.digest()
    const hashMacStart = PAGE_SIZE - RESERVE + IV_SIZE
    const storedMAC = pageBuf.slice(hashMacStart, hashMacStart + HMAC_SIZE)

    if (!calculatedMAC.equals(storedMAC)) {
      console.warn(`页面 ${pageNum} HMAC 验证失败`)
    }

    // 获取 IV
    const iv = pageBuf.slice(PAGE_SIZE - RESERVE, PAGE_SIZE - RESERVE + IV_SIZE)

    // 解密数据
    const encrypted = pageBuf.slice(offset, PAGE_SIZE - RESERVE)
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv)
    decipher.setAutoPadding(false)

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ])

    // 组合解密后的页面：解密数据 + 保留区域
    const result = Buffer.concat([
      decrypted,
      pageBuf.slice(PAGE_SIZE - RESERVE)
    ])

    return result
  }
}

export const wechatDecryptService = new WeChatDecryptService()
