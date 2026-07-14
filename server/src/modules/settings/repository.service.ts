import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { getSetting, setSetting } from '../../common/database-settings.js';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class RepositoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  get() {
    const stored = getSetting(this.database.db, 'repository');
    if (!stored) return '';
    try {
      return this.normalize(stored);
    } catch {
      return stored;
    }
  }

  branch() {
    return getSetting(this.database.db, 'repository_branch');
  }

  initialized() {
    return getSetting(this.database.db, 'repository_initialized') === '1';
  }

  set(value: string) {
    const normalized = this.normalize(value);
    setSetting(this.database.db, 'repository', normalized);
    setSetting(this.database.db, 'repository_branch', '');
    setSetting(this.database.db, 'repository_initialized', '0');
    return normalized;
  }

  setBranch(value: string) {
    setSetting(this.database.db, 'repository_branch', value);
  }

  markInitialized() {
    setSetting(this.database.db, 'repository_initialized', '1');
  }

  private normalize(value: string) {
    const raw = value.trim().replace(/\/$/, '').replace(/\.git$/, '');
    const match = raw.match(/^(?:git@github\.com:|https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)$/);
    if (!match) throw new BadRequestException('请输入 owner/repo 或合法的 GitHub 仓库地址');
    return `${match[1]}/${match[2]}`;
  }
}
