import { useEffect } from 'react';
import { Check, X } from 'lucide-react';

const AUTO_CLOSE_DELAY = 5_000;

type ToastProps = {
  kind: 'error' | 'notice';
  value: string;
  onClose: () => void;
};

export default function Toast({ kind, value, onClose }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, AUTO_CLOSE_DELAY);
    return () => window.clearTimeout(timer);
  }, [onClose, value]);

  return <div className={`toast toast-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'notice' && <Check size={16} />}
    <span>{value}</span>
    <button type="button" onClick={onClose} aria-label="关闭提示"><X size={15} /></button>
  </div>;
}
