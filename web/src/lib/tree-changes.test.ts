import { describe, expect, it } from 'vitest';
import { projectTree } from './tree-changes';

describe('file management preview', () => {
  const tree = {
    files: [
      { id: 'one', path: '收件箱/一.md', revision: 'r1' },
      { id: 'two', path: '项目/二.png', revision: 'r2' },
    ],
    folders: ['收件箱', '项目', '归档'],
  };

  it('projects mixed file and folder changes without mutating the source tree', () => {
    const result = projectTree(tree, [
      { type: 'move-file', id: 'one', fromPath: '收件箱/一.md', toFolder: '归档', revision: 'r1' },
      { type: 'move-folder', fromPath: '项目', toPath: '资料' },
    ]);

    expect(result.files.map((file) => file.path)).toEqual(['归档/一.md', '资料/二.png']);
    expect(result.folders).toEqual(expect.arrayContaining(['归档', '资料']));
    expect(tree.files.map((file) => file.path)).toEqual(['收件箱/一.md', '项目/二.png']);
  });

  it('removes nested files and folders from the projected tree', () => {
    const result = projectTree(tree, [{ type: 'delete-folder', path: '项目', recursive: true }]);
    expect(result.files.map((file) => file.path)).toEqual(['收件箱/一.md']);
    expect(result.folders).not.toContain('项目');
  });
});
