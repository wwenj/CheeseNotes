// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeArticlePath, forgetOpenedArticle, recentArticlePaths, rememberOpenedArticle } from './constants';

describe('article session and recent history', () => {
  beforeEach(() => {
    const storage = () => {
      const values = new Map<string, string>();
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      };
    };
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('仅在当前页面会话内恢复打开的笔记', () => {
    rememberOpenedArticle('man/notes', 'daily/today.md');

    expect(activeArticlePath('man/notes')).toBe('daily/today.md');
    expect(activeArticlePath('other/notes')).toBeNull();

    sessionStorage.clear();
    expect(activeArticlePath('man/notes')).toBeNull();
    expect(recentArticlePaths('man/notes')).toEqual(['daily/today.md']);
  });

  it('按仓库维护最近访问，并将再次打开的笔记移到最前', () => {
    rememberOpenedArticle('man/notes', 'first.md');
    rememberOpenedArticle('other/notes', 'other.md');
    rememberOpenedArticle('man/notes', 'second.md');
    rememberOpenedArticle('man/notes', 'first.md');

    expect(recentArticlePaths('man/notes')).toEqual(['first.md', 'second.md']);
    expect(recentArticlePaths('other/notes')).toEqual(['other.md']);
  });

  it('删除当前笔记时移除会话与最近访问入口', () => {
    rememberOpenedArticle('man/notes', 'today.md');
    forgetOpenedArticle('man/notes', 'today.md');

    expect(activeArticlePath('man/notes')).toBeNull();
    expect(recentArticlePaths('man/notes')).toEqual([]);
  });
});
