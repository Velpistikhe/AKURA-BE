/**
 * Spawns the Akura services and the API gateway for the duration of a test
 * run. Split from harness.ts so the environment definitions stay readable.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { gatewayDirectory, serviceDirectory } from './db.js';
import { TEST_PORTS, assertLocalServiceUrl, type ServiceName } from './env.js';
import {
  SERVICE_ENV,
  SERVICE_PORT,
  TEST_GATEWAY_SECRETS,
  assertServiceEnvIsLocal,
  waitForHealth,
  type ServiceProcess,
} from './harness.js';

const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';

/**
 * Spawns a service or the gateway.
 *
 * `tsx` is invoked through its Node entry point rather than the .cmd shim,
 * because spawn cannot execute a .cmd file on Windows without a shell.
 */
const spawnNode = (args: string[], cwd: string, env: NodeJS.ProcessEnv): ReturnType<typeof spawn> =>
  spawn(process.execPath, [TSX_CLI, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

const attachOutput = (child: ReturnType<typeof spawn>): string[] => {
  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => { output.push(chunk.toString()); });
  child.stderr?.on('data', (chunk: Buffer) => { output.push(chunk.toString()); });
  return output;
};

const makeStop = (child: ReturnType<typeof spawn>) => async (): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  const forced = delay(5_000).then(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  await Promise.race([exited, forced]);
};

/**
 * Starts a domain service with `tsx` so the TypeScript sources run as-is.
 *
 * `extraEnv` adds service-specific overrides on top of the fixed test
 * environment, for example the local S3 stub configuration.
 */
export const startService = async (
  service: ServiceName,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<ServiceProcess> => {
  const directory = serviceDirectory(service);
  const env = { ...process.env, ...SERVICE_ENV[service](), ...extraEnv };
  assertServiceEnvIsLocal(service, env);

  const child = spawnNode(['src/server.ts'], directory, env);
  const output = attachOutput(child);
  const process_: ServiceProcess = { name: service, child, output, stop: makeStop(child) };
  await waitForHealth(
    process_,
    `http://127.0.0.1:${SERVICE_PORT[service]}/health`,
    90_000,
    output,
    { 'x-gateway-secret': TEST_GATEWAY_SECRETS[service] },
  );
  return process_;
};

/**
 * Starts the API gateway against the local test services.
 *
 * The rate limiters are raised well above the stress levels the suite uses,
 * because the limiter would otherwise mask application behaviour with HTTP
 * 429 responses.
 */
export const startGateway = async (): Promise<ServiceProcess> => {
  const directory = gatewayDirectory();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(TEST_PORTS.gateway),
    NODE_ENV: 'development',
    CORS_ORIGIN: '*',
    RATE_LIMIT_WINDOW_MS: '900000',
    RATE_LIMIT_MAX_REQUESTS: '1000000',
    AUTH_RATE_LIMIT_WINDOW_MS: '900000',
    AUTH_RATE_LIMIT_MAX_REQUESTS: '1000000',
    AUTH_SERVICE_GATEWAY_SECRET: TEST_GATEWAY_SECRETS.auth,
    APP_MANAGER_SERVICE_GATEWAY_SECRET: TEST_GATEWAY_SECRETS.appManager,
    MARKETING_SERVICE_GATEWAY_SECRET: TEST_GATEWAY_SECRETS.marketing,
    FINANCE_SERVICE_URL: `http://127.0.0.1:${TEST_PORTS.finance}`,
    FINANCE_SERVICE_GATEWAY_SECRET: TEST_GATEWAY_SECRETS.finance,
    FIELDSERVICE_SERVICE_URL: `http://127.0.0.1:${TEST_PORTS.fieldservice}`,
    FIELDSERVICE_SERVICE_GATEWAY_SECRET: TEST_GATEWAY_SECRETS.fieldservice,
    AUTH_SERVICE_URL: `http://127.0.0.1:${TEST_PORTS.auth}`,
    APP_MANAGER_SERVICE_URL: `http://127.0.0.1:${TEST_PORTS.appManager}`,
    MARKETING_SERVICE_URL: `http://127.0.0.1:${TEST_PORTS.marketing}`,
    AUTH_JWKS_URL: `http://127.0.0.1:${TEST_PORTS.auth}/.well-known/jwks.json`,
    JWT_ISSUER: 'akura-auth',
    JWT_AUDIENCE: 'akura-api',
  };
  assertLocalServiceUrl(env.AUTH_SERVICE_URL ?? '', 'gateway.AUTH_SERVICE_URL');
  assertLocalServiceUrl(env.MARKETING_SERVICE_URL ?? '', 'gateway.MARKETING_SERVICE_URL');
  assertLocalServiceUrl(env.FINANCE_SERVICE_URL ?? '', 'gateway.FINANCE_SERVICE_URL');
  assertLocalServiceUrl(env.FIELDSERVICE_SERVICE_URL ?? '', 'gateway.FIELDSERVICE_SERVICE_URL');

  const child = spawnNode(['src/server.ts'], directory, env);
  const output = attachOutput(child);
  const process_: ServiceProcess = { name: 'api-gateway', child, output, stop: makeStop(child) };
  await waitForHealth(process_, `http://127.0.0.1:${TEST_PORTS.gateway}/health`, 90_000, output);
  return process_;
};
