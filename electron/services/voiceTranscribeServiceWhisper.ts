/**
 * 基于 whisper.cpp 的语音转文字服务（支持 GPU 加速）
 * 使用 node-whisper 包装 whisper.cpp
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream, statSync, unlinkSync, writeFileSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import * as https from 'https'
import * as http from 'http'

interface ModelConfig {
    name: string
    filename: string
    size: number
    sizeLabel: string
    quality: string
}

const MODELS: Record<string, ModelConfig> = {
    tiny: {
        name: 'tiny',
        filename: 'ggml-tiny.bin',
        size: 75_000_000,
        sizeLabel: '75 MB',
        quality: '一般'
    },
    base: {
        name: 'base',
        filename: 'ggml-base.bin',
        size: 145_000_000,
        sizeLabel: '145 MB',
        quality: '良好'
    },
    small: {
        name: 'small',
        filename: 'ggml-small.bin',
        size: 488_000_000,
        sizeLabel: '488 MB',
        quality: '优秀'
    },
    medium: {
        name: 'medium',
        filename: 'ggml-medium.bin',
        size: 1_500_000_000,
        sizeLabel: '1.5 GB',
        quality: '很好'
    },
    'large-v3': {
        name: 'large-v3',
        filename: 'ggml-large-v3.bin',
        size: 3_100_000_000,
        sizeLabel: '3.1 GB',
        quality: '极好'
    },
    'large-v3-turbo': {
        name: 'large-v3-turbo',
        filename: 'ggml-large-v3-turbo.bin',
        size: 1_620_000_000,
        sizeLabel: '1.62 GB',
        quality: '极好（推荐）'
    },
    'large-v3-turbo-q5': {
        name: 'large-v3-turbo-q5',
        filename: 'ggml-large-v3-turbo-q5_0.bin',
        size: 540_000_000,
        sizeLabel: '540 MB',
        quality: '极好（量化版）'
    },
    'large-v3-turbo-q8': {
        name: 'large-v3-turbo-q8',
        filename: 'ggml-large-v3-turbo-q8_0.bin',
        size: 835_000_000,
        sizeLabel: '835 MB',
        quality: '极好（高质量量化）'
    }
}

export class VoiceTranscribeServiceWhisper {
    private modelsDir: string
    private whisperExe: string
    private whisperDir: string
    private useGPU: boolean = false

    constructor() {
        this.modelsDir = join(app.getPath('appData'), 'ciphertalk', 'whisper-models')
        
        // whisper.cpp 的可执行文件路径
        let resourcesPath: string
        
        if (app.isPackaged) {
            resourcesPath = join(process.resourcesPath, 'resources', 'whisper')
        } else {
            resourcesPath = join(app.getAppPath(), 'resources', 'whisper')
        }
        
        const cliExe = join(resourcesPath, 'whisper-cli.exe')
        const mainExe = join(resourcesPath, 'main.exe')
        
        this.whisperExe = existsSync(cliExe) ? cliExe : mainExe
        this.whisperDir = resourcesPath
        
        if (!existsSync(this.modelsDir)) {
            mkdirSync(this.modelsDir, { recursive: true })
        }
    }

    /**
     * 设置 GPU 组件目录（从用户配置的缓存目录）
     */
    setGPUComponentsDir(cachePath: string) {
        const gpuDir = join(cachePath, 'whisper-gpu')
        if (!existsSync(gpuDir)) {
            mkdirSync(gpuDir, { recursive: true })
        }
        
        // 检查用户缓存目录是否有完整的 GPU 组件
        const gpuExe = join(gpuDir, 'whisper-cli.exe')
        if (existsSync(gpuExe)) {
            this.whisperExe = gpuExe
            this.whisperDir = gpuDir
        }
    }

    /**
     * 检测 GPU 支持
     */
    async detectGPU(): Promise<{
        available: boolean
        provider: string
        info: string
    }> {
        try {
            if (!existsSync(this.whisperExe)) {
                return {
                    available: false,
                    provider: 'CPU',
                    info: 'Whisper 可执行文件不存在'
                }
            }

            // 检测 NVIDIA GPU
            const { execSync } = require('child_process')
            try {
                const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', {
                    encoding: 'utf-8',
                    timeout: 3000,
                    windowsHide: true
                })
                
                const gpuName = output.trim()
                
                if (gpuName) {
                    // 检查是否有 CUDA DLL
                    const cudaDll = join(this.whisperDir, 'ggml-cuda.dll')
                    
                    if (existsSync(cudaDll)) {
                        this.useGPU = true
                        return {
                            available: true,
                            provider: 'NVIDIA CUDA',
                            info: `GPU: ${gpuName} (支持 CUDA 加速)`
                        }
                    } else {
                        return {
                            available: false,
                            provider: 'CPU',
                            info: `检测到 ${gpuName}，但缺少 CUDA 支持文件`
                        }
                    }
                }
            } catch (e) {
                // nvidia-smi 命令失败，继续检查 CPU 模式
            }

            // 检查是否有 CPU DLL
            const cpuDll = join(this.whisperDir, 'ggml-cpu.dll')
            
            if (existsSync(cpuDll)) {
                this.useGPU = false
                return {
                    available: false,
                    provider: 'CPU',
                    info: '未检测到 NVIDIA GPU，将使用 CPU 模式（仍比 SenseVoice 快）'
                }
            }

            return {
                available: false,
                provider: 'CPU',
                info: 'GPU 不可用，将使用 CPU'
            }
        } catch (error) {
            console.error('[Whisper] GPU 检测失败:', error)
            return {
                available: false,
                provider: 'CPU',
                info: `GPU 检测失败: ${error}`
            }
        }
    }

    /**
     * 检查模型状态
     */
    async getModelStatus(modelType: keyof typeof MODELS = 'small'): Promise<{
        exists: boolean
        modelPath?: string
        sizeBytes?: number
    }> {
        const config = MODELS[modelType]
        const modelPath = join(this.modelsDir, config.filename)

        if (!existsSync(modelPath)) {
            return { exists: false }
        }

        const stats = statSync(modelPath)
        return {
            exists: true,
            modelPath,
            sizeBytes: stats.size
        }
    }

    /**
     * 清除指定模型
     */
    async clearModel(modelType: keyof typeof MODELS = 'small'): Promise<{ success: boolean; error?: string }> {
        try {
            const config = MODELS[modelType]
            const modelPath = join(this.modelsDir, config.filename)

            if (existsSync(modelPath)) {
                unlinkSync(modelPath)
            }

            return { success: true }
        } catch (error) {
            console.error('[Whisper] 清除模型失败:', error)
            return { success: false, error: String(error) }
        }
    }

    /**
     * 语音转文字
     */
    async transcribeWavBuffer(
        wavData: Buffer,
        modelType: keyof typeof MODELS = 'small',
        language: string = 'auto'
    ): Promise<{ success: boolean; transcript?: string; error?: string }> {
        const config = MODELS[modelType]
        const modelPath = join(this.modelsDir, config.filename)

        if (!existsSync(modelPath)) {
            return { success: false, error: '模型文件不存在，请先下载模型' }
        }

        if (!existsSync(this.whisperExe)) {
            return { 
                success: false, 
                error: `Whisper 可执行文件不存在: ${this.whisperExe}\n请运行: node scripts/setup-whisper-gpu.js` 
            }
        }

        let tempWavPath: string | null = null
        let txtPath: string | null = null

        try {
            // 保存临时 WAV 文件
            tempWavPath = join(app.getPath('temp'), `whisper_${Date.now()}.wav`)
            writeFileSync(tempWavPath, wavData)
            txtPath = tempWavPath + '.txt'

            // 构建命令参数
            const args = [
                '-m', modelPath,
                '-f', tempWavPath,
                '-l', language,
                '-t', '4', // 线程数
                '-nt', // 不输出时间戳
                '-otxt' // 输出文本到 .txt 文件
            ]

            // 注意：-ng 是 "no-gpu"，我们不加这个参数就会自动使用 GPU
            // 如果不想用 GPU，才加 -ng

            // 执行 whisper
            const result = await this.runWhisper(args)

            if (result.success) {
                // 优先从 .txt 文件读取结果
                let transcript = ''
                
                if (existsSync(txtPath)) {
                    const { readFileSync } = require('fs')
                    transcript = readFileSync(txtPath, 'utf-8').trim()
                }
                
                // 如果 .txt 文件为空，尝试从 stdout 提取
                if (!transcript && result.text) {
                    transcript = result.text
                }
                
                if (transcript) {
                    return { success: true, transcript }
                } else {
                    console.error('[Whisper] 识别结果为空')
                    return { success: false, error: '识别结果为空' }
                }
            } else {
                console.error('[Whisper] 识别失败:', result.error)
                return { success: false, error: result.error }
            }
        } catch (error) {
            console.error('[Whisper] 异常:', error)
            return { success: false, error: String(error) }
        } finally {
            // 清理临时文件
            try {
                if (tempWavPath && existsSync(tempWavPath)) {
                    unlinkSync(tempWavPath)
                }
                if (txtPath && existsSync(txtPath)) {
                    unlinkSync(txtPath)
                }
            } catch (e) {
                console.warn('[Whisper] 清理临时文件失败:', e)
            }
        }
    }

    /**
     * 运行 whisper 命令
     */
    private runWhisper(args: string[]): Promise<{ success: boolean; text?: string; error?: string }> {
        return new Promise((resolve) => {
            const process = spawn(this.whisperExe, args, {
                windowsHide: true
            })

            let stdout = ''
            let stderr = ''

            process.stdout?.on('data', (data) => {
                stdout += data.toString()
            })

            process.stderr?.on('data', (data) => {
                stderr += data.toString()
            })

            process.on('close', (code) => {
                if (code === 0) {
                    // 从输出中提取文本
                    const text = this.extractText(stdout)
                    resolve({ success: true, text })
                } else {
                    resolve({ success: false, error: stderr || '识别失败' })
                }
            })

            process.on('error', (error) => {
                resolve({ success: false, error: String(error) })
            })
        })
    }

    /**
     * 从输出中提取文本
     */
    private extractText(output: string): string {
        // whisper.cpp 的输出格式有多种可能：
        // 1. 带时间戳: [00:00:00.000 --> 00:00:05.000] 文本
        // 2. 不带时间戳(-nt): 直接输出文本
        const lines = output.split('\n')
        const textLines: string[] = []

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            
            // 跳过日志行
            if (trimmed.startsWith('[') && !trimmed.includes('-->')) {
                continue
            }
            
            // 匹配带时间戳的格式: [00:00:00.000 --> 00:00:05.000] 文本
            const timestampMatch = trimmed.match(/\[[\d:.]+\s+-->\s+[\d:.]+\]\s+(.+)/)
            if (timestampMatch) {
                textLines.push(timestampMatch[1].trim())
                continue
            }
            
            // 如果不是日志行且不为空，直接作为文本
            if (!trimmed.startsWith('whisper_') && 
                !trimmed.startsWith('system_info:') &&
                !trimmed.includes('processing') &&
                !trimmed.includes('load time') &&
                trimmed.length > 0) {
                textLines.push(trimmed)
            }
        }

        return textLines.join(' ').trim()
    }

    /**
     * 下载模型（使用 GGML 格式）
     */
    async downloadModel(
        modelType: keyof typeof MODELS,
        onProgress?: (progress: { downloadedBytes: number; totalBytes?: number; percent?: number }) => void
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const config = MODELS[modelType]
            const modelPath = join(this.modelsDir, config.filename)

            // 使用 ModelScope iceCream2025 仓库（已验证可用）
            const url = `https://modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/${config.filename}`

            await this.downloadFile(url, modelPath, (downloaded, total) => {
                const percent = total ? (downloaded / total) * 100 : undefined
                onProgress?.({
                    downloadedBytes: downloaded,
                    totalBytes: config.size,
                    percent
                })
            })
            return { success: true }
        } catch (error) {
            console.error('[Whisper] 下载失败:', error)
            return { success: false, error: String(error) }
        }
    }

    /**
     * 下载文件（支持重定向和超时重试）
     */
    private downloadFile(
        url: string,
        targetPath: string,
        onProgress?: (downloaded: number, total?: number) => void,
        remainingRedirects = 5,
        timeout = 30000 // 30秒超时
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http

            const request = protocol.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                },
                timeout
            }, (response) => {
                // 处理重定向
                if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
                    if (remainingRedirects <= 0) {
                        reject(new Error('重定向次数过多'))
                        return
                    }

                    this.downloadFile(response.headers.location, targetPath, onProgress, remainingRedirects - 1, timeout)
                        .then(resolve)
                        .catch(reject)
                    return
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`下载失败: HTTP ${response.statusCode}`))
                    return
                }

                const totalBytes = Number(response.headers['content-length'] || 0) || undefined
                let downloadedBytes = 0

                const writer = createWriteStream(targetPath)

                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length
                    onProgress?.(downloadedBytes, totalBytes)
                })

                response.on('error', reject)
                writer.on('error', reject)
                writer.on('finish', () => {
                    writer.close()
                    resolve()
                })

                response.pipe(writer)
            })

            request.on('error', reject)
            request.on('timeout', () => {
                request.destroy()
                reject(new Error('下载超时'))
            })
        })
    }

    /**
     * 清理资源
     */
    dispose() {
        // 无需特殊清理
    }
}

export const voiceTranscribeServiceWhisper = new VoiceTranscribeServiceWhisper()
