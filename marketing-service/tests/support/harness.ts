/**
 * Boots the Akura services as child processes against the dedicated local
 * test databases, so the reliability suite exercises the real HTTP stack
 * (gateway -> service -> Prisma -> local PostgreSQL).
 *
 * Safety: every service is started with an explicitly overridden environment.
 * DATABASE_URL always points at 127.0.0.1, API_GATEWAY_URL always points at
 * the local test gateway, and TAX_DELIVERY_TARGETS is emptied so a test run
 * can never deliver an event to a deployed service.
 */
import { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  TEST_PORTS,
  assertLocalServiceUrl,
  assertLocalTestDatabase,
  localDatabaseUrl,
  localGatewayUrl,
  type ServiceName,
} from './env.js';

export interface ServiceProcess {
  name: string;
  child: ChildProcess;
  output: string[];
  stop: () => Promise<void>;
}

const SERVICE_ENTRY: Record<ServiceName, string> = {
  auth: 'auth-service/src/server.ts',
  appManager: 'app-manager-service/src/server.ts',
  marketing: 'marketing-service/src/server.ts',
  finance: 'finance-service/src/server.ts',
  fieldservice: 'fieldservice-service/src/server.ts',
};

export const SERVICE_ENTRY_PATHS = SERVICE_ENTRY;

export const SERVICE_PORT: Record<ServiceName, number> = {
  auth: TEST_PORTS.auth,
  appManager: TEST_PORTS.appManager,
  marketing: TEST_PORTS.marketing,
  finance: TEST_PORTS.finance,
  fieldservice: TEST_PORTS.fieldservice,
};

/**
 * Gateway secrets for the test topology.
 *
 * The API Gateway refuses to start when two downstream services share a
 * secret ("Every downstream service must use a different gateway secret"),
 * so each service gets its own distinct test-only value. These secrets only
 * ever travel over 127.0.0.1 and are not used by any deployed environment.
 */
const TEST_SECRET_PREFIX = 'reltest-local-only-';
export const TEST_GATEWAY_SECRETS = {
  auth: `${TEST_SECRET_PREFIX}auth-0123456789abcdef`,
  appManager: `${TEST_SECRET_PREFIX}app-manager-0123456789abcd`,
  marketing: `${TEST_SECRET_PREFIX}marketing-0123456789abc`,
  finance: `${TEST_SECRET_PREFIX}finance-0123456789abcdef`,
  fieldservice: `${TEST_SECRET_PREFIX}field-service-0123456789`,
} as const;

export const TEST_TAX_SYNC_SECRET = 'reltest-local-tax-sync-secret-0123456789abcd';
export const TEST_WORK_ORDER_SYNC_SECRET = 'reltest-local-work-order-secret-0123456789';

export const SERVICE_ENV: Record<ServiceName, () => NodeJS.ProcessEnv> = {
  auth: () => ({
    PORT: String(TEST_PORTS.auth),
    NODE_ENV: 'development',
    GATEWAY_SECRET: TEST_GATEWAY_SECRETS.auth,
    DATABASE_URL: localDatabaseUrl('auth'),
    JWT_ISSUER: 'akura-auth',
    JWT_AUDIENCE: 'akura-api',
  }),
  appManager: () => ({
    PORT: String(TEST_PORTS.appManager),
    NODE_ENV: 'development',
    GATEWAY_SECRET: TEST_GATEWAY_SECRETS.appManager,
    DATABASE_URL: localDatabaseUrl('appManager'),
    API_GATEWAY_URL: localGatewayUrl(),
    TAX_SYNC_SECRET: TEST_TAX_SYNC_SECRET,
    JWT_ISSUER: 'akura-auth',
    JWT_AUDIENCE: 'akura-api',
  }),
  marketing: () => ({
    PORT: String(TEST_PORTS.marketing),
    NODE_ENV: 'development',
    GATEWAY_SECRET: TEST_GATEWAY_SECRETS.marketing,
    DATABASE_URL: localDatabaseUrl('marketing'),
    API_GATEWAY_URL: localGatewayUrl(),
    TAX_SYNC_SECRET: TEST_TAX_SYNC_SECRET,
    WORK_ORDER_SYNC_SECRET: TEST_WORK_ORDER_SYNC_SECRET,
    JWT_ISSUER: 'akura-auth',
    JWT_AUDIENCE: 'akura-api',
  }),
  finance: () => ({
    PORT: String(TEST_PORTS.finance),
    NODE_ENV: 'development',
    GATEWAY_SECRET: TEST_GATEWAY_SECRETS.finance,
    DATABASE_URL: localDatabaseUrl('finance'),
    API_GATEWAY_URL: localGatewayUrl(),
    TAX_SYNC_SECRET: TEST_TAX_SYNC_SECRET,
    // No delivery targets: a test run must never call a deployed service.
    TAX_DELIVERY_TARGETS: '[]',
    JWT_ISSUER: 'akura-auth',
    JWT_AUDIENCE: 'akura-api',
  }),
  fieldservice: () => ({
    PORT: String(TEST_PORTS.fieldservice),
    NODE_ENV: 'development',
    GATEWAY_SECRET: TEST_GATEWAY_SECRETS.fieldservice,
    DATABASE_URL: localDatabaseUrl('fieldservice'),
    API_GATEWAY_URL: localGatewayUrl(),
    WORK_ORDER_SYNC_SECRET: TEST_WORK_ORDER_SYNC_SECRET,
    JWT_ISSUER: 'akura-auth',
    JWT_AUDIENCE: 'akura-api',
  }),
};

/**
 * Validates the environment overrides before a process is started. A mistake
 * here would be the single most dangerous failure mode in this suite.
 */
export const assertServiceEnvIsLocal = (name: string, env: NodeJS.ProcessEnv): void => {
  assertLocalTestDatabase(env.DATABASE_URL ?? '', `${name}.DATABASE_URL`);
  // Only the services that call the gateway define API_GATEWAY_URL. The others
  // (auth, app manager) must not be forced to carry one.
  if (env.API_GATEWAY_URL) assertLocalServiceUrl(env.API_GATEWAY_URL, `${name}.API_GATEWAY_URL`);
  const targets = env.TAX_DELIVERY_TARGETS;
  if (targets && targets !== '[]') {
    for (const target of JSON.parse(targets) as Array<{ name: string; url: string }>) {
      assertLocalServiceUrl(target.url, `${name}.TAX_DELIVERY_TARGETS[${target.name}]`);
    }
  }
};

/**
 * Polls a health endpoint until it answers or the timeout expires.
 *
 * Every domain service verifies the gateway secret before any route, health
 * included, so the probe must present the test secret.
 */
export const waitForHealth = async (
  process_: ServiceProcess,
  url: string,
  timeoutMs: number,
  output: string[] = [],
  headers: Record<string, string> = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    if (process_.child.exitCode !== null) {
      throw new Error(`${process_.name} exited with code ${process_.child.exitCode}\n${output.join('')}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000), headers });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`${process_.name} did not become healthy within ${timeoutMs}ms (${lastError})\n${output.join('')}`);
};
