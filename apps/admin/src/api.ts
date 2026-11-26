export class ApiError extends Error {
  constructor(public status: number, message: string) {super(message);}
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {credentials: 'include', ...options, headers: {...(options.body && !(options.body instanceof FormData) ? {'Content-Type': 'application/json'} : {}), ...options.headers}});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('admin:unauthorized'));
    throw new ApiError(response.status, Array.isArray(result.message) ? result.message.join('；') : result.message || '请求失败，请稍后重试');
  }
  return result as T;
}

export interface UploadProgress {
  percent: number | null;
  phase: 'uploading' | 'processing';
}

// Fetch does not expose request-body progress. XHR reports the bytes actually sent.
export function upload<T>(path: string, data: FormData, options: {onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal} = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result as T);
    };
    const abort = () => {
      xhr.abort();
      finish(new DOMException('上传已取消', 'AbortError'));
    };
    if (options.signal?.aborted) {abort(); return;}
    xhr.open('POST', '/api' + path);
    xhr.withCredentials = true;
    xhr.timeout = 300000;
    xhr.upload.onprogress = event => {
      if (settled) return;
      const percent = event.lengthComputable && event.total > 0 ? Math.min(100, Math.floor(event.loaded / event.total * 100)) : null;
      options.onProgress?.({percent, phase: percent === 100 ? 'processing' : 'uploading'});
    };
    xhr.upload.onload = () => {if (!settled) options.onProgress?.({percent: 100, phase: 'processing'});};
    xhr.onload = () => {
      if (settled) return;
      let result: {message?: string | string[]} = {};
      try {const parsed: unknown = JSON.parse(xhr.responseText); if (parsed && typeof parsed === 'object') result = parsed;} catch {}
      if (xhr.status >= 200 && xhr.status < 300) finish(undefined, result as T);
      else {
        const message = Array.isArray(result.message) ? result.message.join('；') : result.message || '上传失败，请稍后重试';
        finish(new ApiError(xhr.status, message));
        if (xhr.status === 401) window.dispatchEvent(new Event('admin:unauthorized'));
      }
    };
    xhr.onerror = () => finish(new Error('上传失败，请检查网络后重试'));
    xhr.ontimeout = () => finish(new Error('上传超时，请稍后重试'));
    xhr.onabort = () => finish(new DOMException('上传已取消', 'AbortError'));
    options.signal?.addEventListener('abort', abort, {once: true});
    options.onProgress?.({percent: null, phase: 'uploading'});
    try {xhr.send(data);} catch (error) {finish(error as Error);}
  });
}
