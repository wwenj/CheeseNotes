import { beforeEach, describe, expect, it, vi } from 'vitest';
import { imagePreviewForLine, listMarkerForLine, markdownMarkerRanges } from '../components/MarkdownLiveEditor';
import { splitArticle } from './article';
import { displayName } from './files';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null });
});

describe('article markdown helpers', () => {
  it('splits only the leading title and preserves the body byte-for-byte', () => {
    const content = '# 我的标题\n\n正文含有 **加粗**、[[笔记|别名]] 和表格。\n';
    expect(splitArticle(content, '收件箱/草稿.md')).toEqual({ title: '我的标题', body: '正文含有 **加粗**、[[笔记|别名]] 和表格。\n' });
  });

  it('uses the filename when a document does not start with a title', () => {
    expect(splitArticle('普通正文', '收件箱/草稿.md')).toEqual({ title: '草稿', body: '普通正文' });
  });

});

describe('file display names', () => {
  it('removes regular extensions without truncating dotfiles', () => {
    expect(displayName('资料/会议记录.md')).toBe('会议记录');
    expect(displayName('附件/录音.m4a')).toBe('录音');
    expect(displayName('.gitignore')).toBe('.gitignore');
  });
});

describe('live preview markers', () => {
  const content = '# 标题\n\n这是 **加粗** 和 [链接](https://example.com)。\n\n[[笔记|显示名]]';

  it('keeps markdown syntax visible in the focused line', () => {
    const line = content.indexOf('这是');
    const ranges = markdownMarkerRanges(content, line, content.indexOf('\n', line));
    expect(ranges.some((range) => content.slice(range.from, range.to).includes('**'))).toBe(false);
    expect(ranges.some((range) => content.slice(range.from, range.to) === '# ')).toBe(true);
  });

  it('hides link delimiters and wiki-link target outside the focused line', () => {
    const titleEnd = content.indexOf('\n');
    const hidden = markdownMarkerRanges(content, 0, titleEnd).map((range) => content.slice(range.from, range.to));
    expect(hidden).toContain('**');
    expect(hidden).toContain('](' + 'https://example.com)');
    expect(hidden).toContain('[[笔记|');
    expect(hidden).toContain(']]');
  });
});

describe('live preview lists', () => {
  it('renders non-focused list syntax as the same marker hierarchy used by reading mode', () => {
    expect(listMarkerForLine('- 一级项目')).toMatchObject({ kind: 'unordered', level: 1 });
    expect(listMarkerForLine('    - 二级项目')).toMatchObject({ kind: 'unordered', level: 2 });
    expect(listMarkerForLine('3. 有序项目')).toMatchObject({ kind: 'ordered', level: 1, number: '3' });
  });

  it('keeps task lists and the original Markdown syntax available when their line is focused', () => {
    expect(listMarkerForLine('- [x] 已完成')).toMatchObject({ kind: 'task', checked: true });
    const content = '- 项目\n\n正文';
    expect(markdownMarkerRanges(content, 0, content.indexOf('\n'))).toEqual([]);
  });

  it('never includes a line break in an unfinished list marker', () => {
    const content = '- 列表 1\n- \n';
    const ranges = markdownMarkerRanges(content, 0, 0);
    expect(ranges.map(({ from, to }) => content.slice(from, to))).toEqual(['- ', '- ']);
    expect(ranges.every(({ from, to }) => !content.slice(from, to).includes('\n'))).toBe(true);
    expect(listMarkerForLine('- ')).toMatchObject({ kind: 'unordered', from: 0, to: 2 });
  });
});

describe('live preview images', () => {
  it('recognizes standard Markdown images without changing their source', () => {
    expect(imagePreviewForLine('![封面](https://example.com/cover.png)', '文章/正文.md', [])).toEqual({ alt: '封面', src: 'https://example.com/cover.png' });
  });

  it('resolves existing Obsidian image embeds through the vault file endpoint', () => {
    const image = imagePreviewForLine('![[imgs/cover.png|600]]', '文章/正文.md', [{ path: '文章/imgs/cover.png' }]);
    expect(image?.alt).toBe('cover.png');
    expect(image?.src).toContain('files?path=');
  });
});
