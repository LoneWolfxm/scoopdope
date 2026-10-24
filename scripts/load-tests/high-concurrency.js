import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * High Concurrency Load Test
 * Tests system with 1000 and 10000 concurrent users
 */

export const options = {
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
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.1'],
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

export default function () {
  group('High Concurrency - Read Heavy', () => {
    // Simulate read-heavy workload
    const coursesRes = http.get(`${BASE_URL}${API_PREFIX}/courses?page=${Math.floor(Math.random() * 10)}&limit=20`, {
      tags: { endpoint: 'courses' },
    });

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

    check(courseRes, {
      'course status 200 or 404': (r) => r.status === 200 || r.status === 404,
      'course response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    sleep(1);
  });
}
