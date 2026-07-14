import { BadRequestException, Injectable } from '@nestjs/common';
import { extname, normalize } from 'node:path';
import { assetExtensions, textExtensions } from '../../common/file-types.js';
import { runtimeConfig } from '../../config/runtime.config.js';

@Injectable()
export class PathPolicy {
  safe(path: string, writable = false) {
    const config = runtimeConfig();
    const normalized = normalize(path).replace(/^\/+/, '');
    if (!normalized || normalized.startsWith('..') || normalized.split('/').some((part) => part.startsWith('.')) || normalized === config.serviceDir || normalized.startsWith(`${config.serviceDir}/`)) {
      throw new BadRequestException('非法笔记路径');
    }
    const extension = extname(normalized).toLowerCase();
    if (!(textExtensions.has(extension) || assetExtensions.has(extension)) || (writable && extension !== '.md')) {
      throw new BadRequestException(writable ? '仅允许 Markdown 写入' : '不支持的文件类型');
    }
    return normalized;
  }

  allowed(path: string) {
    try {
      this.safe(path);
      return true;
    } catch {
      return false;
    }
  }
}
