# 歌单迁移工具

将网易云音乐 / QQ 音乐歌单迁移到 Apple Music。

## 截图

![首页](首页.png)

![匹配页](match.png)

## 功能

- 输入歌单链接自动抓取所有歌曲
- 批量搜索 iTunes Search API，实时显示匹配进度
- 匹配状态分级：已匹配 / 待确认 / 未找到
- DeepSeek AI 辅助二次搜索，提升匹配率
- 支持手动搜索 & 候选切换
- 匹配结果本地缓存（`matched.json`），下次跳过已知歌曲
- 跳过记录持久化（`skipped.json`）
- 导出 CSV（自动按 200 首拆分，含 Apple Music Track ID，去除重复）
- 导出 TXT（弹窗复制，可粘贴到 TuneMyMusic 等网站）
- 通过 AppleScript 直接写入 Music.app（仅限资料库内的歌曲）

## 技术栈

- Next.js 16 · TypeScript · Tailwind CSS
- iTunes Search API
- DeepSeek Chat API
- osascript / AppleScript

## 使用前提

- macOS
- Node.js 18+
- Music.app 已登录 Apple Music 账号
- （可选）DeepSeek API Key，用于 AI 辅助匹配

## 快速开始

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，粘贴网易云或 QQ 音乐歌单链接即可。

## 使用流程

### 方式一：导出 CSV → Soundiiz 导入（推荐）

使用 iTunes Search API 精确匹配后，通过 [Soundiiz](https://soundiiz.com) 官方 API 导入，成功率最高。

1. 粘贴歌单链接，填入 DeepSeek API Key（可选）
2. 点击「开始搜索」，等待批量匹配完成
3. 若「待确认」/「未找到」较多，点击「重新搜索」再试
4. 仍有问题的歌曲点击「AI 辅助搜索」，由 DeepSeek 辅助查找
5. 手动调整剩余问题歌曲，或标记跳过
6. 点击「导出 CSV」—— 歌曲超过 200 首时自动拆分为多个文件（Soundiiz 免费版单次限 200 首）
7. 前往 [Soundiiz](https://soundiiz.com) → Import → From File，依次上传每个 CSV 文件
8. 若导出了多个 CSV，每次导入后在 Soundiiz 创建独立歌单，最后用 AppleScript 或 Music.app 手动合并

> CSV 包含 `Apple Music – id` 列（即 iTunes trackId），Soundiiz 支持按 ID 精确匹配，避免同名歌曲匹配错误。

### 方式二：导出 TXT → TuneMyMusic

1. 完成匹配后点击「导出 TXT」，在弹窗中复制全部内容
2. 前往 [TuneMyMusic](https://www.tunemymusic.com/zh-CN/transfer) → 来源选「From Text」，粘贴内容
3. 目标选 Apple Music，授权后导入

> TXT 方式按歌名+歌手名匹配，不使用 ID，同名歌曲偶有偏差，适合快速导入小歌单。

### 方式三：直接写入 Music.app（AppleScript）

点击右下角「写入 Apple Music」，工具通过 AppleScript 将已匹配歌曲加入 Music.app 歌单。

**限制：** AppleScript 只能操作已在本地资料库的歌曲（有 database ID 的）。Apple Music 目录中存在但未加入资料库的歌曲会被静默跳过，导致实际写入数少于匹配数。若发现写入数远少于匹配数，建议改用方式一。

## 缓存文件

| 文件 | 说明 |
|------|------|
| `matched.json` | 已匹配歌曲缓存，避免重复搜索 |
| `skipped.json` | 跳过歌曲记录，下次自动跳过 |

这两个文件已加入 `.gitignore`，不会上传。

## 注意事项

- DeepSeek API Key 仅在本地使用，不会上传或存储
- 歌单须为**公开**歌单
- 写入 Music.app 时请保持 Music 在后台运行
- 导出的 CSV 使用 UTF-8 BOM 编码，可直接用 Excel 打开
