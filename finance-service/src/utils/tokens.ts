import { env } from '../config/env.js';
import { AccessTokenPayload } from '../types/auth.types.js';

type RemoteJwkSet = ReturnType<(typeof import('jose'))['createRemoteJWKSet']>;

let jwks: RemoteJwkSet | undefined;

export const verifyAccessToken = async (token: string): Promise<AccessTokenPayload> => {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  jwks ??= createRemoteJWKSet(new URL(`${env.API_GATEWAY_URL}/api/v1/auth/.well-known/jwks.json`), {
    headers: { 'x-service-name': 'finance-service', 'x-service-secret': env.GATEWAY_SECRET },
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60 * 1_000,
  });

  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ['RS256'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
  if (!payload.sub || payload.type !== 'access') {
    throw new Error('Token is not a valid access token');
  }
  return payload as AccessTokenPayload;
};
