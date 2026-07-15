import { describe, expect, it } from 'vitest';
import { fileKind, fileName } from './files';

describe('media file helpers', () => {
  it('recognizes the supported image, audio, and video extensions without case sensitivity', () => {
    expect(fileKind('附件/封面.HEIC')).toBe('image');
    expect(fileKind('附件/录音.OPUS')).toBe('audio');
    expect(fileKind('附件/演示.M4V')).toBe('video');
  });

  it('keeps the original extension in the filename used by preview status copy', () => {
    expect(fileName('会议/访谈.final.mp3')).toBe('访谈.final.mp3');
  });
});
