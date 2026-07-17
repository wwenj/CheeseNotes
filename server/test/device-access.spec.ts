import { createHmac } from 'node:crypto';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { AUTHENTICATOR_SECRET_VALUE, AuthenticatorService } from '../src/modules/auth/authenticator.service.js';
import { DeviceGuard } from '../src/modules/auth/device.guard.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const testAuthenticatorSecret = 'JBSWY3DPEHPK3PXP';

function decodeBase32(value: string) {
  let bits = '';
  for (const character of value) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(now: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac('sha1', decodeBase32(testAuthenticatorSecret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

const createService = () => new AuthenticatorService(testAuthenticatorSecret);

describe('AuthenticatorService', () => {
  it('resolves its Secret through Nest dependency injection', async () => {
    const module = await Test.createTestingModule({
      providers: [
        { provide: AUTHENTICATOR_SECRET_VALUE, useValue: testAuthenticatorSecret },
        AuthenticatorService,
      ],
    }).compile();

    expect(module.get(AuthenticatorService)).toBeInstanceOf(AuthenticatorService);
  });

  it('accepts the current and adjacent TOTP windows', () => {
    const service = createService();
    const now = 1_750_000_000_000;

    expect(service.verifyCode(codeAt(now), 'current', now)).toMatch(/^noteai-device-v1\./);
    expect(service.verifyCode(codeAt(now - 30_000), 'previous', now)).toMatch(/^noteai-device-v1\./);
    expect(service.verifyCode(codeAt(now + 30_000), 'next', now)).toMatch(/^noteai-device-v1\./);
  });

  it('rejects malformed, incorrect, and expired codes', () => {
    const service = createService();
    const now = 1_750_000_000_000;

    expect(() => service.verifyCode('123', 'format', now)).toThrow(BadRequestException);
    expect(() => service.verifyCode('000000', 'wrong', now)).toThrow(UnauthorizedException);
    expect(() => service.verifyCode(codeAt(now - 60_000), 'expired', now)).toThrow(UnauthorizedException);
  });

  it('creates permanent signed tokens that survive service recreation', () => {
    const now = 1_750_000_000_000;
    const token = createService().verifyCode(codeAt(now), 'client', now);
    const restartedService = createService();

    expect(restartedService.isTrustedDevice(token)).toBe(true);
    expect(restartedService.isTrustedDevice(`${token}x`)).toBe(false);
  });

  it('blocks an IP after five failed attempts for five minutes', () => {
    const service = createService();
    const now = 1_750_000_000_000;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => service.verifyCode('000000', 'client', now)).toThrow(UnauthorizedException);
    }
    try {
      service.verifyCode(codeAt(now), 'client', now);
      throw new Error('expected rate limit');
    } catch (reason) {
      expect(reason).toBeInstanceOf(HttpException);
      expect((reason as HttpException).getStatus()).toBe(429);
    }
    expect(service.verifyCode(codeAt(now + 5 * 60_000), 'client', now + 5 * 60_000)).toMatch(/^noteai-device-v1\./);
  });
});

describe('DeviceGuard', () => {
  const context = (token?: string) => ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers: token ? { 'x-device-token': token } : {} }) }),
  }) as never;

  it('allows explicitly public routes', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) };
    const guard = new DeviceGuard(reflector as never, createService());
    expect(guard.canActivate(context())).toBe(true);
  });

  it('rejects missing or forged tokens and allows a valid token', () => {
    const service = createService();
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const guard = new DeviceGuard(reflector as never, service);
    const now = 1_750_000_000_000;
    const token = service.verifyCode(codeAt(now), 'client', now);

    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context('forged'))).toThrow(UnauthorizedException);
    expect(guard.canActivate(context(token))).toBe(true);
  });
});
