import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { syncApi, type ConflictAction, type ConflictDetail, type SyncConflict, type SyncStatus } from '../../api';
import { isSyncBusy, messageOf } from '../../app/constants';
import { Progress } from '../setup/SetupScreens';

type AutoConflictAction = Exclude<ConflictAction, 'manual'>;

type SyncPanelProps = {
  sync: SyncStatus | null;
  onSync: () => Promise<void>;
  onSyncStatus: (sync: SyncStatus) => void;
  onRefresh: () => void;
  onError: (value: string) => void;
  onClose: () => void;
};

const resolutionOptions: Array<{ value: AutoConflictAction; title: string }> = [
  { value: 'use-remote', title: '采用远端' },
  { value: 'keep-local', title: '保留本地' },
  { value: 'keep-both', title: '保留两个版本' },
];

export default function SyncPanel({ sync, onSync, onSyncStatus, onRefresh, onError, onClose }: SyncPanelProps) {
  const [items, setItems] = useState<SyncConflict[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [details, setDetails] = useState<Record<string, ConflictDetail>>({});
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const pendingDecisionSaves = useRef(new Set<Promise<void>>());
  const [bulkAction, setBulkAction] = useState<AutoConflictAction | null>('keep-both');
  const [applying, setApplying] = useState(false);

  const loadList = useCallback(async (reset: boolean, cursor?: string | null) => {
    setLoading(true);
    try {
      const page = await syncApi.conflicts({ cursor: reset ? undefined : cursor ?? undefined, limit: 50 });
      setItems((current) => reset ? page.items : [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      setDraftCount(page.resolutionDraftCount);
    } catch (reason) {
      onError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadList(true);
  }, [loadList]);

  useEffect(() => {
    if ((sync?.conflictCount ?? 0) === 0) {
      setItems([]);
      setDetails({});
      setTotal(0);
      setDraftCount(0);
      setBulkAction('keep-both');
      return;
    }
    if (sync?.syncBlockedByConflicts && sync.conflictCount !== total) void loadList(true);
  }, [loadList, sync?.conflictCount, sync?.syncBlockedByConflicts, total]);

  const loadDetail = async (id: string) => {
    if (details[id] || loadingDetail === id) return;
    setLoadingDetail(id);
    try {
      const detail = await syncApi.conflict(id);
      if (detail) setDetails((current) => ({ ...current, [id]: detail }));
    } catch (reason) {
      onError(messageOf(reason));
    } finally {
      setLoadingDetail(null);
    }
  };

  const saveSingleDecision = (item: SyncConflict, action: AutoConflictAction) => {
    const wasUndecided = item.resolution_action === null;
    setSavingIds((current) => new Set(current).add(item.id));
    setBulkAction(null);
    setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, resolution_action: action } : currentItem));
    if (wasUndecided) setDraftCount((current) => Math.min(total, current + 1));

    const request = (async () => {
      try {
        const result = await syncApi.saveDecision(item.id, action);
        if (!result.ok || !result.conflict) {
          await loadList(true);
          return;
        }
        setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, resolution_action: action, resolution_copy_path: result.conflict.resolution_copy_path } : currentItem));
        setDraftCount((current) => Math.max(current, result.sync.resolutionDraftCount));
      } catch (reason) {
        setItems((current) => current.map((currentItem) => currentItem.id === item.id ? item : currentItem));
        if (wasUndecided) setDraftCount((current) => Math.max(0, current - 1));
        onError(messageOf(reason));
      } finally {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    })();

    pendingDecisionSaves.current.add(request);
    void request.finally(() => pendingDecisionSaves.current.delete(request));
  };

  const processConflicts = async () => {
    if (!bulkAction && draftCount !== total) return;
    setApplying(true);
    try {
      await Promise.all([...pendingDecisionSaves.current]);
      if (bulkAction) {
        const saved = await syncApi.saveAllDecisions(bulkAction);
        onSyncStatus(saved.sync);
      }
      const next = await syncApi.applyDecisions();
      onSyncStatus(next);
      onRefresh();
    } catch (reason) {
      onError(messageOf(reason));
    } finally {
      setApplying(false);
    }
  };

  const processing = applying || isSyncBusy(sync);
  const allDecided = total > 0 && draftCount === total;
  const canProcess = Boolean(bulkAction) || allDecided;

  return <section className="settings-view sync-conflicts-view">
    <header className="settings-page-header">
      <h1>同步冲突</h1>
      <button type="button" className="settings-header-action" onClick={onClose} aria-label="关闭同步冲突"><X size={21} /></button>
    </header>

    <main className="sync-conflicts-content">
      {sync?.lastError && <p className="sync-conflicts-warning">{sync.lastError}</p>}
      {!total && !loading ? <section className="sync-conflicts-empty"><Check size={24} /><h2>没有待处理的冲突</h2><p>当前本地与远端内容一致。</p><button type="button" className="accent-button" disabled={!sync?.manualSyncAvailable || processing} onClick={() => void onSync()}><RefreshCw size={16} />立即同步</button></section> : <>
        <section className="sync-conflicts-all" aria-labelledby="sync-conflicts-all-title">
          <h2 id="sync-conflicts-all-title">全部处理</h2>
          <ResolutionOptions name="all-conflicts" value={bulkAction} onChange={setBulkAction} disabled={processing} />
        </section>

        <section className="sync-conflicts-list" aria-labelledby="sync-conflicts-list-title">
          <h2 id="sync-conflicts-list-title">逐条处理</h2>
          {items.map((item) => <ConflictItem key={item.id} item={item} inheritedAction={bulkAction} detail={details[item.id]} detailLoading={loadingDetail === item.id} busy={processing || savingIds.has(item.id)} onShowDetail={() => void loadDetail(item.id)} onChange={(action) => saveSingleDecision(item, action)} />)}
          {nextCursor && <button type="button" className="sync-conflicts-more" disabled={loading} onClick={() => void loadList(false, nextCursor)}>{loading ? <LoaderCircle className="spin" size={15} /> : null}加载更多</button>}
        </section>
        {processing && sync && <div className="sync-conflicts-progress"><Progress sync={sync} /></div>}
      </>}
    </main>

    {total > 0 && <footer className="sync-conflicts-footer"><button type="button" className="accent-button" disabled={!canProcess || processing} onClick={() => void processConflicts()}>{processing ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}处理冲突</button></footer>}
  </section>;
}

function ConflictItem({ item, inheritedAction, detail, detailLoading, busy, onShowDetail, onChange }: { item: SyncConflict; inheritedAction: AutoConflictAction | null; detail?: ConflictDetail; detailLoading: boolean; busy: boolean; onShowDetail: () => void; onChange: (action: AutoConflictAction) => void }) {
  const selected = inheritedAction ?? (item.resolution_action === 'manual' ? null : item.resolution_action);
  return <article className="sync-conflict-item">
    <div className="sync-conflict-item-head"><strong>{item.path}</strong></div>
    <ResolutionOptions name={`conflict-${item.id}`} value={selected} onChange={onChange} disabled={busy} />
    <details className="sync-conflict-content" onToggle={(event) => { if (event.currentTarget.open) onShowDetail(); }}><summary>查看本地与远端内容</summary>{detailLoading ? <p><LoaderCircle className="spin" size={14} />正在读取内容</p> : detail ? <div className="sync-conflict-content-columns"><ContentBlock title="本地" value={detail.local_content} /><ContentBlock title="远端" value={detail.remote_content} /></div> : null}</details>
  </article>;
}

function ResolutionOptions({ name, value, onChange, disabled }: { name: string; value: AutoConflictAction | null; onChange: (action: AutoConflictAction) => void; disabled: boolean }) {
  return <div className="sync-resolution-options" role="radiogroup" aria-label="冲突处理方式">{resolutionOptions.map((option) => <label key={option.value} className={value === option.value ? 'is-selected' : ''}><input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} /><strong>{option.title}</strong></label>)}</div>;
}

function ContentBlock({ title, value }: { title: string; value: string | null }) {
  return <section><h3>{title}</h3><pre>{value === null ? '已删除' : value || '（空文件）'}</pre></section>;
}
