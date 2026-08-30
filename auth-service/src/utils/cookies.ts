import { CookieOptions, Response } from 'express';
import { env } from '../config/env.js';
import { AuthTokens } from '../types/auth.types.js';
import { durationToMilliseconds } from './duration.js';

const ACCESS_TOKEN_MAX_AGE = durationToMilliseconds(env.JWT_ACCESS_EXPIRES_IN);
const REFRESH_TOKEN_MAX_AGE = durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN);

const isDeployed = env.NODE_ENV === 'production' || process.env.VERCEL === '1';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isDeployed,
  sameSite: isDeployed ? 'none' : 'lax',
  path: '/',
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
