export const getErrorMessage = (error: unknown, fallback = 'Internal Server Error'): string =>
  error instanceof Error ? error.message : fallback;

export const getErrorStack = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : undefined;

export const getErrorStatus = (error: unknown): number => {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }
  const value = error as { status?: unknown; statusCode?: unknown };
  if (typeof value.status === 'number') return value.status;
  if (typeof value.statusCode === 'number') return value.statusCode;
  return 500;
};
