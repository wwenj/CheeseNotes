import { useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { notesApi } from '../api';
import { isNativeIOS } from '../api/platform';
import { fileKind, fileName } from '../lib/files';
import { cachedAssetSource } from '../lib/workspace-cache';
import CachedImage from './CachedImage';

type PreviewState = 'loading' | 'ready' | 'error';
export default function AssetViewer({ path, version, fragment, embedded = false }: { path: string; version?: string; fragment?: string; embedded?: boolean }) {
  const fileUrl = notesApi.fileUrl(path, version);
  const kind = fileKind(path);
  const [state, setState] = useState<PreviewState>('loading');
  const [mediaSource, setMediaSource] = useState<string | null>(isNativeIOS() ? null : fileUrl);
  const name = fileName(path);

  useEffect(() => {
    setState('loading');
  }, [path, version]);

  useEffect(() => {
    if (!isNativeIOS() || kind === 'image') {
      setMediaSource(fileUrl);
      return;
    }
    let active = true;
    let release = () => {};
    setMediaSource(null);
    void cachedAssetSource(fileUrl).then((result) => {
      release = result.release;
      if (active) setMediaSource(result.source);
      else release();
    }).catch(() => {
      if (active) setState('error');
    });
    return () => {
      active = false;
      release();
    };
  }, [fileUrl, kind]);

  if (kind !== 'pdf' && kind !== 'image' && kind !== 'audio' && kind !== 'video') {
    return <div className="unsupported-file"><FileWarning size={28} /><h2>此文件不能直接预览</h2></div>;
  }

  const complete = () => setState('ready');
  const fail = () => setState('error');
  const stageClassName = `asset-stage asset-stage--${kind} ${state === 'loading' ? 'is-loading' : ''} ${state === 'error' ? 'is-error' : ''}`;

  return <section className={`asset-viewer${embedded ? ' asset-viewer--embedded' : ''}`} aria-busy={state === 'loading'}>
    <div className={stageClassName}>
      {state === 'loading' && <div className="asset-loading" role="status" aria-label="正在加载媒体"><div className="asset-loading__skeleton" aria-hidden="true"><i /><i /></div></div>}
      {state === 'error'
        ? <div className="asset-preview-error" role="alert"><FileWarning size={24} /><span>无法预览此媒体</span></div>
        : kind === 'pdf'
          ? mediaSource && <iframe className="asset-media asset-pdf" src={`${mediaSource}${fragment ? `#${fragment}` : ''}`} title={name} onLoad={complete} />
          : kind === 'image'
            ? <CachedImage className="asset-media asset-image" src={fileUrl} alt={name} cache loading="eager" onLoad={complete} onError={fail} onSourceError={fail} />
            : kind === 'audio'
              ? mediaSource && <audio className="asset-media asset-audio" controls preload="metadata" src={mediaSource} onLoadedMetadata={complete} onError={fail}>浏览器不支持音频预览。</audio>
              : mediaSource && <video className="asset-media asset-video" controls playsInline preload="metadata" src={mediaSource} onLoadedMetadata={complete} onError={fail}>浏览器不支持视频预览。</video>}
    </div>
  </section>;
}
