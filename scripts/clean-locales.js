const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
    // context.appOutDir 是打包后的临时解压目录
    const localesDir = path.join(context.appOutDir, 'locales');

    if (fs.existsSync(localesDir)) {
        console.log('🧹 正在清理多余的 Chromium 语言包...');
        const files = fs.readdirSync(localesDir);

        // 只保留中文(简体/繁体)和英文
        const whitelist = [
            'zh-CN.pak',
            'en-US.pak'
        ];

        let deletedCount = 0;
        for (const file of files) {
            if (file.endsWith('.pak') && !whitelist.includes(file)) {
                fs.unlinkSync(path.join(localesDir, file));
                deletedCount++;
            }
        }
        console.log(`✅ 已删除 ${deletedCount} 个无关语言包，仅保留中英文。`);
    }
};
