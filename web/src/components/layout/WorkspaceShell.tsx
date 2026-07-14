import type { ReactNode } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import Explorer, { type ExplorerProps } from './Explorer';

type WorkspaceShellProps = {
  explorer: ExplorerProps;
  drawerOpen: boolean;
  onDrawerOpen: () => void;
  onDrawerClose: () => void;
  toolbar?: ReactNode;
  feedback?: ReactNode;
  children: ReactNode;
};

export default function WorkspaceShell({ explorer, drawerOpen, onDrawerOpen, onDrawerClose, toolbar, feedback, children }: WorkspaceShellProps) {
  return <main className="vault-app">
    <aside className="desktop-explorer"><Explorer {...explorer} /></aside>
    <section className="vault-workspace">
      {feedback}
      <header className="minimal-topbar">
        <button type="button" className="floating-button" onClick={onDrawerOpen} aria-label="打开文件列表"><PanelLeftOpen size={25} /></button>
        <div className="topbar-spacer" />
        {toolbar}
      </header>
    {children}
    </section>
    <div className={`mobile-scrim ${drawerOpen ? 'is-visible' : ''}`} onClick={onDrawerClose} />
    <aside className={`mobile-explorer ${drawerOpen ? 'is-open' : ''}`}>
      <Explorer {...explorer} />
    </aside>
  </main>;
}
