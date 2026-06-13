# 歌单迁移工具

将网易云音乐 / QQ 音乐歌单迁移到 Apple Music。

**在线版：** https://apple-music-rho.vercel.app

## 功能

- 输入歌单链接自动抓取所有歌曲
- 批量搜索 iTunes Search API，实时显示匹配进度
- 匹配状态分级：已匹配 / 待确认 / 未找到，支持按状态筛选
- DeepSeek AI 辅助二次搜索，提升匹配率
- 手动搜索：歌名 / 歌手 chip 单独控制，可自由组合关键词
- 候选结果下拉切换
- 导出 CSV 可选已匹配 / 待确认范围，超 200 首自动拆分
- 导出 TXT（弹窗复制，可粘贴到 TuneMyMusic 等网站）
- 匹配结果缓存到 localStorage，下次自动跳过已匹配歌曲
- 合并歌单（macOS 本地版）：通过 AppleScript 将多个 Music.app 歌单合并

## 技术栈

- Next.js · TypeScript · Tailwind CSS
- iTunes Search API
- DeepSeek Chat API

## 快速开始（本地）

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，粘贴网易云或 QQ 音乐公开歌单链接即可。

## 使用流程

### 方式一：导出 CSV → Soundiiz（推荐）

1. 粘贴歌单链接，点击「开始搜索」，等待批量匹配
2. 匹配完成后查看「待确认」歌曲，逐一确认或调整
3. 仍有问题的点「重新搜索」或「AI 辅助搜索」再试
4. 手动处理剩余问题歌曲，或标记跳过
5. 点击「导出 CSV」—— 弹出范围选择，可勾选已匹配 / 待确认
6. 前往 [Soundiiz](https://soundiiz.com) → Import → From File，依次上传 CSV

> CSV 包含 `Apple Music – id` 列（iTunes trackId），Soundiiz 按 ID 精确匹配，避免同名歌曲错误。超过 200 首时自动拆分（Soundiiz 免费版单次限 200 首）。

### 方式二：导出 TXT → TuneMyMusic

1. 完成匹配后点击「导出 TXT」，在弹窗中复制全部内容
2. 前往 [TuneMyMusic](https://www.tunemymusic.com/zh-CN/transfer) → 来源选「From Text」，粘贴内容
3. 目标选 Apple Music，授权后导入

> TXT 按歌名+歌手名匹配，不使用 ID，适合快速导入小歌单。

### 方式三：合并歌单（仅限 macOS 本地运行）

若通过 Soundiiz 导入了多个 CSV 歌单，可用本工具的「合并歌单」标签将它们合并：

1. 切换到「合并歌单」标签
2. 勾选要合并的源歌单，用上下箭头调整顺序
3. 输入目标歌单名，点击「开始合并」

**前提：** 歌曲须已在 Music.app 资料库中（Soundiiz 导入后即可）。

## 注意事项

- 歌单须为**公开**歌单
- DeepSeek API Key 仅在本地使用，不会上传
- 匹配缓存存储在浏览器 localStorage（`am-cache-v1`），换浏览器/设备需重新搜索
- 导出的 CSV 使用 UTF-8 BOM 编码，可直接用 Excel 打开
