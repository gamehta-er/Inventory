import { CheckSquare2, Printer, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAppState } from '../state/AppState';
import type { LabelData, LabelFieldKey } from '../types';
import { LoadingState } from './LoadingState';
import { Overlay } from './Overlay';

const fieldOptions: Array<{ key: LabelFieldKey; label: string }> = [
  { key: 'productName', label: 'Product Name' },
  { key: 'modelNumber', label: 'Model #' },
  { key: 'boardSku', label: 'Board SKU' },
  { key: 'gpuSku', label: 'GPU SKU' },
  { key: 'boardArchitecture', label: 'Board Architecture' },
  { key: 'assetTag', label: 'Asset Tag #' },
  { key: 'serialNumber', label: 'Serial #' },
];

const defaultFields: LabelFieldKey[] = ['productName', 'modelNumber', 'assetTag', 'serialNumber'];

function PhysicalLabel({ label, fields }: { label: LabelData; fields: LabelFieldKey[] }) {
  const metadata = [
    fields.includes('boardSku') && label.boardSku ? `Board SKU ${label.boardSku}` : '',
    fields.includes('gpuSku') && label.gpuSku ? `GPU SKU ${label.gpuSku}` : '',
    fields.includes('boardArchitecture') && label.boardArchitecture ? `Architecture ${label.boardArchitecture}` : '',
  ].filter(Boolean);

  return <article className={`physical-label${metadata.length ? ' physical-label--dense' : ''}`}>
    {fields.includes('productName') && <strong>{label.productName}</strong>}
    {fields.includes('modelNumber') && <span className="physical-label__model">{label.modelNumber}</span>}
    {metadata.length > 0 && <span className="physical-label__metadata">{metadata.join(' | ')}</span>}
    {fields.includes('assetTag') && label.assetTag && <b>{label.assetTag}</b>}
    <div className="barcode" dangerouslySetInnerHTML={{ __html: label.barcodeSvg }}/>
    {fields.includes('serialNumber') && <span className="physical-label__serial">{label.serialNumber}</span>}
  </article>;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
}

export function LabelPrint({ assetIds, onClose }: { assetIds: number[]; onClose(): void }) {
  const { session, notify } = useAppState();
  const [labels, setLabels] = useState<LabelData[]>([]);
  const [includedIds, setIncludedIds] = useState<number[]>(assetIds);
  const [fields, setFields] = useState<LabelFieldKey[]>(defaultFields);
  const [printLabels, setPrintLabels] = useState<LabelData[]>([]);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const assetKey = assetIds.join(',');
  const canCustomize = Boolean(session?.user?.roles?.some((role) => role === 'super_user' || role === 'privileged_administrator'));

  useEffect(() => {
    let active = true;
    setError('');
    api.labelPreview(assetIds)
      .then((next) => {
        if (!active) return;
        setLabels(next);
        setIncludedIds(next.map((label) => label.assetId));
        setPrintLabels([]);
      })
      .catch((failure: Error) => active && setError(failure.message));
    return () => { active = false; };
  }, [assetKey]);

  const includedLabels = useMemo(
    () => labels.filter((label) => includedIds.includes(label.assetId)),
    [includedIds, labels],
  );
  const printableLabels = printLabels;

  function toggleLabel(assetId: number) {
    setIncludedIds((current) => current.includes(assetId)
      ? current.filter((id) => id !== assetId)
      : [...current, assetId]);
    setPrintLabels([]);
  }

  function toggleField(field: LabelFieldKey) {
    setFields((current) => current.includes(field)
      ? current.filter((item) => item !== field)
      : [...current, field]);
    setPrintLabels([]);
  }

  async function print() {
    if (!includedIds.length) { setError('Select at least one label for this print job.'); return; }
    setPrinting(true); setError('');
    try {
      const next = await api.labels(includedIds, canCustomize ? fields : undefined);
      setPrintLabels(next);
      await nextPaint();
      window.print();
      notify(`${next.length} ${next.length === 1 ? 'label' : 'labels'} sent to the print dialog.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Labels could not be prepared for printing.');
    } finally {
      setPrintLabels([]);
      setPrinting(false);
    }
  }

  const printSurface = createPortal(
    <div className="print-root" aria-hidden="true">
      {printableLabels.map((label) => <PhysicalLabel key={label.assetId} label={label} fields={fields}/>)}
    </div>,
    document.body,
  );

  return <>
    <Overlay
      title="Print Labels"
      subtitle={`${includedLabels.length} of ${labels.length || assetIds.length} ${labels.length === 1 ? 'label' : 'labels'} included`}
      onClose={onClose}
      size="wide"
      footer={<>
        <button className="button button--primary" disabled={!includedLabels.length || printing} onClick={() => void print()}>
          <Printer size={17}/>{printing ? 'Preparing...' : `Print ${includedLabels.length || ''} ${includedLabels.length === 1 ? 'Label' : 'Labels'}`}
        </button>
        <button className="button" onClick={onClose}>Cancel</button>
      </>}
    >
      {error && <p className="form-alert" role="alert">{error}</p>}
      {!labels.length && !error ? <LoadingState rows={2}/> : labels.length > 0 && <div className={`label-print-layout${canCustomize ? '' : ' label-print-layout--preview-only'}`}>
        {canCustomize && <aside className="label-print-controls" aria-label="Label print settings">
          <section>
            <header><div><span className="eyebrow">Print Job</span><h3>Choose labels</h3></div><button className="button button--small" onClick={() => { setIncludedIds(includedIds.length === labels.length ? [] : labels.map((label) => label.assetId)); setPrintLabels([]); }}>{includedIds.length === labels.length ? 'Clear' : 'Select All'}</button></header>
            <div className="label-choice-list">{labels.map((label) => {
              const checked = includedIds.includes(label.assetId);
              return <label key={label.assetId} className={checked ? 'label-choice label-choice--selected' : 'label-choice'}>
                <input type="checkbox" checked={checked} onChange={() => toggleLabel(label.assetId)}/>
                {checked ? <CheckSquare2 size={17}/> : <Square size={17}/>}
                <span><strong>{label.productName}</strong><small>{label.assetTag || label.serialNumber}</small></span>
              </label>;
            })}</div>
          </section>
          <section>
            <span className="eyebrow">Label Content</span><h3>Choose visible fields</h3>
            <p>The Code 128 barcode is always included.</p>
            <div className="label-field-options">{fieldOptions.map((field) => <label key={field.key}><input type="checkbox" checked={fields.includes(field.key)} onChange={() => toggleField(field.key)}/><span>{field.label}</span></label>)}</div>
          </section>
        </aside>}
        <section className="label-preview"><header><div><span className="eyebrow">Preview</span><h3>{includedLabels.length} {includedLabels.length === 1 ? 'label' : 'labels'}</h3></div><small>2.125 in x 1 in</small></header><div className="label-grid">{includedLabels.map((label) => <PhysicalLabel key={label.assetId} label={label} fields={fields}/>)}</div></section>
      </div>}
    </Overlay>
    {printSurface}
  </>;
}
