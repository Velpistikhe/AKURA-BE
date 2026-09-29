import { env } from '../config/env.js';
import { isDirectMfeAccess } from './directAccess.js';

/**
 * CORS policy for direct development access: only the configured local MFE
 * origin may call this service directly; requests routed through the API
 * Gateway keep the unrestricted gateway-origin behavior.
 */
export const corsOrigin = (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void => {
  if (!origin || !isDirectMfeAccess() || origin === env.DIRECT_MFE_ORIGIN) {
    callback(null, true);
    return;
  }
  callback(null, false);
};
