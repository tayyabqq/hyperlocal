import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Load test for the read-heavy hot path: browsing nearby listings (the geo query
 * the whole product is built around). Mirrors the Technology doc's targets:
 *   - API p95 < 1s
 *   - Geo query < 200ms (server-side; observed here as total response time)
 *   - 500 concurrent (the JMeter figure from the execution plan)
 *
 * Run against a seeded environment:
 *   BASE_URL=https://api.worknearby.ae k6 run infra/load-test/browse.k6.js
 *
 * Browsing is public (no auth), so this isolates DB + Redis + PostGIS under load.
 */
const browseLatency = new Trend('browse_latency', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// A cluster of points around Deira, the documented launch area, so cache keys
// spread realistically across the ~110m grid rather than all hitting one entry.
const CENTERS = [
  [25.2582, 55.3047],
  [25.2688, 55.31],
  [25.271, 55.309],
  [25.2585, 55.305],
  [25.2648, 55.3012],
];

export const options = {
  scenarios: {
    ramp_to_500: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '2m', target: 500 }, // the 500-concurrent target
        { duration: '3m', target: 500 }, // hold
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<1000'], // API p95 < 1s
    browse_latency: ['p(95)<1000'],
  },
};

export default function () {
  const [lat, lng] = CENTERS[Math.floor(Math.random() * CENTERS.length)];
  const jitterLat = lat + (Math.random() - 0.5) * 0.01;
  const jitterLng = lng + (Math.random() - 0.5) * 0.01;

  const res = http.get(
    `${BASE_URL}/v1/listings?latitude=${jitterLat}&longitude=${jitterLng}&radiusMeters=2000`,
  );

  browseLatency.add(res.timings.duration);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'returns a listings array': (r) => Array.isArray(r.json('listings')),
  });

  sleep(Math.random() * 2); // think time between browses
}
