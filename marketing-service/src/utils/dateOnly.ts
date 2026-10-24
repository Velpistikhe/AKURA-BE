export const formatDateOnly = (value: Date | string | null): string | null => {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
};

export const formatContractDates = <T extends { contractDate?: Date | string | null; effectiveFrom?: Date | string; effectiveUntil?: Date | string | null }>(contract: T): T => ({
  ...contract,
  ...(contract.contractDate === undefined ? {} : { contractDate: formatDateOnly(contract.contractDate) }),
  effectiveFrom: formatDateOnly(contract.effectiveFrom ?? null),
  effectiveUntil: formatDateOnly(contract.effectiveUntil ?? null),
}) as T;
