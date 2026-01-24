import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// Windows API 常量
const PROCESS_ALL_ACCESS = 0x1F0FFF
const MEM_COMMIT = 0x1000
const MEM_PRIVATE = 0x20000
const MEM_MAPPED = 0x40000
const MEM_IMAGE = 0x1000000
const PAGE_NOACCESS = 0x01
const PAGE_GUARD = 0x100

// 延迟初始化 Windows API
let koffiModule: any = null
let kernel32: any = null
let OpenProcess: any = null
let CloseHandle: any = null
let VirtualQueryEx: any = null
let ReadProcessMemory: any = null
let MEMORY_BASIC_INFORMATION: any = null

function ensureKernel32(): boolean {
  if (kernel32) return true
  
  try {
    koffiModule = require('koffi')
    kernel32 = koffiModule.load('kernel32.dll')

    const HANDLE = koffiModule.pointer('HANDLE_IMG_KEY', koffiModule.opaque())
    MEMORY_BASIC_INFORMATION = koffiModule.struct('MEMORY_BASIC_INFORMATION_IMG_KEY', {
      BaseAddress: 'uint64',
      AllocationBase: 'uint64',
      AllocationProtect: 'uint32',
      RegionSize: 'uint64',
      State: 'uint32',
      Protect: 'uint32',
      Type: 'uint32'
    })

    OpenProcess = kernel32.func('OpenProcess', 'HANDLE_IMG_KEY', ['uint32', 'bool', 'uint32'])
    CloseHandle = kernel32.func('CloseHandle', 'bool', ['HANDLE_IMG_KEY'])
    VirtualQueryEx = kernel32.func('VirtualQueryEx', 'uint64', [
      'HANDLE_IMG_KEY', 
      'uint64', 
      koffiModule.out(koffiModule.pointer(MEMORY_BASIC_INFORMATION)), 
      'uint64'
    ])
    ReadProcessMemory = kernel32.func('ReadProcessMemory', 'bool', [
      'HANDLE_IMG_KEY', 
      'uint64', 
      'void*', 
      'uint64', 
      koffiModule.out(koffiModule.pointer('uint64'))
    ])

    return true
  } catch (e) {
    console.error('初始化 kernel32 失败:', e)
    return false
  }
}

/**
 * 图片密钥服务 - 使用 WeFlow 的完整实现
 */
class ImageKeyService {
  /**
   * 查找模板文件 (_t.dat)
   */
  private findTemplateDatFiles(rootDir: string): string[] {
    const files: string[] = []
    const stack = [rootDir]
    const maxFiles = 32

    while (stack.length && files.length < maxFiles) {
      const dir = stack.pop() as string
      let entries: string[]
      try {
        entries = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        let stats: fs.Stats
        try {
          stats = fs.statSync(fullPath)
        } catch {
          continue
        }
        if (stats.isDirectory()) {
          stack.push(fullPath)
        } else if (entry.endsWith('_t.dat')) {
          files.push(fullPath)
          if (files.length >= maxFiles) break
        }
      }
    }

    if (!files.length) return []

    // 按日期排序（优先最新的）
    const dateReg = /(\d{4}-\d{2})/
    files.sort((a, b) => {
      const ma = a.match(dateReg)?.[1]
      const mb = b.match(dateReg)?.[1]
      if (ma && mb) return mb.localeCompare(ma)
      return 0
    })

    return files.slice(0, 16)
  }

  /**
   * 从模板文件获取 XOR 密钥
   */
  private getXorKey(templateFiles: string[]): number | null {
    const counts = new Map<string, number>()

    for (const file of templateFiles) {
      try {
        const bytes = fs.readFileSync(file)
        if (bytes.length < 2) continue
        const x = bytes[bytes.length - 2]
        const y = bytes[bytes.length - 1]
        const key = `${x}_${y}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      } catch { }
    }

    if (!counts.size) return null

    let mostKey = ''
    let mostCount = 0
    counts.forEach((count, key) => {
      if (count > mostCount) {
        mostCount = count
        mostKey = key
      }
    })

    if (!mostKey) return null

    const [xStr, yStr] = mostKey.split('_')
    const x = Number(xStr)
    const y = Number(yStr)
    const xorKey = x ^ 0xFF
    const check = y ^ 0xD9

    return xorKey === check ? xorKey : null
  }

  /**
   * 从模板文件获取密文（用于验证 AES 密钥）
   * 只从 V2 格式文件中读取密文
   */
  private getCiphertextFromTemplate(templateFiles: string[]): Buffer | null {
    for (const file of templateFiles) {
      try {
        const bytes = fs.readFileSync(file)
        if (bytes.length < 0x1f) continue
        
        // 检查 V2 签名: 0x07, 0x08, 0x56, 0x32, 0x08, 0x07
        if (
          bytes[0] === 0x07 &&
          bytes[1] === 0x08 &&
          bytes[2] === 0x56 &&
          bytes[3] === 0x32 &&
          bytes[4] === 0x08 &&
          bytes[5] === 0x07
        ) {
          console.log(`使用 V2 模板文件: ${file}`)
          return bytes.subarray(0x0f, 0x1f)
        }
      } catch { }
    }
    return null
  }

  /**
   * 检查是否是有效的密钥字符（字母数字）
   */
  private isAlphaNumAscii(byte: number): boolean {
    return (byte >= 0x61 && byte <= 0x7a) || // a-z
           (byte >= 0x41 && byte <= 0x5a) || // A-Z
           (byte >= 0x30 && byte <= 0x39)    // 0-9
  }

  /**
   * 检查是否是 UTF-16 编码的 ASCII 密钥
   */
  private isUtf16AsciiKey(buf: Buffer, start: number): boolean {
    if (start + 64 > buf.length) return false
    for (let j = 0; j < 32; j++) {
      const charByte = buf[start + j * 2]
      const nullByte = buf[start + j * 2 + 1]
      if (nullByte !== 0x00 || !this.isAlphaNumAscii(charByte)) {
        return false
      }
    }
    return true
  }

  /**
   * 验证 AES 密钥
   * 解密后应该是 JPEG 文件头: 0xFF 0xD8 0xFF
   */
  private verifyKey(ciphertext: Buffer, keyBytes: Buffer): boolean {
    try {
      const key = keyBytes.subarray(0, 16)
      const decipher = crypto.createDecipheriv('aes-128-ecb', key, null)
      decipher.setAutoPadding(false)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      const isValid = decrypted[0] === 0xFF && decrypted[1] === 0xD8 && decrypted[2] === 0xFF
      if (isValid) {
        console.log(`✓ 验证 AES 密钥成功: ${key.toString('ascii')}`)
      }
      return isValid
    } catch {
      return false
    }
  }

  /**
   * 获取进程的所有可读内存区域
   */
  private getMemoryRegions(hProcess: any): Array<[number, number]> {
    const regions: Array<[number, number]> = []

    let address = 0
    const maxAddress = 0x7fffffffffff

    while (address >= 0 && address < maxAddress) {
      const info: any = {}
      const result = VirtualQueryEx(hProcess, address, info, koffiModule.sizeof(MEMORY_BASIC_INFORMATION))
      if (!result) break

      const state = info.State
      const protect = info.Protect
      const type = info.Type
      const regionSize = Number(info.RegionSize)

      // 只扫描已提交的、可读的内存区域
      if (state === MEM_COMMIT && 
          (protect & PAGE_NOACCESS) === 0 && 
          (protect & PAGE_GUARD) === 0) {
        // 包括私有内存、映射内存和镜像内存
        if (type === MEM_PRIVATE || type === MEM_MAPPED || type === MEM_IMAGE) {
          regions.push([Number(info.BaseAddress), regionSize])
        }
      }

      const nextAddress = address + regionSize
      if (nextAddress <= address) break
      address = nextAddress
    }

    return regions
  }

  /**
   * 读取进程内存
   */
  private readProcessMemory(hProcess: any, address: number, size: number): Buffer | null {
    const buffer = Buffer.alloc(size)
    const bytesRead = [BigInt(0)]
    const ok = ReadProcessMemory(hProcess, address, buffer, size, bytesRead)
    if (!ok || bytesRead[0] === BigInt(0)) return null
    return buffer.subarray(0, Number(bytesRead[0]))
  }

  /**
   * 从进程内存获取 AES 密钥
   */
  private async getAesKeyFromMemory(pid: number, ciphertext: Buffer, onProgress?: (msg: string) => void): Promise<string | null> {
    if (!ensureKernel32()) return null

    const hProcess = OpenProcess(PROCESS_ALL_ACCESS, false, pid)
    if (!hProcess) {
      console.error('无法打开进程，PID:', pid)
      return null
    }

    try {
      const regions = this.getMemoryRegions(hProcess)
      console.log(`找到 ${regions.length} 个内存区域`)
      
      const chunkSize = 4 * 1024 * 1024  // 4MB 分块
      const overlap = 65  // 重叠字节数，避免边界问题
      let scannedRegions = 0

      for (const [baseAddress, regionSize] of regions) {
        // 跳过过大的区域
        if (regionSize > 100 * 1024 * 1024) continue

        let offset = 0
        let trailing: Buffer | null = null

        while (offset < regionSize) {
          const remaining = regionSize - offset
          const currentChunkSize = remaining > chunkSize ? chunkSize : remaining
          const chunk = this.readProcessMemory(hProcess, baseAddress + offset, currentChunkSize)

          if (!chunk || !chunk.length) {
            offset += currentChunkSize
            trailing = null
            continue
          }

          // 合并上一块的尾部数据
          let dataToScan: Buffer
          if (trailing && trailing.length) {
            dataToScan = Buffer.concat([trailing, chunk])
          } else {
            dataToScan = chunk
          }

          // 搜索 ASCII 密钥：非字母数字 + 32个字母数字 + 非字母数字
          for (let i = 0; i < dataToScan.length - 34; i++) {
            if (this.isAlphaNumAscii(dataToScan[i])) continue

            let valid = true
            for (let j = 1; j <= 32; j++) {
              if (!this.isAlphaNumAscii(dataToScan[i + j])) {
                valid = false
                break
              }
            }

            if (valid && this.isAlphaNumAscii(dataToScan[i + 33])) {
              valid = false
            }

            if (valid) {
              const keyBytes = dataToScan.subarray(i + 1, i + 33)
              if (this.verifyKey(ciphertext, keyBytes)) {
                return keyBytes.toString('ascii')
              }
            }
          }

          // 搜索 UTF-16 密钥
          for (let i = 0; i < dataToScan.length - 65; i++) {
            if (!this.isUtf16AsciiKey(dataToScan, i)) continue

            const keyBytes = Buffer.alloc(32)
            for (let j = 0; j < 32; j++) {
              keyBytes[j] = dataToScan[i + j * 2]
            }
            if (this.verifyKey(ciphertext, keyBytes)) {
              return keyBytes.toString('ascii')
            }
          }

          // 保留尾部数据用于下一块
          const start = dataToScan.length - overlap
          trailing = dataToScan.subarray(start < 0 ? 0 : start)
          offset += currentChunkSize
        }

        scannedRegions++
        if (scannedRegions % 50 === 0) {
          onProgress?.(`正在扫描内存区域: ${scannedRegions}/${regions.length}`)
        }
      }

      return null
    } finally {
      try {
        CloseHandle(hProcess)
      } catch { }
    }
  }

  /**
   * 获取图片密钥
   */
  async getImageKeys(
    userDir: string,
    wechatPid: number,
    onProgress?: (msg: string) => void
  ): Promise<{ success: boolean; xorKey?: number; aesKey?: string; error?: string }> {
    try {
      onProgress?.('正在收集模板文件...')
      
      const templateFiles = this.findTemplateDatFiles(userDir)
      if (templateFiles.length === 0) {
        return { success: false, error: '未找到模板文件，可能该微信账号没有图片缓存' }
      }

      onProgress?.(`找到 ${templateFiles.length} 个模板文件，正在计算 XOR 密钥...`)

      const xorKey = this.getXorKey(templateFiles)
      if (xorKey === null) {
        return { success: false, error: '无法获取 XOR 密钥' }
      }

      onProgress?.(`XOR 密钥: 0x${xorKey.toString(16).padStart(2, '0')}，正在读取加密数据...`)

      const ciphertext = this.getCiphertextFromTemplate(templateFiles)
      if (!ciphertext) {
        // 没有 V2 文件，只返回 XOR 密钥
        onProgress?.('未找到 V2 格式模板文件，仅返回 XOR 密钥')
        return {
          success: true,
          xorKey,
          aesKey: undefined
        }
      }

      // 重试机制：最多尝试 3 次，每次间隔 2 秒
      const maxRetries = 3
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        onProgress?.(`正在扫描微信进程内存获取 AES 密钥... (第 ${attempt}/${maxRetries} 次)`)

        const aesKey = await this.getAesKeyFromMemory(wechatPid, ciphertext, onProgress)
        if (aesKey) {
          return {
            success: true,
            xorKey,
            aesKey: aesKey.substring(0, 16)
          }
        }

        if (attempt < maxRetries) {
          onProgress?.(`未找到密钥，等待 2 秒后重试... 请确保已打开朋友圈图片`)
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }

      return { 
        success: false, 
        error: '无法从内存中获取 AES 密钥。\n\n请尝试：\n1. 确保微信已登录\n2. 打开朋友圈查看几张图片\n3. 重新获取密钥' 
      }
    } catch (e) {
      console.error('获取图片密钥失败:', e)
      return { success: false, error: String(e) }
    }
  }
}

export const imageKeyService = new ImageKeyService()
