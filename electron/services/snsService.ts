import { wcdbService } from './wcdbService'
import { ConfigService } from './config'
import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import crypto from 'crypto'
import zlib from 'zlib'
import { chatService } from './chatService'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { WasmService } from './wasmService'
import { Isaac64 } from './isaac64'

export interface SnsLivePhoto {
    url: string
    thumb: string
    md5?: string
    token?: string
    key?: string
    encIdx?: string
}

export interface SnsMedia {
    url: string
    thumb: string
    md5?: string
    token?: string
    key?: string
    thumbKey?: string  // 缩略图的解密密钥（可能和原图不同）
    encIdx?: string
    livePhoto?: SnsLivePhoto
    width?: number   // 媒体原始宽度（从 XML <size> 提取）
    height?: number  // 媒体原始高度（从 XML <size> 提取）
}

export interface SnsShareInfo {
    title: string
    description: string
    contentUrl: string
    thumbUrl: string
    thumbKey?: string
    thumbToken?: string
    appName?: string
    type?: number
}

export interface SnsCommentEmoji {
    url: string
    md5: string
    width: number
    height: number
    encryptUrl?: string
    aesKey?: string
}

export interface SnsCommentImage {
    url: string
    token?: string
    key?: string
    encIdx?: string
    thumbUrl?: string
    thumbUrlToken?: string
    thumbKey?: string
    thumbEncIdx?: string
    width?: number
    height?: number
    heightPercentage?: number
    fileSize?: number
    minArea?: number
    mediaId?: string
    md5?: string
}

export interface SnsComment {
    id: string
    nickname: string
    content: string
    refCommentId: string
    refNickname?: string
    emojis?: SnsCommentEmoji[]
    images?: SnsCommentImage[]
}

export interface SnsPost {
    id: string
    username: string
    nickname: string
    avatarUrl?: string
    createTime: number
    contentDesc: string
    type?: number
    media: SnsMedia[]
    shareInfo?: SnsShareInfo
    likes: string[]
    comments: SnsComment[]
    rawXml?: string
}

const fixSnsUrl = (url: string, token?: string, isVideo: boolean = false) => {
    if (!url) return url

    // 解码HTML实体
    let fixedUrl = url.replace(/&amp;/g, '&')

    // HTTP → HTTPS
    fixedUrl = fixedUrl.replace('http://', 'https://')

    // 图片：/150 → /0 获取原图（视频不需要）
    if (!isVideo) {
        fixedUrl = fixedUrl.replace(/\/150($|\?)/, '/0$1')
    }

    // 如果URL中已经包含token，直接返回，不要重复添加
    if (fixedUrl.includes('token=')) {
        return fixedUrl
    }

    // 如果没有token参数，且提供了token，则添加
    if (token && token.trim().length > 0) {
        if (isVideo) {
            // 视频：token必须放在参数最前面
            const urlParts = fixedUrl.split('?')
            const baseUrl = urlParts[0]
            const existingParams = urlParts[1] ? `&${urlParts[1]}` : ''
            return `${baseUrl}?token=${token}&idx=1${existingParams}`
        } else {
            // 图片：token追加到末尾
            const connector = fixedUrl.includes('?') ? '&' : '?'
            return `${fixedUrl}${connector}token=${token}&idx=1`
        }
    }

    return fixedUrl
}

const detectImageMime = (buf: Buffer, fallback: string = 'image/jpeg') => {
    if (!buf || buf.length < 4) return fallback
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
    if (buf.length >= 6) {
        const sig = buf.subarray(0, 6).toString('ascii')
        if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif'
    }
    if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
    if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
    if (buf.length > 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4'
    if (fallback.includes('video') || fallback.includes('mp4')) return 'video/mp4'
    return fallback
}

export const isVideoUrl = (url: string) => {
    if (!url) return false
    if (url.includes('vweixinthumb')) return false
    return url.includes('snsvideodownload') || url.includes('video') || url.includes('.mp4')
}

// 从XML中提取视频密钥
const extractVideoKey = (xml: string): string | undefined => {
    if (!xml) return undefined
    const match = xml.match(/<enc\s+key="(\d+)"/i)
    return match ? match[1] : undefined
}

// 从XML中提取分享信息
// type=3：链接/公众号文章/音乐等
// type=28：视频号 finderFeed
const extractShareInfo = (xml: string): SnsShareInfo | undefined => {
    if (!xml) return undefined;

    const contentObjMatch = xml.match(/<ContentObject>([\s\S]*?)<\/ContentObject>/i);
    if (!contentObjMatch) return undefined;

    const contentXml = contentObjMatch[1];
    const typeMatch = contentXml.match(/<type>(\d+)<\/type>/i);
    const shareType = typeMatch ? parseInt(typeMatch[1], 10) : undefined;

    const unescapeXml = (str: string) =>
        str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

    // ==================== type=28: 视频号 ====================
    if (shareType === 28) {
        const finderMatch = contentXml.match(/<finderFeed>([\s\S]*?)<\/finderFeed>/i);
        if (!finderMatch) return undefined;
        const finderXml = finderMatch[1];

        const nicknameMatch = finderXml.match(/<nickname>([\s\S]*?)<\/nickname>/i);
        const descMatch = finderXml.match(/<desc>([\s\S]*?)<\/desc>/i);
        const avatarMatch = finderXml.match(/<avatar>([\s\S]*?)<\/avatar>/i);

        // 封面图：从 finderFeed 内部的 mediaList 取 thumbUrl 或 coverUrl
        let thumbUrl = '';
        let videoUrl = '';
        const finderMediaMatch = finderXml.match(/<mediaList>([\s\S]*?)<\/mediaList>/i);
        if (finderMediaMatch) {
            const mediaXml = finderMediaMatch[1];
            const coverUrlMatch = mediaXml.match(/<coverUrl>([\s\S]*?)<\/coverUrl>/i);
            const thumbUrlMatch = mediaXml.match(/<thumbUrl>([\s\S]*?)<\/thumbUrl>/i);
            const urlMatch = mediaXml.match(/<url>([\s\S]*?)<\/url>/i);
            if (coverUrlMatch && coverUrlMatch[1].trim()) {
                thumbUrl = unescapeXml(coverUrlMatch[1]);
            } else if (thumbUrlMatch && thumbUrlMatch[1].trim()) {
                thumbUrl = unescapeXml(thumbUrlMatch[1]);
            }
            if (urlMatch && urlMatch[1].trim()) {
                videoUrl = unescapeXml(urlMatch[1]);
            }
        }

        // 若没有封面图，取视频号头像作为兜底
        if (!thumbUrl && avatarMatch && avatarMatch[1].trim()) {
            thumbUrl = unescapeXml(avatarMatch[1]);
        }

        return {
            title: nicknameMatch ? unescapeXml(nicknameMatch[1]) : '视频号',
            description: descMatch ? unescapeXml(descMatch[1]) : '',
            contentUrl: videoUrl,
            thumbUrl,
            appName: '视频号',
            type: shareType
        };
    }

    // ==================== type=3: 链接/公众号/音乐 ====================
    if (shareType !== 3) return undefined;

    const titleMatch = contentXml.match(/<title>([\s\S]*?)<\/title>/i);
    if (!titleMatch) return undefined;

    const descMatch = contentXml.match(/<description>([\s\S]*?)<\/description>/i);
    const urlMatch = contentXml.match(/<contentUrl>([\s\S]*?)<\/contentUrl>/i);

    let thumbUrl = '';
    let thumbKey: string | undefined;
    let thumbToken: string | undefined;

    // 1. 优先 <thumburl>
    const thumbUrlTag = contentXml.match(/<thumburl[^>]*>([\s\S]*?)<\/thumburl>/i);
    if (thumbUrlTag && thumbUrlTag[1].trim()) {
        thumbUrl = unescapeXml(thumbUrlTag[1]);
    } else {
        // 2. <thumb> 节点（ContentObject 内 或 整个 xml 内）
        let thumbMatch = contentXml.match(/<thumb([^>]*)>([\s\S]*?)<\/thumb>/i);
        if (!thumbMatch) {
            thumbMatch = xml.match(/<thumb([^>]*)>([\s\S]*?)<\/thumb>/i);
        }
        if (thumbMatch && thumbMatch[2].trim()) {
            thumbUrl = unescapeXml(thumbMatch[2]);
            const keyM = thumbMatch[1].match(/key="([^"]+)"/i);
            const tokM = thumbMatch[1].match(/token="([^"]+)"/i);
            if (keyM) thumbKey = keyM[1];
            if (tokM) thumbToken = tokM[1];
        } else {
            // 3. cover_pic_image_url
            const coverMatch = xml.match(/<cover_pic_image_url>([\s\S]*?)<\/cover_pic_image_url>/i);
            if (coverMatch && coverMatch[1].trim()) {
                thumbUrl = unescapeXml(coverMatch[1]);
            }
        }
    }

    // appName
    let appName: string | undefined;
    const appInfoMatch = xml.match(/<appInfo>([\s\S]*?)<\/appInfo>/i);
    if (appInfoMatch) {
        const nameMatch = appInfoMatch[1].match(/<appName>([\s\S]*?)<\/appName>/i);
        if (nameMatch) appName = nameMatch[1];
    }

    // 公众号来源名称（无 appName 时使用）
    let sourceName: string | undefined;
    const sourceNickMatch = xml.match(/<sourceNickName>([\s\S]*?)<\/sourceNickName>/i);
    if (sourceNickMatch && sourceNickMatch[1].trim()) {
        sourceName = unescapeXml(sourceNickMatch[1]);
    }

    return {
        title: unescapeXml(titleMatch[1]),
        description: descMatch ? unescapeXml(descMatch[1]) : '',
        contentUrl: urlMatch ? unescapeXml(urlMatch[1]) : '',
        thumbUrl,
        thumbKey,
        thumbToken,
        appName: appName ? unescapeXml(appName) : (sourceName ?? undefined),
        type: shareType
    };
}


class SnsService {
    private configService: ConfigService
    private imageCache = new Map<string, string>()
    private snsDb: Database.Database | null = null

    constructor() {
        this.configService = new ConfigService()
    }

    /**
     * 获取解密后的数据库目录
     */
    private getDecryptedDbDir(): string {
        const cachePath = this.configService.get('cachePath')
        if (cachePath) return cachePath

        // 开发环境使用文档目录
        if (process.env.VITE_DEV_SERVER_URL) {
            const documentsPath = app.getPath('documents')
            return join(documentsPath, 'CipherTalkData')
        }

        // 生产环境
        const exePath = app.getPath('exe')
        const installDir = dirname(exePath)

        // 检查是否安装在 C 盘
        const isOnCDrive = /^[cC]:/i.test(installDir) || installDir.startsWith('\\')

        if (isOnCDrive) {
            const documentsPath = app.getPath('documents')
            return join(documentsPath, 'CipherTalkData')
        }

        return join(installDir, 'CipherTalkData')
    }

    /**
     * 清理账号目录名
     */
    private cleanAccountDirName(dirName: string): string {
        const trimmed = dirName.trim()
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
     */
    private findAccountDir(baseDir: string, wxid: string): string | null {
        if (!existsSync(baseDir)) return null

        const cleanedWxid = this.cleanAccountDirName(wxid)

        // 1. 直接匹配原始 wxid
        const directPath = join(baseDir, wxid)
        if (existsSync(directPath)) {
            return wxid
        }

        // 2. 直接匹配清理后的 wxid
        if (cleanedWxid !== wxid) {
            const cleanedPath = join(baseDir, cleanedWxid)
            if (existsSync(cleanedPath)) {
                return cleanedWxid
            }
        }

        // 3. 遍历目录查找匹配
        try {
            const entries = require('fs').readdirSync(baseDir)
            for (const entry of entries) {
                const entryPath = join(baseDir, entry)
                const stat = require('fs').statSync(entryPath)
                if (!stat.isDirectory()) continue

                const cleanedEntry = this.cleanAccountDirName(entry)
                if (cleanedEntry === cleanedWxid || cleanedEntry === wxid) {
                    return entry
                }
            }
        } catch (e) {
            console.error('[SnsService] 遍历目录失败:', e)
        }

        return null
    }

    /**
     * 打开 SNS 数据库（解密后的）
     */
    private openSnsDatabase(): boolean {
        if (this.snsDb) return true

        try {
            const wxid = this.configService.get('myWxid')

            if (!wxid) {
                console.error('[SnsService] wxid 未配置')
                return false
            }

            // 获取解密后的数据库目录
            const baseDir = this.getDecryptedDbDir()
            const accountDir = this.findAccountDir(baseDir, wxid)

            if (!accountDir) {
                console.error('[SnsService] 未找到账号目录:', wxid)
                return false
            }

            const snsDbPath = join(baseDir, accountDir, 'sns.db')

            if (!existsSync(snsDbPath)) {
                console.error('[SnsService] SNS 数据库不存在:', snsDbPath)
                return false
            }

            // 打开解密后的数据库（不需要密钥）
            this.snsDb = new Database(snsDbPath, { readonly: true })

            // 测试连接
            this.snsDb.prepare('SELECT COUNT(*) as count FROM SnsTimeLine').get()

            return true
        } catch (error) {
            console.error('[SnsService] 打开 SNS 数据库失败:', error)
            this.snsDb = null
            return false
        }
    }

    /**
     * 关闭 SNS 数据库连接，释放文件锁
     */
    closeSnsDb(): void {
        if (this.snsDb) {
            try {
                this.snsDb.close()
            } catch (e) {
                // 忽略关闭错误
            }
            this.snsDb = null
        }
    }

    /**
     * 从 XML 中解析点赞信息
     */
    private parseLikesFromXml(xml: string): string[] {
        if (!xml) return []

        const likes: string[] = []
        try {
            // 方式1: 查找 <LikeUserList> 标签
            let likeListMatch = xml.match(/<LikeUserList>([\s\S]*?)<\/LikeUserList>/i)

            // 方式2: 如果没找到，尝试查找 <likeUserList>（小写）
            if (!likeListMatch) {
                likeListMatch = xml.match(/<likeUserList>([\s\S]*?)<\/likeUserList>/i)
            }

            // 方式3: 尝试查找 <likeList>
            if (!likeListMatch) {
                likeListMatch = xml.match(/<likeList>([\s\S]*?)<\/likeList>/i)
            }

            // 方式4: 尝试查找 <like_user_list>（下划线格式，来自 LocalExtraInfo）
            if (!likeListMatch) {
                likeListMatch = xml.match(/<like_user_list>([\s\S]*?)<\/like_user_list>/i)
            }

            if (!likeListMatch) return likes

            const likeListXml = likeListMatch[1]

            // 提取所有 <LikeUser> 或 <likeUser> 或 <user_comment> 标签
            const likeUserRegex = /<(?:LikeUser|likeUser|user_comment)>([\s\S]*?)<\/(?:LikeUser|likeUser|user_comment)>/gi
            let likeUserMatch

            while ((likeUserMatch = likeUserRegex.exec(likeListXml)) !== null) {
                const likeUserXml = likeUserMatch[1]

                // 提取昵称（可能是 nickname 或 nickName）
                let nicknameMatch = likeUserXml.match(/<nickname>([^<]*)<\/nickname>/i)
                if (!nicknameMatch) {
                    nicknameMatch = likeUserXml.match(/<nickName>([^<]*)<\/nickName>/i)
                }

                if (nicknameMatch) {
                    likes.push(nicknameMatch[1].trim())
                }
            }
        } catch (error) {
            console.error('[SnsService] 解析点赞失败:', error)
        }

        return likes
    }

    /**
     * 从 XML 中解析评论信息
     */
    private parseCommentsFromXml(xml: string): SnsComment[] {
        if (!xml) return []

        type CommentItem = {
            id: string
            nickname: string
            username?: string
            content: string
            refCommentId: string
            refUsername?: string
            refNickname?: string
            emojis?: SnsCommentEmoji[]
            images?: SnsCommentImage[]
        }
        const comments: CommentItem[] = []
        try {
            // 方式1: 查找 <CommentUserList> 标签
            let commentListMatch = xml.match(/<CommentUserList>([\s\S]*?)<\/CommentUserList>/i)

            // 方式2: 如果没找到，尝试查找 <commentUserList>（小写）
            if (!commentListMatch) {
                commentListMatch = xml.match(/<commentUserList>([\s\S]*?)<\/commentUserList>/i)
            }

            // 方式3: 尝试查找 <commentList>
            if (!commentListMatch) {
                commentListMatch = xml.match(/<commentList>([\s\S]*?)<\/commentList>/i)
            }

            // 方式4: 尝试查找 <comment_user_list>（下划线格式，来自 LocalExtraInfo）
            if (!commentListMatch) {
                commentListMatch = xml.match(/<comment_user_list>([\s\S]*?)<\/comment_user_list>/i)
            }

            if (!commentListMatch) return comments

            const commentListXml = commentListMatch[1]

            // 提取所有评论标签（支持多种格式）
            const commentUserRegex = /<(?:CommentUser|commentUser|comment|user_comment)>([\s\S]*?)<\/(?:CommentUser|commentUser|comment|user_comment)>/gi
            let commentUserMatch

            while ((commentUserMatch = commentUserRegex.exec(commentListXml)) !== null) {
                const commentUserXml = commentUserMatch[1]

                // 提取评论 ID（支持 cmtid, commentId, id, comment_id）
                const idMatch = commentUserXml.match(/<(?:cmtid|commentId|comment_id|id)>([^<]*)<\/(?:cmtid|commentId|comment_id|id)>/i)

                // 提取用户名/wxid（用于回复关系解析）
                const usernameMatch = commentUserXml.match(/<username>([^<]*)<\/username>/i)

                // 提取昵称
                let nicknameMatch = commentUserXml.match(/<nickname>([^<]*)<\/nickname>/i)
                if (!nicknameMatch) {
                    nicknameMatch = commentUserXml.match(/<nickName>([^<]*)<\/nickName>/i)
                }

                // 提取评论内容（content 可能为空，比如纯表情包评论）
                const contentMatch = commentUserXml.match(/<content>([^<]*)<\/content>/i)

                // 提取回复的评论 ID（支持下划线格式 ref_comment_id）
                const refCommentIdMatch = commentUserXml.match(/<(?:refCommentId|replyCommentId|ref_comment_id)>([^<]*)<\/(?:refCommentId|replyCommentId|ref_comment_id)>/i)

                // 提取被回复者昵称
                const refNicknameMatch = commentUserXml.match(/<(?:refNickname|refNickName|replyNickname)>([^<]*)<\/(?:refNickname|refNickName|replyNickname)>/i)

                // 提取被回复者用户名（下划线格式 ref_username）
                const refUsernameMatch = commentUserXml.match(/<ref_username>([^<]*)<\/ref_username>/i)

                // 提取表情包信息
                const emojis: SnsCommentEmoji[] = []
                const emojiRegex = /<emojiinfo>([\s\S]*?)<\/emojiinfo>/gi
                let emojiMatch
                while ((emojiMatch = emojiRegex.exec(commentUserXml)) !== null) {
                    const emojiXml = emojiMatch[1]
                    // 优先 extern_url（公开可访问），其次 cdn_url，最后 url
                    const externUrlMatch = emojiXml.match(/<extern_url>([^<]*)<\/extern_url>/i)
                    const cdnUrlMatch = emojiXml.match(/<cdn_url>([^<]*)<\/cdn_url>/i)
                    const plainUrlMatch = emojiXml.match(/<url>([^<]*)<\/url>/i)
                    const emojiUrlMatch = externUrlMatch || cdnUrlMatch || plainUrlMatch
                    const emojiMd5Match = emojiXml.match(/<md5>([^<]*)<\/md5>/i)
                    const emojiWidthMatch = emojiXml.match(/<width>([^<]*)<\/width>/i)
                    const emojiHeightMatch = emojiXml.match(/<height>([^<]*)<\/height>/i)
                    // 加密 URL 和 AES 密钥（用于解密回退）
                    const encryptUrlMatch = emojiXml.match(/<encrypt_url>([^<]*)<\/encrypt_url>/i)
                    const aesKeyMatch = emojiXml.match(/<aes_key>([^<]*)<\/aes_key>/i)

                    const url = emojiUrlMatch ? emojiUrlMatch[1].trim().replace(/&amp;/g, '&') : ''
                    const encryptUrl = encryptUrlMatch ? encryptUrlMatch[1].trim().replace(/&amp;/g, '&') : undefined
                    const aesKey = aesKeyMatch ? aesKeyMatch[1].trim() : undefined

                    if (url || encryptUrl) {
                        emojis.push({
                            url,
                            md5: emojiMd5Match ? emojiMd5Match[1].trim() : '',
                            width: emojiWidthMatch ? parseInt(emojiWidthMatch[1]) : 0,
                            height: emojiHeightMatch ? parseInt(emojiHeightMatch[1]) : 0,
                            encryptUrl,
                            aesKey
                        })
                    }
                }

                // 提取评论图片信息（评论图片走 imagelist/imageinfo）
                const images: SnsCommentImage[] = []
                const imageRegex = /<imageinfo>([\s\S]*?)<\/imageinfo>/gi
                let imageMatch
                while ((imageMatch = imageRegex.exec(commentUserXml)) !== null) {
                    const imageXml = imageMatch[1]
                    const pick = (tag: string) => {
                        const m = imageXml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i'))
                        return m ? m[1].trim().replace(/&amp;/g, '&') : ''
                    }
                    const parseNum = (value: string) => {
                        const n = parseInt(value, 10)
                        return Number.isFinite(n) ? n : undefined
                    }

                    const imageInfo: SnsCommentImage = {
                        url: pick('url'),
                        token: pick('token') || undefined,
                        key: pick('key') || undefined,
                        encIdx: pick('enc_idx') || undefined,
                        thumbUrl: pick('thumb_url') || undefined,
                        thumbUrlToken: pick('thumb_url_token') || undefined,
                        thumbKey: pick('thumb_key') || undefined,
                        thumbEncIdx: pick('thumb_enc_idx') || undefined,
                        width: parseNum(pick('width')),
                        height: parseNum(pick('height')),
                        heightPercentage: parseNum(pick('height_percentage')),
                        fileSize: parseNum(pick('file_size')),
                        minArea: parseNum(pick('min_area')),
                        mediaId: pick('media_id') || undefined,
                        md5: pick('md5') || undefined
                    }

                    if (imageInfo.url || imageInfo.thumbUrl) {
                        images.push(imageInfo)
                    }
                }

                // 昵称存在即可（content 可能为空但有表情包/图片）
                if (nicknameMatch && (contentMatch || emojis.length > 0 || images.length > 0)) {
                    const refCommentId = refCommentIdMatch ? refCommentIdMatch[1].trim() : ''
                    comments.push({
                        id: idMatch ? idMatch[1].trim() : `comment_${Date.now()}_${Math.random()}`,
                        nickname: nicknameMatch[1].trim(),
                        username: usernameMatch ? usernameMatch[1].trim() : undefined,
                        content: contentMatch ? contentMatch[1].trim() : '',
                        refCommentId: (refCommentId === '0') ? '' : refCommentId,
                        refUsername: refUsernameMatch ? refUsernameMatch[1].trim() : undefined,
                        refNickname: refNicknameMatch ? refNicknameMatch[1].trim() : undefined,
                        emojis: emojis.length > 0 ? emojis : undefined,
                        images: images.length > 0 ? images : undefined
                    })
                }
            }

            // 第二遍：通过 refUsername 解析被回复者昵称（如果 refNickname 为空）
            const usernameToNickname = new Map<string, string>()
            for (const c of comments) {
                if (c.username && c.nickname) {
                    usernameToNickname.set(c.username, c.nickname)
                }
            }
            for (const c of comments) {
                if (!c.refNickname && c.refUsername && c.refCommentId) {
                    c.refNickname = usernameToNickname.get(c.refUsername)
                }
            }
        } catch (error) {
            console.error('[SnsService] 解析评论失败:', error)
        }

        return comments
    }

    private normalizeComments(comments: SnsComment[]): SnsComment[] {
        return comments.map((c) => {
            const fixedImages = c.images?.map((img) => ({
                ...img,
                url: fixSnsUrl(img.url || '', img.token, false),
                thumbUrl: fixSnsUrl(img.thumbUrl || '', img.thumbUrlToken || img.token, false)
            }))
            return {
                ...c,
                images: fixedImages
            }
        })
    }

    /**
     * 从 XML 中解析媒体信息
     */
    private parseMediaFromXml(xml: string): { media: SnsMedia[]; videoKey?: string } {
        if (!xml) return { media: [] }

        const media: SnsMedia[] = []
        let videoKey: string | undefined

        try {
            // 提取视频密钥 <enc key="123456" />
            const encMatch = xml.match(/<enc\s+key="(\d+)"/i)
            if (encMatch) {
                videoKey = encMatch[1]
            }

            // 提取所有 <media> 标签
            const mediaRegex = /<media>([\s\S]*?)<\/media>/gi
            let mediaMatch

            while ((mediaMatch = mediaRegex.exec(xml)) !== null) {
                const mediaXml = mediaMatch[1]

                // 提取 URL（可能在属性中）
                const urlMatch = mediaXml.match(/<url[^>]*>([^<]+)<\/url>/i)
                const urlTagMatch = mediaXml.match(/<url([^>]*)>/i)

                // 提取 thumb（可能在属性中）
                const thumbMatch = mediaXml.match(/<thumb[^>]*>([^<]+)<\/thumb>/i)
                const thumbTagMatch = mediaXml.match(/<thumb([^>]*)>/i)

                // 从 url 标签的属性中提取 token, key, md5, enc_idx
                let urlToken: string | undefined
                let urlKey: string | undefined
                let urlMd5: string | undefined
                let urlEncIdx: string | undefined

                if (urlTagMatch && urlTagMatch[1]) {
                    const attrs = urlTagMatch[1]
                    const tokenMatch = attrs.match(/token="([^"]+)"/i)
                    const keyMatch = attrs.match(/key="([^"]+)"/i)
                    const md5Match = attrs.match(/md5="([^"]+)"/i)
                    const encIdxMatch = attrs.match(/enc_idx="([^"]+)"/i)

                    if (tokenMatch) urlToken = tokenMatch[1]
                    if (keyMatch) urlKey = keyMatch[1]
                    if (md5Match) urlMd5 = md5Match[1]
                    if (encIdxMatch) urlEncIdx = encIdxMatch[1]
                }

                // 从 thumb 标签的属性中提取 token, key
                let thumbToken: string | undefined
                let thumbKey: string | undefined
                let thumbEncIdx: string | undefined

                if (thumbTagMatch && thumbTagMatch[1]) {
                    const attrs = thumbTagMatch[1]
                    const tokenMatch = attrs.match(/token="([^"]+)"/i)
                    const keyMatch = attrs.match(/key="([^"]+)"/i)
                    const encIdxMatch = attrs.match(/enc_idx="([^"]+)"/i)

                    if (tokenMatch) thumbToken = tokenMatch[1]
                    if (keyMatch) thumbKey = keyMatch[1]
                    if (encIdxMatch) thumbEncIdx = encIdxMatch[1]
                }

                // 提取宽高（<size width="288" height="512" .../>）
                const sizeMatch = mediaXml.match(/<size\s+[^>]*width="(\d+)"[^>]*height="(\d+)"/i)
                    || mediaXml.match(/<size\s+[^>]*height="(\d+)"[^>]*width="(\d+)"/i)
                let mediaWidth: number | undefined
                let mediaHeight: number | undefined
                if (sizeMatch) {
                    const w = parseInt(sizeMatch[1])
                    const h = parseInt(sizeMatch[2])
                    // width/height 顺序可能被 height-first 正则颠倒，做修正
                    const sizeWMatch = mediaXml.match(/width="(\d+)"/i)
                    const sizeHMatch = mediaXml.match(/height="(\d+)"/i)
                    if (sizeWMatch && sizeHMatch) {
                        mediaWidth = parseInt(sizeWMatch[1]) || undefined
                        mediaHeight = parseInt(sizeHMatch[1]) || undefined
                    } else {
                        mediaWidth = w || undefined
                        mediaHeight = h || undefined
                    }
                }

                const mediaItem: SnsMedia = {
                    url: urlMatch ? urlMatch[1].trim() : '',
                    thumb: thumbMatch ? thumbMatch[1].trim() : '',
                    token: urlToken || thumbToken,
                    key: urlKey || thumbKey,  // 原图的 key
                    thumbKey: thumbKey,  // 缩略图的 key（可能和原图不同）
                    md5: urlMd5,
                    encIdx: urlEncIdx || thumbEncIdx,
                    width: mediaWidth,
                    height: mediaHeight
                }

                // 检查是否有实况照片 <livePhoto>
                const livePhotoMatch = mediaXml.match(/<livePhoto>([\s\S]*?)<\/livePhoto>/i)
                if (livePhotoMatch) {
                    const livePhotoXml = livePhotoMatch[1]

                    const lpUrlMatch = livePhotoXml.match(/<url[^>]*>([^<]+)<\/url>/i)
                    const lpUrlTagMatch = livePhotoXml.match(/<url([^>]*)>/i)
                    const lpThumbMatch = livePhotoXml.match(/<thumb[^>]*>([^<]+)<\/thumb>/i)
                    const lpThumbTagMatch = livePhotoXml.match(/<thumb([^>]*)>/i)

                    let lpUrlToken: string | undefined
                    let lpUrlKey: string | undefined
                    let lpUrlMd5: string | undefined
                    let lpUrlEncIdx: string | undefined

                    if (lpUrlTagMatch && lpUrlTagMatch[1]) {
                        const attrs = lpUrlTagMatch[1]
                        const tokenMatch = attrs.match(/token="([^"]+)"/i)
                        const keyMatch = attrs.match(/key="([^"]+)"/i)
                        const md5Match = attrs.match(/md5="([^"]+)"/i)
                        const encIdxMatch = attrs.match(/enc_idx="([^"]+)"/i)

                        if (tokenMatch) lpUrlToken = tokenMatch[1]
                        if (keyMatch) lpUrlKey = keyMatch[1]
                        if (md5Match) lpUrlMd5 = md5Match[1]
                        if (encIdxMatch) lpUrlEncIdx = encIdxMatch[1]
                    }

                    let lpThumbToken: string | undefined
                    let lpThumbKey: string | undefined

                    if (lpThumbTagMatch && lpThumbTagMatch[1]) {
                        const attrs = lpThumbTagMatch[1]
                        const tokenMatch = attrs.match(/token="([^"]+)"/i)
                        const keyMatch = attrs.match(/key="([^"]+)"/i)

                        if (tokenMatch) lpThumbToken = tokenMatch[1]
                        if (keyMatch) lpThumbKey = keyMatch[1]
                    }

                    mediaItem.livePhoto = {
                        url: lpUrlMatch ? lpUrlMatch[1].trim() : '',
                        thumb: lpThumbMatch ? lpThumbMatch[1].trim() : '',
                        token: lpUrlToken || lpThumbToken,
                        key: lpUrlKey || lpThumbKey,
                        md5: lpUrlMd5,
                        encIdx: lpUrlEncIdx
                    }
                }

                media.push(mediaItem)
            }
        } catch (error) {
            console.error('[SnsService] 解析 XML 失败:', error)
        }

        return { media, videoKey }
    }

    /**
     * 获取表情包缓存目录（与聊天共用同一目录）
     */
    private getEmojiCacheDir(): string {
        const cachePath = this.configService.getCacheBasePath()
        const emojiDir = join(cachePath, 'Emojis')
        if (!existsSync(emojiDir)) {
            mkdirSync(emojiDir, { recursive: true })
        }
        return emojiDir
    }

    /**
     * 解密表情数据（从 Weixin.dll 逆向得到的算法）
     *
     * 核心发现（sub_1845E6DB0 / c2c_response.cc）：
     *   nonce = key 的前 12 字节，数据格式 = [ciphertext][auth_tag (16B)]
     * 备选格式：GcmData 块、尾部 nonce、前置 nonce 等
     * 解密后可能需要 zlib 解压（AesGcmDecryptWithUncompress）
     */
    private decryptEmojiAes(
        encData: Buffer,
        aesKey: string,
        debug?: { cacheKey: string; source: 'encrypt_url' | 'plain_url' }
    ): Buffer | null {
        if (encData.length <= 16) {
            return null
        }

        const keyTries = this.buildKeyTries(aesKey)
        const tag = encData.subarray(encData.length - 16)
        const ciphertext = encData.subarray(0, encData.length - 16)

        // ★ 最高优先级：IDA 确认的 nonce-tail 格式 [ciphertext][nonce 12B][tag 16B]
        // 来源：Weixin.dll sub_182687C70 (mmcrypto::AesGcmDecrypt)
        // AAD 为空（sub_180C800F0 mode=13 传 0,0），支持 AES-128/256
        if (encData.length > 28) {
            const nonceTail = encData.subarray(encData.length - 28, encData.length - 16)
            const tagTail = encData.subarray(encData.length - 16)
            const cipherTail = encData.subarray(0, encData.length - 28)
            for (const { name, key } of keyTries) {
                if (key.length !== 16 && key.length !== 32) continue
                const result = this.tryGcmDecrypt(key, nonceTail, cipherTail, tagTail)
                if (result) {
                    return result
                }
            }
        }

        // 次优先级：nonce = key 前 12 字节，data = [ciphertext][tag 16B]
        // 来源：Weixin.dll sub_1845E6DB0 (CDN c2c_response decrypt)
        for (const { name, key } of keyTries) {
            if (key.length !== 16 && key.length !== 32) continue
            const nonce = key.subarray(0, 12)
            const result = this.tryGcmDecrypt(key, nonce, ciphertext, tag)
            if (result) {
                return result
            }
        }

        // 其他备选布局
        const layouts = this.buildGcmLayouts(encData)
        for (const layout of layouts) {
            for (const { name, key } of keyTries) {
                if (key.length !== 16 && key.length !== 32) continue
                const result = this.tryGcmDecrypt(key, layout.nonce, layout.ciphertext, layout.tag)
                if (result) {
                    return result
                }
            }
        }

        // ★ 回退：尝试 AES-128-CBC / AES-128-ECB
        for (const { name, key } of keyTries) {
            if (key.length !== 16) continue
            // CBC 变体 1（IDA sub_180C80320）：IV = key 本身
            if (encData.length >= 16 && encData.length % 16 === 0) {
                try {
                    const dec = crypto.createDecipheriv('aes-128-cbc', key, key)
                    dec.setAutoPadding(true)
                    const result = Buffer.concat([dec.update(encData), dec.final()])
                    if (this.isValidImageBuffer(result)) {
                        return result
                    }
                    for (const fn of [zlib.inflateSync, zlib.gunzipSync]) {
                        try {
                            const d = fn(result)
                            if (this.isValidImageBuffer(d)) {
                                return d
                            }
                        } catch { }
                    }
                } catch { }
            }
            // CBC 变体 2：前 16 字节作为 IV
            if (encData.length > 32) {
                try {
                    const iv = encData.subarray(0, 16)
                    const cbcData = encData.subarray(16)
                    const dec = crypto.createDecipheriv('aes-128-cbc', key, iv)
                    dec.setAutoPadding(true)
                    const result = Buffer.concat([dec.update(cbcData), dec.final()])
                    if (this.isValidImageBuffer(result)) {
                        return result
                    }
                    // CBC + zlib
                    for (const fn of [zlib.inflateSync, zlib.gunzipSync]) {
                        try {
                            const d = fn(result)
                            if (this.isValidImageBuffer(d)) {
                                return d
                            }
                        } catch { }
                    }
                } catch { }
            }
            // ECB
            try {
                const dec = crypto.createDecipheriv('aes-128-ecb', key, null)
                dec.setAutoPadding(true)
                const result = Buffer.concat([dec.update(encData), dec.final()])
                if (this.isValidImageBuffer(result)) {
                    return result
                }
            } catch { }
        }

        return null
    }

    /** 构建密钥派生列表 */
    private buildKeyTries(aesKey: string): { name: string; key: Buffer }[] {
        const keyTries: { name: string; key: Buffer }[] = []
        const hexStr = aesKey.replace(/\s/g, '')
        if (hexStr.length >= 32 && /^[0-9a-fA-F]+$/.test(hexStr)) {
            try {
                const keyBuf = Buffer.from(hexStr.slice(0, 32), 'hex')
                if (keyBuf.length === 16) keyTries.push({ name: 'hex-decode', key: keyBuf })
            } catch { }
            // ★ IDA 发现：WeChat 可能直接用 hex 字符串作为 32 字节密钥 → AES-256-GCM
            // sub_182584DB0 支持 key_len=16/24/32，std::string 传递时长度为 32
            const rawKey = Buffer.from(hexStr.slice(0, 32), 'utf8')
            if (rawKey.length === 32) keyTries.push({ name: 'raw-hex-str-32', key: rawKey })
        }
        if (aesKey.length >= 16) {
            keyTries.push({ name: 'utf8-16', key: Buffer.from(aesKey, 'utf8').subarray(0, 16) })
        }
        keyTries.push({ name: 'md5', key: crypto.createHash('md5').update(aesKey).digest() })
        try {
            const b64Buf = Buffer.from(aesKey, 'base64')
            if (b64Buf.length >= 16) keyTries.push({ name: 'base64', key: b64Buf.subarray(0, 16) })
        } catch { }
        return keyTries
    }

    /** 构建多种 GCM 数据布局（nonce + ciphertext + tag 的不同拆分方式） */
    private buildGcmLayouts(encData: Buffer): { name: string; nonce: Buffer; ciphertext: Buffer; tag: Buffer }[] {
        const layouts: { name: string; nonce: Buffer; ciphertext: Buffer; tag: Buffer }[] = []

        // 格式 A：GcmData 块格式 — magic \xAB GcmData \xAB\x00 (10B), nonce at offset 19 (12B), payload at offset 63
        if (encData.length > 63 && encData[0] === 0xAB && encData[8] === 0xAB && encData[9] === 0x00) {
            const payloadSize = encData.readUInt32LE(10)
            if (payloadSize > 16 && 63 + payloadSize <= encData.length) {
                const nonce = encData.subarray(19, 31)
                const payload = encData.subarray(63, 63 + payloadSize)
                const tag = payload.subarray(payload.length - 16)
                const ciphertext = payload.subarray(0, payload.length - 16)
                layouts.push({ name: 'gcmdata-block', nonce, ciphertext, tag })
            }
        }

        // 格式 B：尾部格式 [ciphertext][nonce 12B][tag 16B]（mmcrypto::AesGcmDecrypt）
        if (encData.length > 28) {
            layouts.push({
                name: 'nonce-tail',
                ciphertext: encData.subarray(0, encData.length - 28),
                nonce: encData.subarray(encData.length - 28, encData.length - 16),
                tag: encData.subarray(encData.length - 16)
            })
        }

        // 格式 C：前置格式 [nonce 12B][ciphertext][tag 16B]
        if (encData.length > 28) {
            layouts.push({
                name: 'nonce-head',
                nonce: encData.subarray(0, 12),
                ciphertext: encData.subarray(12, encData.length - 16),
                tag: encData.subarray(encData.length - 16)
            })
        }

        // 格式 D：零 nonce，[ciphertext][tag 16B]
        if (encData.length > 16) {
            layouts.push({
                name: 'zero-nonce',
                nonce: Buffer.alloc(12, 0),
                ciphertext: encData.subarray(0, encData.length - 16),
                tag: encData.subarray(encData.length - 16)
            })
        }

        // 格式 E：前置格式 [nonce 12B][tag 16B][ciphertext]
        if (encData.length > 28) {
            layouts.push({
                name: 'nonce-tag-head',
                nonce: encData.subarray(0, 12),
                tag: encData.subarray(12, 28),
                ciphertext: encData.subarray(28)
            })
        }

        return layouts
    }

    /** 尝试 AES-GCM 解密，根据 key 长度自动选择 128/256，auth tag 通过即返回 */
    private tryGcmDecrypt(key: Buffer, nonce: Buffer, ciphertext: Buffer, tag: Buffer): Buffer | null {
        try {
            const algo = key.length === 32 ? 'aes-256-gcm' : 'aes-128-gcm'
            const decipher = crypto.createDecipheriv(algo, key, nonce)
            decipher.setAuthTag(tag)
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

            // auth tag 通过 → 解密正确
            if (this.isValidImageBuffer(decrypted)) return decrypted

            // 尝试 zlib 解压（AesGcmDecryptWithUncompress）
            for (const fn of [zlib.inflateSync, zlib.gunzipSync, zlib.unzipSync]) {
                try {
                    const decompressed = fn(decrypted)
                    if (this.isValidImageBuffer(decompressed)) return decompressed
                } catch { }
            }

            // GCM auth tag 通过但不是已知图片格式，仍然返回（可能是 lottie/tgs 等）
            console.log('[SnsService] GCM auth tag 通过但非已知图片格式', {
                size: decrypted.length,
                headHex: decrypted.subarray(0, 16).toString('hex')
            })
            return decrypted
        } catch {
            return null
        }
    }

    /** 判断 buffer 是否为有效图片头（GIF/PNG/JPEG/WebP） */
    private isValidImageBuffer(buf: Buffer): boolean {
        if (!buf || buf.length < 12) return false
        if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true // GIF
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true // PNG
        if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true // JPEG
        if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true // WebP
        return false
    }

    /** 根据图片头返回扩展名 */
    private getImageExtFromBuffer(buf: Buffer): string {
        if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif'
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png'
        if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg'
        if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return '.webp'
        return '.gif'
    }

    /**
     * 下载朋友圈评论表情包到本地缓存
     * 解密说明：优先用 XML 里的 encrypt_url + aes_key（AES-128-GCM，数据格式=[密文][nonce 12B][tag 16B]，解密后 zlib 解压）；
     * 若只有普通 url 且下载下来是加密数据，会尝试用设置里的「图片 AES 密钥」解密。
     */
    async downloadSnsEmoji(url: string, encryptUrl?: string, aesKey?: string): Promise<{ success: boolean; localPath?: string; error?: string }> {
        if (!url && !encryptUrl) return { success: false, error: 'url 不能为空' }

        const cacheKey = crypto.createHash('md5').update(url || encryptUrl!).digest('hex')
        const cacheDir = this.getEmojiCacheDir()
        const fs = require('fs')



        // 检查本地是否已有缓存
        const extensions = ['.gif', '.png', '.webp', '.jpg', '.jpeg']
        for (const ext of extensions) {
            const filePath = join(cacheDir, `${cacheKey}${ext}`)
            if (existsSync(filePath)) {
                return { success: true, localPath: filePath }
            }
        }

        // 1. 优先：有 encrypt_url + aes_key 时，下载加密内容并用多种密钥派生尝试 AES 解密
        if (encryptUrl && aesKey) {
            const encResult = await this.doDownloadRaw(encryptUrl, cacheKey + '_enc', cacheDir)
            if (encResult) {
                const encData = fs.readFileSync(encResult)
                // 有些情况下 encrypt_url 直接返回明文图片
                if (this.isValidImageBuffer(encData)) {
                    const ext = this.getImageExtFromBuffer(encData)
                    const filePath = join(cacheDir, `${cacheKey}${ext}`)
                    fs.writeFileSync(filePath, encData)
                    try { fs.unlinkSync(encResult) } catch { }
                    return { success: true, localPath: filePath }
                }
                const decrypted = this.decryptEmojiAes(encData, aesKey)
                if (decrypted) {
                    const ext = this.isValidImageBuffer(decrypted)
                        ? this.getImageExtFromBuffer(decrypted)
                        : '.gif' // GCM auth tag 通过但非已知图片格式，默认 .gif
                    const filePath = join(cacheDir, `${cacheKey}${ext}`)
                    fs.writeFileSync(filePath, decrypted)
                    try { fs.unlinkSync(encResult) } catch { }
                    return { success: true, localPath: filePath }
                }
                this.decryptEmojiAes(encData, aesKey, { cacheKey, source: 'encrypt_url' })
                try { fs.unlinkSync(encResult) } catch { }
            }
            // encrypt_url 下载失败或解密失败，继续尝试普通 url
        }

        // 2. 直接下载 extern_url / cdn_url
        if (url) {
            const result = await this.doDownloadRaw(url, cacheKey, cacheDir)
            if (result) {
                const buf = fs.readFileSync(result)
                if (this.isValidImageBuffer(buf)) {
                    return { success: true, localPath: result }
                }
                // 若有 XML 的 aes_key，优先用同一密钥解密（plain url 有时也返回加密数据）
                if (aesKey) {
                    const decrypted = this.decryptEmojiAes(buf, aesKey)
                    if (decrypted) {
                        const ext = this.isValidImageBuffer(decrypted)
                            ? this.getImageExtFromBuffer(decrypted)
                            : '.gif'
                        const filePath = join(cacheDir, `${cacheKey}${ext}`)
                        fs.writeFileSync(filePath, decrypted)
                        try { fs.unlinkSync(result) } catch { }
                        return { success: true, localPath: filePath }
                    }
                    this.decryptEmojiAes(buf, aesKey, { cacheKey, source: 'plain_url' })
                }
                // 再尝试用设置里的图片 AES 密钥解密（多种派生）
                const imageAesKey = this.configService.get('imageAesKey')
                const keyStr = typeof imageAesKey === 'string' ? imageAesKey.trim() : ''
                if (keyStr.length >= 16) {
                    const keyTries: Buffer[] = [
                        Buffer.from(keyStr, 'ascii').subarray(0, 16),
                        crypto.createHash('md5').update(keyStr).digest(),
                    ]
                    for (const keyBuf of keyTries) {
                        try {
                            const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuf, null)
                            decipher.setAutoPadding(true)
                            const decrypted = Buffer.concat([decipher.update(buf), decipher.final()])
                            if (this.isValidImageBuffer(decrypted)) {
                                const ext = this.getImageExtFromBuffer(decrypted)
                                const filePath = join(cacheDir, `${cacheKey}${ext}`)
                                fs.writeFileSync(filePath, decrypted)
                                try { fs.unlinkSync(result) } catch { }
                                return { success: true, localPath: filePath }
                            }
                        } catch { /* next */ }
                    }
                    try {
                        const decipher = crypto.createDecipheriv('aes-128-ecb', keyTries[0], null)
                        decipher.setAutoPadding(false)
                        let decrypted = Buffer.concat([decipher.update(buf), decipher.final()])
                        if (decrypted.length > 0 && decrypted[decrypted.length - 1] >= 1 && decrypted[decrypted.length - 1] <= 16) {
                            const pad = decrypted[decrypted.length - 1]
                            const tail = decrypted.subarray(-pad)
                            if (tail.every((b: number) => b === pad)) decrypted = decrypted.subarray(0, decrypted.length - pad)
                        }
                        if (this.isValidImageBuffer(decrypted)) {
                            const ext = this.getImageExtFromBuffer(decrypted)
                            const filePath = join(cacheDir, `${cacheKey}${ext}`)
                            fs.writeFileSync(filePath, decrypted)
                            try { fs.unlinkSync(result) } catch { }
                            return { success: true, localPath: filePath }
                        }
                    } catch { /* ignore */ }
                }
                try { fs.unlinkSync(result) } catch { }
            }
        }

        return { success: false, error: '下载失败' }
    }

    /**
     * 下载原始文件到缓存目录
     */
    private doDownloadRaw(url: string, cacheKey: string, cacheDir: string): Promise<string | null> {
        return new Promise((resolve) => {
            try {
                let fixedUrl = url.replace(/&amp;/g, '&')
                // 微信 CDN 使用 HTTP，不强制转 HTTPS（部分 CDN 不支持 HTTPS 会导致下载失败）
                const https = require('https')
                const http = require('http')
                const urlObj = new URL(fixedUrl)
                const protocol = fixedUrl.startsWith('https') ? https : http

                const options = {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x67001431) NetType/WIFI WindowsWechat/3.9.11.17(0x63090b11)',
                        'Accept': '*/*',
                        'Connection': 'keep-alive'
                    },
                    rejectUnauthorized: false,
                    timeout: 15000
                }

                const request = protocol.get(fixedUrl, options, (response: any) => {
                    if ([301, 302, 303, 307].includes(response.statusCode)) {
                        const redirectUrl = response.headers.location
                        if (redirectUrl) {
                            const full = redirectUrl.startsWith('http') ? redirectUrl : `${urlObj.protocol}//${urlObj.host}${redirectUrl}`
                            this.doDownloadRaw(full, cacheKey, cacheDir).then(resolve)
                            return
                        }
                    }

                    if (response.statusCode !== 200) {
                        resolve(null)
                        return
                    }

                    const chunks: Buffer[] = []
                    response.on('data', (chunk: Buffer) => chunks.push(chunk))
                    response.on('end', () => {
                        const buffer = Buffer.concat(chunks)
                        if (buffer.length === 0) { resolve(null); return }

                        let ext = '.gif'
                        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) ext = '.gif'
                        else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) ext = '.png'
                        else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) ext = '.jpg'
                        else if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) ext = '.webp'

                        const filePath = join(cacheDir, `${cacheKey}${ext}`)
                        try {
                            require('fs').writeFileSync(filePath, buffer)
                            resolve(filePath)
                        } catch {
                            resolve(null)
                        }
                    })
                    response.on('error', () => {
                        resolve(null)
                    })
                })

                request.on('error', () => {
                    resolve(null)
                })
                request.setTimeout(15000, () => {
                    request.destroy()
                    resolve(null)
                })
            } catch {
                resolve(null)
            }
        })
    }

    private getSnsCacheDir(): string {
        const cachePath = this.configService.getCacheBasePath()
        const snsCacheDir = join(cachePath, 'sns_cache')
        if (!existsSync(snsCacheDir)) {
            mkdirSync(snsCacheDir, { recursive: true })
        }
        return snsCacheDir
    }

    private getCacheFilePath(url: string, md5?: string): string {
        const hash = md5 || crypto.createHash('md5').update(url).digest('hex')
        const ext = isVideoUrl(url) ? '.mp4' : '.jpg'
        return join(this.getSnsCacheDir(), `${hash}${ext}`)
    }

    async getTimeline(limit: number = 20, offset: number = 0, usernames?: string[], keyword?: string, startTime?: number, endTime?: number): Promise<{ success: boolean; timeline?: SnsPost[]; error?: string }> {
        // 优先尝试使用 DLL execQuery 直接查 SnsTimeLine 表（获取完整 XML，包含评论/点赞/表情包）
        try {
            let sql = 'SELECT tid, user_name, content FROM SnsTimeLine WHERE 1=1'

            if (usernames && usernames.length > 0) {
                const escaped = usernames.map(u => `'${u.replace(/'/g, "''")}'`).join(',')
                sql += ` AND user_name IN (${escaped})`
            }
            if (keyword) {
                sql += ` AND content LIKE '%${keyword.replace(/'/g, "''")}%'`
            }

            // 时间范围过滤
            if (startTime) {
                sql += ` AND CAST(SUBSTR(CAST(content AS TEXT), INSTR(CAST(content AS TEXT), '<createTime>') + 12, 10) AS INTEGER) >= ${startTime}`
            }
            if (endTime) {
                sql += ` AND CAST(SUBSTR(CAST(content AS TEXT), INSTR(CAST(content AS TEXT), '<createTime>') + 12, 10) AS INTEGER) <= ${endTime}`
            }

            sql += ' ORDER BY tid DESC LIMIT ' + limit + ' OFFSET ' + offset

            const queryResult = await wcdbService.execQuery('sns', '', sql)

            if (queryResult.success && queryResult.rows && queryResult.rows.length > 0) {
                const timeline: SnsPost[] = await Promise.all(queryResult.rows.map(async (row: any) => {
                    const xmlContent = row.content || ''
                    const contact = await chatService.getContact(row.user_name)
                    const avatarInfo = await chatService.getContactAvatar(row.user_name)

                    const { media, videoKey } = this.parseMediaFromXml(xmlContent)

                    // 提取基本信息
                    const createTimeMatch = xmlContent.match(/<createTime>(\d+)<\/createTime>/i)
                    const idMatch = xmlContent.match(/<id>(\d+)<\/id>/i)
                    const contentDescMatch = xmlContent.match(/<contentDesc(?:\s+[^>]*)?>([^<]*)<\/contentDesc>/i)
                    const typeMatch = xmlContent.match(/<type>(\d+)<\/type>/i)

                    const fixedMedia = media.map((m) => {
                        const isMediaVideo = isVideoUrl(m.url)
                        return {
                            url: fixSnsUrl(m.url, m.token, isMediaVideo),
                            thumb: fixSnsUrl(m.thumb, m.token, false),
                            md5: m.md5,
                            token: m.token,
                            key: isMediaVideo ? (videoKey || m.key) : m.key,
                            encIdx: m.encIdx,
                            width: m.width,
                            height: m.height,
                            livePhoto: m.livePhoto ? {
                                url: fixSnsUrl(m.livePhoto.url, m.livePhoto.token, true),
                                thumb: fixSnsUrl(m.livePhoto.thumb, m.livePhoto.token, false),
                                token: m.livePhoto.token,
                                key: videoKey || m.livePhoto.key || m.key,
                                md5: m.livePhoto.md5,
                                encIdx: m.livePhoto.encIdx
                            } : undefined
                        }
                    })

                    const likes = this.parseLikesFromXml(xmlContent)
                    const comments = this.normalizeComments(this.parseCommentsFromXml(xmlContent))

                    return {
                        id: idMatch ? idMatch[1] : String(row.tid),
                        username: row.user_name,
                        nickname: contact?.remark || contact?.nickName || contact?.alias || row.user_name,
                        avatarUrl: avatarInfo?.avatarUrl,
                        createTime: createTimeMatch ? parseInt(createTimeMatch[1]) : 0,
                        contentDesc: contentDescMatch ? contentDescMatch[1] : '',
                        type: typeMatch ? parseInt(typeMatch[1]) : 1,
                        media: fixedMedia,
                        shareInfo: extractShareInfo(xmlContent),
                        likes,
                        comments,
                        rawXml: xmlContent
                    }
                }))

                return { success: true, timeline }
            }
        } catch (dllError) {
            console.warn('[SnsService] execQuery 读取失败，尝试使用解密后的数据库:', dllError)
        }

        // 回退：使用解密后的数据库（数据可能不是最新的）
        if (!this.openSnsDatabase()) {
            return { success: false, error: 'SNS 数据库打开失败，请先在设置中解密数据库' }
        }

        try {
            // 构建 SQL 查询
            let sql = 'SELECT tid, user_name, content FROM SnsTimeLine WHERE 1=1'
            const params: any[] = []

            // 用户名过滤
            if (usernames && usernames.length > 0) {
                sql += ` AND user_name IN (${usernames.map(() => '?').join(',')})`
                params.push(...usernames)
            }

            // 关键词过滤
            if (keyword) {
                sql += ' AND content LIKE ?'
                params.push(`%${keyword}%`)
            }

            // 时间范围过滤
            if (startTime) {
                sql += ` AND CAST(SUBSTR(CAST(content AS TEXT), INSTR(CAST(content AS TEXT), '<createTime>') + 12, 10) AS INTEGER) >= ?`
                params.push(startTime)
            }
            if (endTime) {
                sql += ` AND CAST(SUBSTR(CAST(content AS TEXT), INSTR(CAST(content AS TEXT), '<createTime>') + 12, 10) AS INTEGER) <= ?`
                params.push(endTime)
            }

            // 排序和分页（按 tid 降序，tid 越大越新）
            sql += ' ORDER BY tid DESC LIMIT ? OFFSET ?'
            params.push(limit, offset)

            const stmt = this.snsDb!.prepare(sql)
            const rows = stmt.all(...params) as any[]

            // 解析每条记录
            const timeline: SnsPost[] = await Promise.all(rows.map(async (row) => {
                const contact = await chatService.getContact(row.user_name)
                const avatarInfo = await chatService.getContactAvatar(row.user_name)

                // 解析 XML 获取媒体信息和其他字段
                const xmlContent = row.content || ''
                const { media, videoKey } = this.parseMediaFromXml(xmlContent)

                // 从 XML 中提取基本信息
                let createTime = 0
                let contentDesc = ''
                let snsId = String(row.tid)
                let type = 1 // 默认类型

                // 提取 createTime
                const createTimeMatch = xmlContent.match(/<createTime>(\d+)<\/createTime>/i)
                if (createTimeMatch) {
                    createTime = parseInt(createTimeMatch[1])
                }

                // 提取 id
                const idMatch = xmlContent.match(/<id>(\d+)<\/id>/i)
                if (idMatch) {
                    snsId = idMatch[1]
                }

                // 提取 contentDesc
                const contentDescMatch = xmlContent.match(/<contentDesc(?:\s+[^>]*)?>([^<]*)<\/contentDesc>/i)
                if (contentDescMatch) {
                    contentDesc = contentDescMatch[1].trim()
                }

                // 提取 type
                const typeMatch = xmlContent.match(/<type>(\d+)<\/type>/i)
                if (typeMatch) {
                    type = parseInt(typeMatch[1])
                }

                // 判断是否为视频动态
                const isVideoPost = type === 15

                // 修正媒体 URL
                const fixedMedia = media.map((m) => {
                    const isMediaVideo = isVideoUrl(m.url)

                    return {
                        url: fixSnsUrl(m.url, m.token, isMediaVideo),
                        thumb: fixSnsUrl(m.thumb, m.token, false),
                        md5: m.md5,
                        token: m.token,
                        // 视频用 XML 的 key，图片用 media 的 key
                        key: isMediaVideo ? (videoKey || m.key) : m.key,
                        encIdx: m.encIdx,
                        livePhoto: m.livePhoto ? {
                            url: fixSnsUrl(m.livePhoto.url, m.livePhoto.token, true),
                            thumb: fixSnsUrl(m.livePhoto.thumb, m.livePhoto.token, false),
                            token: m.livePhoto.token,
                            // 实况照片的视频部分用 XML 的 key
                            key: videoKey || m.livePhoto.key || m.key,
                            md5: m.livePhoto.md5,
                            encIdx: m.livePhoto.encIdx
                        } : undefined
                    }
                })

                // 提取点赞和评论
                const likes = this.parseLikesFromXml(xmlContent)
                const comments = this.normalizeComments(this.parseCommentsFromXml(xmlContent))

                return {
                    id: snsId,
                    username: row.user_name,
                    nickname: contact?.remark || contact?.nickName || contact?.alias || row.user_name,
                    avatarUrl: avatarInfo?.avatarUrl,
                    createTime,
                    contentDesc,
                    type,
                    media: fixedMedia,
                    shareInfo: extractShareInfo(xmlContent),
                    likes,
                    comments,
                    rawXml: xmlContent
                }
            }))

            return { success: true, timeline }
        } catch (error: any) {
            console.error('[SnsService] 查询 SNS 数据失败:', error)
            return { success: false, error: error.message }
        }
    }

    async proxyImage(url: string, key?: string | number, md5?: string): Promise<{ success: boolean; dataUrl?: string; videoPath?: string; localPath?: string; error?: string }> {
        if (!url) return { success: false, error: 'url 不能为空' }

        const result = await this.fetchAndDecryptImage(url, key, md5)
        if (result.success) {
            // 视频返回文件路径
            if (result.contentType?.startsWith('video/')) {
                return { success: true, videoPath: result.cachePath }
            }
            // 图片也返回文件路径，而不是 base64
            if (result.cachePath && existsSync(result.cachePath)) {
                return { success: true, localPath: result.cachePath }
            }
            // 回退：如果没有缓存路径，返回 base64
            if (result.data && result.contentType) {
                const dataUrl = `data:${result.contentType};base64,${result.data.toString('base64')}`
                return { success: true, dataUrl }
            }
        }
        return { success: false, error: result.error }
    }

    async downloadImage(url: string, key?: string | number, md5?: string): Promise<{ success: boolean; data?: Buffer; contentType?: string; cachePath?: string; error?: string }> {
        return this.fetchAndDecryptImage(url, key, md5)
    }

    private async fetchAndDecryptImage(url: string, key?: string | number, md5?: string): Promise<{ success: boolean; data?: Buffer; contentType?: string; cachePath?: string; error?: string }> {
        if (!url) return { success: false, error: 'url 不能为空' }

        const isVideo = isVideoUrl(url)
        const cachePath = this.getCacheFilePath(url, md5)

        // 1. 检查缓存（优先返回本地文件）
        if (existsSync(cachePath)) {
            try {
                if (isVideo) {
                    return { success: true, cachePath, contentType: 'video/mp4' }
                }
                const data = await readFile(cachePath)
                const contentType = detectImageMime(data)
                return { success: true, data, contentType, cachePath }
            } catch (e) {
                console.warn(`[SnsService] 读取缓存失败: ${cachePath}`, e)
            }
        }

        // 视频：流式下载到临时文件
        if (isVideo) {
            return new Promise(async (resolve) => {
                const tmpPath = join(require('os').tmpdir(), `sns_video_${Date.now()}_${Math.random().toString(36).slice(2)}.enc`)

                try {
                    const https = require('https')
                    const urlObj = new URL(url)
                    const fs = require('fs')
                    const fileStream = fs.createWriteStream(tmpPath)

                    const options = {
                        hostname: urlObj.hostname,
                        path: urlObj.pathname + urlObj.search,
                        method: 'GET',
                        headers: {
                            'User-Agent': 'MicroMessenger Client',
                            'Accept': '*/*',
                            'Connection': 'keep-alive'
                        },
                        rejectUnauthorized: false
                    }

                    const req = https.request(options, (res: any) => {
                        if (res.statusCode !== 200 && res.statusCode !== 206) {
                            fileStream.close()
                            fs.unlink(tmpPath, () => { })
                            resolve({ success: false, error: `HTTP ${res.statusCode}` })
                            return
                        }

                        res.pipe(fileStream)

                        fileStream.on('finish', async () => {
                            fileStream.close()

                            try {
                                const encryptedBuffer = await readFile(tmpPath)
                                const raw = encryptedBuffer

                                // 视频只解密前128KB
                                if (key && String(key).trim().length > 0) {
                                    try {
                                        const keyText = String(key).trim()
                                        let keystream: Buffer

                                        try {
                                            const wasmService = WasmService.getInstance()
                                            // 只需要前 128KB (131072 bytes) 用于解密头部
                                            keystream = await wasmService.getKeystream(keyText, 131072)
                                        } catch (wasmErr) {
                                            // 打包漏带 wasm 或 wasm 初始化异常时，回退到纯 TS ISAAC64
                                            const isaac = new Isaac64(keyText)

                                            // 对齐到 8 字节，然后 reverse
                                            const alignSize = Math.ceil(131072 / 8) * 8
                                            const alignedKeystream = isaac.generateKeystreamBE(alignSize)
                                            const reversed = Buffer.from(alignedKeystream)
                                            reversed.reverse()
                                            keystream = reversed.subarray(0, 131072)
                                        }

                                        const decryptLen = Math.min(keystream.length, raw.length)

                                        // XOR 解密
                                        for (let i = 0; i < decryptLen; i++) {
                                            raw[i] ^= keystream[i]
                                        }

                                        // 验证 MP4 签名 ('ftyp' at offset 4)
                                        const ftyp = raw.subarray(4, 8).toString('ascii')
                                        if (ftyp !== 'ftyp') {
                                            // 签名验证失败，静默处理
                                        }
                                    } catch (err) {
                                        console.error(`[SnsService] 视频解密出错: ${err}`)
                                    }
                                }

                                await writeFile(cachePath, raw)
                                try { await import('fs/promises').then(fs => fs.unlink(tmpPath)) } catch (e) { }

                                resolve({ success: true, data: raw, contentType: 'video/mp4', cachePath })
                            } catch (e: any) {
                                console.error(`[SnsService] 视频处理失败:`, e)
                                resolve({ success: false, error: e.message })
                            }
                        })
                    })

                    req.on('error', (e: any) => {
                        fs.unlink(tmpPath, () => { })
                        resolve({ success: false, error: e.message })
                    })

                    req.end()
                } catch (e: any) {
                    resolve({ success: false, error: e.message })
                }
            })
        }

        // 图片：内存下载并解密
        return new Promise((resolve) => {
            try {
                const https = require('https')
                const zlib = require('zlib')
                const urlObj = new URL(url)

                const options = {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'MicroMessenger Client',
                        'Accept': '*/*',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Accept-Language': 'zh-CN,zh;q=0.9',
                        'Connection': 'keep-alive'
                    },
                    rejectUnauthorized: false
                }

                const req = https.request(options, (res: any) => {
                    if (res.statusCode !== 200 && res.statusCode !== 206) {
                        resolve({ success: false, error: `HTTP ${res.statusCode}` })
                        return
                    }

                    const chunks: Buffer[] = []
                    let stream = res

                    // 解压gzip/br
                    const encoding = res.headers['content-encoding']
                    if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip())
                    else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate())
                    else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress())

                    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                    stream.on('end', async () => {
                        const raw = Buffer.concat(chunks)
                        const xEnc = String(res.headers['x-enc'] || '').trim()

                        let decoded = raw

                        // 图片逻辑
                        const shouldDecrypt = (xEnc === '1' || !!key) && key !== undefined && key !== null && String(key).trim().length > 0
                        if (shouldDecrypt) {
                            try {
                                const keyStr = String(key).trim()
                                if (/^\d+$/.test(keyStr)) {
                                    let keystream: Buffer

                                    try {
                                        // 优先使用 WASM 版本的 Isaac64 解密图片
                                        // 修正逻辑：使用带 reverse 且修正了 8字节对齐偏移的 getKeystream
                                        const wasmService = WasmService.getInstance()
                                        keystream = await wasmService.getKeystream(keyStr, raw.length)
                                    } catch (wasmErr) {
                                        // Fallback：使用纯 TypeScript 的 Isaac64
                                        const isaac = new Isaac64(keyStr)

                                        // 需要对齐到 8 字节边界，然后 reverse，和 WASM 版本保持一致
                                        const alignSize = Math.ceil(raw.length / 8) * 8
                                        const alignedKeystream = isaac.generateKeystreamBE(alignSize)

                                        // Reverse 整个 buffer
                                        const reversed = Buffer.from(alignedKeystream)
                                        reversed.reverse()

                                        // 取前 raw.length 字节
                                        keystream = reversed.subarray(0, raw.length)
                                    }

                                    const decrypted = Buffer.allocUnsafe(raw.length)
                                    for (let i = 0; i < raw.length; i++) {
                                        decrypted[i] = raw[i] ^ keystream[i]
                                    }

                                    decoded = decrypted

                                    // 验证解密结果
                                    const mime = detectImageMime(decoded)
                                    if (!mime.startsWith('image/')) {
                                        console.warn('[SnsService] ✗ 图片解密失败，文件头:', decoded.subarray(0, 8).toString('hex'))
                                    }
                                }
                            } catch (e) {
                                console.error('[SnsService] 图片解密失败:', e)
                            }
                        }

                        try {
                            await writeFile(cachePath, decoded)
                        } catch (e) {
                            console.warn(`[SnsService] 写入缓存失败: ${cachePath}`, e)
                        }

                        const contentType = detectImageMime(decoded, (res.headers['content-type'] || 'image/jpeg') as string)
                        resolve({ success: true, data: decoded, contentType, cachePath })
                    })
                    stream.on('error', (e: any) => resolve({ success: false, error: e.message }))
                })

                req.on('error', (e: any) => resolve({ success: false, error: e.message }))
                req.end()
            } catch (e: any) {
                resolve({ success: false, error: e.message })
            }
        })
    }
}

export const snsService = new SnsService()
