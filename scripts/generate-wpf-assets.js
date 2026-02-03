const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const INPUT_LOGO = path.join(__dirname, '../public/xinnian.png');
// WPF Project Directory
const OUTPUT_DIR = path.join(__dirname, '../MyCoolInstaller');
const OUTPUT_BANNER = path.join(OUTPUT_DIR, 'left_banner.png');

async function generateWpfAssets() {
    console.log('正在生成 WPF 安装器资源...');

    // 生成左侧通栏图片: 240x520 (Window Height is 520)
    try {
        const width = 240;
        const height = 520;

        // 1. 创建背景 (新年淡红)
        const banner = await sharp({
            create: {
                width: width,
                height: height,
                channels: 4,
                background: '#FFF0F0'
            }
        });

        // 2. 准备 Logo (大一点，放在上部)
        const logoBuffer = await sharp(INPUT_LOGO)
            .resize(160, 160, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();

        // 3. 准备底部装饰 (可选，这里简化，只放Logo)
        // 也可以叠加一些红色圆或者图案来增加氛围，这里简单叠加一个半透明红色块到底部
        const decorHeight = 100;
        const decor = await sharp({
            create: {
                width: width,
                height: decorHeight,
                channels: 4,
                background: { r: 230, g: 0, b: 18, alpha: 0.1 } // rgba(230, 0, 18, 0.1)
            }
        }).png().toBuffer();

        // 合成
        await banner
            .composite([
                { input: logoBuffer, top: 60, left: 40 }, // Logo 居中 (240-160)/2 = 40
                { input: decor, top: height - decorHeight, left: 0 } //底部装饰
            ])
            .png()
            .toFile(OUTPUT_BANNER);

        console.log('✅ WPF 侧边栏已生成:', OUTPUT_BANNER);

    } catch (e) {
        console.error('生成 WPF 资源失败:', e);
    }
}

generateWpfAssets();
