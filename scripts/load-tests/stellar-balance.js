import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 50 },
    { duration: '20s', target: 50 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_PREFIX = '/api/v1';

// Sample Stellar public keys for testing
const STELLAR_KEYS = [
  'GBRPYHIL2CI3WHZDTOOQFC6EB4PSQJNPPQYY3YVKNQHTUNQHTOG3XEU',
  'GBBD47UZQ5SYWV4XQJWAPLHAB2METXIGQ7YNXZKYCW3XYVZY7XNBGUQ',
  'GCZST3XVCDTUJ76ZAV2HA72KYQJWKH6HOCF7FCCQP5XJJG2HDPPTDL7',
];

// Smoke assertion: track whether at least one response returned 200
let sawSuccess = false;

export default function () {
  const randomKey = STELLAR_KEYS[Math.floor(Math.random() * STELLAR_KEYS.length)];
  const res = http.get(`${BASE_URL}${API_PREFIX}/stellar/balance/${randomKey}`);

  if (res.status === 200) {
    sawSuccess = true;
  }

  check(res, {
    'status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response is valid': (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}

export function teardown() {
  check(sawSuccess, {
    'at least one response returned 200': (v) => v === true,
  });
}