import { Download, Printer, XCircle } from 'lucide-react';

export function AssetSelectionToggle({
  selectedCount,
  visibleCount,
  disabled = false,
  onToggle,
}: {
  selectedCount: number;
  visibleCount: number;
  disabled?: boolean;
  onToggle(): void;
}) {
  const allSelected = visibleCount > 0 && selectedCount === visibleCount;
  return <button className="button" disabled={disabled || visibleCount === 0} onClick={onToggle}>
    {allSelected ? 'Clear Page Selection' : 'Select Page'}
  </button>;
}

export function AssetSelectionActions({
  selectedCount,
  canExport,
  canPrint,
  exporting = false,
  onExport,
  onPrint,
  onClear,
}: {
  selectedCount: number;
  canExport: boolean;
  canPrint: boolean;
  exporting?: boolean;
  onExport(): void;
  onPrint(): void;
  onClear(): void;
}) {
  if (selectedCount === 0) return null;
  return <div className="bulk-bar" role="region" aria-label="Selected asset actions">
    <strong>{selectedCount} {selectedCount === 1 ? 'asset' : 'assets'} selected</strong>
    <span>Selection applies to the current page.</span>
    {canExport && <button className="button" disabled={exporting} onClick={onExport}><Download size={17}/>{exporting ? 'Exporting...' : 'Export CSV'}</button>}
    {canPrint && <button className="button" onClick={onPrint}><Printer size={17}/>Print Labels</button>}
    <button className="icon-button" onClick={onClear} aria-label="Clear selected assets"><XCircle size={19}/></button>
  </div>;
}
