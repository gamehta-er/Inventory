export function inertSpreadsheetText(value: unknown): string {
  const text = value instanceof Date
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
    : value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvCell(value: unknown): string {
  const text = inertSpreadsheetText(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
