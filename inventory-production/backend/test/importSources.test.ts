import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from '@excel.js/exceljs';
import { AppError } from '../src/errors.js';
import { csvCell } from '../src/csvSafety.js';
import { inspectImportSource, maxImportBytes, maxImportRows } from '../src/importSources.js';

async function workbookBuffer(sheets: Array<{ name: string; rows: unknown[][] }>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const source of sheets) {
    const worksheet = workbook.addWorksheet(source.name);
    source.rows.forEach((row) => worksheet.addRow(row));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('canonical CSV and XLSX import source', () => {
  it('produces the same parsed draft for equivalent CSV and XLSX files', async () => {
    const csv = Buffer.from('Serial #,Date Received,Product Name\r\nSER-1,2026-08-13,NVIDIA A100\r\n');
    const xlsx = await workbookBuffer([{ name: 'Inventory', rows: [
      ['Serial #', 'Date Received', 'Product Name'],
      ['SER-1', new Date(2026, 7, 13), 'NVIDIA A100'],
    ] }]);
    const csvSource = await inspectImportSource('inventory.csv', csv);
    const xlsxSource = await inspectImportSource('inventory.xlsx', xlsx);
    assert.deepEqual(xlsxSource.parsed, csvSource.parsed);
  });

  it('detects semicolon CSV and falls back to Windows-1252 without changing values', async () => {
    const csv = Buffer.from('Serial #;Product Name\r\nSER-1;Caf\xe9 drive\r\n', 'latin1');
    const source = await inspectImportSource('inventory.csv', csv);
    assert.equal(source.encoding, 'windows-1252');
    assert.equal(source.delimiter, ';');
    assert.equal(source.parsed?.rows[0]?.[1], 'Café drive');
  });

  it('prompts for one of several visible worksheets before staging rows', async () => {
    const xlsx = await workbookBuffer([
      { name: 'Building A', rows: [['Serial #', 'Product Name'], ['A-1', 'SSD']] },
      { name: 'Building B', rows: [['Serial #', 'Product Name'], ['B-1', 'GPU']] },
    ]);
    const source = await inspectImportSource('regional.xlsx', xlsx);
    assert.equal(source.selectionRequired, true);
    assert.equal(source.parsed, null);
    assert.deepEqual(source.availableSheets.map((sheet) => sheet.name), ['Building A', 'Building B']);
    const selected = await inspectImportSource('regional.xlsx', xlsx, { sheetName: 'Building B' });
    assert.equal(selected.parsed?.rows[0]?.[0], 'B-1');
  });

  it('rejects formula cells even when a workbook contains a cached result', async () => {
    const xlsx = await workbookBuffer([{ name: 'Inventory', rows: [
      ['Serial #', 'Quantity'],
      ['SER-1', { formula: '1+1', result: 2 }],
    ] }]);
    await assert.rejects(
      () => inspectImportSource('formula.xlsx', xlsx),
      (error: unknown) => error instanceof AppError && error.code === 'XLSX_FORMULA_BLOCKED',
    );
  });

  it('accepts exactly 1,000 rows and clearly rejects row 1,001', async () => {
    const csv = (rows: number) => Buffer.from([
      'Serial #,Product Name',
      ...Array.from({ length: rows }, (_value, index) => `SER-${index + 1},Drive`),
    ].join('\r\n'));
    const accepted = await inspectImportSource('limit.csv', csv(maxImportRows));
    assert.equal(accepted.parsed?.rows.length, maxImportRows);
    await assert.rejects(
      () => inspectImportSource('over-limit.csv', csv(maxImportRows + 1)),
      (error: unknown) => error instanceof AppError
        && error.code === 'IMPORT_ROW_LIMIT'
        && (error.details as { actualRows: number }).actualRows === 1001,
    );
  });

  it('rejects a source larger than 10 MB before parsing it', async () => {
    await assert.rejects(
      () => inspectImportSource('over-limit.csv', Buffer.alloc(maxImportBytes + 1, 0x41)),
      (error: unknown) => error instanceof AppError
        && error.code === 'IMPORT_FILE_TOO_LARGE'
        && error.statusCode === 413,
    );
  });

  it('blocks null bytes and makes spreadsheet formulas inert in CSV exports', async () => {
    await assert.rejects(
      () => inspectImportSource('null.csv', Buffer.from('Serial #,Name\0\r\nSER-1,SSD')),
      (error: unknown) => error instanceof AppError && error.code === 'CSV_NULL_BYTE',
    );
    assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), '"\'=HYPERLINK(""https://example.invalid"")"');
    assert.equal(csvCell('+SUM(1,1)'), '"\'+SUM(1,1)"');
  });
});
