import { env } from '../config/env.js';
import { durationToMilliseconds } from './duration.js';

export const createRefreshTokenExpiry = (): Date => {
  return new Date(Date.now() + durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN));
};
