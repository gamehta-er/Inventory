import { AlertTriangle, RefreshCw } from 'lucide-react';

export function PageFailure({ title = 'This page could not be loaded', message, onRetry }: { title?: string; message: string; onRetry(): void }) {
  return <section className="empty-state surface" role="alert">
    <AlertTriangle aria-hidden="true"/>
    <h2>{title}</h2>
    <p>{message}</p>
    <div><button className="button button--primary" onClick={onRetry}><RefreshCw size={16}/>Retry</button></div>
  </section>;
}
