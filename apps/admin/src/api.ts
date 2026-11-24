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
