import { request } from './http';

export type AccessStatus = { authorized: boolean };
export type AccessVerification = AccessStatus & { token: string };

export const accessApi = {
  status: () => request<AccessStatus>('access/status'),
  verify: (code: string) => request<AccessVerification>('access/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
};
