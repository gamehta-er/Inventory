export const requiredAssetFieldKeys = [
  'nvbugs',
  'date_received',
  'model_number',
  'serial_number',
  'product_name',
  'asset_status',
  'owner',
  'vendor',
] as const;

const requiredAssetFields = new Set<string>(requiredAssetFieldKeys);

export function isSystemRequiredField(fieldKey: string): boolean {
  return requiredAssetFields.has(fieldKey);
}

export function effectiveRequiredSetting(fieldKey: string, configuredRequired: unknown): boolean {
  return isSystemRequiredField(fieldKey) || Boolean(configuredRequired);
}
