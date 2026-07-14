import { Module } from '@nestjs/common';
import { FileStoreService } from './file-store.service.js';
import { PathPolicy } from './path-policy.service.js';

@Module({ providers: [PathPolicy, FileStoreService], exports: [PathPolicy, FileStoreService] })
export class StorageModule {}
