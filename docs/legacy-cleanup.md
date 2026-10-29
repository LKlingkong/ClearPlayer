# 旧 MP3 歌词识别工程清理清单

播放器已独立使用 Node.js，不调用下列旧 Python 识别工程。用户于 2026-10-29 明确授权删除清单中的全部旧识别文件，清单已执行。

下列目标均已验证位于 D:/lkbugs/projects/lyrics_maker 内并删除：

- lyrics_maker/：旧 Tk 界面、识别任务、歌词导出源码及缓存。
- models/：faster-whisper-small 下载模型和锁文件。
- .venv/：旧 Python 识别工程专用虚拟环境。
- tools/：旧 smoke_transcribe.py 识别验证脚本及 Python 缓存。
- setup.bat、start.bat、requirements.txt：旧 Python 安装启动文件。
- tests/test_app.py、test_cli.py、test_jobs.py、test_lyrics.py、test_transcription.py 和 tests/__pycache__/：旧识别测试。
- docs/superpowers/specs/2026-10-29-lyrics-maker-design.md、docs/superpowers/plans/2026-10-29-lyrics-maker.md、docs/superpowers/plans/progress.md：旧识别工程记录。
- .verification/speech.mp3、.verification/speech.wav：旧识别验证产物。

保留播放器 src、server、public、Node 依赖、播放器文档和测试音频、downloads、LenoMusic 原始 exe/zip 与参考源码。
