import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { readFile } from 'fs/promises'

export class DecryptService {
  private goDecryptPath: string

  constructor() {
    // Go 解密工具路径
    const resourcesPath = app.isPackaged
      ? join(process.resourcesPath, 'resources')
      : join(__dirname, '../../resources')
    
    this.goDecryptPath = join(resourcesPath, 'go_decrypt.exe')
  }

  /**
   * 解密微信数据库
   * 调用 Go 编写的解密工具
   */
  async decryptDatabase(sourcePath: string, key: string, outputPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.goDecryptPath, [
        '-source', sourcePath,
        '-key', key,
        '-output', outputPath
      ])

      let stderr = ''

      process.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0) {
          resolve(true)
        } else {
          reject(new Error(`Decrypt failed: ${stderr}`))
        }
      })

      process.on('error', (err) => {
        reject(err)
      })
    })
  }

  /**
   * 解密微信图片
   * 微信图片使用简单的 XOR 加密
   */
  async decryptImage(imagePath: string): Promise<Buffer> {
    const data = await readFile(imagePath)
    
    // 检测图片类型并获取 XOR key
    const xorKey = this.detectImageXorKey(data)
    if (xorKey === null) {
      throw new Error('Unable to detect image type')
    }

    // 解密
    const decrypted = Buffer.alloc(data.length)
    for (let i = 0; i < data.length; i++) {
      decrypted[i] = data[i] ^ xorKey
    }

    return decrypted
  }

  /**
   * 检测图片 XOR key
   * 通过文件头特征判断原始图片类型
   */
  private detectImageXorKey(data: Buffer): number | null {
    if (data.length < 2) return null

    const byte1 = data[0]
    const byte2 = data[1]

    // JPEG: FF D8
    const jpegKey = byte1 ^ 0xFF
    if ((byte2 ^ jpegKey) === 0xD8) {
      return jpegKey
    }

    // PNG: 89 50
    const pngKey = byte1 ^ 0x89
    if ((byte2 ^ pngKey) === 0x50) {
      return pngKey
    }

    // GIF: 47 49
    const gifKey = byte1 ^ 0x47
    if ((byte2 ^ gifKey) === 0x49) {
      return gifKey
    }

    // BMP: 42 4D
    const bmpKey = byte1 ^ 0x42
    if ((byte2 ^ bmpKey) === 0x4D) {
      return bmpKey
    }

    return null
  }
}
