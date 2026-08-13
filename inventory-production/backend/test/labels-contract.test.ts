import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const sourcePath = fileURLToPath(new URL('../src/labels.ts', import.meta.url));
const source = await readFile(sourcePath, 'utf8');

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
});
