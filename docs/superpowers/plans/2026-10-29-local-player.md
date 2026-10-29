# 澄音本地播放器 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 构建带三种外观预设、持久化本地曲库和同步歌词的精致中文播放器。

**Architecture:** React + TypeScript 界面共用单一 audio 实例；歌词和播放顺序是纯函数；IndexedDB 存储音频和歌词。CSS 变量与布局选择器切换主题，无需重建播放状态。

**Tech Stack:** React, TypeScript, Vite, lucide-react, music-metadata, Node 原生测试, Playwright。

**Spec:** docs/superpowers/specs/2026-10-29-local-player-design.md

## Global Constraints

- 中文界面，本地 MP3 和 LRC/TXT，不上传用户文件。
- 三种外观，刷新保留选择；切换不中断播放。
- 响应式、键盘操作、可见焦点、减少动态效果。
- 保留既有 Python 工作；本项目未初始化 Git，不创建分支或提交。

## Review Focus

- 无时间戳、offset 和多标签歌词需准确呈现。
- 同批导入歌词先于音频也应正确配对。
- 切换歌曲期间旧播放请求不能覆盖新状态。
- 本地数据库失败需提示并保留会话内曲库。
- 小屏播放栏、歌词和外观切换均可访问。

### Task 1: 核心数据与歌词

Files: package.json, tsconfig.json, vite.config.ts, index.html, src/lib/lyrics.ts, src/lib/library.ts, src/lib/storage.ts, src/types.ts, tests/core.native.test.mjs。

Interfaces: parseLyrics(text) -> { lines: {time: number | null, text: string}[], synced: boolean }; lyricIndex(lines, seconds) -> number; fileStem(name) -> string; nextTrackId(ids, current, mode, automatic) -> string | null; Track 保存 File、封面、歌词和收藏。

- [x] 配置依赖，写核心行为测试，用 `npm test` 观察功能缺失导致失败。
- [x] 实现时间戳、offset、重复标签、TXT 和二分当前行；实现文件名标准化、播放顺序及 IndexedDB。
- [x] `npm test` 全部通过。

### Task 2: 可交互播放器

Files: src/hooks/usePlayer.ts, src/App.tsx, src/components/IconButton.tsx, src/components/Artwork.tsx, src/components/LyricsPanel.tsx, src/components/ThemePicker.tsx, src/styles.css, src/main.tsx, public/artwork.svg。

Consumes: Task 1 的 Track、歌词与持久化接口。
Produces: 文件导入、元数据、播放、队列、收藏搜索、滚动歌词、三种持久化预设和响应式界面。

- [x] 用原生 audio 实例和播放请求序号实现稳定播放；顺序结束停止、随机避免立即重复、单曲循环。
- [x] 文件批处理先读取歌词再关联新旧曲库；UTF-8/GB18030 读取，失败给出中文提示。
- [x] 完成主界面与三种主题、快捷键、队列、导入拖放、收藏、曲库移除、主题选择和歌词沉浸。
- [x] `npm run build` 验证 TypeScript 和生产构建。

### Task 3: 浏览器验证与交付

Files: tests/player.e2e.mjs, README-player.md, start-player.cmd。

- [x] 生成真实 MP3 测试样本和配对歌词；浏览器验证导入、播放推进、定位、主题切换不中断、收藏、搜索、刷新恢复、移除和窄屏布局。
- [x] 截图检查三个主题和 390px 窄屏；检查控制台，修复观察到的问题。
- [x] 执行 `npm test` 和 `npm run build`，记录结果，提供中文启动说明和运行入口。

## Execution record

用户确认设计并补充多预设要求，按本地应用范围直接实施；不发布到外部网站。当前目录不是 Git 仓库，使用本目录并保留已有文件。


## 完成记录

- 核心模块、完整交互界面、三种持久化外观、中文启动脚本和使用说明已完成。
- 最终核心自动测试 10/10 通过，TypeScript 与生产构建通过。
- 三组浏览器验证均通过：真实 MP3 播放与歌词；音量和模式、TXT、手机及存储失败；当前曲目恢复、最近播放、手机设置、导入并发和浅色文字对比度。
- 独立复核发现的 offset 方向、初次加载覆盖当前曲目、最近播放漏记、手机控制缺失和异步导入覆盖状态均先复现再修复，回归通过。
- 视觉检查修复浅色预设正文颜色；最后截图保存在 screenshots/。
- 移除不需要的第三方测试框架，使用 Node 自带测试工具；最后联网依赖审计为 0 项。
- 本地预览曾因同目录其他程序的锁定 EXE 导致文件监视退出，已排除可执行文件、Python 环境、缓存与输出目录；未修改这些其他程序文件。
- 当前目录无 Git，不创建提交或分支；交付本地应用，没有向外部网站发布。
