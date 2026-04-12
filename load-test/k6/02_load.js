/**
 * [02] 부하 테스트 (Load Test)
 * ────────────────────────────
 * 목적: "평소 예상 트래픽에서 시스템이 SLA를 지키는가?"
 * 시나리오:
 *   0→30 VU (30초 ramp-up)
 *   30 VU 유지 (3분)
 *   30→0 VU (30초 ramp-down)
 * 총 시간: ~4분
 *
 * 추적 지표:
 *   - Throughput: 초당 처리량 (http_reqs)
 *   - Latency: p50, p95, p99 응답시간
 *   - Error rate: 에러 비율
 *
 * 실행:
 *   k6 run k6/02_load.js
 *   k6 run --out json=results/load-$(date +%Y%m%d_%H%M%S).json k6/02_load.js
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, ENDPOINTS, makePayload, thresholds } from './config.js';

// ── 커스텀 메트릭 ─────────────────────────────────────────────────────────────
// 파이프라인별 응답시간을 따로 추적 (k6 기본 메트릭은 전체 합산)
const simpleDuration   = new Trend('simple_pipeline_duration',   true);
const pipelineDuration = new Trend('full_pipeline_duration',     true);
const errorCount       = new Counter('pipeline_errors');

export const options = {
  stages: [
    { duration: '30s', target: 30 },  // ramp-up
    { duration: '3m',  target: 30 },  // 부하 유지
    { duration: '30s', target: 0  },  // ramp-down
  ],
  thresholds: {
    ...thresholds,
    // 파이프라인별 개별 SLA
    simple_pipeline_duration:   ['p(95)<100', 'p(99)<200'],
    full_pipeline_duration:     ['p(95)<300', 'p(99)<600'],
  },
};

export default function () {
  const rand = Math.random();

  if (rand < 0.6) {
    // 60%: 최소 파이프라인 (가장 빠른 경로)
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}${ENDPOINTS.simple}`,
      makePayload(),
      { headers: DEFAULT_HEADERS, tags: { name: 'simple' } }
    );
    simpleDuration.add(Date.now() - start);

    const ok = check(res, {
      'simple: status 200': (r) => r.status === 200,
      'simple: body exists': (r) => r.body.length > 0,
    });
    if (!ok) errorCount.add(1);

  } else {
    // 40%: 풀 파이프라인 (NODE1 → NODE2 거침)
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}${ENDPOINTS.pipeline}`,
      makePayload({ extra_field: 'transform-me' }),
      { headers: DEFAULT_HEADERS, tags: { name: 'pipeline' } }
    );
    pipelineDuration.add(Date.now() - start);

    const ok = check(res, {
      'pipeline: status 200': (r) => r.status === 200,
      'pipeline: body exists': (r) => r.body.length > 0,
    });
    if (!ok) errorCount.add(1);
  }

  // 사용자 요청 간격 (0.1~0.3초 랜덤) — 실제 사용자 행동 모사
  sleep(0.1 + Math.random() * 0.2);
}
