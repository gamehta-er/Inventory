import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LabelData } from '../types';
import { LoadingState } from './LoadingState';
import { Overlay } from './Overlay';

export function LabelPrint({ assetIds, onClose }: { assetIds: number[]; onClose(): void }) {
  const [labels, setLabels] = useState<LabelData[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { api.labels(assetIds).then(setLabels).catch((failure: Error) => setError(failure.message)); }, [assetIds]);
  return <Overlay title="Print Labels" subtitle={`${assetIds.length} ${assetIds.length === 1 ? 'asset' : 'assets'} selected`} onClose={onClose} size="wide" footer={<><button className="button button--primary" disabled={!labels.length} onClick={() => window.print()}><Printer size={17}/>Print</button><button className="button" onClick={onClose}>Cancel</button></>}>
    {error ? <p className="form-alert">{error}</p> : !labels.length ? <LoadingState rows={2}/> : <div className="label-grid print-label-region">{labels.map((label) => <article className="physical-label" key={label.assetId}><strong>{label.productName}</strong><b>{label.assetTag || label.modelNumber}</b><div className="barcode" dangerouslySetInnerHTML={{ __html: label.barcodeSvg }}/><span>{label.serialNumber}</span></article>)}</div>}
  </Overlay>;
}
