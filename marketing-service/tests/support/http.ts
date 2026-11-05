/**
 * Shared helpers for the Akura reliability suite: HTTP client and synthetic
 * identifier helpers.
 *
 * Every identifier created here is prefixed with TEST_MARKER so cleanup can
 * target only rows this suite produced and never touch pre-existing data.
 */
import { randomUUID } from 'node:crypto';

export const TEST_MARKER = 'RELTEST';
export const TEST_PREFIX = `${TEST_MARKER}-`;

/** Synthetic company/item/service names, unique per call. */
export const syntheticName = (kind: string): string =>
  `${TEST_PREFIX}${kind}-${randomUUID().slice(0, 8)}`;

export const syntheticUsername = (): string =>
  `${TEST_MARKER.toLowerCase()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

/** A fixed synthetic password; never a real credential. */
export const TEST_PASSWORD = 'RelTest!2026pass';

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  durationMs: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Thin fetch wrapper with a hard timeout. The default timeout is deliberately
 * short so a hung request is reported as a timeout instead of stalling a suite.
 */
export const httpRequest = async <T = unknown>(
  url: string,
  options: RequestOptions = {},
): Promise<HttpResponse<T>> => {
  const { method = 'GET', body, token, headers = {}, timeoutMs = 30_000 } = options;
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return {
      status: response.status,
      body: parsed as T,
      headers: response.headers,
      durationMs: performance.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Minimal typed accessor for the Akura response envelope. */
export interface ApiEnvelope<T = unknown> {
  status: number;
  success: boolean;
  message: string;
  data: T;
  requestId?: string;
}
