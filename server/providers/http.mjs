// Network boundary shared by the LenoMusic-derived provider adapters.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export const form = values => new URLSearchParams(Object.entries(values).map(([k,v]) => [k,String(v)])).toString();

export async function request(url, options = {}) {
  const {timeout = 12000, signal, ...rest} = options;
  const deadline = AbortSignal.timeout(timeout);
  try {
    return await fetch(url, {...rest, headers:{'User-Agent':UA, ...rest.headers}, signal:signal ? AbortSignal.any([signal,deadline]) : deadline});
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    const code = error.cause?.code || error.code || '';
    if (/CERT|TLS|SSL/.test(code)) throw new Error('音源连接的安全证书无效，请换一个音源重试', {cause:error});
    if (deadline.aborted) throw new Error('音源响应超时，请稍后重试或切换音源', {cause:error});
    throw new Error('无法连接音源，请检查网络或切换音源', {cause:error});
  }
}

export async function json(url, options = {}) {
  const response = await request(url, options);
  if (!response.ok) throw new Error(`音源暂时不可用（HTTP ${response.status}）`);
  try { return await response.json(); }
  catch (error) { throw new Error('音源返回了无法读取的数据，请切换音源', {cause:error}); }
}
