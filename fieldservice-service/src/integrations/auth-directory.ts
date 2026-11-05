import { Request } from 'express';
import { z } from 'zod';
import { serviceHeaders, serviceUrl } from '../utils/serviceUrl.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Live Auth directory lookups.
 *
 * Auth is the single source of truth for the user directory. Field Service
 * used to keep a local read model that Auth pushed through an asynchronous
 * event; that replication is gone, so the directory is read from Auth on
 * demand instead. The caller forwards the authenticated access token, so the
 * branch is always derived from the caller on the Auth side and never from a
 * request parameter.
 */
const DIRECTORY_PATH = 'auth/users/field-service/inspector-directory';
const VALIDATE_PATH = 'auth/users/field-service/inspectors';

/** A full Auth user snapshot, as the directory endpoint returns it. */
const directoryInspectorSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
}).passthrough();
const directoryListSchema = z.object({ inspectors: z.array(directoryInspectorSchema) });

/** The { id, name } pair the validation endpoint returns. */
const validatedInspectorSchema = z.object({ id: z.string().uuid(), name: z.string().min(1) });
const validatedListSchema = z.object({ inspectors: z.array(validatedInspectorSchema) });

export type InspectorSnapshot = z.infer<typeof directoryInspectorSchema>;
/** An inspector is identified by its Auth user ID when known, else by its name. */
export type InspectorIdentity = { userId: string | null; name: string };
/** A stored inspector row: the Auth user ID may be absent on name-only rows. */
export type StoredInspector = { userId: string | null; name: string };

/** The canonical display name of a user, rebuilt exactly like Auth does. */
export const displayNameOf = (snapshot: { firstName: string; lastName: string }): string =>
  `${snapshot.firstName} ${snapshot.lastName}`.trim();

/**
 * Requests an Auth endpoint through the gateway with the caller's token.
 *
 * A transport failure is an unavailable upstream (503); an invalid payload is
 * a broken upstream contract (502). A rejected call keeps the upstream status
 * so an expired token or a missing branch is not masked.
 */
async function authGet(path: string, req: Request, query?: string) {
  const token = getAccessToken(req);
  if (!token) throw new HttpError('Access token is required', 401);
  const url = serviceUrl(path) + (query ? `?${query}` : '');
  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ...serviceHeaders(path),
        'x-request-id': String(req.headers['x-request-id'] ?? '') },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError('Auth service is currently unavailable; retry later', 503);
  }
  if (!response.ok) {
    const status = [400, 401, 403, 404, 409, 422].includes(response.status) ? response.status : 503;
    throw new HttpError(
      status === 401 || status === 403 ? 'Unable to validate the inspectors with Auth service'
        : status === 404 ? 'Referenced record not found'
          : 'Auth service is currently unavailable; retry later',
      status,
    );
  }
  try { return (await response.json() as { data: unknown }).data; }
  catch { throw new HttpError('Invalid response from Auth service', 502); }
}

/**
 * The branch-scoped inspector directory of the caller.
 *
 * Auth returns the active FIELD_SERVICE users of the caller's branch. The
 * response keeps the shape the former local read model exposed, so the Work
 * Order forms keep working unchanged.
 */
export async function loadInspectorOptions(req: Request) {
  const parsed = directoryListSchema.safeParse(await authGet(DIRECTORY_PATH, req));
  if (!parsed.success) throw new HttpError('Invalid Auth inspector response', 502);
  return parsed.data.inspectors;
}

/**
 * Indexes the directory by display name so a name-only PATCH can still be
 * compared with the ID-carrying rows. A name that matches no user, or more
 * than one user, stays unresolved and is compared by name.
 */
export function indexInspectorDirectory(snapshots: InspectorSnapshot[]) {
  const byName = new Map<string, string[]>();
  for (const snapshot of snapshots) {
    const name = displayNameOf(snapshot);
    if (!name) continue;
    const key = name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), snapshot.id]);
  }
  return byName;
}

/**
 * Resolves display names to Auth user IDs through the live directory, so a
 * PATCH (which keeps the name-based contract) can still be compared with
 * ID-carrying rows.
 */
export async function resolveInspectorIdentities(req: Request, names: string[]): Promise<InspectorIdentity[]> {
  if (!names.length) return [];
  const byName = indexInspectorDirectory(await loadInspectorOptions(req));
  return names.map((name) => {
    const matches = byName.get(name.toLowerCase()) ?? [];
    return { userId: matches.length === 1 ? matches[0] : null, name };
  });
}

/**
 * Validates submitted [{ userId, name }] inspector pairs against Auth.
 *
 * The submitted name must exactly equal the canonical display name Auth
 * reports for that user, so the stored pair is always the confirmed identity.
 * Any unknown ID, an ID outside the branch, or a name that no longer matches
 * fails the whole set.
 */
export async function validateInspectorPairs(
  req: Request,
  inspectors: { userId: string; name: string }[],
) {
  if (inspectors.length === 0) return [];
  const ids = [...new Set(inspectors.map(({ userId }) => userId))];
  const parsed = validatedListSchema.safeParse(
    await authGet(VALIDATE_PATH, req, `ids=${encodeURIComponent(ids.join(','))}`),
  );
  if (!parsed.success) throw new HttpError('Invalid Auth inspector response', 502);
  const byId = new Map(parsed.data.inspectors.map((inspector) => [inspector.id, inspector.name]));
  const mismatch = 'One or more inspectors do not match active Field Service users in this branch';
  if (ids.some((id) => !byId.has(id)) || inspectors.some(({ userId, name }) => byId.get(userId) !== name.trim())) {
    throw new HttpError(mismatch, 400);
  }
  return inspectors.map(({ userId, name }) => ({ userId, name: name.trim() }));
}

/**
 * Live Auth validation used before a Work order starts.
 *
 * Auth is the source of truth for FIELD_SERVICE users: the stored inspector
 * snapshot (id + display name) must still exist in Auth as an active
 * FIELD_SERVICE user of the caller branch with the same canonical display
 * name. Rows without a userId (legacy name-only rows) are skipped.
 *
 * The upstream call runs before the status transaction, never holding locks.
 */
export async function validateInspectorsForStart(req: Request, inspectors: StoredInspector[]): Promise<void> {
  const ids = [...new Set(inspectors.flatMap((row) => row.userId ? [row.userId] : []))];
  if (ids.length === 0) return;
  const parsed = validatedListSchema.safeParse(
    await authGet(VALIDATE_PATH, req, `ids=${encodeURIComponent(ids.join(','))}`),
  );
  if (!parsed.success) throw new HttpError('Invalid Auth inspector response', 502);
  const authById = new Map(parsed.data.inspectors.map((inspector) => [inspector.id, inspector.name]));
  // Auth only returns active FIELD_SERVICE users of the caller branch, so a
  // missing ID means the user was removed, deactivated or moved.
  const mismatch = 'Work order inspectors do not match Auth user data; reload the inspectors before starting';
  if (ids.some((id) => !authById.has(id))) throw new HttpError(mismatch, 409);
  for (const { userId, name } of inspectors) {
    if (userId && authById.get(userId) !== name) throw new HttpError(mismatch, 409);
  }
}
