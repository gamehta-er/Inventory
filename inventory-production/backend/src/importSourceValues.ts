import type { FieldDefinition } from './types.js';

export const normalizeImportHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

export function importAliasMap(fields: FieldDefinition[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const field of fields) {
    for (const alias of [field.fieldKey, field.label, ...field.aliases]) {
      result.set(normalizeImportHeader(alias), field.fieldKey);
    }
  }
  return result;
}

export function sourceKeyForField(fields: FieldDefinition[], source: Record<string, string>, fieldKey: string): string {
  const aliases = importAliasMap(fields);
  return Object.keys(source).find((header) => aliases.get(normalizeImportHeader(header)) === fieldKey)
    ?? fields.find((field) => field.fieldKey === fieldKey)?.label
    ?? fieldKey;
}

export function sourceValueForField(
  fields: FieldDefinition[],
  source: Record<string, string>,
  fieldKey: string,
  normalizedValues: Record<string, unknown> = {},
): unknown {
  const field = fields.find((item) => item.fieldKey === fieldKey);
  const sourceKey = sourceKeyForField(fields, source, fieldKey);
  const candidates = [
    source[sourceKey],
    source[fieldKey],
    field ? source[field.label] : undefined,
    normalizedValues[fieldKey],
  ];

  return candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '')
    ?? candidates.find((value) => value !== undefined && value !== null);
}
