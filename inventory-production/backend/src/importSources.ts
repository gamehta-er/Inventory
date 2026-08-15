import ExcelJSRuntime from '@excel.js/exceljs';
import type { Cell, Workbook as ExcelWorkbook, Worksheet } from '../../node_modules/@excel.js/exceljs/index.js';
import { parse } from 'csv-parse/sync';
import { AppError } from './errors.js';
import type { FieldDefinition } from './types.js';

const ExcelJS = ExcelJSRuntime as {
  Workbook: new () => ExcelWorkbook;
  ValueType: { Formula: number; Error: number };
};

export const maxImportBytes = 10 * 1024 * 1024;
export const maxImportRows = 1_000;
export const importSourceSchemaVersion = 'inventory-import-v2';

export type ImportSourceFormat = 'CSV' | 'XLSX';

export interface ImportSourceOptions {
  sheetName?: string;
  delimiter?: ',' | ';' | '\t';
  encoding?: 'utf-8' | 'windows-1252';
}

export interface ImportSourceSheet {
  name: string;
  rowCount: number;
}

export interface ParsedImportSource {
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
}

export interface ImportSourceInspection {
  format: ImportSourceFormat;
  parsed: ParsedImportSource | null;
  selectionRequired: boolean;
  availableSheets: ImportSourceSheet[];
  delimiterCandidates: Array<',' | ';' | '\t'>;
  sheetName: string | null;
  delimiter: ',' | ';' | '\t' | null;
  encoding: 'utf-8' | 'windows-1252' | null;
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim();
}

function assertSourceShape(source: ParsedImportSource): ParsedImportSource {
  if (!source.headers.length || source.headers.every((header) => !header)) {
    throw new AppError(422, 'IMPORT_HEADER_EMPTY', 'The selected source has an empty header row.');
  }
  if (!source.rows.length) throw new AppError(422, 'IMPORT_SOURCE_EMPTY', 'The selected source contains no inventory rows.');
  if (source.rows.length > maxImportRows) {
    throw new AppError(422, 'IMPORT_ROW_LIMIT', `Import files can contain at most ${maxImportRows.toLocaleString()} inventory rows.`, {
      maximumRows: maxImportRows,
      actualRows: source.rows.length,
    });
  }
  return source;
}

function decodeCsv(contents: Buffer, requested?: ImportSourceOptions['encoding']): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  if (contents.includes(0)) throw new AppError(422, 'CSV_NULL_BYTE', 'The CSV contains a null byte. Remove it and upload the file again.');
  const decode = (encoding: 'utf-8' | 'windows-1252', fatal: boolean) => new TextDecoder(encoding, { fatal }).decode(contents);
  if (requested) {
    try {
      return { text: decode(requested, true), encoding: requested };
    } catch {
      throw new AppError(422, 'CSV_ENCODING_INVALID', `The CSV could not be decoded as ${requested}. Choose the correct encoding or save it as UTF-8.`);
    }
  }
  try {
    return { text: decode('utf-8', true), encoding: 'utf-8' };
  } catch {
    return { text: decode('windows-1252', false), encoding: 'windows-1252' };
  }
}

function parseCsvRecords(text: string, delimiter: ',' | ';' | '\t'): string[][] {
  try {
    return parse(text, {
      bom: true,
      columns: false,
      delimiter,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: false,
    }) as string[][];
  } catch (error) {
    throw new AppError(422, 'CSV_INVALID', 'The CSV could not be read. Check the delimiter, quoting, and row column counts.', {
      parserMessage: error instanceof Error ? error.message : 'CSV parsing failed.',
      delimiter,
    });
  }
}

function csvCandidate(text: string, delimiter: ',' | ';' | '\t'): ParsedImportSource | null {
  let records: string[][];
  try {
    records = parseCsvRecords(text, delimiter);
  } catch {
    return null;
  }
  if (!records.length || (records[0]?.length ?? 0) < 2) return null;
  const headers = records[0]!.map((value) => String(value).replace(/^\uFEFF/, '').trim());
  const sourceRows = records.slice(1);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  sourceRows.forEach((row, index) => {
    if (!row.some((value) => cleanText(value) !== '')) return;
    rows.push(row.map(String));
    rowNumbers.push(index + 2);
  });
  return { headers, rows, rowNumbers };
}

export function inspectCsvSource(contents: Buffer, options: ImportSourceOptions = {}): ImportSourceInspection {
  const decoded = decodeCsv(contents, options.encoding);
  const candidates = (options.delimiter ? [options.delimiter] : [',', ';', '\t'] as const)
    .flatMap((delimiter) => {
      const parsed = csvCandidate(decoded.text, delimiter);
      return parsed ? [{ delimiter, parsed }] : [];
    });
  if (!candidates.length) {
    const delimiter = options.delimiter ?? ',';
    const records = parseCsvRecords(decoded.text, delimiter);
    if (!records.length) throw new AppError(422, 'CSV_EMPTY', 'The CSV contains no header or inventory rows.');
    throw new AppError(422, 'CSV_DELIMITER_UNKNOWN', 'The CSV delimiter could not be identified. Use comma, semicolon, or tab-delimited data.');
  }
  const widest = Math.max(...candidates.map((candidate) => candidate.parsed.headers.length));
  const best = candidates.filter((candidate) => candidate.parsed.headers.length === widest);
  if (!options.delimiter && best.length > 1) {
    return {
      format: 'CSV', parsed: null, selectionRequired: true, availableSheets: [],
      delimiterCandidates: best.map((candidate) => candidate.delimiter), sheetName: null,
      delimiter: null, encoding: decoded.encoding,
    };
  }
  const selected = best[0]!;
  return {
    format: 'CSV', parsed: assertSourceShape(selected.parsed), selectionRequired: false, availableSheets: [],
    delimiterCandidates: best.map((candidate) => candidate.delimiter), sheetName: null,
    delimiter: selected.delimiter, encoding: decoded.encoding,
  };
}

function excelDate(value: Date): string {
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

function xlsxCellText(cell: Cell): string {
  const value = cell.value;
  if (cell.type === ExcelJS.ValueType.Formula || (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value))) {
    throw new AppError(422, 'XLSX_FORMULA_BLOCKED', `Formula cell ${cell.address} must be converted to a literal value before import.`, { cell: cell.address });
  }
  if (cell.type === ExcelJS.ValueType.Error) {
    throw new AppError(422, 'XLSX_CELL_ERROR', `Cell ${cell.address} contains an Excel error value. Correct it before import.`, { cell: cell.address });
  }
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return excelDate(value);
  if (typeof value === 'object') return cell.text;
  return String(value);
}

function parseWorksheet(worksheet: Worksheet): ParsedImportSource {
  let headerRowNumber = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const containsValue = Array.from({ length: row.cellCount }, (_value, index) => xlsxCellText(row.getCell(index + 1)))
      .some((value) => cleanText(value) !== '');
    if (!headerRowNumber && containsValue) headerRowNumber = rowNumber;
  });
  if (!headerRowNumber) throw new AppError(422, 'XLSX_EMPTY', `Worksheet "${worksheet.name}" contains no data.`);
  const headerRow = worksheet.getRow(headerRowNumber);
  const headerWidth = headerRow.cellCount;
  if (!headerWidth) throw new AppError(422, 'XLSX_HEADER_EMPTY', `Worksheet "${worksheet.name}" has an empty header row.`);
  const headers = Array.from({ length: headerWidth }, (_value, index) => {
    const cell = headerRow.getCell(index + 1);
    if (cell.isMerged) throw new AppError(422, 'XLSX_MERGED_HEADER', `Header cell ${cell.address} is merged. Unmerge the header row before import.`, { cell: cell.address });
    return xlsxCellText(cell).trim();
  });
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.actualRowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const extraValue = Array.from({ length: Math.max(0, row.cellCount - headerWidth) }, (_value, index) => xlsxCellText(row.getCell(headerWidth + index + 1)))
      .find((value) => cleanText(value) !== '');
    if (extraValue !== undefined) {
      throw new AppError(422, 'XLSX_ROW_TOO_WIDE', `Worksheet row ${rowNumber} contains data beyond the last header column.`, { row: rowNumber });
    }
    const values = Array.from({ length: headerWidth }, (_value, index) => xlsxCellText(row.getCell(index + 1)));
    if (!values.some((value) => cleanText(value) !== '')) continue;
    rows.push(values);
    rowNumbers.push(rowNumber);
  }
  return assertSourceShape({ headers, rows, rowNumbers });
}

async function inspectXlsx(contents: Buffer, options: ImportSourceOptions): Promise<ImportSourceInspection> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(contents).buffer);
  } catch (error) {
    throw new AppError(422, 'XLSX_INVALID', 'The Excel workbook could not be read. Confirm it is an unencrypted .xlsx file.', {
      parserMessage: error instanceof Error ? error.message : 'XLSX parsing failed.',
    });
  }
  const availableSheets = workbook.worksheets
    .filter((sheet) => sheet.state === 'visible' && sheet.actualRowCount > 0)
    .map((sheet) => ({ name: sheet.name, rowCount: Math.max(0, sheet.actualRowCount - 1) }));
  if (!availableSheets.length) throw new AppError(422, 'XLSX_EMPTY', 'The workbook contains no visible worksheet with inventory data.');
  if (!options.sheetName && availableSheets.length > 1) {
    return {
      format: 'XLSX', parsed: null, selectionRequired: true, availableSheets,
      delimiterCandidates: [], sheetName: null, delimiter: null, encoding: null,
    };
  }
  const sheetName = options.sheetName ?? availableSheets[0]!.name;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet || worksheet.state !== 'visible' || !availableSheets.some((sheet) => sheet.name === sheetName)) {
    throw new AppError(422, 'XLSX_SHEET_INVALID', 'Choose one of the available visible worksheets.', { availableSheets });
  }
  return {
    format: 'XLSX', parsed: parseWorksheet(worksheet), selectionRequired: false, availableSheets,
    delimiterCandidates: [], sheetName, delimiter: null, encoding: null,
  };
}

export async function inspectImportSource(fileName: string, contents: Buffer, options: ImportSourceOptions = {}): Promise<ImportSourceInspection> {
  if (contents.length > maxImportBytes) throw new AppError(413, 'IMPORT_FILE_TOO_LARGE', 'Import files can be at most 10 MB.');
  if (/\.csv$/i.test(fileName)) return inspectCsvSource(contents, options);
  if (/\.xlsx$/i.test(fileName)) return inspectXlsx(contents, options);
  throw new AppError(415, 'IMPORT_FILE_REQUIRED', 'Choose a CSV or XLSX inventory file.');
}

export async function buildImportWorkbook(fields: FieldDefinition[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Inventory Project';
  const worksheet = workbook.addWorksheet('Inventory Import', { views: [{ state: 'frozen', ySplit: 1 }] });
  const header = worksheet.addRow(fields.map((field) => field.label));
  header.font = { bold: true, color: { argb: 'FF101820' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFF0D8' } };
  worksheet.columns = fields.map((field) => ({ width: Math.min(36, Math.max(16, field.label.length + 4)) }));
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };
  const guide = workbook.addWorksheet('Field Guide', { state: 'hidden' });
  guide.addRow(['Column', 'Required', 'Type', 'Definition']);
  fields.forEach((field) => guide.addRow([field.label, field.required ? 'Yes' : 'No', field.dataType, field.definition || field.helpText]));
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}
