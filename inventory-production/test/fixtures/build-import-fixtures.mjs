import ExcelJS from '@excel.js/exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'generated');
await mkdir(fixtureDirectory, { recursive: true });

const headers = [
  'NVBugs #',
  'Date Received',
  'Model #',
  'Serial #',
  'Product Name',
  'Status',
  'Owner / Assignee',
  'Vendor',
  'Notes',
];

function inventoryRow(serialNumber, modelNumber, productName, note) {
  return [
    '900002',
    '2026-08-13',
    modelNumber,
    serialNumber,
    productName,
    'AVAILABLE',
    'Gaurav Mehta',
    'NVIDIA Lab Supply',
    note,
  ];
}

async function writeWorkbook(fileName, sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Inventory Project reliability gate';
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRow(headers);
    sheet.rows.forEach((row) => worksheet.addRow(row));
  }
  await workbook.xlsx.writeFile(resolve(fixtureDirectory, fileName));
}

await writeWorkbook('inventory-multi-sheet.xlsx', [
  { name: 'Building A', rows: [inventoryRow('CI-XLSX-A-000001', 'CI-SSD-A', '1TB SATA SSD', 'Building A source option')] },
  { name: 'Building B', rows: [inventoryRow('CI-XLSX-B-000001', 'CI-M2-4TB', '4TB M.2 SSD', 'Selected Building B worksheet')] },
]);

const formulaWorkbook = new ExcelJS.Workbook();
const formulaSheet = formulaWorkbook.addWorksheet('Inventory');
formulaSheet.addRow(headers);
const formulaRow = inventoryRow('CI-FORMULA-000001', 'CI-FORMULA', 'Formula rejection fixture', 'Formula cells must be rejected');
formulaRow[1] = { formula: 'DATE(2026,8,13)', result: new Date(2026, 7, 13) };
formulaSheet.addRow(formulaRow);
await formulaWorkbook.xlsx.writeFile(resolve(fixtureDirectory, 'inventory-formula.xlsx'));

const csvHeader = headers.join(',');
const csvRows = (count) => Array.from({ length: count }, (_value, index) => [
  String(910000 + index),
  '2026-08-13',
  'CI-LIMIT-MODEL',
  `CI-LIMIT-${String(index + 1).padStart(4, '0')}`,
  'Inventory row-limit fixture',
  'AVAILABLE',
  'Gaurav Mehta',
  'NVIDIA Lab Supply',
  'Synthetic reliability data',
].join(','));
await writeFile(resolve(fixtureDirectory, 'inventory-limit-1000.csv'), `${[csvHeader, ...csvRows(1000)].join('\r\n')}\r\n`);
await writeFile(resolve(fixtureDirectory, 'inventory-limit-1001.csv'), `${[csvHeader, ...csvRows(1001)].join('\r\n')}\r\n`);
await writeFile(resolve(fixtureDirectory, 'inventory-duplicate-headers.csv'), `${csvHeader},Serial #\r\n${inventoryRow('CI-DUPLICATE-000001', 'CI-DUPLICATE', 'Duplicate header fixture', 'Must be rejected').join(',')},duplicate\r\n`);
await writeFile(resolve(fixtureDirectory, 'inventory-null-byte.csv'), Buffer.from(`${csvHeader}\r\n${inventoryRow('CI-NULL-000001', 'CI-NULL', 'Null-byte fixture', 'Must be rejected').join(',')}\0\r\n`));
await writeFile(resolve(fixtureDirectory, 'inventory-windows-1252-semicolon.csv'), Buffer.from([
  headers.join(';'),
  inventoryRow('CI-CP1252-000001', 'CI-CP1252', 'Caf\u00e9 storage drive', 'Windows-1252 fixture').join(';'),
].join('\r\n'), 'latin1'));

process.stdout.write(`Generated inventory reliability fixtures in ${fixtureDirectory}\n`);
