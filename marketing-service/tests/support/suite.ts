/**
 * Shared bootstrap for the Akura reliability suite.
 *
 * Provides the database provisioning that every test file needs, plus the
 * per-test reset that keeps test files independent of each other and of the
 * order in which they run.
 *
 * Each test file starts the services it needs itself, through
 * `startService` / `startGateway`, so a test only pays for what it uses.
 */
import { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { provisionTestDatabases, resetTestDatabases } from './db.js';
import type { ServiceName } from './env.js';

export const ALL_SERVICES: ServiceName[] = [
  'auth',
  'appManager',
  'marketing',
  'finance',
  'fieldservice',
];

let provisioned = false;

/**
 * Provisions the dedicated test databases exactly once per process.
 * `db push` is executed against 127.0.0.1 only.
 */
export const ensureDatabases = async (): Promise<void> => {
  if (provisioned) return;
  await provisionTestDatabases(ALL_SERVICES);
  provisioned = true;
};

/**
 * Resets the given test databases before each test, so every test starts from
 * a known state and cannot be influenced by a previous test.
 */
export const resetBeforeEach = (services: ServiceName[]): void => {
  beforeEach(async () => {
    await resetTestDatabases(services);
  });
};

/** Asserts that a response carries the Akura response envelope. */
export const assertEnvelope = (body: unknown, expectedStatus: number): void => {
  assert.ok(body && typeof body === 'object', 'response body must be an object');
  const envelope = body as { status?: number; success?: boolean; message?: string; requestId?: string };
  assert.equal(envelope.status, expectedStatus, `envelope.status must be ${expectedStatus}`);
  assert.equal(envelope.success, expectedStatus >= 200 && expectedStatus < 300);
  assert.equal(typeof envelope.message, 'string');
};
