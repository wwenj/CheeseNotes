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

  folder(path: string) {
    return resolve(this.storePath(), this.paths.safeFolder(path));
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

  async createFolder(path: string) {
    const target = this.folder(path);
    const existing = await fs.stat(target).then((stat) => stat.isDirectory()).catch(() => false);
    if (existing) return false;
    await fs.mkdir(target, { recursive: true });
    return true;
  }

  async folders() {
    const output: string[] = [];
    const walk = async (directory: string, relative = ''): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        output.push(path);
        await walk(join(directory, entry.name), path);
      }
    };
    await walk(this.storePath());
    return output.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  async writeIn(root: string, path: string, content: Buffer | string) {
    const target = this.fileIn(root, path);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  async remove(path: string) {
    await fs.rm(this.file(path), { force: true });
  }

  async pruneEmptyFolders(preservedPaths: Iterable<string>) {
    const preserved = new Set(preservedPaths);
    const root = this.storePath();
    const prune = async (directory: string, relative = ''): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        if (entry.isDirectory()) await prune(join(directory, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
      }
      if (!relative || preserved.has(relative)) return;
      const remaining = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return ['.removed'];
        throw error;
      });
      if (!remaining.length) await fs.rmdir(directory);
    };
    await prune(root);
  }

  async clear() {
    await fs.rm(this.storePath(), { recursive: true, force: true });
  }
}
