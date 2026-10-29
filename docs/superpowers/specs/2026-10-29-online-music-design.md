# 澄音在线搜索与下载

用户已同意上一轮提出的本地服务方案，并明确要求删除旧 MP3 歌词识别工具。本轮直接实施，不重复请求批准。

保留 React 播放器及三种外观。增加在线找歌入口、音源选择、搜索结果和下载任务；下载音频及可选 LRC 到项目 downloads 目录，并自动加入浏览器曲库。下载不自动打断当前播放。支持真实格式 MP3、FLAC、M4A、OGG、WAV；不改后缀冒充格式。歌词失败不抹掉已经成功的音频。

Node >=22.18 同时提供本地 API 和页面，开发及构建后的启动方式都具备 API。仅监听 127.0.0.1，拒绝不符的 Host/Origin，不提供任意 URL 下载或任意路径访问。保留 TLS 校验。移植 LenoMusic 音源适配逻辑（酷我、网易云、酷狗、QQ、音乐库），接口失效时展示可理解的失败原因，不能承诺付费或无损可用。

下载任务限制并行数，支持进度、取消、失败重试、暂停和续传。半成品与完成文件分离，检查 HTTP 状态、Content-Range、媒体签名和最终字节数，错误页不能入库。完成后再改名并记历史；重启后未完成任务可重试。已保存文件不会因曲库移除或清理任务而被删除。

前后端协议：GET /api/sources => {sources:[{id,name}]}；GET /api/search?q=&source=&limit= => {songs,warnings}，歌曲含 key/source/id/title/artist/album/duration/format。POST /api/downloads {key,lyrics:true} => {job}；GET /api/downloads => {jobs}；POST /api/downloads/:id/(pause|resume|cancel|retry) => {job}；GET /api/downloads/:id/audio 与 /lyrics 获取已完成文件。job 含 id/song/status/received/total/filename/hasLyrics/error/lyricError。状态 queued/resolving/downloading/paused/completed/failed/cancelled。

适配器契约：export const provider = {id,name, search(query,limit,{signal}), resolve(song,{signal}), lyrics(song,{signal})}。search 返回 id/source/title/artist/album/duration/format 及服务端内部 data，resolve 返回 {url,headers?}。共用 server/providers/http.mjs 的 request(url,{method,headers,body,signal,timeout}) 返回标准 Response；json(url,options) 解析 JSON；form(dict) 返回表单字符串。限时及 TLS 错误由调用方展示。

清理 lyrics_maker/、models/、.venv/、旧 Python tests/test_*.py、tools/smoke_transcribe.py、setup.bat、start.bat、requirements.txt 和过时识别文档；保留测试音频、播放器测试、LenoMusic 原始 exe/zip 和参考源码。更新 README 与启动脚本，附原项目 Apache-2.0 许可和上游版权说明。

验证：协议及适配器离线金标测试；本地 HTTP 服务验证完整音频、错误页、异常 Range、暂停续传和取消；浏览器验证搜索、下载入库、歌词、重试、主题、移动端及原播放器回归。联网验证与离线模拟分开记录。
