import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { NotesController } from './notes.controller.js';
import { NoteService } from './note.service.js';

@Module({ imports: [DatabaseModule, StorageModule, SyncModule], controllers: [NotesController], providers: [NoteService], exports: [NoteService] })
export class NotesModule {}
