import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useAppState } from '../state/AppState';

export function ToastRegion() {
  const { toasts } = useAppState();
  return <div className="toast-region" role="status" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.tone}`}>{toast.tone === 'success' ? <CheckCircle2/> : toast.tone === 'error' ? <AlertCircle/> : <Info/>}<span>{toast.message}</span></div>)}</div>;
}
