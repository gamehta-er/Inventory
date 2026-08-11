export type LookupMatchOption = {
  id: number;
  value: string;
  label: string;
  description?: string;
  aliases?: string[];
};

export function normalizeLookupInput(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

export function matchLookupOption<T extends LookupMatchOption>(options: T[], input: unknown): T | undefined {
  const candidate = normalizeLookupInput(input);
  if (!candidate) return undefined;

  return options.find((option) => [option.value, option.label, ...(option.aliases ?? [])]
    .some((accepted) => normalizeLookupInput(accepted) === candidate));
}
