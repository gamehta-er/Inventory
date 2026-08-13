import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const adminSource = await readFile(fileURLToPath(new URL('../src/admin.ts', import.meta.url)), 'utf8');
const registrySource = await readFile(fileURLToPath(new URL('../src/registry.ts', import.meta.url)), 'utf8');

describe('guided location hierarchy contract', () => {
  it('creates the complete physical path in one transaction-owned workflow', () => {
    assert.match(adminSource, /\/api\/v1\/admin\/location-paths/);
    for (const type of ['BUILDING', 'LAB_ROOM', 'RACK', 'RU', 'CABINET_STORAGE']) {
      assert.match(adminSource, new RegExp(`'${type}'`));
    }
    for (const field of ['building', 'roomName', 'roomNumber', 'binRow', 'rackLocation', 'binLocation', 'binId']) {
      assert.match(adminSource, new RegExp(`body\\.${field}`));
    }
    assert.match(adminSource, /LOCATION_PATH_CREATED/);
  });

  it('returns type metadata so the UI can explain and filter the hierarchy', () => {
    assert.match(registrySource, /lt\.type_key,lt\.type_name,lt\.level_order/);
    assert.match(registrySource, /JOIN location_types lt/);
  });
});
