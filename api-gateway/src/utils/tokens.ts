import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { AccessTokenPayload } from '../types/auth.types.js';

const jwks = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL), {
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60 * 1_000,
});

export const verifyAccessToken = async (token: string): Promise<AccessTokenPayload> => {
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
