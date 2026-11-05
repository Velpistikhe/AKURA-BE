/**
 * Latency percentiles, stress metrics and synchronization primitives used by
 * the Akura reliability suite.
 */

export interface LatencySummary {
  count: number;
  minMs: number;
  maxMs: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/** Percentile summary over a sample of latencies (nearest-rank). */
export const summarizeLatency = (samples: number[]): LatencySummary => {
  if (!samples.length) {
    return { count: 0, minMs: 0, maxMs: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (percentile: number): number => {
    const rank = Math.ceil((percentile / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
  };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    averageMs: total / sorted.length,
    p50Ms: at(50),
    p95Ms: at(95),
    p99Ms: at(99),
  };
};

export interface StressMetrics {
  concurrency: number;
  totalRequests: number;
  successful: number;
  failed: number;
  timeouts: number;
  wallClockMs: number;
  requestsPerSecond: number;
  latency: LatencySummary;
  statusCounts: Record<number, number>;
  errorMessages: Record<string, number>;
}

export interface StressSample {
  status: number;
  durationMs: number;
  error?: string;
}

/** Aggregates raw per-request samples into the stress report metrics. */
export const buildStressMetrics = (
  concurrency: number,
  samples: StressSample[],
  wallClockMs: number,
): StressMetrics => {
  const statusCounts: Record<number, number> = {};
  const errorMessages: Record<string, number> = {};
  let successful = 0;
  let failed = 0;
  let timeouts = 0;
  for (const sample of samples) {
    if (sample.error) {
      failed += 1;
      const key = sample.error.slice(0, 120);
      errorMessages[key] = (errorMessages[key] ?? 0) + 1;
      if (/abort|timeout/i.test(sample.error)) timeouts += 1;
      continue;
    }
    statusCounts[sample.status] = (statusCounts[sample.status] ?? 0) + 1;
    if (sample.status >= 200 && sample.status < 400) successful += 1;
    else failed += 1;
  }
  return {
    concurrency,
    totalRequests: samples.length,
    successful,
    failed,
    timeouts,
    wallClockMs,
    requestsPerSecond: wallClockMs > 0 ? (samples.length / wallClockMs) * 1000 : 0,
    latency: summarizeLatency(samples.map((sample) => sample.durationMs)),
    statusCounts,
    errorMessages,
  };
};

/**
 * A barrier that releases every waiter at once. Used to force a deterministic
 * interleaving instead of relying on Promise.all scheduling luck.
 */
export class Barrier {
  private waiting = 0;
  private released = false;
  private readonly promise: Promise<void>;
  private resolvePromise!: () => void;

  constructor(private readonly parties: number) {
    this.promise = new Promise<void>((resolve) => { this.resolvePromise = resolve; });
  }

  async wait(): Promise<void> {
    this.waiting += 1;
    if (this.waiting >= this.parties && !this.released) {
      this.released = true;
      this.resolvePromise();
    }
    await this.promise;
  }

  /** Resolves once every party has reached the barrier. */
  async ready(): Promise<void> {
    while (this.waiting < this.parties) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

/** Waits for a condition to become true, polling until the timeout expires. */
export const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  { timeoutMs = 20_000, intervalMs = 100, label = 'condition' }:
    { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
};
