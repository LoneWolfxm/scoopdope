import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * High Concurrency Load Test
 * Tests system with 200, 1000 and 10000 concurrent users
 *
 * The 200-user scenario validates the DB connection pool configuration
 * (DB_POOL_MAX, defaults to 20) and asserts no connection exhaustion occurs.
 */

// Custom metrics for connection-exhaustion detection
const connectionExhaustionRate = new Rate('connection_exhaustion_errors');
const serverErrorRate = new Rate('server_errors');
const dbHeavyDuration = new Trend('db_heavy_request_duration');

export const options = {
  scenarios: {
    // 200 concurrent users - validates DB pool configuration
    pool_validation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Ramp-up to 200 users
        { duration: '2m', target: 200 },
        // Sustain 200 users
        { duration: '5m', target: 200 },
        // Ramp-down
        { duration: '1m', target: 0 },
      ],
      exec: 'poolValidationScenario',
      tags: { scenario: 'pool_validation' },
    },
    // High concurrency - 1000 and 10000 users
    high_concurrency: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Ramp-up to 1000 users
        { duration: '5m', target: 1000 },
        // Sustained 1000 users
        { duration: '10m', target: 1000 },
        // Spike to 10000 users
        { duration: '2m', target: 10000 },
        // Sustained 10000 users
        { duration: '5m', target: 10000 },
        // Ramp-down
        { duration: '5m', target: 0 },
      ],
      exec: 'highConcurrencyScenario',
      startTime: '8m',
      tags: { scenario: 'high_concurrency' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.1'],
    // Pool validation scenario must show no connection exhaustion
    'connection_exhaustion_errors{scenario:pool_validation}': ['rate==0'],
    'server_errors{scenario:pool_validation}': ['rate<0.01'],
    'db_heavy_request_duration{scenario:pool_validation}': ['p(95)<1500', 'p(99)<3000'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_PREFIX = '/api/v1';

// Smoke assertion: fail the run if no response ever returns 200 (e.g. wrong path -> all 404s)
export function setup() {
  const res = http.get(`${BASE_URL}${API_PREFIX}/courses?page=0&limit=1`, {
    tags: { endpoint: 'smoke' },
  });

  check(res, {
    'smoke: at least one response returns 200': (r) => r.status === 200,
  });

  if (res.status !== 200) {
    throw new Error(
      `Smoke check failed: expected 200 from ${BASE_URL}${API_PREFIX}/courses, got ${res.status}`
    );
  }
}

/**
 * Detect connection-exhaustion symptoms in a response.
 * TypeORM/pg surfaces these as ETIMEDOUT, ECONNREFUSED, "too many clients",
 * "connection pool" errors, or generic 5xx responses.
 */
function isConnectionExhaustion(res) {
  if (!res) return false;
  const body = (res.body || '').toString().toLowerCase();
  const errorText = (res.error || '').toString().toLowerCase();
  const combined = `${body} ${errorText}`;

  const exhaustionPatterns = [
    'etimedout',
    'econnrefused',
    'econnreset',
    'timeout exceeded when trying to connect',
    'too many clients',
    'connection pool',
    'pool exhausted',
    'connection terminated',
    'remaining connection slots',
  ];

  return exhaustionPatterns.some((pattern) => combined.includes(pattern));
}

function isServerError(res) {
  return !res || res.status >= 500;
}

function recordPoolMetrics(res, tags) {
  connectionExhaustionRate.add(isConnectionExhaustion(res), tags);
  serverErrorRate.add(isServerError(res), tags);
}

/**
 * 200 concurrent user scenario - exercises DB-heavy endpoints
 * to validate the connection pool configuration.
 */
export function poolValidationScenario() {
  group('Pool Validation - DB Heavy', () => {
    // DB-heavy: paginated list query with filtering/sorting
    const listRes = http.get(
      `${BASE_URL}/v1/courses?page=${Math.floor(Math.random() * 10)}&limit=50&sort=createdAt`,
      { tags: { endpoint: 'courses-list', scenario: 'pool_validation' } },
    );

    dbHeavyDuration.add(listRes.timings.duration, { scenario: 'pool_validation' });
    recordPoolMetrics(listRes, { scenario: 'pool_validation' });

    check(listRes, {
      'list status 200': (r) => r.status === 200,
      'list not connection exhausted': (r) => !isConnectionExhaustion(r),
      'list no 5xx': (r) => r.status < 500,
      'list response time < 1500ms': (r) => r.timings.duration < 1500,
    });

    sleep(0.5);

    // DB-heavy: detail lookup with relations
    const courseId = Math.floor(Math.random() * 100) + 1;
    const detailRes = http.get(`${BASE_URL}/v1/courses/${courseId}`, {
      tags: { endpoint: 'course-details', scenario: 'pool_validation' },
    });

    dbHeavyDuration.add(detailRes.timings.duration, { scenario: 'pool_validation' });
    recordPoolMetrics(detailRes, { scenario: 'pool_validation' });

    check(detailRes, {
      'detail status 200 or 404': (r) => r.status === 200 || r.status === 404,
      'detail not connection exhausted': (r) => !isConnectionExhaustion(r),
      'detail no 5xx': (r) => r.status < 500,
      'detail response time < 1500ms': (r) => r.timings.duration < 1500,
    });

    sleep(0.5);

    // DB-heavy: write path (enrollment) to stress the pool with transactions
    const enrollRes = http.post(
      `${BASE_URL}/v1/enrollments`,
      JSON.stringify({ courseId }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { endpoint: 'enrollments', scenario: 'pool_validation' },
      },
    );

    dbHeavyDuration.add(enrollRes.timings.duration, { scenario: 'pool_validation' });
    recordPoolMetrics(enrollRes, { scenario: 'pool_validation' });

    check(enrollRes, {
      'enroll status is 2xx/4xx': (r) => r.status >= 200 && r.status < 500,
      'enroll not connection exhausted': (r) => !isConnectionExhaustion(r),
      'enroll no 5xx': (r) => r.status < 500,
    });

    sleep(1);
  });
}

/**
 * High concurrency scenario - 1000 and 10000 users.
 */
export function highConcurrencyScenario() {
  group('High Concurrency - Read Heavy', () => {
    // Simulate read-heavy workload
    const coursesRes = http.get(`${BASE_URL}${API_PREFIX}/courses?page=${Math.floor(Math.random() * 10)}&limit=20`, {
      tags: { endpoint: 'courses' },
    });

    recordPoolMetrics(coursesRes, { scenario: 'high_concurrency' });

    check(coursesRes, {
      'courses status 200': (r) => r.status === 200,
      'courses response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    sleep(1);

    // Get random course details
    const courseId = Math.floor(Math.random() * 100) + 1;
    const courseRes = http.get(`${BASE_URL}${API_PREFIX}/courses/${courseId}`, {
      tags: { endpoint: 'course-details' },
    });

    recordPoolMetrics(courseRes, { scenario: 'high_concurrency' });

    check(courseRes, {
      'course status 200 or 404': (r) => r.status === 200 || r.status === 404,
      'course response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    sleep(1);
  });
}

export default function () {
  highConcurrencyScenario();
}