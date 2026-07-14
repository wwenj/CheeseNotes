import { Body, Controller, Delete, Get, Inject, Post, Put, Query, Res } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import type { FastifyReply } from 'fastify';
import { DeleteNoteDto, SaveNoteDto } from './contracts/notes.dto.js';
import { NoteService } from './note.service.js';

@Controller()
export class NotesController {
  constructor(@Inject(NoteService) private readonly notes: NoteService) {}

  @Get('tree')
  tree() {
    return this.notes.tree();
  }

  @Get('notes/content')
  content(@Query('path') path: string) {
    return this.notes.content(path);
  }

  @Get('notes/render')
  render(@Query('path') path: string) {
    return this.notes.render(path);
  }

  @Get('files')
  async file(@Query('path') path: string, @Res() reply: FastifyReply) {
    const asset = await this.notes.asset(path);
    return reply.type(asset.mime).header('Content-Disposition', 'inline').send(createReadStream(asset.file));
  }

  @Get('search')
  search(@Query('q') q = '') {
    return this.notes.search(q);
  }

  @Post('notes')
  create(@Body() dto: SaveNoteDto) {
    return this.notes.save(dto.path, dto.content);
  }

  @Put('notes')
  update(@Body() dto: SaveNoteDto) {
    return this.notes.save(dto.path, dto.content, dto.revision);
  }

  @Delete('notes')
  remove(@Body() dto: DeleteNoteDto) {
    return this.notes.remove(dto.path, dto.revision);
  }
}
