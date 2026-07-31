import { useEffect, useState, type ReactNode } from 'react';
import { Circle, CircleCheck, Github, LoaderCircle, ShieldCheck } from 'lucide-react';
import { githubApi, type GitHubRepository, type SyncStatus } from '../../api';
import { messageOf, phaseText } from '../../app/constants';

export function SetupScreen({ feedback, children, centered = false }: { feedback?: ReactNode; children: ReactNode; centered?: boolean }) {
  return <main className={centered ? 'setup-screen setup-screen-centered' : 'setup-screen'}>{feedback}{children}</main>;
}

export function AuthenticatorGate({ error, onVerify }: { error: string | null; onVerify: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const verify = async () => {
    setSubmitting(true);
    setLocalError(null);
    try {
      await onVerify(code);
    } catch (reason) {
      setLocalError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="setup-card authenticator-gate">
    <div className="authenticator-heading"><ShieldCheck size={24} /><h1>Authenticator 验证</h1></div>
    <form className="authenticator-form" onSubmit={(event) => { event.preventDefault(); void verify(); }}>
      <input
        aria-label="Authenticator 验证码"
        autoFocus
        autoComplete="one-time-code"
        className="authenticator-code-input"
        inputMode="numeric"
        maxLength={6}
        pattern="[0-9]{6}"
        placeholder="输入 6 位验证码"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      <button type="submit" className="accent-button authenticator-confirm" disabled={submitting || code.length !== 6}>
        {submitting ? '验证中…' : '确认'}
      </button>
    </form>
    {(localError || error) && <span className="setup-error">{localError || error}</span>}
  </section>;
}

export function ConnectGitHub({ error, onConnect }: { error: string | null; onConnect: () => Promise<void> }) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const begin = async () => {
    setSubmitting(true);
    setLocalError(null);
    try {
      await onConnect();
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

export function RepositoryPicker({ onSelect, compact = false }: { onSelect: (value: string) => Promise<void>; compact?: boolean }) {
  const [items, setItems] = useState<GitHubRepository[]>([]);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void githubApi.repositories().then(setItems).catch((reason) => setError(messageOf(reason))).finally(() => setLoading(false));
  }, []);

  const confirm = async () => {
    if (!value) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSelect(value);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return <section className={compact ? 'repository-picker compact-picker' : 'setup-card repository-picker'}>
    {!compact && <h1>选择笔记库</h1>}
    <select aria-label="选择笔记仓库" className="repository-select" value={value} disabled={loading || submitting} onChange={(event) => { setValue(event.target.value); setError(null); }}>
      <option value="">{loading ? '正在读取仓库…' : '选择仓库'}</option>
      {items.map((item) => <option value={item.fullName} key={item.fullName}>{item.fullName}</option>)}
    </select>
    <button type="button" className="accent-button repository-confirm" disabled={!value || loading || submitting} onClick={() => void confirm()}>
      {submitting ? <LoaderCircle className="spin" size={16} /> : null}确认克隆并同步仓库
    </button>
    {error && <span className="setup-error">{error}</span>}
  </section>;
}

export function InitializationProgress({ sync, onRetry }: { sync: SyncStatus; onRetry: () => Promise<void> }) {
  const phaseOrder: SyncStatus['phase'][] = ['checking-repository', 'checking-remote', 'preparing-workspace', 'cloning', 'configuring-workspace', 'indexing-workspace', 'completed'];
  const currentStep = Math.max(0, phaseOrder.indexOf(sync.phase));
  const phaseDetail: Record<SyncStatus['phase'], string> = {
    idle: '正在准备同步',
    'checking-repository': '正在确认 GitHub 仓库存在且具有写入权限',
    'checking-remote': '正在读取默认分支的远端 Git ref',
    'preparing-workspace': '正在清理并准备本地 Git 工作区',
    cloning: '正在克隆默认分支的当前版本',
    'configuring-workspace': '正在配置本地 Git 用户和远端地址',
    'indexing-workspace': '正在扫描仓库文件并建立 NoteAI 索引',
    fetching: '正在读取 GitHub 最新版本',
    merging: '正在合并本地与远端修改',
    committing: '正在提交本地修改',
    pushing: '正在推送提交到 GitHub',
    verifying: '正在验证 GitHub ref',
    completed: '仓库已完成同步',
    failed: '同步未完成',
  };
  const steps = [
    ['checking-repository', '确认仓库权限'],
    ['checking-remote', '读取远端分支'],
    ['preparing-workspace', '准备本地工作区'],
    ['cloning', '克隆仓库文件'],
    ['configuring-workspace', '配置 Git 工作区'],
    ['indexing-workspace', '建立文件索引'],
  ] as const;

  return <section className="setup-card progress-card">
    <h1>同步仓库当前版本</h1>
    <div className="initial-sync-status" aria-live="polite">
      <LoaderCircle className="spin" size={17} />
      <div><strong>{phaseText[sync.phase]}</strong><span>{phaseDetail[sync.phase]}</span></div>
    </div>
    <ol className="initial-sync-steps">
      {steps.map(([phase, label], index) => {
        const isCurrent = phase === sync.phase;
        const isDone = sync.phase === 'completed' || index < currentStep;
        return <li className={isCurrent ? 'is-current' : isDone ? 'is-done' : ''} key={phase}>
          {isDone ? <CircleCheck size={17} /> : isCurrent ? <LoaderCircle className="spin" size={17} /> : <Circle size={17} />}
          {label}
        </li>;
      })}
    </ol>
    {sync.lastError && <><span className="setup-error">{sync.lastError}</span><button type="button" className="quiet-action" onClick={() => void onRetry()}>重新尝试</button></>}
  </section>;
}

export function Progress({ sync }: { sync: SyncStatus }) {
  return <div className="progress-block">
    <div><LoaderCircle className="spin" size={16} /><span>{phaseText[sync.phase]}</span></div>
  </div>;
}
