import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { isNativeIOS } from '../api/mobile-session';
import { cachedAssetSource } from '../lib/workspace-cache';

type CachedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string;
  cache?: boolean;
  onSourceError?: () => void;
};

export default function CachedImage({ src, cache = false, loading = 'lazy', decoding = 'async', onSourceError, ...props }: CachedImageProps) {
  const image = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(loading !== 'lazy');
  const [resolvedSource, setResolvedSource] = useState<string | null>(loading === 'lazy' ? null : src);

  useEffect(() => {
    setVisible(loading !== 'lazy');
    setResolvedSource(loading === 'lazy' ? null : src);
  }, [loading, src]);

  useEffect(() => {
    if (visible || !image.current) return;
    if (!('IntersectionObserver' in globalThis)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '640px 0px' });
    observer.observe(image.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let release = () => {};
    void (cache ? cachedAssetSource(src) : Promise.resolve({ source: src, release })).then((result) => {
      release = result.release;
      if (active) setResolvedSource(result.source);
      else release();
    }).catch(() => {
      if (!active) return;
      onSourceError?.();
      if (!isNativeIOS()) setResolvedSource(src);
    });
    return () => {
      active = false;
      release();
    };
  }, [cache, onSourceError, src, visible]);

  return <img ref={image} {...props} src={resolvedSource ?? undefined} loading={loading} decoding={decoding} />;
}
