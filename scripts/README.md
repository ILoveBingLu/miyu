# 📦 自动发布脚本使用说明

## 🚀 快速开始

### 发布新版本（3 步完成）

```bash
# 1. 修改 package.json 中的版本号
#    "version": "2.0.4"

# 2. 提交所有更改
git add .
git commit -m "release: v2.0.4"

# 3. 运行发布脚本
npm run tuisong
```

就这么简单！脚本会自动：
- ✅ 检查是否有未提交的更改（有则报错）
- ✅ 读取 `package.json` 中的版本号
- ✅ 推送到 GitHub
- ✅ 创建并推送版本标签（如 `v2.0.4`）
- ✅ 触发自动构建和发布

---

## 📝 使用方法

```bash
npm run tuisong
```

**前提条件：**
- ✅ 所有更改已提交（`git commit`）
- ✅ `package.json` 中的版本号已更新

**脚本会做什么：**
1. 检查是否有未提交的更改（有则退出）
2. 显示待推送的提交
3. 推送到 GitHub
4. 创建版本标签（如 `v2.0.4`）
5. 推送标签到 GitHub

---

## 🎯 完整发布流程

### 步骤 1：修改版本号

编辑 `package.json`：

```json
{
  "name": "ciphertalk",
  "version": "2.0.4",  // 修改这里
  ...
}
```

**版本号规范：**
- **patch (x.y.Z)** - 修复 bug：`2.0.3` → `2.0.4`
- **minor (x.Y.z)** - 新增功能：`2.0.3` → `2.1.0`
- **major (X.y.z)** - 重大更新：`2.0.3` → `3.0.0`

### 步骤 2：提交更改

```bash
git add .
git commit -m "release: v2.0.4"
```

### 步骤 3：推送发布

```bash
npm run tuisong
```

脚本会显示：
```
================================
  密语 - 自动发布脚本
================================

📌 当前版本: v2.0.4

📝 待推送的提交:
abc1234 release: v2.0.4

[1/2] 🚀 推送到 GitHub...
  ✓ 推送成功

[2/2] 🏷️  创建并推送标签 v2.0.4...
  ✓ 标签创建成功

================================
  ✅ 发布流程已启动！
================================

📦 版本: v2.0.4

🔗 查看构建进度:
   https://github.com/JiQingzhe2004/ciphertalk/actions

🔗 发布完成后访问:
   https://github.com/JiQingzhe2004/ciphertalk/releases/tag/v2.0.4

⏱️  预计 10-15 分钟后构建完成
```

### 步骤 4：等待构建完成

GitHub Actions 会自动：
1. 安装依赖
2. 重新编译原生模块
3. 构建美化安装包
4. 创建 GitHub Release
5. 上传到 Cloudflare R2
6. 上传 `CipherTalk-2.0.4-Setup.exe`

---

## 🎨 使用场景示例

### 场景 1：修复 bug

```bash
# 1. 修改代码
# 2. 更新版本号: 2.0.3 → 2.0.4
# 3. 提交
git add .
git commit -m "fix: 修复表情包显示问题"

# 4. 发布
npm run tuisong
```

### 场景 2：添加新功能

```bash
# 1. 开发新功能
# 2. 更新版本号: 2.0.3 → 2.1.0
# 3. 提交
git add .
git commit -m "feat: 添加语音转文字功能"

# 4. 发布
npm run tuisong
```

### 场景 3：重大更新

```bash
# 1. 重构代码
# 2. 更新版本号: 2.0.3 → 3.0.0
# 3. 提交
git add .
git commit -m "feat!: 全新 UI 设计"

# 4. 发布
npm run tuisong
```

---

## 🔧 其他构建脚本

### 完整构建（生产环境）

```bash
npm run build:pro
```

包含：
- ✅ 更新 README 版本号
- ✅ TypeScript 编译
- ✅ Vite 构建前端
- ✅ Electron 打包
- ✅ 生成美化安装包
- ✅ 更新 latest.yml

### 仅构建外壳（测试用）

```bash
node scripts/build-shell-only.js
```

用于快速测试安装程序界面。

---

## 🤖 GitHub Actions 自动化

推送到 `main` 分支时自动触发：

1. 📦 安装依赖
2. 🔨 重新编译原生模块
3. 🏗️ 构建应用程序（`npm run build:pro`）
4. 📊 获取版本号（从 `package.json`）
5. 🎉 创建 GitHub Release（标签：`v2.0.4`）
6. ☁️ 上传到 Cloudflare R2（自动删除旧版本）
7. 📤 上传构建产物到 GitHub

**查看构建状态：**  
https://github.com/JiQingzhe2004/ciphertalk/actions

**查看发布版本：**  
https://github.com/JiQingzhe2004/ciphertalk/releases

---

## ⚙️ GitHub Secrets 配置

需要在 GitHub 仓库设置中配置以下 Secrets：

### Cloudflare R2 配置

1. 进入 GitHub 仓库 → Settings → Secrets and variables → Actions
2. 点击 "New repository secret" 添加以下密钥：

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `R2_ACCOUNT_ID` | R2 账户 ID | `bf9d655d15b24e8636ef9e61c137785b` |
| `R2_BUCKET_NAME` | R2 存储桶名称 | `miyu` |
| `R2_ACCESS_KEY_ID` | R2 访问密钥 ID | `3c49eaabd4b1a28f1d6a4eb642942ee7` |
| `R2_SECRET_ACCESS_KEY` | R2 桶密访问密钥 | `••••••••••••••••••••••••••••••••` |

### 邮件通知配置（可选）

如果需要在构建完成后收到邮件通知，添加以下 Secrets：

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `MAIL_USERNAME` | 发件邮箱（Gmail） | `your-email@gmail.com` |
| `MAIL_PASSWORD` | Gmail 应用专用密码 | `abcd efgh ijkl mnop` |
| `MAIL_TO` | 收件邮箱 | `your-email@gmail.com` |

**如何获取 Gmail 应用专用密码：**

1. 登录 [Google 账户](https://myaccount.google.com/)
2. 进入 **安全性** → **两步验证**（需要先启用）
3. 进入 **应用专用密码**
4. 选择 **邮件** 和 **Windows 计算机**
5. 点击 **生成**，复制 16 位密码（格式：`abcd efgh ijkl mnop`）
6. 将密码添加到 GitHub Secrets 的 `MAIL_PASSWORD`

**邮件通知功能：**
- ✅ 构建成功时发送邮件（包含下载链接）
- ❌ 构建失败时发送邮件（包含错误日志链接）
- 📧 邮件发送到你的 GitHub 注册邮箱（或指定邮箱）

### 如何获取 R2 凭证

从你的截图中可以看到：
- **账户 ID**：在 Cloudflare R2 页面顶部显示
- **存储桶名称**：你创建的存储桶名称
- **访问密钥 ID**：在 R2 API 令牌页面显示
- **桶密访问密钥**：创建 API 令牌时显示（只显示一次，需要保存）

### R2 上传规则

- ✅ 自动上传 `CipherTalk-{版本号}-Setup.exe`
- ✅ 自动上传 `latest.yml`（用于自动更新）
- ✅ 自动删除旧版本的安装包（保留最新版本）
- ❌ 不上传 Core 版本（`*-Core-Setup.exe`）
- ℹ️ 如果存储桶为空，跳过删除步骤

---

## 🔧 故障排查

### 问题 1：检测到未提交的更改

**错误：**
```
❌ 检测到未提交的更改:
 M package.json
 M src/App.tsx

请先提交所有更改后再运行此脚本
```

**解决：**
```bash
# 提交所有更改
git add .
git commit -m "你的提交信息"

# 然后运行脚本
npm run tuisong
```

### 问题 2：推送失败

**错误：**
```
❌ 推送失败
请检查网络连接和 Git 配置
```

**解决：**
- 检查网络连接
- 检查 Git 配置
- 确认 GitHub 账号已登录

### 问题 3：标签已存在

**提示：**
```
⚠️  标签 v2.0.4 已存在，跳过创建
```

**说明：**
- 这是正常提示，不影响推送
- 如果需要重新创建标签，先删除远程标签：
  ```bash
  git push origin :refs/tags/v2.0.4
  git tag -d v2.0.4
  ```

---

## 💡 提示

1. **推送前先测试** - 确保代码可以正常运行
2. **遵循版本号规范** - 便于版本管理（[语义化版本](https://semver.org/lang/zh-CN/)）
3. **写清楚提交信息** - 方便用户了解更新内容
4. **等待构建完成** - 大约 10-15 分钟

---

## 🔗 相关链接

- [GitHub Actions 工作流](../.github/workflows/build-release.yml)
- [语义化版本规范](https://semver.org/lang/zh-CN/)
- [Git 提交规范](https://www.conventionalcommits.org/zh-hans/)
