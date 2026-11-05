# ADR-0004: RS256 JWTs with a Remote JWKS

**Status:** Accepted (reconstructed)
**Date:** Undated — reconstructed from source at commit `ec4484c`

---

## Context

Six services need to verify that a request comes from an authenticated user,
and several of them need the user's **role**, **section**, and **office branch**
to make authorization decisions.

Two broad approaches exist:

1. **A shared secret (HMAC).** Every verifier holds the same secret.
2. **Asymmetric keys (RSA/EC).** Only the issuer holds the private key; others
   hold the public key.

The asymmetric approach lets the key be *published* rather than *distributed*.
That distinction matters here because six services plus the gateway would
otherwise need to share a secret with write access to token forgery.

The platform also needs the token to carry the role, section, and branch, so
that services can authorize section-scoped resources without a call back into
Auth on every request.

## Decision

**Auth issues RS256 access tokens with an RSA private key and publishes the
public key set at `GET /.well-known/jwks.json`. Every consumer fetches that
JWKS and verifies locally.**

### Token design

| Property | Value |
|---|---|
| Algorithm | RS256 only |
| Access token lifetime | `JWT_ACCESS_EXPIRES_IN`, default `15m` |
| Refresh token | HS256, `JWT_REFRESH_EXPIRES_IN` default `7d`, persisted server-side |
| Issuer | `akura-auth` |
| Audience | `akura-api` |
| `kid` | `JWT_ACCESS_KEY_ID`, default `akura-access-key-1` |

**Access token claims** — `auth-service/src/utils/tokens.ts:20-41`:

```ts
{ name, username, role, section, officeBranchId, type: 'access', sub, iss, aud, exp, kid }
```

The `section` claim exists specifically so services can authorize
section-scoped resources without a round trip to Auth
(`tokens.ts:26-28`).

**Refresh tokens** are HS256 and carry `{ id, sub, type: 'refresh' }`. The `id`
is the database row identifier, which makes them **server-side revocable** —
unlike a purely stateless access token. They are also revocable on logout and
on a password change.

### Key constraints

**VERIFIED** — `auth-service/src/config/accessKey.ts:6-19` enforces at load
time that the key is RSA and has a modulus of at least 2048 bits. The public
key is derived from the private key with `createPublicKey`, so the published
JWKS can never drift from the signing key.

### Consumer configuration

**VERIFIED** — every verifier (`api-gateway/src/utils/tokens.ts` and the
identical `*/src/utils/tokens.ts` in marketing, finance, and fieldservice):

```ts
const { payload } = await jwtVerify(token, jwks, {
  algorithms: ['RS256'],
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
});
if (!payload.sub || payload.type !== 'access') throw new Error('Token is not a valid access token');
```

| Setting | Value | Purpose |
|---|---|---|
| `algorithms` | `['RS256']` | Prevents algorithm-confusion attacks |
| `issuer` / `audience` | checked | Scopes the token to this platform |
| `cacheMaxAge` | 10 minutes | Verification survives a JWKS fetch failure |
| `cooldownDuration` | 30 seconds | Prevents a refetch storm on an unknown `kid` |
| `timeoutDuration` | 5 seconds | Bounds the JWKS fetch |

The `type: 'access'` check is what stops a **refresh token** from being used
as an access token.

### JWKS is fetched through the gateway

**VERIFIED** — consumers fetch the JWKS from
`${API_GATEWAY_URL}/api/v1/auth/.well-known/jwks.json` with their own service
credentials. Even key material follows
[ADR-0001](./ADR-0001-gateway-as-single-entrypoint.md).

## Consequences

**Positive**

- **The private key exists in exactly one place.** A compromised domain service
  cannot forge tokens.
- **Algorithm confusion is impossible.** `algorithms: ['RS256']` is pinned
  everywhere, so an attacker cannot downgrade to `none` or re-sign with HMAC
  using the public key as the secret.
- **Issuer and audience are validated**, so a token from another system cannot
  be replayed here.
- **Refresh tokens are revocable.** Logout and password change take effect
  immediately for refresh; access tokens remain valid until they expire
  (maximum 15 minutes).
- **Verification is local and cached**, so services do not call Auth on every
  request just to check a signature.
- **The key can be rotated** in principle, because a `kid` is published.

**Negative**

- **Key rotation is not implemented.** The JWKS publishes exactly **one**
  key. There is no overlap window, no second-key support, and no rotation
  logic. A naive rotation would invalidate every in-flight token, and
  consumers cache the JWKS for 10 minutes, so the disruption lasts at least
  that long.
- **The public key must be served over the network** on first use. The 10-minute
  cache and 5-second timeout bound the exposure.
- **Asymmetric signing is slower than HMAC** — negligible at this request
  volume.
- **Two key types are in play.** Access tokens use RSA; refresh tokens use
  HS256 with a shared secret. The refresh secret must therefore be shared
  across the Auth replicas.

## Open issue

**A documented key-rotation procedure is needed.** The current implementation
can support rotation — `kid` is already published and the JWKS is a *set* —
but the Auth service publishes only one key, and nothing rotates it.
**UNKNOWN** — whether a rotation procedure exists outside this repository.

## Evidence

| Claim | Location |
|---|---|
| Access + refresh token issuance | `auth-service/src/utils/tokens.ts:20-51` |
| RSA ≥ 2048 enforcement, public key derivation | `auth-service/src/config/accessKey.ts:6-33` |
| JWKS endpoint | `auth-service/src/app.ts:41-44` |
| Consumer verification config | `api-gateway/src/utils/tokens.ts:10-28` |
| `type: 'access'` enforcement | `api-gateway/src/utils/tokens.ts:22-28` |
| Cookie security attributes | `auth-service/src/utils/cookies.ts:9-16` |

## Related

- [ADR-0005](./ADR-0005-layered-service-credentials.md) — service-to-service authentication
- [`../authentication-flow.md`](../authentication-flow.md) — the full authentication reference

