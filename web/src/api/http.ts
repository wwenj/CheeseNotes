export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

declare const __NOTE_SERVICE_BASE_URL__: string;

const buildTimeBaseUrl = __NOTE_SERVICE_BASE_URL__.replace(/\/$/, '');
const configuredBaseUrl = () => localStorage.getItem('note-service-url')?.replace(/\/$/, '') || buildTimeBaseUrl;

export function apiUrl(path: string) {
  return `${configuredBaseUrl()}/api/${path.replace(/^\//, '')}`;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    throw new ApiError('无法连接服务，请检查服务地址。');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(result?.message) ? result.message.join('；') : result?.message;
    throw new ApiError(message || `请求失败（${response.status}）`, response.status);
  }
  return response.json() as Promise<T>;
}

export function serviceUrl() { return localStorage.getItem('note-service-url') || ''; }
export function saveServiceUrl(url: string) { localStorage.setItem('note-service-url', url.replace(/\/$/, '')); }
