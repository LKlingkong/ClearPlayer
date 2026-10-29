export interface OnlineSong {
  key: string; source: string; id: string; title: string; artist: string; album: string; duration: number; format?: string;
}
export interface DownloadJob {
  id: string; song: OnlineSong;
  status: 'queued' | 'resolving' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  received: number; total?: number; filename?: string; hasLyrics: boolean; error?: string; lyricError?: string;
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {response = await fetch(`/api${path}`, {...options, signal: AbortSignal.timeout(25000), headers:{'Content-Type':'application/json', ...options?.headers}});}
  catch {throw new Error('无法连接本地音乐服务，请使用启动脚本打开播放器后重试');}
  let data;
  try {data = await response.json();}
  catch {throw new Error('本地音乐服务尚未就绪，请使用启动脚本打开播放器');}
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || '操作失败，请稍后重试');
  return data as T;
}
export async function downloadFile(job: DownloadJob, type: 'audio' | 'lyrics'): Promise<File> {
  const response = await fetch(`/api/downloads/${encodeURIComponent(job.id)}/${type}`, {signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(type === 'audio' ? '已下载的音频暂时无法读取，请重试加入曲库' : '歌词暂时无法读取，可以稍后单独保存歌词');
  const blob = await response.blob();
  if (!blob.size) throw new Error('下载文件为空，请重新下载');
  const filename = (job.filename || '').split(/[\\/]/).pop() || '';
  if (type === 'audio' && !/\.(mp3|flac|m4a|ogg|wav)$/i.test(filename)) throw new Error('音频格式暂不支持加入曲库，请保存音频使用其他播放器');
  return new File([blob], type === 'audio' ? filename : filename.replace(/\.[^.]+$/, '.lrc'), {type:blob.type, lastModified:0});
}
