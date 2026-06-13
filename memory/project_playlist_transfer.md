---
name: project-playlist-transfer
description: 歌单迁移工具项目 — 网易云/QQ音乐迁移到 Apple Music，Next.js + DeepSeek AI 辅助匹配
metadata:
  type: project
---

歌单迁移工具 (Next.js App Router, TypeScript, Tailwind CSS)，运行在 localhost:3000。

**核心流程：**
1. 输入网易云/QQ音乐歌单链接 → 解析获取曲目列表
2. iTunes Search API 批量搜索匹配
3. DeepSeek AI 对失败/不确定曲目重新生成搜索词
4. 用户预览、手动调整
5. osascript/AppleScript 写入本地 Music.app

**Why:** 用户有网易云/QQ音乐歌单想迁移到 Apple Music，中间借助 AI 提高匹配率。

**How to apply:** 项目已搭建完毕，用户有 DeepSeek API key，可直接配置使用。
