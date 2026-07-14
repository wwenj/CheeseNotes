import { Inject, Injectable } from '@nestjs/common';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runtimeConfig } from '../../config/runtime.config.js';
import { PathPolicy } from './path-policy.service.js';

@Injectable()
export class FileStoreService {
  private readonly root = runtimeConfig().dataRoot;

  constructor(@Inject(PathPolicy) private readonly paths: PathPolicy) {}

  dataRoot() {
    return this.root;
  }

  storePath() {
    return join(this.root, 'store');
  }

  file(path: string) {
    return resolve(this.storePath(), this.paths.safe(path));
  }

  fileIn(root: string, path: string) {
    return resolve(root, this.paths.safe(path));
  }

  exists(path: string) {
    return existsSync(this.file(path));
  }

  async readText(path: string) {
    return fs.readFile(this.file(path), 'utf8');
  }

  async write(path: string, content: Buffer | string) {
    return this.writeIn(this.storePath(), path, content);
  }

  async writeAtomic(path: string, content: string) {
    const target = this.file(path);
    const temporary = `${target}.tmp`;
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, target);
  }

  async writeIn(root: string, path: string, content: Buffer | string) {
    const target = this.fileIn(root, path);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  async remove(path: string) {
    await fs.rm(this.file(path), { force: true });
  }

  async clear() {
    await fs.rm(this.storePath(), { recursive: true, force: true });
  }
}
