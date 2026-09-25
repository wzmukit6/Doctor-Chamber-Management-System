import { metrics } from './metrics';
import { routePattern } from './request-logger.middleware';
import type { Request } from 'express';

describe('metrics', () => {
  it('counts requests per route pattern and exposes Prometheus text', () => {
    metrics.recordRequest('GET', '/api/patients/:id', 200, 12);
    metrics.recordRequest('GET', '/api/patients/:id', 404, 3);
    metrics.recordRequest('POST', '/api/auth/login', 401, 150);
    const text = metrics.prometheus();
    expect(text).toContain('http_requests_total{method="GET",route="/api/patients/:id",status="200"} 1');
    expect(text).toContain('http_requests_total{method="POST",route="/api/auth/login",status="401"} 1');
    expect(text).toMatch(/http_request_duration_seconds_bucket\{method="GET",route="\/api\/patients\/:id",le="0\.025"\} 2/);
  });

  it('summarises the rolling window with percentiles and security rejections', () => {
    const s = metrics.summary();
    expect(s.requests).toBeGreaterThanOrEqual(3);
    expect(s.securityRejections).toBeGreaterThanOrEqual(1);
    expect(s.p95Ms).not.toBeNull();
  });

  it('never uses concrete ids or query strings as labels', () => {
    const req = { path: '/api/patients/3f1c7b4e-1234-4abc-9def-0123456789ab/timeline', baseUrl: '' } as unknown as Request;
    expect(routePattern(req)).toBe('/api/patients/:id/timeline');
    const matched = { route: { path: '/api/patients/:id' }, baseUrl: '', path: '/api/patients/x' } as unknown as Request;
    expect(routePattern(matched)).toBe('/api/patients/:id');
  });
});
