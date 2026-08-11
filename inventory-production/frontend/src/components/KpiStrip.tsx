import type { ReactNode } from 'react';

export interface KpiItem { key: string; label: string; value: number | string; detail: string; icon?: ReactNode }

export function KpiStrip({ items, onSelect }: { items: KpiItem[]; onSelect?(key: string): void }) {
  return <div className="kpi-strip">{items.map((item) => <button type="button" className="kpi-card" onClick={() => onSelect?.(item.key)} disabled={!onSelect} key={item.key}>{item.icon}<span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></button>)}</div>;
}
