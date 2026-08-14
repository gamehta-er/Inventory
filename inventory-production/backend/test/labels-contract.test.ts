import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const sourcePath = fileURLToPath(new URL('../src/labels.ts', import.meta.url));
const stylesPath = fileURLToPath(new URL('../../frontend/src/styles.css', import.meta.url));
const source = await readFile(sourcePath, 'utf8');
const styles = await readFile(stylesPath, 'utf8');

describe('label printing contract', () => {
  it('separates unaudited preview from the audited print job', () => {
    assert.match(source, /\/api\/v1\/labels\/preview/);
    assert.match(source, /\/api\/v1\/labels\/print/);
    assert.match(source, /LABEL_JOB_CREATED/);
    assert.match(source, /LABEL_PRINTED/);
  });

  it('restricts custom label fields to elevated roles', () => {
    assert.match(source, /super_user/);
    assert.match(source, /privileged_administrator/);
    assert.match(source, /LABEL_LAYOUT_FORBIDDEN/);
  });

  it('offers the confirmed model metadata while preserving the standard default fields', () => {
    assert.match(source, /'boardSku', 'gpuSku', 'boardArchitecture'/);
    assert.match(source, /defaultLabelFields = \['productName', 'modelNumber', 'assetTag', 'serialNumber'\]/);
    assert.match(source, /am\.board_sku,am\.gpu_sku,am\.board_architecture/);
  });

  it('centers each physical label on the print page', () => {
    assert.match(styles, /body > \.print-root \{[^}]*width: 100% !important;[^}]*margin: 0 auto !important;/);
    assert.match(styles, /\.print-root \.physical-label \{[^}]*margin: 0 auto !important;[^}]*align-items: center !important;[^}]*text-align: center !important;/);
  });
});
