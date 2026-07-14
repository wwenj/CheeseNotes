import { ExternalLink, FileWarning } from 'lucide-react';
import { notesApi } from '../api';
import { fileKind } from '../lib/files';

export default function AssetViewer({ path }: { path: string }) {
  const url = notesApi.fileUrl(path);
  const kind = fileKind(path);
  if (kind === 'pdf') return <iframe className="asset-pdf" src={url} title={path} />;
  if (kind === 'image') return <div className="asset-image"><img src={url} alt={path.split('/').at(-1)} /></div>;
  if (kind === 'audio') return <div className="asset-player"><audio controls src={url}>浏览器不支持音频预览。</audio></div>;
  if (kind === 'video') return <div className="asset-player"><video controls src={url}>浏览器不支持视频预览。</video></div>;
  return <div className="unsupported-file"><FileWarning size={28} /><h2>此文件不能直接预览</h2><p>{path.split('/').at(-1)}</p><a href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} />在新窗口打开</a></div>;
}
