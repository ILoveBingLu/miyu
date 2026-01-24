const fs = require('fs')
const path = require('path')

const releaseDir = path.join(__dirname, '../release')
const ymlPath = path.join(releaseDir, 'latest.yml')

if (!fs.existsSync(ymlPath)) {
  console.log('latest.yml 不存在，跳过')
  process.exit(0)
}

// 读取 yml 内容
let content = fs.readFileSync(ymlPath, 'utf-8')
const lines = content.split('\n')

// 从 yml 中提取文件名
const match = content.match(/path:\s*(.+\.exe)/)
if (!match) {
  console.log('未找到安装包文件名')
  process.exit(0)
}

const exeName = match[1].trim()
const exePath = path.join(releaseDir, exeName)

if (!fs.existsSync(exePath)) {
  console.log(`安装包不存在: ${exeName}`)
  process.exit(0)
}

// 获取文件大小
const stats = fs.statSync(exePath)
const size = stats.size

// 找到 files 块内第一个 sha512 行，在其后插入 size
const newLines = []
let inFiles = false
let sizeAdded = false

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  newLines.push(line)
  
  if (line.startsWith('files:')) {
    inFiles = true
  }
  
  // 在 files 块内的第一个 sha512 后添加 size
  if (inFiles && !sizeAdded && line.trim().startsWith('sha512:')) {
    newLines.push(`    size: ${size}`)
    sizeAdded = true
    inFiles = false
  }
}

if (sizeAdded) {
  fs.writeFileSync(ymlPath, newLines.join('\n'))
  console.log(`已添加 size: ${size} 到 latest.yml`)
} else {
  console.log('未找到合适位置插入 size')
}
