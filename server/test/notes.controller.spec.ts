import { describe, expect, it, vi } from 'vitest';
import { NotesController, parseByteRange } from '../src/modules/notes/notes.controller.js';
import type { NoteService } from '../src/modules/notes/note.service.js';

describe('media byte ranges', () => {
  it('handles complete, bounded, and suffix range requests', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange('bytes=100-299', 1000)).toEqual({ start: 100, end: 299 });
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });

  it('rejects malformed and unsatisfiable range requests', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=300-100', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=0-1,2-3', 1000)).toBeUndefined();
  });
});

describe('note tree', () => {
  const tree = {
    files: [{ path: '笔记.md', revision: 'revision', assetVersion: 'asset', updated_at: 'now' }],
    folders: ['空文件夹'],
  };

  it('always returns files and folders together', async () => {
    const notes = { tree: vi.fn(async () => tree) } as unknown as NoteService;
    const controller = new NotesController(notes);

    await expect(controller.tree()).resolves.toEqual(tree);

    expect(notes.tree).toHaveBeenCalledOnce();
  });
});
