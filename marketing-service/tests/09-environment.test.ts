/**
 * ENVIRONMENT - the local development configuration.
 *
 * These tests guard the environment handling, which is the most dangerous
 * failure mode in the suite: a development configuration that points at a
 * deployed database or a deployed service would let a local run modify real
 * data.
 *
 * The checks are static, because the behaviour under test is the content of
 * the configuration files and the startup guard in each service.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SERVICES = [
  'api-gateway',
  'auth-service',
  'app-manager-service',
  'marketing-service',
  'finance-service',
  'fieldservice-service',
] as const;

/** Reads an environment file and returns its key/value pairs. */
const readEnv = async (service: string, file: string): Promise<Map<string, string>> => {
  const content = await readFile(resolve(process.cwd(), '..', service, file), 'utf8');
  const values = new Map<string, string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return values;
};

/**
 * The variables an environment file documents.
 *
 * A commented-out assignment still documents the variable: the templates
 * present the alternative options of a setting (a private key path or its
 * base64 form) as commented lines, so the operator can see every option.
 */
const documentedKeys = async (service: string, file: string): Promise<Set<string>> => {
  const content = await readFile(resolve(process.cwd(), '..', service, file), 'utf8');
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const withoutComment = trimmed.startsWith('#') ? trimmed.replace(/^#+\s*/, '') : trimmed;
    if (!withoutComment) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=/.exec(withoutComment);
    if (match) keys.add(match[1]);
  }
  return keys;
};

/** The host of a URL or a connection string. */
const hostOf = (value: string): string => {
  try {
    return new URL(value.includes('://') ? value : `postgresql://${value}`).hostname;
  } catch {
    return '';
  }
};

/** Every TypeScript source file under a directory, recursively. */
const collectTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
};

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

/** The hosts a service may reach in development besides the local machine. */
const allowedRemoteHosts = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

describe('environment configuration', () => {
  test('every service ships a .env.example template', async () => {
    for (const service of SERVICES) {
      const values = await readEnv(service, '.env.example');
      assert.ok(values.size > 0, `${service}/.env.example must define variables`);
    }
  });

  test('every .env.example documents the variables the service reads', async () => {
    // The schema is the source of truth for the required variables.
    for (const service of SERVICES) {
      const schema = await readFile(
        resolve(process.cwd(), '..', service, 'src', 'config', 'env.ts'),
        'utf8',
      );
      const template = await readEnv(service, '.env.example');
      const documented = await documentedKeys(service, '.env.example');
      const required = [...schema.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*z\./gm)].map((match) => match[1]);
      for (const name of new Set(required)) {
        assert.ok(
          documented.has(name),
          `${service}/.env.example must document ${name}`,
        );
      }
      // The template must also carry at least one usable assignment.
      assert.ok(template.size > 0, `${service}/.env.example must define variables`);
    }
  });

  test('the local .env files only target an allowed host', async () => {
    for (const service of SERVICES) {
      const values = await readEnv(service, '.env');
      // The development environment is hosted, so a remote host is reachable only
      // when the service lists it in DEV_ALLOWED_REMOTE_HOSTS.
      const allowed = allowedRemoteHosts(values.get('DEV_ALLOWED_REMOTE_HOSTS'));
      const targets = [
        ['DATABASE_URL', values.get('DATABASE_URL')],
        ['API_GATEWAY_URL', values.get('API_GATEWAY_URL')],
        ['AWS_ENDPOINT_URL_S3', values.get('AWS_ENDPOINT_URL_S3')],
        ['AUTH_SERVICE_URL', values.get('AUTH_SERVICE_URL')],
        ['AUTH_JWKS_URL', values.get('AUTH_JWKS_URL')],
        ['APP_MANAGER_SERVICE_URL', values.get('APP_MANAGER_SERVICE_URL')],
        ['MARKETING_SERVICE_URL', values.get('MARKETING_SERVICE_URL')],
        ['FINANCE_SERVICE_URL', values.get('FINANCE_SERVICE_URL')],
        ['FIELDSERVICE_SERVICE_URL', values.get('FIELDSERVICE_SERVICE_URL')],
      ] as const;
      for (const [name, value] of targets) {
        if (!value) continue;
        const host = hostOf(value);
        assert.ok(
          LOCAL_HOSTS.includes(host) || allowed.includes(host),
          `${service}/.env ${name} points at "${host}", which is neither local nor listed in DEV_ALLOWED_REMOTE_HOSTS`,
        );
      }

      // The delivery targets are a JSON list, so they are checked separately.
      const deliveryTargets = values.get('TAX_DELIVERY_TARGETS');
      if (deliveryTargets && deliveryTargets !== '[]') {
        const parsed = JSON.parse(deliveryTargets) as Array<{ name: string; url: string }>;
        for (const target of parsed) {
          const host = hostOf(target.url);
          assert.ok(
            LOCAL_HOSTS.includes(host) || allowed.includes(host),
            `${service}/.env TAX_DELIVERY_TARGETS[${target.name}] points at "${host}", which is neither local nor listed in DEV_ALLOWED_REMOTE_HOSTS`,
          );
        }
      }
    }
  });

  test('a remote target is refused unless its host is listed', async () => {
    // The allowlist is per host: naming one development host never opens the
    // door to another. This keeps the hosted development environment from
    // reaching a production branch or deployment by accident.
    for (const service of SERVICES) {
      const schema = await readFile(
        resolve(process.cwd(), '..', service, 'src', 'config', 'env.ts'),
        'utf8',
      );
      assert.match(
        schema,
        /DEV_ALLOWED_REMOTE_HOSTS/,
        `${service} must expose the remote host allowlist`,
      );
      assert.match(
        schema,
        /allowedRemoteHosts\.has\(normalized\)/,
        `${service} must accept a remote host only when it is listed`,
      );
      assert.match(
        schema,
        /parseAllowedRemoteHosts/,
        `${service} must parse the allowlist before it validates a target`,
      );
    }
  });

  test('local direct access is gated by development mode and Vercel hosting', async () => {
    const targets = [
      'marketing-service',
      'finance-service',
      'fieldservice-service',
      'app-manager-service',
    ] as const;
    for (const service of targets) {
      const helper = await readFile(
        resolve(process.cwd(), '..', service, 'src', 'utils', 'localDirectAccess.ts'),
        'utf8',
      );
      assert.match(helper, /NODE_ENV === 'development'/, `${service} must allow direct access only in development`);
      assert.match(helper, /VERCEL !== '1'/, `${service} must refuse direct access when hosted on Vercel`);
    }
  });

  test('no .env.production file remains in the repository', async () => {
    for (const service of SERVICES) {
      await assert.rejects(
        () => readFile(resolve(process.cwd(), '..', service, '.env.production'), 'utf8'),
        /ENOENT/,
        `${service}/.env.production must not exist`,
      );
    }
  });

  test('every service refuses a remote target in development', async () => {
    for (const service of SERVICES) {
      const schema = await readFile(
        resolve(process.cwd(), '..', service, 'src', 'config', 'env.ts'),
        'utf8',
      );
      assert.match(
        schema,
        /assertAllowedTarget/,
        `${service} must refuse a remote target in development`,
      );
      assert.match(
        schema,
        /NODE_ENV !== 'development'/,
        `${service} must apply the guard only in development`,
      );
    }
  });

  test('the shared sync secrets are consistent between the services that use them', async () => {
    const marketing = await readEnv('marketing-service', '.env');
    const finance = await readEnv('finance-service', '.env');
    const fieldservice = await readEnv('fieldservice-service', '.env');

    // The delivery pairs must share one secret, or the receiver rejects the
    // event with 403.
    assert.equal(
      marketing.get('TAX_SYNC_SECRET'),
      finance.get('TAX_SYNC_SECRET'),
      'the tax sync secret must match between Finance and Marketing',
    );
    assert.equal(
      marketing.get('WORK_ORDER_SYNC_SECRET'),
      fieldservice.get('WORK_ORDER_SYNC_SECRET'),
      'the work order secret must match between Marketing and Field Service',
    );

    // Every shared secret must be long enough for the schema.
    for (const [name, value] of marketing) {
      if (!name.endsWith('_SECRET') || name === 'GATEWAY_SECRET') continue;
      assert.ok(
        (value ?? '').length >= 32,
        `marketing-service/.env ${name} must be at least 32 characters`,
      );
    }
  });

  test('every service uses a different gateway secret', async () => {
    const gateway = await readEnv('api-gateway', '.env');
    const names = [
      'AUTH_SERVICE_GATEWAY_SECRET',
      'APP_MANAGER_SERVICE_GATEWAY_SECRET',
      'MARKETING_SERVICE_GATEWAY_SECRET',
      'FINANCE_SERVICE_GATEWAY_SECRET',
      'FIELDSERVICE_SERVICE_GATEWAY_SECRET',
    ];
    const values = names.map((name) => gateway.get(name) ?? '');
    // The gateway refuses to start when two services share a secret.
    assert.equal(new Set(values).size, values.length, 'every gateway secret must be unique');

    // Each service must present the same secret as the gateway expects.
    const pairs = [
      ['auth-service', 'GATEWAY_SECRET', 'AUTH_SERVICE_GATEWAY_SECRET'],
      ['app-manager-service', 'GATEWAY_SECRET', 'APP_MANAGER_SERVICE_GATEWAY_SECRET'],
      ['marketing-service', 'GATEWAY_SECRET', 'MARKETING_SERVICE_GATEWAY_SECRET'],
      ['finance-service', 'GATEWAY_SECRET', 'FINANCE_SERVICE_GATEWAY_SECRET'],
      ['fieldservice-service', 'GATEWAY_SECRET', 'FIELDSERVICE_SERVICE_GATEWAY_SECRET'],
    ] as const;
    for (const [service, serviceKey, gatewayKey] of pairs) {
      const serviceValues = await readEnv(service, '.env');
      assert.equal(
        serviceValues.get(serviceKey),
        gateway.get(gatewayKey),
        `${service}/.env ${serviceKey} must match the gateway ${gatewayKey}`,
      );
    }
  });
});
