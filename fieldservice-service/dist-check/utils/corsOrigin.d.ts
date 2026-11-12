/**
 * CORS policy for the service.
 *
 * Every browser request arrives through the API Gateway, which is the public
 * edge and owns the origin policy. A service therefore has no browser origin
 * of its own to allow: it accepts any origin, and the gateway decides which
 * origins are actually served. The service is never exposed directly.
 */
export declare const corsOrigin: (_origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => void;
