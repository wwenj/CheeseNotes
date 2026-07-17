import { Body, Controller, Delete, Get, Inject, Post, Put, Query, Req, Res } from '@nestjs/common';
import { createReadStream, promises as fs } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CreateFolderDto, DeleteNoteDto, SaveNoteDto } from './contracts/notes.dto.js';
import { NoteService } from './note.service.js';

export function parseByteRange(value: string | undefined, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || size < 1 || (!match[1] && !match[2])) return undefined;

  const [, startValue, endValue] = match;
  const start = startValue ? Number(startValue) : Math.max(size - Number(endValue), 0);
  const end = startValue ? Math.min(endValue ? Number(endValue) : size - 1, size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return undefined;
  return { start, end };
}

@Controller()
export class NotesController {
  constructor(@Inject(NoteService) private readonly notes: NoteService) {}

  @Get('tree')
  async tree() {
    return this.notes.tree();
  }

  @Get('notes/content')
  async content(@Query('path') path: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const note = await this.notes.content(path);
    const etag = `"${note.revision}"`;
    if (request.headers['if-none-match'] === etag) return reply.code(304).header('ETag', etag).header('Cache-Control', 'private, max-age=0, must-revalidate').send();
    return reply.header('ETag', etag).header('Cache-Control', 'private, max-age=0, must-revalidate').send(note);
  }

  @Get('notes/render')
  render(@Query('path') path: string) {
    return this.notes.render(path);
  }

  @Get('files')
  async file(@Query('path') path: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const asset = await this.notes.asset(path);
    const size = (await fs.stat(asset.file)).size;
    const range = parseByteRange(request.headers.range, size);
    const headers = reply
      .type(asset.mime)
      .header('Content-Disposition', 'inline')
      .header('Accept-Ranges', 'bytes')
      .header('ETag', `"${asset.version}"`)
      .header('Cache-Control', 'private, max-age=31536000, immutable');
    if (!request.headers.range && request.headers['if-none-match'] === `"${asset.version}"`) return headers.code(304).send();
    if (range === undefined) return headers.code(416).header('Content-Range', `bytes */${size}`).send();
    if (!range) return headers.header('Content-Length', size).send(createReadStream(asset.file));
    return headers.code(206).header('Content-Length', range.end - range.start + 1).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).send(createReadStream(asset.file, range));
  }

  @Get('search')
  search(@Query('q') q = '') {
    return this.notes.search(q);
  }

  @Post('notes')
  create(@Body() dto: SaveNoteDto) {
    return this.notes.save(dto.path, dto.content, undefined, dto.id);
  }

  @Post('folders')
  createFolder(@Body() dto: CreateFolderDto) {
    return this.notes.createFolder(dto.path);
  }

  @Put('notes')
  update(@Body() dto: SaveNoteDto) {
    return this.notes.save(dto.path, dto.content, dto.revision, dto.id);
  }

  @Delete('notes')
  remove(@Body() dto: DeleteNoteDto) {
    return this.notes.remove(dto.path, dto.revision, dto.id);
  }
}
