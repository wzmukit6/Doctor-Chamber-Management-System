/**
 * In-process metrics (spec §64): request counts and latency per route, database
 * query latency and a rolling 15-minute window for the system status page.
 * Exposed in Prometheus text format at /api/metrics. Labels never contain
 * identifiers or query strings — only route patterns — so no patient data leaks.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const WINDOW_MINUTES = 15;
const MAX_SAMPLES_PER_MINUTE = 2000;

interface Histogram {
  buckets: number[];
  sum: number;
  count: number;
}

interface MinuteBucket {
  minute: number;
  requests: number;
  serverErrors: number;
  clientErrors: number;
  securityRejections: number;
  latencies: number[];
}

const newHistogram = (): Histogram => ({ buckets: BUCKETS.map(() => 0), sum: 0, count: 0 });
function observe(h: Histogram, seconds: number) {
  h.sum += seconds;
  h.count += 1;
  BUCKETS.forEach((b, i) => {
    if (seconds <= b) h.buckets[i] += 1;
  });
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

class Metrics {
  readonly startedAt = Date.now();
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Histogram>();
  private readonly db = newHistogram();
  private slowQueries = 0;
  private window: MinuteBucket[] = [];

  recordRequest(method: string, route: string, status: number, durationMs: number) {
    const key = `${method}\u0000${route}\u0000${status}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const hKey = `${method}\u0000${route}`;
    let h = this.durations.get(hKey);
    if (!h) this.durations.set(hKey, (h = newHistogram()));
    observe(h, durationMs / 1000);

    const b = this.bucket();
    b.requests += 1;
    if (status >= 500) b.serverErrors += 1;
    else if (status >= 400) b.clientErrors += 1;
    if (status === 401 || status === 403 || status === 429) b.securityRejections += 1;
    if (b.latencies.length < MAX_SAMPLES_PER_MINUTE) b.latencies.push(durationMs);
  }

  recordQuery(durationMs: number, slow: boolean) {
    observe(this.db, durationMs / 1000);
    if (slow) this.slowQueries += 1;
  }

  private bucket(): MinuteBucket {
    const minute = Math.floor(Date.now() / 60_000);
    const last = this.window[this.window.length - 1];
    if (last?.minute === minute) return last;
    this.window = this.window.filter((w) => w.minute > minute - WINDOW_MINUTES);
    const b: MinuteBucket = { minute, requests: 0, serverErrors: 0, clientErrors: 0, securityRejections: 0, latencies: [] };
    this.window.push(b);
    return b;
  }

  /** Last 15 minutes, for the system status page. */
  summary() {
    const minute = Math.floor(Date.now() / 60_000);
    const recent = this.window.filter((w) => w.minute > minute - WINDOW_MINUTES);
    const latencies = recent.flatMap((w) => w.latencies);
    const sum = (k: 'requests' | 'serverErrors' | 'clientErrors' | 'securityRejections') => recent.reduce((s, w) => s + w[k], 0);
    return {
      windowMinutes: WINDOW_MINUTES,
      requests: sum('requests'),
      serverErrors: sum('serverErrors'),
      clientErrors: sum('clientErrors'),
      securityRejections: sum('securityRejections'),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      dbQueries: this.db.count,
      dbAvgMs: this.db.count ? Math.round((this.db.sum / this.db.count) * 1000 * 10) / 10 : null,
      slowQueries: this.slowQueries,
    };
  }

  prometheus(): string {
    const lines: string[] = [];
    lines.push('# HELP process_uptime_seconds Seconds since the API process started.', '# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    const mem = process.memoryUsage();
    lines.push('# HELP process_resident_memory_bytes Resident memory size.', '# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${mem.rss}`);

    lines.push('# HELP http_requests_total HTTP requests by method, route pattern and status.', '# TYPE http_requests_total counter');
    for (const [key, n] of this.requests) {
      const [method, route, status] = key.split('\u0000');
      lines.push(`http_requests_total{method="${method}",route="${escapeLabel(route)}",status="${status}"} ${n}`);
    }
    lines.push('# HELP http_request_duration_seconds HTTP request latency.', '# TYPE http_request_duration_seconds histogram');
    for (const [key, h] of this.durations) {
      const [method, route] = key.split('\u0000');
      const labels = `method="${method}",route="${escapeLabel(route)}"`;
      BUCKETS.forEach((b, i) => lines.push(`http_request_duration_seconds_bucket{${labels},le="${b}"} ${h.buckets[i]}`));
      lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
      lines.push(`http_request_duration_seconds_sum{${labels}} ${h.sum.toFixed(6)}`);
      lines.push(`http_request_duration_seconds_count{${labels}} ${h.count}`);
    }
    lines.push('# HELP db_query_duration_seconds Database query latency.', '# TYPE db_query_duration_seconds histogram');
    BUCKETS.forEach((b, i) => lines.push(`db_query_duration_seconds_bucket{le="${b}"} ${this.db.buckets[i]}`));
    lines.push(`db_query_duration_seconds_bucket{le="+Inf"} ${this.db.count}`);
    lines.push(`db_query_duration_seconds_sum ${this.db.sum.toFixed(6)}`);
    lines.push(`db_query_duration_seconds_count ${this.db.count}`);
    lines.push('# HELP db_slow_queries_total Queries slower than SLOW_QUERY_MS.', '# TYPE db_slow_queries_total counter');
    lines.push(`db_slow_queries_total ${this.slowQueries}`);
    return `${lines.join('\n')}\n`;
  }
}

export const metrics = new Metrics();
