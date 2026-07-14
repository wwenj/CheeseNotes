import { Github, SlidersHorizontal, Type } from 'lucide-react';
import type { GitHubAuth } from '../../api';
import { defaultClientSettings } from '../../app/constants';

type RepositorySettingsProps = {
  repository: string;
  auth: GitHubAuth;
  readerFontSize: number;
  onReaderFontSizeChange: (value: number) => void;
  onDisconnect: () => Promise<void>;
};

export default function RepositorySettings({ repository, auth, readerFontSize, onReaderFontSizeChange, onDisconnect }: RepositorySettingsProps) {
  return <section className="settings-view">
    <header className="settings-header"><span className="utility-icon"><SlidersHorizontal size={22} /></span><div><h1>设置</h1><p>阅读偏好保存在此浏览器；仓库授权保存在本机服务。</p></div></header>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><Type size={17} /></span><div><h2>阅读</h2><p>只调整文章正文，不影响标题栏、按钮和编辑器。</p></div></div><label className="reader-size-control"><span>正文大小 <output>{readerFontSize} px</output></span><input type="range" min="14" max="20" step="1" value={readerFontSize} onChange={(event) => onReaderFontSizeChange(Number(event.target.value))} aria-label="文章正文字号" /><div><small>更紧凑</small><button type="button" onClick={() => onReaderFontSizeChange(defaultClientSettings.readerFontSize)}>恢复默认</button><small>更宽松</small></div></label></section>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><Github size={17} /></span><div><h2>GitHub 仓库</h2><p>已连接 <strong>{auth.login}</strong> · <code>{repository}</code></p></div></div><div className="settings-actions"><button type="button" className="delete-action" onClick={() => void onDisconnect()}>断开 GitHub</button></div></section>
  </section>;
}
