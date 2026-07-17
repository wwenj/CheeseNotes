export type AutoSaveDraft = {
  workspaceKey: string;
  id?: string;
  path: string;
  content: string;
  revision: string;
  updatedAt: number;
};

export type AutoSaveResult =
  | { kind: 'saved'; revision: string; path: string; id?: string }
  | { kind: 'blocked' };

type AutoSaveQueueOptions = {
  delay?: number;
  retryDelays?: number[];
  persist: (draft: AutoSaveDraft) => Promise<void>;
  clear: (draft: AutoSaveDraft) => Promise<void>;
  save: (draft: AutoSaveDraft) => Promise<AutoSaveResult>;
  onSaved: (draft: AutoSaveDraft, result: Extract<AutoSaveResult, { kind: 'saved' }>, fullySaved: boolean) => void | Promise<void>;
  onRetrying: (draft: AutoSaveDraft) => void;
  onBlocked: (draft: AutoSaveDraft) => void;
};

type AutoSaveTask = {
  latest: AutoSaveDraft;
  revision: string;
  lastSavedContent: string | undefined;
  version: number;
  persistedVersion: number;
  lastChangedAt: number;
  retryIndex: number;
  retryNotified: boolean;
  blockedNotified: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  persisting: Promise<void> | null;
  running: Promise<boolean> | null;
  retired: boolean;
};

const taskKey = (workspaceKey: string, path: string) => `${workspaceKey}\u0000${path}`;

export class AutoSaveQueue {
  private readonly tasks = new Map<string, AutoSaveTask>();
  private readonly delay: number;
  private readonly retryDelays: number[];

  constructor(private readonly options: AutoSaveQueueOptions) {
    this.delay = options.delay ?? 5_000;
    this.retryDelays = options.retryDelays ?? [1_000, 2_000, 5_000, 10_000, 30_000];
  }

  ensure(draft: Omit<AutoSaveDraft, 'updatedAt'> & { updatedAt?: number }) {
    const key = taskKey(draft.workspaceKey, draft.path);
    const current = this.tasks.get(key);
    if (current) return;
    const updatedAt = draft.updatedAt ?? Date.now();
    this.tasks.set(key, {
      latest: { ...draft, updatedAt },
      revision: draft.revision,
      lastSavedContent: draft.content,
      version: 0,
      persistedVersion: 0,
      lastChangedAt: updatedAt,
      retryIndex: 0,
      retryNotified: false,
      blockedNotified: false,
      timer: null,
      persisting: null,
      running: null,
      retired: false,
    });
  }

  restore(draft: AutoSaveDraft) {
    const key = taskKey(draft.workspaceKey, draft.path);
    const current = this.tasks.get(key);
    if (current && current.version > 0 && current.latest.updatedAt >= draft.updatedAt) return;
    const task: AutoSaveTask = current ?? {
      latest: draft,
      revision: draft.revision,
      lastSavedContent: undefined,
      version: 1,
      persistedVersion: 1,
      lastChangedAt: draft.updatedAt,
      retryIndex: 0,
      retryNotified: false,
      blockedNotified: false,
      timer: null,
      persisting: null,
      running: null,
      retired: false,
    };
    task.latest = draft;
    task.revision = draft.revision;
    task.lastSavedContent = undefined;
    task.version = Math.max(1, task.version + 1);
    task.persistedVersion = task.version;
    task.lastChangedAt = draft.updatedAt;
    task.retired = false;
    this.tasks.set(key, task);
    this.schedule(task, 0);
  }

  update(draft: Omit<AutoSaveDraft, 'updatedAt'>) {
    const key = taskKey(draft.workspaceKey, draft.path);
    let task = this.tasks.get(key);
    if (!task) {
      const now = Date.now();
      task = {
        latest: { ...draft, updatedAt: now },
        revision: draft.revision,
        lastSavedContent: undefined,
        version: 0,
        persistedVersion: 0,
        lastChangedAt: now,
        retryIndex: 0,
        retryNotified: false,
        blockedNotified: false,
        timer: null,
        persisting: null,
        running: null,
        retired: false,
      };
      this.tasks.set(key, task);
    }

    const updatedAt = Math.max(Date.now(), task.latest.updatedAt + 1);
    task.latest = { ...draft, revision: task.revision, updatedAt };
    task.version += 1;
    task.lastChangedAt = updatedAt;
    task.retired = false;
    void this.persistLatest(task);

    if (task.latest.content === task.lastSavedContent) {
      void this.persistLatest(task).then(() => this.clearSavedDraft(task, updatedAt));
      return;
    }
    this.schedule(task, this.delay);
  }

  async flush(workspaceKey?: string, path?: string) {
    const tasks = path && workspaceKey
      ? [this.tasks.get(taskKey(workspaceKey, path))].filter((task): task is AutoSaveTask => Boolean(task))
      : [...this.tasks.values()];
    const results = await Promise.all(tasks.map((task) => this.flushTask(task)));
    return results.every(Boolean);
  }

  draft(workspaceKey: string, path: string) {
    const task = this.tasks.get(taskKey(workspaceKey, path));
    return task && this.isDirty(task) ? { ...task.latest, revision: task.revision } : undefined;
  }

  revision(workspaceKey: string, path: string) {
    return this.tasks.get(taskKey(workspaceKey, path))?.revision;
  }

  stop(workspaceKey: string, path: string) {
    const key = taskKey(workspaceKey, path);
    const task = this.tasks.get(key);
    if (!task) return;
    task.retired = true;
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    this.tasks.delete(key);
  }

  stopWorkspace(workspaceKey: string) {
    for (const task of [...this.tasks.values()]) {
      if (task.latest.workspaceKey === workspaceKey) this.stop(task.latest.workspaceKey, task.latest.path);
    }
  }

  dispose() {
    for (const task of this.tasks.values()) {
      task.retired = true;
      if (task.timer) clearTimeout(task.timer);
    }
    this.tasks.clear();
  }

  private isDirty(task: AutoSaveTask) {
    return task.lastSavedContent !== task.latest.content;
  }

  private schedule(task: AutoSaveTask, delay: number) {
    if (task.retired || !this.isDirty(task)) return;
    if (task.timer) clearTimeout(task.timer);
    task.timer = setTimeout(() => {
      task.timer = null;
      void this.run(task);
    }, Math.max(0, delay));
  }

  private async persistLatest(task: AutoSaveTask) {
    if (task.persisting) return task.persisting;
    task.persisting = (async () => {
      while (!task.retired && task.persistedVersion < task.version) {
        const version = task.version;
        const snapshot = { ...task.latest, revision: task.revision };
        await this.options.persist(snapshot);
        task.persistedVersion = version;
      }
    })().finally(() => { task.persisting = null; });
    return task.persisting;
  }

  private async clearSavedDraft(task: AutoSaveTask, throughUpdatedAt: number) {
    if (task.retired || task.latest.updatedAt > throughUpdatedAt) return;
    await this.options.clear({ ...task.latest, revision: task.revision, updatedAt: throughUpdatedAt });
  }

  private async flushTask(task: AutoSaveTask) {
    if (task.retired) return true;
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    await this.persistLatest(task);
    while (this.isDirty(task) && !task.retired) {
      const saved = await this.run(task);
      if (!saved) return false;
    }
    return true;
  }

  private async run(task: AutoSaveTask): Promise<boolean> {
    if (task.retired || !this.isDirty(task)) return true;
    if (task.running) return task.running;
    task.running = this.perform(task).finally(() => { task.running = null; });
    return task.running;
  }

  private async perform(task: AutoSaveTask) {
    await this.persistLatest(task);
    if (task.retired || !this.isDirty(task)) return true;
    const snapshot = { ...task.latest, revision: task.revision };
    try {
      const result = await this.options.save(snapshot);
      if (task.retired) return true;
      if (result.kind === 'blocked') {
        if (!task.blockedNotified) {
          task.blockedNotified = true;
          this.options.onBlocked(snapshot);
        }
        this.scheduleRetry(task);
        return false;
      }

      task.revision = result.revision;
      task.lastSavedContent = snapshot.content;
      task.retryIndex = 0;
      task.retryNotified = false;
      task.blockedNotified = false;
      task.latest = { ...task.latest, path: result.path, id: result.id ?? task.latest.id };
      const previousKey = taskKey(snapshot.workspaceKey, snapshot.path);
      const nextKey = taskKey(task.latest.workspaceKey, task.latest.path);
      if (previousKey !== nextKey && this.tasks.get(previousKey) === task) {
        this.tasks.delete(previousKey);
        this.tasks.set(nextKey, task);
      }
      const fullySaved = task.latest.content === snapshot.content;
      await this.options.onSaved(snapshot, result, fullySaved);

      if (fullySaved) {
        await this.persistLatest(task);
        await this.clearSavedDraft(task, task.latest.updatedAt);
        return true;
      }

      task.latest = {
        ...task.latest,
        revision: task.revision,
        updatedAt: Math.max(Date.now(), task.latest.updatedAt + 1),
      };
      task.version += 1;
      void this.persistLatest(task);
      this.schedule(task, Math.max(0, task.lastChangedAt + this.delay - Date.now()));
      return true;
    } catch {
      task.retryIndex += 1;
      if (task.retryIndex >= 1 && !task.retryNotified) {
        task.retryNotified = true;
        this.options.onRetrying(snapshot);
      }
      this.scheduleRetry(task);
      return false;
    }
  }

  private scheduleRetry(task: AutoSaveTask) {
    const index = Math.min(Math.max(0, task.retryIndex - 1), this.retryDelays.length - 1);
    this.schedule(task, this.retryDelays[index]);
  }
}
