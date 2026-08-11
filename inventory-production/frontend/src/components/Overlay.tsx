import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Overlay({ title, subtitle, onClose, children, footer, size = 'wide' }: { title: string; subtitle?: string; onClose(): void; children: ReactNode; footer?: ReactNode; size?: 'compact' | 'wide' | 'workspace' }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; closeRef.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [onClose]);
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`sheet sheet--${size}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <header className="sheet__header"><div><h2 id="sheet-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
      <div className="sheet__body">{children}</div>
      {footer && <footer className="sheet__footer">{footer}</footer>}
    </section>
  </div>;
}
