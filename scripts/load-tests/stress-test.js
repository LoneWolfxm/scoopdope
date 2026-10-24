import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * Stress Test - Find Breaking Points
 * Gradually increases load until system breaks
 */

export const options = {
  stages: [
    // Gradual ramp-up to find breaking point
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 1000 },
    { duration: '2m', target: 2000 },
    { duration: '2m', target: 5000 },
    // Ramp-down
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.2'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_PREFIX = '/api/v1';

// Smoke assertion: fail the test if no request ever returns 200 (e.g. wrong path -> all 404)
let successCount = 0;

export function handleSummary(data) {
  const smokeOk = successCount > 0;
  check(null, {
    'smoke: at least one response returned 200': () => smokeOk,
  });
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}

export default function () {
  group('Stress Test - API Endpoints', () => {
    // Mix of read and write operations
    const operations = [
      () => {
        // Read courses
        const res = http.get(`${BASE_URL}${API_PREFIX}/courses`, {
          tags: { operation: 'read' },
        });
        if (res.status === 200) successCount++;
        check(res, {
          'read status 200': (r) => r.status === 200,
        });
      },
      () => {
        // Get course details
        const courseId = Math.floor(Math.random() * 100) + 1;
        const res = http.get(`${BASE_URL}${API_PREFIX}/courses/${courseId}`, {
          tags: { operation: 'read' },
        });
        if (res.status === 200) successCount++;
        check(res, {
          'read status 200 or 404': (r) => r.status === 200 || r.status === 404,
        });
      },
      () => {
        // Health check
        const res = http.get(`${BASE_URL}/health`, {
          tags: { operation: 'health' },
        });
        if (res.status === 200) successCount++;
        check(res, {
          'health status 200': (r) => r.status === 200,
        });
      },
    ];

    // Randomly select operation
    const operation = operations[Math.floor(Math.random() * operations.length)];
    operation();

    sleep(Math.random() * 2);
  });
}
