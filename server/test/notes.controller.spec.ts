import { describe, expect, it, vi } from 'vitest';
import { NotesController, parseByteRange } from '../src/modules/notes/notes.controller.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
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

describe('note tree compatibility', () => {
  const tree = {
    files: [{ path: '笔记.md', revision: 'revision', assetVersion: 'asset', updated_at: 'now' }],
    folders: ['空文件夹'],
  };

  const reply = () => {
    const value = {
      code: vi.fn(),
      header: vi.fn(),
      send: vi.fn(),
    };
    value.code.mockReturnValue(value);
    value.header.mockReturnValue(value);
    return value;
  };

  it('keeps the legacy array response unless Web explicitly requests folders', async () => {
    const notes = { tree: vi.fn(async () => tree) } as unknown as NoteService;
    const controller = new NotesController(notes);
    const request = { headers: {} } as FastifyRequest;
    const legacyReply = reply();
    const webReply = reply();

    await controller.tree(undefined, request, legacyReply as unknown as FastifyReply);
    await controller.tree('1', request, webReply as unknown as FastifyReply);

    expect(legacyReply.send).toHaveBeenCalledWith(tree.files);
    expect(webReply.send).toHaveBeenCalledWith(tree);
  });
});
