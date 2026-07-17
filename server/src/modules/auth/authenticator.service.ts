import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { resolve } from 'node:path';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const deviceTokenPrefix = 'noteai-device-v1';
const maxFailures = 5;
const failureWindowMs = 5 * 60_000;

type FailureState = { count: number; startedAt: number };

function localAuthenticatorSecret() {
  const path = resolve(process.cwd(), 'config', 'authenticator-secret.local.txt');
  if (!existsSync(path)) throw new Error(`缺少 Authenticator 本机 Secret 文件：${path}`);
  const secret = readFileSync(path, 'utf8').trim();
  if (!secret) throw new Error(`Authenticator 本机 Secret 文件为空：${path}`);
  return secret;
}

function decodeBase32(value: string) {
  const input = value.toUpperCase().replace(/[\s=-]/g, '');
  let bits = '';
  for (const character of input) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error('Authenticator Secret 不是有效的 Base32 字符串');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: Buffer, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

@Injectable()
export class AuthenticatorService {
  private readonly secret: Buffer;
  private readonly signingKey: Buffer;
  private readonly failures = new Map<string, FailureState>();

  constructor(secretValue = localAuthenticatorSecret()) {
    this.secret = decodeBase32(secretValue);
    this.signingKey = createHmac('sha256', this.secret).update('noteai-device-token-key').digest();
  }

  verifyCode(code: string, clientKey: string, now = Date.now()) {
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('请输入 6 位 Authenticator 验证码');
    this.assertNotLimited(clientKey, now);
    const counter = Math.floor(now / 30_000);
    const valid = [-1, 0, 1].some((offset) => {
      const expected = Buffer.from(totp(this.secret, counter + offset));
      return timingSafeEqual(Buffer.from(code), expected);
    });
    if (!valid) {
      this.recordFailure(clientKey, now);
      throw new UnauthorizedException('Authenticator 验证码不正确');
    }
    this.failures.delete(clientKey);
    return this.createDeviceToken();
  }

  isTrustedDevice(token: string | undefined) {
    if (!token) return false;
    const [prefix, nonce, signature, extra] = token.split('.');
    if (prefix !== deviceTokenPrefix || !nonce || !signature || extra) return false;
    const expected = this.sign(nonce);
    const actual = Buffer.from(signature, 'base64url');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private createDeviceToken() {
    const nonce = randomBytes(32).toString('base64url');
    return `${deviceTokenPrefix}.${nonce}.${this.sign(nonce).toString('base64url')}`;
  }

  private sign(nonce: string) {
    return createHmac('sha256', this.signingKey).update(`${deviceTokenPrefix}.${nonce}`).digest();
  }

  private assertNotLimited(clientKey: string, now: number) {
    const state = this.failures.get(clientKey);
    if (!state) return;
    if (now - state.startedAt >= failureWindowMs) {
      this.failures.delete(clientKey);
      return;
    }
    if (state.count >= maxFailures) throw new HttpException('尝试次数过多，请 5 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
  }

  private recordFailure(clientKey: string, now: number) {
    const current = this.failures.get(clientKey);
    this.failures.set(clientKey, !current || now - current.startedAt >= failureWindowMs
      ? { count: 1, startedAt: now }
      : { count: current.count + 1, startedAt: current.startedAt });
  }
}
