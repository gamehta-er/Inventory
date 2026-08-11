export function LoadingState({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return <div className="skeleton-stack" aria-label={label} aria-live="polite">{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><span/><span/><span/><span/></div>)}</div>;
}
