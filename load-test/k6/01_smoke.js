/**
 * [01] 스모크 테스트 (Smoke Test)
 * ────────────────────────────────
 * 목적: 배포 직후 "서버가 살아있는가?" 를 1~2분 안에 확인
 * 규모: 1 VU, 20회 요청
 * 기준: 에러 0, 응답시간 p99 < 500ms
 *
 * 실행:
 *   k6 run k6/01_smoke.js
 *   k6 run --env BASE_URL=http://192.168.1.10:8080 k6/01_smoke.js
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, DEFAULT_HEADERS, ENDPOINTS, makePayload, assertOk } from './config.js';

export const options = {
  vus:        1,       // 동시 사용자 수 (Virtual Users)
  iterations: 20,      // 총 실행 횟수
  thresholds: {
    http_req_duration: ['p(99)<500'],  // 99%ile 응답시간 500ms 이하
    http_req_failed:   ['rate==0'],    // 에러 0개
  },
};

export default function () {
  // ── 1. 최소 파이프라인 (NODE0 → NODE5) ──────────────────────────────────
  const r1 = http.post(
    `${BASE_URL}${ENDPOINTS.simple}`,
    makePayload(),
    { headers: DEFAULT_HEADERS, tags: { name: 'simple' } }
  );
  assertOk(r1, 'simple');

  sleep(0.1);

  // ── 2. 풀 파이프라인 (NODE0 → NODE1 → NODE2 → NODE5) ───────────────────
  const r2 = http.post(
    `${BASE_URL}${ENDPOINTS.pipeline}`,
    makePayload({ extra_field: 'hello' }),
    { headers: DEFAULT_HEADERS, tags: { name: 'pipeline' } }
  );
  assertOk(r2, 'pipeline');

  sleep(0.1);

  // ── 3. 모니터링 엔드포인트 ────────────────────────────────────────────────
  const r3 = http.get(
    `${BASE_URL}/synapse/monitor/status`,
    { tags: { name: 'monitor' } }
  );
  assertOk(r3, 'monitor');
}
