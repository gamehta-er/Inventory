export function databaseDateText(value: string): string {
  return value;
}

export function canonicalDateText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(text);
  return match?.[1] ?? text;
}
