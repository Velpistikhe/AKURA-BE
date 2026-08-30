import { z } from 'zod';

export type SortDirection = 'asc' | 'desc';

type BaseListQuery<TSortField extends string> = { page: number; limit: number; sortBy?: TSortField; sortOrder: SortDirection };
type FilterRules<TInput, TWhere extends object> = { [K in keyof TInput]?: (value: NonNullable<TInput[K]>) => Partial<TWhere> };

export const createListQueryFields = <TSortField extends string>(
  sortFields: readonly [TSortField, ...TSortField[]],
  defaults: { limit?: number } = {},
) => ({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(defaults.limit ?? 20),
  sortBy: z.enum(sortFields).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const defineSortRules = <TSortField extends string, TOrderBy>(rules: Record<TSortField, (direction: SortDirection) => TOrderBy>) => rules;

export const buildListQuery = <TSortField extends string, TInput extends BaseListQuery<TSortField>, TWhere extends object, TOrderBy>(
  input: TInput,
  rules: { filters: FilterRules<TInput, TWhere>; sorts: Record<TSortField, (direction: SortDirection) => TOrderBy>; defaultSort: TOrderBy },
) => {
  const where = {} as TWhere;
  for (const key of Object.keys(rules.filters) as (keyof TInput)[]) {
    const value = input[key];
    const filter = rules.filters[key];
    if (filter && value !== undefined && value !== null) Object.assign(where, filter(value as NonNullable<TInput[typeof key]>));
  }
  return { where, orderBy: input.sortBy ? rules.sorts[input.sortBy](input.sortOrder) : rules.defaultSort, skip: (input.page - 1) * input.limit, take: input.limit };
};

export const buildPagination = (page: number, limit: number, total: number) => ({
  page, limit, total, totalPages: Math.ceil(total / limit),
});
