/**
 * [04] 소크 테스트 (Soak Test)
 * ──────────────────────────────
 * 목적: "장기 운영 시 메모리 누수·성능 저하가 발생하는가?"
 * 시나리오: 중간 부하를 30분~1시간 유지
 *   - 응답시간이 시간이 지남에 따라 점점 느려지면 → 메모리 누수 또는 GC 압박 의심
 *   - GraalVM 스크립트 캐시(sourceCache) 가 무한히 커지는지 확인
 *   - 로그 파일 크기가 retention 정책대로 관리되는지 확인
 *
 * 주목할 것:
 *   - 10분 단위로 p95 응답시간 추이
 *   - 에러율이 점차 증가하는가?
 *   - /synapse/monitor/status 에서 successCount 꾸준히 증가 중인가?
 *
 * 실행 (기본 30분):
 *   k6 run k6/04_soak.js
 *
 * 실행 (1시간으로 늘리기):
 *   k6 run --env SOAK_DURATION=1h k6/04_soak.js
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, ENDPOINTS, makePayload, soakThresholds } from './config.js';

const soakDuration = __ENV.SOAK_DURATION || '30m';

// 시간 구간별 성능 추이를 보기 위한 커스텀 메트릭
const latencyTrend = new Trend('soak_latency', true);
const errorCounter = new Counter('soak_errors');

export const options = {
  stages: [
    { duration: '2m',          target: 20 },  // ramp-up
    { duration: soakDuration,  target: 20 },  // 장기 부하 유지
    { duration: '2m',          target: 0  },  // ramp-down
  ],
  thresholds: soakThresholds,
};

export default function () {
  // 두 엔드포인트를 번갈아 테스트 (다양한 파이프라인 경로)
  const useSimple = __ITER % 3 !== 0;  // 2/3 simple, 1/3 pipeline
  const endpoint  = useSimple ? ENDPOINTS.simple : ENDPOINTS.pipeline;
  const payload   = makePayload(useSimple ? {} : { extra_field: 'soak' });

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}${endpoint}`,
    payload,
    { headers: DEFAULT_HEADERS, tags: { name: useSimple ? 'soak-simple' : 'soak-pipeline' } }
  );
  latencyTrend.add(Date.now() - start);

  const ok = check(res, {
    'soak: status 200': (r) => r.status === 200,
  });
  if (!ok) errorCounter.add(1);

  // 소크 중 주기적으로 모니터링 데이터 수집
  if (__ITER % 500 === 0) {
    http.get(`${BASE_URL}/synapse/monitor/status`, { tags: { name: 'soak-monitor' } });
  }

  sleep(0.2 + Math.random() * 0.3);
}
