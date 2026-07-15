import { describe, expect, it } from 'vitest';
import { buildTree, fileKind, fileName, folderPaths, treeTitle } from './files';

describe('media file helpers', () => {
  it('recognizes the supported image, audio, and video extensions without case sensitivity', () => {
    expect(fileKind('附件/封面.HEIC')).toBe('image');
    expect(fileKind('附件/录音.OPUS')).toBe('audio');
    expect(fileKind('附件/演示.M4V')).toBe('video');
  });

  it('keeps the original extension in the filename used by preview status copy', () => {
    expect(fileName('会议/访谈.final.mp3')).toBe('访谈.final.mp3');
  });

  it('uses a Markdown heading as the document tree title', () => {
    expect(treeTitle({ path: '收件箱/草稿.md', title: '新的文章标题' })).toBe('新的文章标题');
    expect(treeTitle({ path: '收件箱/草稿.md' })).toBe('草稿');
  });

  it('keeps explicit empty folders in the document tree without turning them into files', () => {
    const files = [{ path: '收件箱/今天.md' }];
    const folders = ['项目/方案', '收件箱/空目录'];
    expect(folderPaths(files, folders)).toEqual(['收件箱', '收件箱/空目录', '项目', '项目/方案']);
    expect(buildTree(files, folders)).toMatchObject([
      { name: '收件箱', folder: true, children: [{ name: '空目录', folder: true }, { name: '今天.md', folder: false }] },
      { name: '项目', folder: true, children: [{ name: '方案', folder: true }] },
    ]);
  });
});
