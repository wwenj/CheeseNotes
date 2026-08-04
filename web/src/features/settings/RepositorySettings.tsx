import { useRef, useState, type TouchEvent } from 'react';
import { ArrowLeft, ChevronRight, CircleHelp, FolderTree, Github, Info, ShieldCheck, SlidersHorizontal, Type, X } from 'lucide-react';
import type { GitHubConnection } from '../../api';
import { defaultClientSettings } from '../../app/constants';

type SettingsPage = 'menu' | 'reader' | 'repository' | 'authenticator' | 'about';

type RepositorySettingsProps = {
  repository: string;
  auth: GitHubConnection;
  readerFontSize: number;
  onReaderFontSizeChange: (value: number) => void;
  onClearReadingCache: () => Promise<void>;
  onClearAuthenticatorAccess: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onOpenFileManagement?: () => void;
  onClose: () => void;
};

type SettingsMenuItemProps = {
  icon: typeof Type;
  title: string;
  onClick: () => void;
};

function SettingsMenuItem({ icon: Icon, title, onClick }: SettingsMenuItemProps) {
  return <button type="button" className="settings-menu-item" onClick={onClick}>
    <span className="settings-menu-icon"><Icon size={20} strokeWidth={1.8} /></span>
    <span className="settings-menu-copy"><strong>{title}</strong></span>
    <ChevronRight className="settings-menu-chevron" size={19} strokeWidth={1.8} />
  </button>;
}

function SettingsPageHeader({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose: () => void }) {
  return <header className="settings-page-header">
    {onBack && <button type="button" className="settings-header-action settings-back-action" onClick={onBack} aria-label="返回设置"><ArrowLeft size={21} /></button>}
    <h1>{title}</h1>
    <button type="button" className="settings-header-action" onClick={onClose} aria-label="关闭设置"><X size={21} /></button>
  </header>;
}

export default function RepositorySettings({ repository, auth, readerFontSize, onReaderFontSizeChange, onClearReadingCache, onClearAuthenticatorAccess, onDisconnect, onOpenFileManagement, onClose }: RepositorySettingsProps) {
  const [page, setPage] = useState<SettingsPage>('menu');
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [clearingAuthenticatorAccess, setClearingAuthenticatorAccess] = useState(false);
  const detailSwipeStart = useRef<{ x: number; y: number } | null>(null);

  const confirmDisconnect = async () => {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  };

  const clearReadingCache = async () => {
    setClearingCache(true);
    try {
      await onClearReadingCache();
    } finally {
      setClearingCache(false);
    }
  };

  const clearAuthenticatorAccess = async () => {
    setClearingAuthenticatorAccess(true);
    try {
      await onClearAuthenticatorAccess();
    } finally {
      setClearingAuthenticatorAccess(false);
    }
  };

  const goBack = () => {
    setConfirmingDisconnect(false);
    setPage('menu');
  };

  const handleDetailTouchStart = (event: TouchEvent<HTMLElement>) => {
    detailSwipeStart.current = null;
    if (event.touches.length !== 1 || page === 'menu') return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select')) return;
    const touch = event.touches[0];
    detailSwipeStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleDetailTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = detailSwipeStart.current;
    detailSwipeStart.current = null;
    if (!start || event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    const distanceX = touch.clientX - start.x;
    const distanceY = touch.clientY - start.y;
    if (Math.abs(distanceX) < 72 || Math.abs(distanceX) <= Math.abs(distanceY) * 1.25) return;

    // 左滑满足设置页的快捷返回；保留 iOS 左边缘右滑的常规返回方式。
    if (distanceX < 0 || (start.x <= 32 && distanceX > 0)) {
      event.preventDefault();
      goBack();
    }
  };

  if (page === 'menu') return <section className="settings-view settings-menu-view">
    <SettingsPageHeader title="设置" onClose={onClose} />
    <div className="settings-menu-content">
      <p className="settings-group-label">选项</p>
      <nav className="settings-menu-list" aria-label="设置选项">
        <SettingsMenuItem icon={Type} title="阅读与编辑" onClick={() => setPage('reader')} />
        <SettingsMenuItem icon={Github} title="仓库与同步" onClick={() => setPage('repository')} />
        <SettingsMenuItem icon={FolderTree} title="文件管理" onClick={() => onOpenFileManagement?.()} />
        <SettingsMenuItem icon={ShieldCheck} title="Authenticator 验证" onClick={() => setPage('authenticator')} />
        <SettingsMenuItem icon={Info} title="关于芝士笔记" onClick={() => setPage('about')} />
      </nav>
    </div>
  </section>;

  if (page === 'reader') return <section className="settings-view settings-detail-view" onTouchStart={handleDetailTouchStart} onTouchEnd={handleDetailTouchEnd}>
    <SettingsPageHeader title="阅读与编辑" onBack={goBack} onClose={onClose} />
    <main className="settings-detail-content">
      <p className="settings-group-label">阅读</p>
      <section className="settings-detail-group">
        <div className="settings-detail-heading"><span className="settings-menu-icon"><Type size={20} strokeWidth={1.8} /></span><div><h2>正文字号</h2><p>只影响文章阅读页，不影响编辑器。</p></div><output>{readerFontSize}<small>px</small></output></div>
        <label className="reader-size-control"><input type="range" min="14" max="20" step="1" value={readerFontSize} onInput={(event) => onReaderFontSizeChange(Number(event.currentTarget.value))} aria-label="文章正文字号" /><span><small>紧凑</small><button type="button" onClick={() => onReaderFontSizeChange(defaultClientSettings.readerFontSize)}>恢复默认</button><small>宽松</small></span></label>
      </section>
    </main>
  </section>;

  if (page === 'repository') return <section className="settings-view settings-detail-view" onTouchStart={handleDetailTouchStart} onTouchEnd={handleDetailTouchEnd}>
    <SettingsPageHeader title="仓库与同步" onBack={goBack} onClose={onClose} />
    <main className="settings-detail-content">
      <p className="settings-group-label">当前连接</p>
      <section className="settings-detail-group">
        <div className="settings-detail-row"><span>GitHub 账户</span><strong>{auth.login}</strong></div>
        <div className="settings-detail-row"><span>笔记仓库</span><code>{repository}</code></div>
      </section>
      <p className="settings-group-label">本地缓存</p>
      <section className="settings-detail-group">
        <div className="settings-detail-heading"><span className="settings-menu-icon"><Info size={20} strokeWidth={1.8} /></span><div><h2>阅读缓存</h2><p>清除已缓存的文章和图片，不会影响 GitHub 仓库。</p></div></div>
        <button type="button" className="settings-quiet-button" disabled={clearingCache} onClick={() => void clearReadingCache()}>{clearingCache ? '正在清除…' : '清除本地阅读缓存'}</button>
      </section>
      <p className="settings-group-label settings-danger-label">危险操作</p>
      <section className="settings-detail-group settings-danger-group">
        {!confirmingDisconnect ? <><div className="settings-detail-heading"><span className="settings-menu-icon"><Github size={20} strokeWidth={1.8} /></span><div><h2>断开 GitHub</h2><p>移除当前服务与 GitHub 的连接。</p></div></div><button type="button" className="settings-danger-trigger" onClick={() => setConfirmingDisconnect(true)}>断开连接</button></> : <div className="disconnect-confirmation" role="alert">
          <CircleHelp size={20} strokeWidth={1.8} />
          <div><h2>确认断开连接？</h2><p>断开后会清除当前服务已同步的本机内容、待同步修改和冲突记录。GitHub 仓库中的内容不会被删除。</p><div className="disconnect-confirmation-actions"><button type="button" className="settings-quiet-button" disabled={disconnecting} onClick={() => setConfirmingDisconnect(false)}>取消</button><button type="button" className="settings-danger-button" disabled={disconnecting} onClick={() => void confirmDisconnect()}>{disconnecting ? '正在断开…' : '清除并断开'}</button></div></div>
        </div>}
      </section>
    </main>
  </section>;

  if (page === 'authenticator') return <section className="settings-view settings-detail-view" onTouchStart={handleDetailTouchStart} onTouchEnd={handleDetailTouchEnd}>
    <SettingsPageHeader title="Authenticator 验证" onBack={goBack} onClose={onClose} />
    <main className="settings-detail-content">
      <section className="settings-detail-group settings-authenticator-group">
        <div className="settings-detail-heading"><span className="settings-menu-icon settings-authenticator-icon"><ShieldCheck size={20} strokeWidth={1.8} /></span><div><h2>Authenticator</h2><p>此设备已通过动态验证码验证。</p></div></div>
        <div className="settings-authenticator-action">
          <button type="button" className="settings-danger-trigger" disabled={clearingAuthenticatorAccess} onClick={() => void clearAuthenticatorAccess()}>{clearingAuthenticatorAccess ? '正在删除…' : '删除当前设备验证'}</button>
        </div>
      </section>
    </main>
  </section>;

  return <section className="settings-view settings-detail-view" onTouchStart={handleDetailTouchStart} onTouchEnd={handleDetailTouchEnd}>
    <SettingsPageHeader title="关于芝士笔记" onBack={goBack} onClose={onClose} />
    <main className="settings-detail-content">
      <p className="settings-group-label">CheeseNotes · 芝士笔记</p>
      <section className="settings-detail-group about-settings-group"><div className="settings-detail-heading"><span className="settings-menu-icon"><SlidersHorizontal size={20} strokeWidth={1.8} /></span><div><h2>本地优先的笔记体验</h2><p>使用 GitHub 仓库同步 Markdown 文件，阅读、编辑和同步状态始终清晰可见。</p></div></div><div className="settings-detail-row"><span>版本</span><strong>0.1.0</strong></div></section>
    </main>
  </section>;
}
