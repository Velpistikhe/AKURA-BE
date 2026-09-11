/** Calendar date in the server's timezone, represented as UTC midnight for PostgreSQL DATE comparisons. */
export const currentBusinessDate = (now = new Date()): Date =>
  new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
