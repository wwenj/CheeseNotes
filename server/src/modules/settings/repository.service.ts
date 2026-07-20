import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { now } from '../../common/time.js';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class RepositoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  get() {
    return this.row().repository;
  }

  branch() {
    return this.row().branch;
  }

  set(value: string) {
    const repository = this.normalize(value);
    this.database.db.prepare("UPDATE repository_state SET repository=?,branch='',local_head='',remote_head='',generation=0,verified_generation=-1,dirty_count=0,state='checking',phase='fetching',last_error='',verified_at='',updated_at=? WHERE id=1").run(repository, now());
    return repository;
  }

  bind(repository: string, branch: string, head: string) {
    this.database.db.prepare("UPDATE repository_state SET repository=?,branch=?,local_head=?,remote_head=?,generation=0,verified_generation=0,dirty_count=0,state='verified',phase='completed',last_error='',verified_at=?,updated_at=? WHERE id=1").run(repository, branch, head, head, now(), now());
  }

  clear() {
    this.database.db.prepare("UPDATE repository_state SET repository='',branch='',local_head='',remote_head='',generation=0,verified_generation=-1,dirty_count=0,state='unconfigured',phase='idle',last_error='',verified_at='',lock_token='',updated_at=? WHERE id=1").run(now());
  }

  private row() {
    return this.database.db.prepare('SELECT repository,branch,local_head,remote_head FROM repository_state WHERE id=1').get() as {
      repository: string;
      branch: string;
      local_head: string;
      remote_head: string;
    };
  }

  private normalize(value: string) {
    const raw = value.trim().replace(/\/$/, '').replace(/\.git$/, '');
    const match = raw.match(/^(?:git@github\.com:|https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)$/);
    if (!match) throw new BadRequestException('请输入 owner/repo 或合法的 GitHub 仓库地址');
    return `${match[1]}/${match[2]}`;
  }
}
