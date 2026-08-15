import { AppError } from './errors.js';

export function parseAssetId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new AppError(400, 'ASSET_ID_INVALID', 'Choose a valid asset.');
  }
  return id;
}

export function parseRelationshipId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new AppError(400, 'RELATIONSHIP_ID_INVALID', 'Choose a valid asset relationship.');
  }
  return id;
}
