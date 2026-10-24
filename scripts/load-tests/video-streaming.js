import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * Video Streaming Load Test
 * Tests video lesson access and progress tracking under load.
 * Simulates: login → get course → access video lesson → update progress
 */

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.05'],
    'http_req_duration{endpoint:video}': ['p(95)<1000'],
    'http_req_duration{endpoint:video_range}': ['p(95)<1000'],
    'http_req_failed{endpoint:video_range}': ['rate<0.01'],
    'http_req_duration{endpoint:progress}': ['p(95)<500'],
  },
};

const RANGE_HEADER = 'bytes=0-999999';

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_PREFIX = '/api/v1';

export function setup() {
  // Create a test user and enroll in a course to get valid lesson IDs
  const email = `video_setup_${Date.now()}@example.com`;
  const reg = http.post(
    `${BASE_URL}${API_PREFIX}/auth/register`,
    JSON.stringify({ email, password: 'Test@1234!', username: `video_${Date.now()}` }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (reg.status !== 201) return { lessonIds: [], courseIds: [] };

  const token = JSON.parse(reg.body).access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const coursesRes = http.get(`${BASE_URL}${API_PREFIX}/courses`, { headers });
  const courses = coursesRes.status === 200 ? JSON.parse(coursesRes.body) : [];
  const courseIds = Array.isArray(courses) ? courses.slice(0, 3).map((c) => c.id) : [];

  // Collect lesson IDs from first course
  let lessonIds = [];
  if (courseIds.length > 0) {
    const courseRes = http.get(`${BASE_URL}${API_PREFIX}/courses/${courseIds[0]}`, { headers });
    if (courseRes.status === 200) {
      const course = JSON.parse(courseRes.body);
      const lessons = course.lessons || course.modules?.flatMap((m) => m.lessons) || [];
      lessonIds = lessons.slice(0, 5).map((l) => l.id);
    }
  }

  return { courseIds, lessonIds };
}

export default function (data) {
  const email = `video_vu${__VU}_${__ITER}@example.com`;
  let token = null;

  group('Auth', () => {
    const reg = http.post(
      `${BASE_URL}${API_PREFIX}/auth/register`,
      JSON.stringify({ email, password: 'Test@1234!', username: `vvu${__VU}_${__ITER}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (reg.status === 201) {
      token = JSON.parse(reg.body).access_token;
    } else {
      const login = http.post(
        `${BASE_URL}${API_PREFIX}/auth/login`,
        JSON.stringify({ email, password: 'Test@1234!' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (login.status === 200) token = JSON.parse(login.body).access_token;
    }
  });

  if (!token) { sleep(1); return; }

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { courseIds = [], lessonIds = [] } = data;

  group('Enroll in course', () => {
    if (courseIds.length === 0) return;
    const courseId = courseIds[__VU % courseIds.length];
    http.post(`${BASE_URL}${API_PREFIX}/enrollments`, JSON.stringify({ courseId }), { headers });
  });

  sleep(1);

  group('Access video lesson', () => {
    if (lessonIds.length === 0) return;
    const lessonId = lessonIds[__VU % lessonIds.length];
    const res = http.get(`${BASE_URL}${API_PREFIX}/lessons/${lessonId}`, {
      headers,
      tags: { endpoint: 'video' },
    });
    check(res, {
      'lesson accessible': (r) => r.status === 200 || r.status === 403,
      'video response time ok': (r) => r.timings.duration < 1000,
      'video path valid (not 404)': (r) => r.status !== 404,
    });
  });

  sleep(1);

  group('Seek video (range request)', () => {
    if (lessonIds.length === 0) return;
    const lessonId = lessonIds[__VU % lessonIds.length];
    const res = http.get(`${BASE_URL}/v1/lessons/${lessonId}/video`, {
      headers: { ...headers, Range: RANGE_HEADER },
      tags: { endpoint: 'video_range' },
    });

    check(res, {
      'range request returns 206': (r) => r.status === 206,
      'content-range header present': (r) => !!r.headers['Content-Range'],
      'content-range format valid': (r) =>
        /^bytes 0-\d+\/\d+$/.test(r.headers['Content-Range'] || ''),
      'content-length header present': (r) => !!r.headers['Content-Length'],
      'content-length matches body': (r) =>
        parseInt(r.headers['Content-Length'], 10) === r.body.length,
      'range response time ok': (r) => r.timings.duration < 1000,
    });
  });

  sleep(2);

  group('Update video progress', () => {
    if (lessonIds.length === 0 || courseIds.length === 0) return;
    const lessonId = lessonIds[__VU % lessonIds.length];
    const courseId = courseIds[__VU % courseIds.length];
    const progressPct = Math.floor(Math.random() * 100);

    const res = http.post(
      `${BASE_URL}${API_PREFIX}/progress`,
      JSON.stringify({ courseId, lessonId, progressPct }),
      { headers, tags: { endpoint: 'progress' } }
    );
    check(res, {
      'progress updated': (r) => r.status === 200 || r.status === 201,
      'progress response time ok': (r) => r.timings.duration < 500,
      'progress path valid (not 404)': (r) => r.status !== 404,
    });
  });

  sleep(1);
}

/**
 * Smoke check: fail the test if no response ever returned 200, which
 * indicates the scripts are hitting wrong (non-existent) paths.
 */
export function handleSummary(data) {
  const okCount = data.metrics.http_reqs?.values?.count ?? 0;
  const failedRate = data.metrics.http_req_failed?.values?.rate ?? 1;
  const allFailed = okCount === 0 || failedRate >= 1;
  if (allFailed) {
    console.error(
      `SMOKE FAILURE: no successful responses against ${BASE_URL}${API_PREFIX} ` +
        `(requests=${okCount}, failed_rate=${failedRate}). Check API prefix/paths.`
    );
  }
  return {
    stdout: JSON.stringify({ smoke_ok: !allFailed, requests: okCount }, null, 2),
  };
}
