import { describe, expect, it } from 'vitest';
import { assetExtensions, mimeTypes } from '../src/common/file-types.js';
import { PathPolicy } from '../src/modules/storage/path-policy.service.js';

describe('asset media types', () => {
  it('allows the expanded browser media formats and serves their matching MIME types', () => {
    expect(assetExtensions.has('.heic')).toBe(true);
    expect(assetExtensions.has('.opus')).toBe(true);
    expect(assetExtensions.has('.m4v')).toBe(true);
    expect(mimeTypes['.heic']).toBe('image/heic');
    expect(mimeTypes['.opus']).toBe('audio/ogg');
    expect(mimeTypes['.m4v']).toBe('video/x-m4v');
  });
});

describe('workspace path policy', () => {
  it('rejects absolute paths, traversal segments and control characters before filesystem access', () => {
    const paths = new PathPolicy();
    expect(() => paths.safe('/文章.md')).toThrow('非法笔记路径');
    expect(() => paths.safe('目录/../文章.md')).toThrow('非法笔记路径');
    expect(() => paths.safe('目录//文章.md')).toThrow('非法笔记路径');
    expect(() => paths.safe('文章\u0000.md')).toThrow('非法笔记路径');
  });
});
