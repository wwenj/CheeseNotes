import { Inject, Injectable } from '@nestjs/common';
import { SyncService } from '../sync/sync.service.js';

@Injectable()
export class MaintenanceService {
  private token = '';

  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  prepare() {
    this.token = Math.random().toString(36).slice(2);
    return { confirmationId: this.token, ...this.sync.status() };
  }

  execute(confirmationId: string) {
    if (!this.token || confirmationId !== this.token) return { ok: false };
    this.token = '';
    return { ok: true, ...this.sync.reset() };
  }
}
