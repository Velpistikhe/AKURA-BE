import jwt, { JwtPayload } from 'jsonwebtoken';
import { User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { accessTokenPrivateKey, accessTokenPublicKey } from '../config/accessKey.js';
import { env } from '../config/env.js';
import { AuthTokens } from '../types/auth.types.js';
import { durationToMilliseconds } from './duration.js';
import { HttpError } from './httpError.js';

interface AccessTokenPayload extends JwtPayload {
  sub: string;
  name: string;
  username: string;
  role: string;
  officeBranchId: string | null;
  type: 'access';
}

const generateAccessToken = (user: User): string => jwt.sign(
  {
    name: `${user.firstName} ${user.lastName}`.trim(),
    username: user.username,
    role: user.role,
    officeBranchId: user.officeBranchId,
    type: 'access',
  },
  accessTokenPrivateKey,
  {
    algorithm: 'RS256',
    keyid: env.JWT_ACCESS_KEY_ID,
    subject: user.id,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  }
);

const generateRefreshToken = (userId: string): string => jwt.sign(
  {
    id: uuidv4(),
    sub: userId,
    type: 'refresh',
  },
  env.JWT_REFRESH_SECRET,
  { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
);

export const createAuthTokens = (user: User): AuthTokens => ({
  accessToken: generateAccessToken(user),
  refreshToken: generateRefreshToken(user.id),
  expiresInSeconds: Math.floor(durationToMilliseconds(env.JWT_ACCESS_EXPIRES_IN) / 1_000),
});

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, accessTokenPublicKey, {
    algorithms: ['RS256'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }) as AccessTokenPayload;
  if (
    !decoded.sub
    || decoded.type !== 'access'
    || (decoded.officeBranchId !== null && typeof decoded.officeBranchId !== 'string')
  ) {
    throw new HttpError('Unauthorized: Access token is invalid or expired', 401);
  }
  return decoded;
};

export const verifyRefreshToken = (token: string): void => {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
    if (decoded.type !== 'refresh' || typeof decoded.id !== 'string' || typeof decoded.sub !== 'string') {
      throw new Error('Invalid refresh token payload');
    }
  } catch {
    throw new HttpError('Invalid or expired refresh token', 401);
  }
};
