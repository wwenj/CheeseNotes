import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronLeft, LoaderCircle, RefreshCw } from 'lucide-react';
import { syncApi, type ConflictDetail, type SyncConflict, type SyncStatus } from '../../api';
import { isSyncBusy, messageOf, phaseText, stateText } from '../../app/constants';
import { Progress } from '../setup/SetupScreens';

type SyncPanelProps = {
  sync: SyncStatus | null;
  onSync: () => Promise<void>;
  onRefresh: () => void;
  onError: (value: string) => void;
};

export default function SyncPanel({ sync, onSync, onRefresh, onError }: SyncPanelProps) {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [detail, setDetail] = useState<ConflictDetail | null>(null);
  const [side, setSide] = useState<'local' | 'remote'>('local');
  const [manual, setManual] = useState('');

  const loadConflicts = useCallback(async () => {
    try {
      setConflicts(await syncApi.conflicts());
    } catch (reason) {
      onError(messageOf(reason));
    }
  }, [onError]);

  useEffect(() => {
    if ((sync?.conflictCount ?? 0) > 0) void loadConflicts();
    else {
      setConflicts([]);
      setDetail(null);
    }
  }, [loadConflicts, sync?.conflictCount]);

  const openConflict = async (item: SyncConflict) => {
    try {
      const next = await syncApi.conflict(item.id);
      setDetail(next);
      setManual(next.local_content ?? '');
      setSide('local');
    } catch (reason) {
      onError(messageOf(reason));
    }
  };

  const resolve = async (action: 'keep-local' | 'use-remote' | 'manual') => {
    if (!detail) return;
    try {
      await syncApi.resolve(detail.id, action, action === 'manual' ? manual : undefined);
      setDetail(null);
      await loadConflicts();
      onRefresh();
    } catch (reason) {
      onError(messageOf(reason));
    }
  };

  return <section className="utility-view sync-view">
    <span className={`utility-icon state-${sync?.state ?? 'unconfigured'}`}>{sync?.state === 'failed' || sync?.state === 'conflict' ? <AlertTriangle size={22} /> : <RefreshCw className={isSyncBusy(sync) ? 'spin' : ''} size={22} />}</span>
    <h1>{stateText[sync?.state ?? 'unconfigured']}</h1>
    <p>{sync?.lastError || (sync?.lastSuccessAt ? `上次完成：${new Date(sync.lastSuccessAt).toLocaleString()}` : phaseText[sync?.phase ?? 'idle'])}</p>
    {isSyncBusy(sync) && sync && <Progress sync={sync} />}
    <div className="sync-metrics"><span><strong>{sync?.pendingCount ?? '—'}</strong>待同步</span><span><strong>{sync?.conflictCount ?? '—'}</strong>冲突</span></div>
    <button type="button" className="accent-button" disabled={!sync?.manualSyncAvailable || isSyncBusy(sync)} onClick={() => void onSync()}>{isSyncBusy(sync) ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}立即同步</button>
    {detail ? <section className="conflict-detail">
      <button type="button" className="back-action" onClick={() => setDetail(null)}><ArrowLeft size={15} />返回冲突列表</button>
      <h2>{detail.path}</h2>
      <div className="conflict-tabs"><button type="button" className={side === 'local' ? 'is-active' : ''} onClick={() => setSide('local')}>本地版本</button><button type="button" className={side === 'remote' ? 'is-active' : ''} onClick={() => setSide('remote')}>远端版本</button></div>
      <pre>{side === 'local' ? detail.local_content : detail.remote_content}</pre>
      <textarea value={manual} onChange={(event) => setManual(event.target.value)} aria-label="手动合并内容" />
      <div className="conflict-actions"><button type="button" className="quiet-action" onClick={() => void resolve('use-remote')}>采用远端</button><button type="button" className="quiet-action" onClick={() => void resolve('keep-local')}>保留本地</button><button type="button" className="accent-button" onClick={() => void resolve('manual')}>提交手动合并</button></div>
    </section> : conflicts.length > 0 && <section className="conflict-list"><h2>需要处理的冲突</h2>{conflicts.map((item) => <button type="button" key={item.id} onClick={() => void openConflict(item)}><span>{item.path}</span><ChevronLeft size={15} /></button>)}</section>}
  </section>;
}
