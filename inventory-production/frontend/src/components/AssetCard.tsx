import { Box, ExternalLink } from 'lucide-react';
import type { AssetSummary } from '../types';

function CompactReference({ label, values, nvbug = false }: { label: string; values: string[]; nvbug?: boolean }) {
  const latest = values[0];
  if (!latest) return null;
  const content = <>{label} {latest}{values.length > 1 && <span className="reference-count">+{values.length - 1}</span>}</>;
  return nvbug
    ? <a href={`https://nvbugspro.nvidia.com/bug/${latest}`} target="_blank" rel="noreferrer">{content}<ExternalLink size={12}/></a>
    : <span>{content}</span>;
}

export function AssetCard({ asset, selected, onSelect, onOpen }: { asset: AssetSummary; selected: boolean; onSelect(value: boolean): void; onOpen(): void }) {
  return <article className={`asset-row ${selected ? 'asset-row--selected' : ''}`}>
    <input className="asset-row__check" type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${asset.model.productName}`}/>
    <div className="asset-row__image">{asset.model.imagePath ? <img src={asset.model.imagePath} alt=""/> : <Box aria-hidden="true"/>}</div>
    <div className="asset-row__identity"><span className="eyebrow">{asset.category.name}</span><strong>{asset.model.productName}</strong><small>{asset.model.modelNumber}</small></div>
    <dl className="asset-row__facts"><div><dt>Serial #</dt><dd>{asset.serialNumber}</dd></div><div><dt>Asset Tag #</dt><dd>{asset.assetTag || 'Not assigned'}</dd></div><div><dt>Location</dt><dd>{asset.location || 'Not assigned'}</dd></div><div><dt>Owner / Assignee</dt><dd>{asset.owner}</dd></div></dl>
    <div className="asset-row__status"><span className={`status status--${asset.status.toLowerCase()}`}>{asset.status.replaceAll('_', ' ')}</span><div className="asset-row__references"><CompactReference label="NVBug" values={asset.references.nvbugs} nvbug/><CompactReference label="MRS" values={asset.references.mrsOrders}/><CompactReference label="Capacity" values={asset.references.capacityRequests}/></div></div>
    <button className="button button--quiet" onClick={onOpen}>Open</button>
  </article>;
}
