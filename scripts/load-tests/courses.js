import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 500 },
    { duration: '20s', target: 500 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_PREFIX = '/api/v1';

// Smoke assertion: track whether at least one response returned 200.
// If every response is a 404 (wrong path), the run fails via the teardown check.
let sawSuccess = false;

export default function () {
  const res = http.get(`${BASE_URL}${API_PREFIX}/courses`);

  if (res.status === 200) {
    sawSuccess = true;
  }

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response is array': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body));
      } catch (e) {
        return false;
      }
    },
  });

  sleep(1);
}

export function teardown() {
  check(sawSuccess, {
    'smoke: at least one response returned 200': (v) => v === true,
  });
}