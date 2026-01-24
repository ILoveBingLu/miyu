const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const upxPath = path.join(rootDir, 'upx', 'upx.exe');

// 需要压缩的依赖文件列表 (只针对 Windows 64位二进制)
const targets = [
    // ⚠️ 暂停压缩：UPX 会破坏 .node 原生模块的完整性，导致 koffi/better-sqlite3 初始化失败
    // 'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    // 'node_modules/koffi/build/koffi/win32_x64/koffi.node',
];

console.log('🚀 开始自动化依赖包瘦身 (UPX)...');

if (!fs.existsSync(upxPath)) {
    console.error('❌ 未找到 upx.exe，请确保 upx 目录在根目录下。');
    process.exit(1);
}

targets.forEach(target => {
    const fullPath = path.join(rootDir, target);
    if (fs.existsSync(fullPath)) {
        try {
            console.log(`📦 正在压缩: ${target}`);
            // --best 追求最高压缩比，--force 强制处理
            execSync(`"${upxPath}" --best --force "${fullPath}"`, { stdio: 'inherit' });
        } catch (err) {
            console.warn(`⚠️ 无法压缩 ${target}:`, err.message);
        }
    } else {
        console.log(`⏭️ 跳过 (未找到文件): ${target}`);
    }
});

console.log('✅ 依赖包瘦身完成！\n');
