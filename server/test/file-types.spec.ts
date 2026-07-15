import { describe, expect, it } from 'vitest';
import { assetExtensions, mimeTypes } from '../src/common/file-types.js';

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
