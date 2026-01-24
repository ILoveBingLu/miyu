/**
 * 语音转写服务
 * 负责模型管理（下载、校验）和转写任务调度
 * 支持转写结果缓存
 */
import { app } from 'electron'
import { existsSync, mkdirSync, statSync, unlinkSync, createWriteStream } from 'fs'
import { join } from 'path'
import * as https from 'https'
import * as http from 'http'
import Database from 'better-sqlite3'
import { ConfigService } from './config'

// 模型信息
interface ModelInfo {
    name: string
    files: {
        model: string
        tokens: string
    }
    sizeBytes: number
    sizeLabel: string
}

// 下载进度
interface DownloadProgress {
    modelName: string
    downloadedBytes: number
    totalBytes?: number
    percent?: number
}

// 模型类型
type ModelType = 'int8' | 'float32'

// SenseVoice 模型配置（按类型）
const SENSEVOICE_MODELS: Record<ModelType, ModelInfo> = {
    int8: {
        name: 'SenseVoice (int8 量化版)',
        files: {
            model: 'model.int8.onnx',
            tokens: 'tokens.txt'
        },
        sizeBytes: 235_000_000,
        sizeLabel: '235 MB'
    },
    float32: {
        name: 'SenseVoice (float32 完整版)',
        files: {
            model: 'model.onnx',
            tokens: 'tokens.txt'
        },
        sizeBytes: 920_000_000,
        sizeLabel: '920 MB'
    }
}

// 模型下载地址 (ModelScope)
const MODEL_DOWNLOAD_URLS: Record<ModelType, { model: string; tokens: string }> = {
    int8: {
        model: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/model.int8.onnx',
        tokens: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/tokens.txt'
    },
    float32: {
        model: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/model.onnx',
        tokens: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/tokens.txt'
    }
}

export class VoiceTranscribeService {
    private configService = new ConfigService()
    private downloadTasks = new Map<string, Promise<{ success: boolean; path?: string; error?: string }>>()
    private cacheDb: Database.Database | null = null

    constructor() {
        this.initCacheDb()
    }

    /**
     * 获取当前配置的模型类型
     */
    private getCurrentModelType(): ModelType {
        return this.configService.get('sttModelType') || 'int8'
    }

    /**
     * 获取当前模型配置
     */
    private getCurrentModel(): ModelInfo {
        return SENSEVOICE_MODELS[this.getCurrentModelType()]
    }

    /**
     * 获取当前模型的下载 URL
     */
    private getCurrentModelUrls() {
        return MODEL_DOWNLOAD_URLS[this.getCurrentModelType()]
    }

    /**
     * 初始化缓存数据库
     */
    private initCacheDb(): void {
        try {
            const cachePath = this.configService.get('cachePath')
            const cacheDir = cachePath || join(app.getPath('appData'), 'ciphertalk')

            if (!existsSync(cacheDir)) {
                mkdirSync(cacheDir, { recursive: true })
            }

            const dbPath = join(cacheDir, 'stt-cache.db')
            this.cacheDb = new Database(dbPath)

            // 创建缓存表
            this.cacheDb.exec(`
                CREATE TABLE IF NOT EXISTS transcript_cache (
                    cache_key TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    create_time INTEGER NOT NULL,
                    transcript TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
            `)

            // 创建索引
            this.cacheDb.exec(`
                CREATE INDEX IF NOT EXISTS idx_session_time 
                ON transcript_cache(session_id, create_time)
            `)


        } catch (e) {
            console.error('[VoiceTranscribe] 缓存数据库初始化失败:', e)
            this.cacheDb = null
        }
    }

    /**
     * 生成缓存 key
     */
    private getCacheKey(sessionId: string, createTime: number): string {
        return `${sessionId}:${createTime}`
    }

    /**
     * 查询缓存
     */
    getCachedTranscript(sessionId: string, createTime: number): string | null {
        if (!this.cacheDb) return null

        try {
            const cacheKey = this.getCacheKey(sessionId, createTime)
            const row = this.cacheDb.prepare(
                'SELECT transcript FROM transcript_cache WHERE cache_key = ?'
            ).get(cacheKey) as { transcript: string } | undefined

            if (row) {

                return row.transcript
            }
            return null
        } catch (e) {
            console.error('[VoiceTranscribe] 查询缓存失败:', e)
            return null
        }
    }

    /**
     * 保存到缓存
     */
    saveTranscriptCache(sessionId: string, createTime: number, transcript: string): void {
        if (!this.cacheDb || !transcript) return

        try {
            const cacheKey = this.getCacheKey(sessionId, createTime)
            this.cacheDb.prepare(`
                INSERT OR REPLACE INTO transcript_cache 
                (cache_key, session_id, create_time, transcript, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(cacheKey, sessionId, createTime, transcript, Date.now())


        } catch (e) {
            console.error('[VoiceTranscribe] 保存缓存失败:', e)
        }
    }

    /**
     * 清理模型文件
     */
    async clearModel(): Promise<{ success: boolean; error?: string }> {
        try {
            const modelDir = this.resolveModelDir()
            if (!existsSync(modelDir)) {
                return { success: true }
            }

            // 清理所有可能的模型文件（int8 和 float32）
            const filesToClean = [
                SENSEVOICE_MODELS.int8.files.model,
                SENSEVOICE_MODELS.int8.files.tokens,
                SENSEVOICE_MODELS.float32.files.model
            ]

            for (const file of filesToClean) {
                const filePath = join(modelDir, file)
                if (existsSync(filePath)) {
                    unlinkSync(filePath)
                }
            }

            // 尝试删除目录（如果为空）
            try {
                // 读取目录，看是否为空
                const fs = require('fs')
                const remaining = fs.readdirSync(modelDir)
                if (remaining.length === 0) {
                    fs.rmdirSync(modelDir)
                }
            } catch {
                // 忽略删目录错误
            }

            return { success: true }
        } catch (e) {
            console.error('[VoiceTranscribe] 清理模型失败:', e)
            return { success: false, error: String(e) }
        }
    }

    /**
     * 获取模型存储目录
     * 注意：sherpa-onnx 的 C++ 底层无法正确处理中文路径，
     * 所以强制使用 APPDATA 目录（通常不含中文）
     */
    private resolveModelDir(): string {
        // 强制使用 APPDATA 目录，避免中文路径问题
        // Windows: C:\Users\<username>\AppData\Roaming\ciphertalk\models\sensevoice
        return join(app.getPath('appData'), 'ciphertalk', 'models', 'sensevoice')
    }

    /**
     * 获取模型文件完整路径
     */
    private resolveModelPath(fileName: string): string {
        return join(this.resolveModelDir(), fileName)
    }

    /**
     * 检查模型状态
     */
    async getModelStatus(): Promise<{
        success: boolean
        exists?: boolean
        modelPath?: string
        tokensPath?: string
        sizeBytes?: number
        error?: string
    }> {
        try {
            const currentModel = this.getCurrentModel()
            const modelPath = this.resolveModelPath(currentModel.files.model)
            const tokensPath = this.resolveModelPath(currentModel.files.tokens)

            const modelExists = existsSync(modelPath)
            const tokensExists = existsSync(tokensPath)
            const exists = modelExists && tokensExists

            if (!exists) {
                return { success: true, exists: false, modelPath, tokensPath }
            }

            const modelSize = statSync(modelPath).size
            const tokensSize = statSync(tokensPath).size
            const totalSize = modelSize + tokensSize

            return {
                success: true,
                exists: true,
                modelPath,
                tokensPath,
                sizeBytes: totalSize
            }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    }

    /**
     * 下载模型文件
     */
    async downloadModel(
        onProgress?: (progress: DownloadProgress) => void
    ): Promise<{ success: boolean; modelPath?: string; tokensPath?: string; error?: string }> {
        const cacheKey = 'sensevoice'
        const pending = this.downloadTasks.get(cacheKey)
        if (pending) return pending

        const task = (async () => {
            try {
                const modelDir = this.resolveModelDir()
                if (!existsSync(modelDir)) {
                    mkdirSync(modelDir, { recursive: true })
                }

                const currentModel = this.getCurrentModel()
                const currentUrls = this.getCurrentModelUrls()
                const modelPath = this.resolveModelPath(currentModel.files.model)
                const tokensPath = this.resolveModelPath(currentModel.files.tokens)

                // 下载模型文件 (60%)
                await this.downloadToFile(
                    currentUrls.model,
                    modelPath,
                    'model',
                    (downloaded, total) => {
                        const percent = total ? (downloaded / total) * 60 : undefined
                        onProgress?.({
                            modelName: currentModel.name,
                            downloadedBytes: downloaded,
                            totalBytes: currentModel.sizeBytes,
                            percent
                        })
                    }
                )

                // 下载 tokens 文件 (40%)
                await this.downloadToFile(
                    currentUrls.tokens,
                    tokensPath,
                    'tokens',
                    (downloaded, total) => {
                        const modelSize = existsSync(modelPath) ? statSync(modelPath).size : 0
                        const percent = total ? 60 + (downloaded / total) * 40 : 60
                        onProgress?.({
                            modelName: currentModel.name,
                            downloadedBytes: modelSize + downloaded,
                            totalBytes: currentModel.sizeBytes,
                            percent
                        })
                    }
                )

                return { success: true, modelPath, tokensPath }
            } catch (error) {
                // 下载失败时清理已下载的文件
                const currentModel = this.getCurrentModel()
                const modelPath = this.resolveModelPath(currentModel.files.model)
                const tokensPath = this.resolveModelPath(currentModel.files.tokens)
                try {
                    if (existsSync(modelPath)) unlinkSync(modelPath)
                    if (existsSync(tokensPath)) unlinkSync(tokensPath)
                } catch { }
                return { success: false, error: String(error) }
            } finally {
                this.downloadTasks.delete(cacheKey)
            }
        })()

        this.downloadTasks.set(cacheKey, task)
        return task
    }

    /**
     * 转写 WAV 音频数据
     */
    async transcribeWavBuffer(
        wavData: Buffer,
        onPartial?: (text: string) => void
    ): Promise<{ success: boolean; transcript?: string; error?: string }> {
        return new Promise((resolve) => {
            try {
                const currentModel = this.getCurrentModel()
                const modelPath = this.resolveModelPath(currentModel.files.model)
                const tokensPath = this.resolveModelPath(currentModel.files.tokens)

                if (!existsSync(modelPath)) {
                    console.error('[VoiceTranscribe] 模型文件不存在:', modelPath)
                    resolve({ success: false, error: '模型文件不存在，请先下载模型' })
                    return
                }
                if (!existsSync(tokensPath)) {
                    console.error('[VoiceTranscribe] Tokens 文件不存在:', tokensPath)
                    resolve({ success: false, error: 'Tokens 文件不存在，请先下载模型' })
                    return
                }

                const { Worker } = require('worker_threads')
                const workerPath = join(__dirname, 'transcribeWorker.js')


                if (!existsSync(workerPath)) {
                    console.error('[VoiceTranscribe] Worker 文件不存在:', workerPath)
                    resolve({ success: false, error: 'Worker 文件不存在: ' + workerPath })
                    return
                }

                const sttLanguages = this.configService.get('sttLanguages') || []
                const language = sttLanguages.length === 1 ? sttLanguages[0] : (sttLanguages.length > 1 ? '' : 'zh')

                const worker = new Worker(workerPath, {
                    workerData: {
                        modelPath,
                        tokensPath,
                        wavData,
                        sampleRate: 16000,
                        language,
                        allowedLanguages: sttLanguages
                    }
                })

                let finalTranscript = ''

                worker.on('message', (msg: any) => {

                    if (msg.type === 'partial') {
                        onPartial?.(msg.text)
                    } else if (msg.type === 'final') {
                        finalTranscript = msg.text

                        resolve({ success: true, transcript: finalTranscript })
                        worker.terminate()
                    } else if (msg.type === 'error') {
                        console.error('[VoiceTranscribe] Worker 错误:', msg.error)
                        resolve({ success: false, error: msg.error })
                        worker.terminate()
                    }
                })

                worker.on('error', (err: Error) => {
                    console.error('[VoiceTranscribe] Worker 异常:', err)
                    resolve({ success: false, error: String(err) })
                })

                worker.on('exit', (code: number) => {
                    if (code !== 0) {

                        resolve({ success: false, error: `Worker 异常退出，代码: ${code}` })
                    }
                })

            } catch (error) {
                console.error('[VoiceTranscribe] 转写异常:', error)
                resolve({ success: false, error: String(error) })
            }
        })
    }

    /**
     * 下载文件到本地
     */
    private downloadToFile(
        url: string,
        targetPath: string,
        fileName: string,
        onProgress?: (downloaded: number, total?: number) => void,
        remainingRedirects = 5
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http


            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }

            const request = protocol.get(url, options, (response) => {
                // 处理重定向
                if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
                    if (remainingRedirects <= 0) {
                        reject(new Error('重定向次数过多'))
                        return
                    }

                    this.downloadToFile(response.headers.location, targetPath, fileName, onProgress, remainingRedirects - 1)
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

                response.on('error', (error) => {
                    try { writer.close() } catch { }
                    reject(error)
                })

                writer.on('error', (error) => {
                    try { writer.close() } catch { }
                    reject(error)
                })

                writer.on('finish', () => {
                    writer.close()

                    resolve()
                })

                response.pipe(writer)
            })

            request.on('error', (error) => {
                console.error(`[VoiceTranscribe] ${fileName} 下载错误:`, error)
                reject(error)
            })
        })
    }

    /**
     * 清理资源
     */
    dispose() {
        // 目前无需特殊清理
    }
}

export const voiceTranscribeService = new VoiceTranscribeService()
