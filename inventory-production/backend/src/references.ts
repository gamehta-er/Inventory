export function normalizeNVBugs(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return [...new Set(
    String(value)
      .match(/(?:nvbugspro\.nvidia\.com\/bug\/)?([0-9]{4,})/gi)
      ?.map((match) => match.match(/[0-9]{4,}/)![0].replace(/^0+(?=\d)/, '')) ?? [],
  )];
}

export function splitReferences(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const seen = new Set<string>();
  return String(value).split(/[,;\r\n]+/).map((item) => item.trim()).filter((item) => {
    if (!item) return false;
    const normalized = item.toLocaleUpperCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function referenceInsertionOrder<T>(newestFirst: readonly T[]): T[] {
  return [...newestFirst].reverse();
}
