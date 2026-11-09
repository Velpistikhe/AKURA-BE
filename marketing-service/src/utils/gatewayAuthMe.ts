import { env } from '../config/env.js';

/** Client-style profile read through the deployed gateway (Bearer only). */
export const fetchGatewayAuthMe = (token: string, requestId?: string): Promise<Response> =>
  fetch(`${env.API_GATEWAY_URL}/api/v1/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
