import { BadGatewayException, GatewayTimeoutException, Injectable, OnModuleDestroy, OnModuleInit, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { runtimeConfig } from '../../config/runtime.config.js';

export type GitRunOptions = {
  cwd?: string;
  token?: string;
  timeout?: number;
};

@Injectable()
export class GitProcessService implements OnModuleInit, OnModuleDestroy {
  private readonly jobsRoot = join(runtimeConfig().dataRoot, 'git-jobs');
  private readonly activeAborts = new Set<AbortController>();

  async onModuleInit() {
    await fs.mkdir(this.jobsRoot, { recursive: true });
    const staleAskPass = (await fs.readdir(this.jobsRoot)).filter((name) => /^askpass-[\w-]+\.sh$/.test(name));
    await Promise.all(staleAskPass.map((name) => fs.rm(join(this.jobsRoot, name), { force: true })));
    try {
      await this.run(['--version'], { cwd: this.jobsRoot, timeout: 10_000 });
    } catch (reason) {
      throw new Error(`CheeseNotes 启动失败：系统 Git 不可用。${reason instanceof Error ? ` ${reason.message}` : ''}`);
    }
  }

  onModuleDestroy() {
    this.cancelActive();
  }

  cancelActive() {
    for (const controller of this.activeAborts) controller.abort();
  }

  async run(args: string[], options: GitRunOptions = {}) {
    const timeout = options.timeout ?? 60_000;
    const askpass = options.token ? join(this.jobsRoot, `askpass-${randomUUID()}.sh`) : '';
    const abort = new AbortController();
    this.activeAborts.add(abort);
    const timeoutHandle = setTimeout(() => abort.abort(), timeout);
    timeoutHandle.unref();
    try {
      if (askpass) {
        await fs.writeFile(askpass, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$NOTEAI_GIT_TOKEN" ;;\nesac\n', { mode: 0o700 });
      }
      const git = simpleGit({
        baseDir: options.cwd ?? this.jobsRoot,
        maxConcurrentProcesses: 1,
        abort: abort.signal,
        timeout: { block: timeout },
        trimmed: false,
        unsafe: { allowUnsafeAskPass: true, allowUnsafeConfigPaths: true },
      });
      const inheritedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => Boolean(value) && !['PAGER', 'GIT_PAGER', 'GIT_EDITOR', 'EDITOR'].includes(key)));
      Object.assign(inheritedEnvironment, {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_LFS_SKIP_SMUDGE: '1',
      });
      if (askpass && options.token) {
        git.env({
          ...inheritedEnvironment,
          GIT_ASKPASS: askpass,
          GIT_TERMINAL_PROMPT: '0',
          NOTEAI_GIT_TOKEN: options.token,
        });
      } else {
        git.env({ ...inheritedEnvironment, GIT_TERMINAL_PROMPT: '0' });
      }
      return await git.raw(args);
    } catch (reason) {
      throw this.classify(reason, options.token, abort.signal.aborted);
    } finally {
      clearTimeout(timeoutHandle);
      this.activeAborts.delete(abort);
      if (askpass) await fs.rm(askpass, { force: true }).catch(() => undefined);
    }
  }

  private classify(reason: unknown, token?: string, timedOut = false) {
    const raw = reason instanceof Error ? reason.message : String(reason);
    const message = this.sanitize(raw, token);
    if (timedOut || /timed?\s*out|timeout|killed by the timeout/i.test(message)) return new GatewayTimeoutException({ code: 'GIT_TIMEOUT', message: 'Git 操作超时，已停止并校验远端状态' });
    if (/authentication failed|could not read username|invalid username or password|permission denied \(publickey\)|repository not found/i.test(message)) {
      return new UnauthorizedException({ code: 'GIT_AUTH_FAILED', message: 'GitHub Git 认证失败，请重新连接 GitHub' });
    }
    if (/protected branch|pre-receive hook declined|remote rejected|permission.*denied/i.test(message)) {
      return new UnprocessableEntityException({ code: 'GIT_PUSH_REJECTED', message: 'GitHub 拒绝了提交，请检查分支保护和仓库权限' });
    }
    if (/not a git repository|bad object|invalid path|unsafe repository/i.test(message)) {
      return new UnprocessableEntityException({ code: 'GIT_WORKSPACE_INVALID', message: '本地 Git 工作区无效，需要重新选择仓库' });
    }
    return new BadGatewayException({ code: 'GIT_FAILED', message: `Git 操作失败：${message.slice(0, 500)}` });
  }

  private sanitize(value: string, token?: string) {
    let output = value.replace(/https:\/\/[^\s/@]+@github\.com/gi, 'https://github.com');
    if (token) output = output.split(token).join('[REDACTED]');
    return output.replace(/NOTEAI_GIT_TOKEN=[^\s]+/g, 'NOTEAI_GIT_TOKEN=[REDACTED]');
  }
}
