import { useEffect } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';

const AUTO_CLOSE_DELAY = 3_000;

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

  const Icon = kind === 'error' ? CircleAlert : CircleCheck;
  return <aside className={`toast toast-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'}>
    <span className="toast-icon"><Icon size={17} strokeWidth={2.3} /></span>
    <p className="toast-message">{value}</p>
  </aside>;
}
