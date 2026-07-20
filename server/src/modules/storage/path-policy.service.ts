import { BadRequestException, Injectable } from '@nestjs/common';
import { extname, normalize } from 'node:path';
import { assetExtensions, textExtensions } from '../../common/file-types.js';
import { runtimeConfig } from '../../config/runtime.config.js';

@Injectable()
export class PathPolicy {
  private normalized(path: string) {
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) {
      throw new BadRequestException('非法笔记路径');
    }
    const value = path.replace(/\/+$/, '');
    if (value.split('/').some((part) => !part || part === '.' || part === '..')) throw new BadRequestException('非法笔记路径');
    return normalize(value);
  }

  private assertSafeDirectoryPath(path: string) {
    const config = runtimeConfig();
    if (!path || path === '.' || path.startsWith('..') || path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) || path === config.serviceDir || path.startsWith(`${config.serviceDir}/`)) {
      throw new BadRequestException('非法笔记路径');
    }
  }

  safe(path: string, writable = false) {
    const normalized = this.normalized(path);
    this.assertSafeDirectoryPath(normalized);
    const extension = extname(normalized).toLowerCase();
    if (!(textExtensions.has(extension) || assetExtensions.has(extension)) || (writable && extension !== '.md')) {
      throw new BadRequestException(writable ? '仅允许 Markdown 写入' : '不支持的文件类型');
    }
    return normalized;
  }

  safeFolder(path: string) {
    const normalized = this.normalized(path.trim());
    this.assertSafeDirectoryPath(normalized);
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
