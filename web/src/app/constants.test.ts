import { describe, expect, it } from 'vitest';
import { newNotePath } from './constants';

describe('new note path', () => {
  it('uses an untitled filename and avoids overwriting an existing note', () => {
    expect(newNotePath([])).toBe('未命名.md');
    expect(newNotePath(['未命名.md', '未命名 2.md'])).toBe('未命名 3.md');
  });
});
