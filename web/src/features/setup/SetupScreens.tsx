import { useEffect, useState, type ReactNode } from 'react';
import { Check, Github, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { authApi, githubApi, type GitHubRepository, type SyncStatus } from '../../api';
import { formatBytes, messageOf, phaseText } from '../../app/constants';

export function SetupScreen({ feedback, children }: { feedback?: ReactNode; children: ReactNode }) {
  return <main className="setup-screen">{feedback}{children}</main>;
}

export function GitHubLogin({ error }: { error: string | null }) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const begin = async () => {
    setSubmitting(true);
    setLocalError(null);
    try {
      const authorization = await authApi.startGitHubLogin();
      window.location.href = authorization.url;
    } catch (reason) {
      setLocalError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="setup-card setup-connect-card setup-login-card">
    <div className="setup-brand-mark setup-login-brand"><img src="/cheese-logo.png" alt="" /><span>芝士</span></div>
    <h1>使用 GitHub 登录</h1>
    <button type="button" className="accent-button setup-action" disabled={submitting} onClick={() => void begin()}>
      {submitting ? <LoaderCircle className="spin" size={16} /> : <Github size={16} />}使用 GitHub 登录
    </button>
    {(localError || error) && <span className="setup-error">{localError || error}</span>}
  </section>;
}

export function AccessDenied({ onRetry }: { onRetry: () => void }) {
  return <section className="setup-card setup-connect-card setup-access-denied">
    <div className="setup-brand-mark"><span className="setup-icon"><ShieldAlert size={25} /></span><span>访问控制</span></div>
    <h1>暂无使用权限</h1>
    <p>当前 GitHub 账号关联的已验证邮箱未获授权。请切换到获授权账号后重新登录。</p>
    <button type="button" className="accent-button setup-action" onClick={onRetry}><Github size={16} />重新登录</button>
  </section>;
}

export function ConnectGitHub({ error }: { error: string | null }) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const begin = async () => {
    setSubmitting(true);
    setLocalError(null);
    try {
      const authorization = await githubApi.startRepositoryAuthorization();
      window.location.href = authorization.url;
    } catch (reason) {
      setLocalError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="setup-card setup-connect-card">
    <div className="setup-brand-mark"><span className="setup-icon"><Github size={25} /></span><span>GitHub</span></div>
    <h1>连接你的笔记库</h1>
    <p>授权 GitHub 后选择一个可写仓库作为笔记库。</p>
    <form className="setup-form" onSubmit={(event) => { event.preventDefault(); void begin(); }}>
      <button type="submit" className="accent-button setup-action" disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={16} /> : <Github size={16} />}连接 GitHub
      </button>
      <button type="button" className="quiet-action setup-refresh-action" onClick={() => window.location.reload()}>已成功连接</button>
    </form>
    {(localError || error) && <span className="setup-error">{localError || error}</span>}
    <div className="setup-note"><ShieldCheck size={15} /><span>将跳转至 GitHub 完成授权，不需要启用设备流。</span></div>
  </section>;
}

export function RepositoryPicker({ login, onSelect, compact = false }: { login: string | null; onSelect: (value: string) => Promise<void>; compact?: boolean }) {
  const [items, setItems] = useState<GitHubRepository[]>([]);
  const [value, setValue] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void githubApi.repositories().then(setItems).catch((reason) => setError(messageOf(reason))).finally(() => setLoading(false));
  }, []);

  const visible = items.filter((item) => item.fullName.toLowerCase().includes(search.toLowerCase()));
  const select = async (repository: string) => {
    if (!repository.trim()) return;
    setError(null);
    try {
      await onSelect(repository);
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  return <section className={compact ? 'repository-picker compact-picker' : 'setup-card repository-picker'}>
    {!compact && <><span className="setup-icon"><ShieldCheck size={24} /></span><h1>选择笔记库</h1><p>已连接 <strong>{login}</strong>。只会下载仓库当前分支，不会克隆 Git 历史。</p></>}
    <label>搜索可写仓库<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="owner/repository" /></label>
    {loading ? <span className="inline-loading"><LoaderCircle className="spin" size={15} />读取仓库列表</span> : <div className="repository-list">
      {visible.map((item) => <button type="button" key={item.fullName} className="repository-item" onClick={() => void select(item.fullName)}><span>{item.fullName}</span><small>{item.private ? '私有' : '公开'} · {item.branch}</small></button>)}
      {!visible.length && <span className="empty-copy">没有匹配结果，可手动填写仓库名。</span>}
    </div>}
    <label className="manual-repository">手动填写仓库<input value={value} onChange={(event) => setValue(event.target.value)} placeholder="owner/repository" /></label>
    <button type="button" className="quiet-action" disabled={!value.trim()} onClick={() => void select(value)}>使用此仓库</button>
    {error && <span className="setup-error">{error}</span>}
  </section>;
}

export function InitializationProgress({ sync, onRetry }: { sync: SyncStatus; onRetry: () => Promise<void> }) {
  return <section className="setup-card progress-card">
    <span className="setup-icon"><LoaderCircle className="spin" size={25} /></span>
    <h1>{phaseText[sync.phase]}</h1>
    <p>{sync.currentPath ? `正在处理：${sync.currentPath}` : '正在准备本地笔记库。页面会持续更新进度。'}</p>
    <Progress sync={sync} />
    <div className="phase-list">{['校验授权', '读取文件树', '下载文件', '激活本地缓存'].map((item, index) => <span key={item} className={index <= phaseIndex(sync.phase) ? 'is-done' : ''}>{index <= phaseIndex(sync.phase) ? <Check size={14} /> : <i />}{item}</span>)}</div>
    {sync.lastError && <><span className="setup-error">{sync.lastError}</span><button type="button" className="quiet-action" onClick={() => void onRetry()}>重新尝试</button></>}
  </section>;
}

export function Progress({ sync }: { sync: SyncStatus }) {
  const total = sync.totalBytes || sync.totalFiles;
  const done = sync.totalBytes ? sync.processedBytes : sync.processedFiles;
  const percent = total ? Math.min(100, Math.round(done / total * 100)) : 0;
  return <div className="progress-block">
    <div><strong>{percent}%</strong><span>{sync.totalFiles ? `${sync.processedFiles} / ${sync.totalFiles} 个文件` : '正在准备文件列表'}</span></div>
    <progress value={done} max={total || 1} />
    {sync.totalBytes > 0 && <small>{formatBytes(sync.processedBytes)} / {formatBytes(sync.totalBytes)}</small>}
  </div>;
}

function phaseIndex(phase: SyncStatus['phase']) {
  return ({ fetching: 0, merging: 1, committing: 2, verifying: 3, completed: 3 } as Partial<Record<SyncStatus['phase'], number>>)[phase] ?? -1;
}
