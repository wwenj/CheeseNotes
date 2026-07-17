import { deviceToken } from './device-access';
import { isNativeIOS } from './platform';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export const accessRequiredEvent = 'noteai:access-required';
export type AccessRequiredDetail = { rejectedToken: string | null };
export type AuthorizedFetchResult = { response: Response; deviceToken: string | null };

declare const __NOTE_SERVICE_BASE_URL__: string;

const buildTimeBaseUrl = __NOTE_SERVICE_BASE_URL__.replace(/\/$/, '');
// Web 端由同域 Nest 托管，不能让历史调试配置把请求导向旧服务。
// 只有 iOS 打包副本需要通过这个值指定生产 API 地址。
const configuredBaseUrl = () => isNativeIOS()
  ? localStorage.getItem('note-service-url')?.replace(/\/$/, '') || buildTimeBaseUrl
  : buildTimeBaseUrl;

export function apiUrl(path: string) {
  return `${configuredBaseUrl()}/api/${path.replace(/^\//, '')}`;
}

export async function fetchWithAuthorization(url: string, options: RequestInit = {}): Promise<AuthorizedFetchResult> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  const trustedDeviceToken = await deviceToken();
  if (trustedDeviceToken) headers.set('X-Device-Token', trustedDeviceToken);
  try {
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    return { response, deviceToken: trustedDeviceToken };
  } catch {
    throw new ApiError('无法连接服务，请检查服务地址。');
  }
}

export async function apiErrorFromResponse(response: Response, rejectedToken: string | null) {
  const result = await response.json().catch(() => null) as { code?: string; message?: string | string[] } | null;
  if (result?.code === 'DEVICE_AUTH_REQUIRED') {
    window.dispatchEvent(new CustomEvent<AccessRequiredDetail>(accessRequiredEvent, {
      detail: { rejectedToken },
    }));
  }
  const message = Array.isArray(result?.message) ? result.message.join('；') : result?.message;
  return new ApiError(message || `请求失败（${response.status}）`, response.status);
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { response, deviceToken: trustedDeviceToken } = await fetchWithAuthorization(apiUrl(path), options);
  if (!response.ok) {
    throw await apiErrorFromResponse(response, trustedDeviceToken);
  }
  return response.json() as Promise<T>;
}

export function serviceUrl() { return localStorage.getItem('note-service-url') || ''; }
export function saveServiceUrl(url: string) { localStorage.setItem('note-service-url', url.replace(/\/$/, '')); }
