import { Response } from 'express';
import { env } from '../config/env.js';
import { AuthTokens } from '../types/auth.types.js';
import { durationToMilliseconds } from './duration.js';

const ACCESS_TOKEN_MAX_AGE = durationToMilliseconds(env.JWT_ACCESS_EXPIRES_IN);
const REFRESH_TOKEN_MAX_AGE = durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN);

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
};

export const setTokenCookies = (res: Response, tokens: AuthTokens): void => {
  res.cookie('accessToken', tokens.accessToken, {
    ...cookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  res.cookie('refreshToken', tokens.refreshToken, {
    ...cookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
};

export const clearTokenCookies = (res: Response): void => {
  res.clearCookie('accessToken', cookieOptions);
  res.clearCookie('refreshToken', cookieOptions);
};
