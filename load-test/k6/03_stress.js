/**
 * [03] 스트레스 테스트 (Stress Test)
 * ────────────────────────────────────
 * 목적: "시스템이 어디서 무너지는가? — 한계점(breaking point) 탐색"
 * 시나리오: VU를 단계적으로 올려가며 에러율/응답시간 급증 지점을 찾음
 *   0→50 VU (1분)  → 정상 범위 탐색
 *   50→100 VU (1분) → 부하 증가
 *   100→200 VU (1분) → 고부하
 *   200→300 VU (1분) → 임계 근처
 *   300→0 VU (1분)  → 복구 확인 (복구 안 되면 메모리 누수 의심)
 *
 * 주목할 것:
 *   - 어느 VU 수준에서 p99가 급증하는가?
 *   - 에러율이 치솟는 VU 구간은?
 *   - ramp-down 후 정상으로 돌아오는가? (돌아오지 않으면 자원 누수)
 *
 * 실행:
 *   k6 run k6/03_stress.js
 *   k6 run --out json=results/stress-$(date +%Y%m%d_%H%M%S).json k6/03_stress.js
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, ENDPOINTS, makePayload, stressThresholds } from './config.js';

// 에러율 추적 (Rate 메트릭: 0.0~1.0 비율)
const errorRate = new Rate('error_rate');
// 응답시간 추적 (Trend: 히스토그램)
const reqDuration = new Trend('req_duration_stress', true);

export const options = {
  stages: [
    { duration: '1m', target: 50  },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 300 },
    { duration: '1m', target: 0   },  // 복구 확인
  ],
  thresholds: stressThresholds,
};

export default function () {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}${ENDPOINTS.simple}`,
    makePayload(),
    {
      headers: DEFAULT_HEADERS,
      tags: { name: 'stress' },
      timeout: '10s',  // 스트레스 중엔 타임아웃을 넉넉히
    }
  );
  reqDuration.add(Date.now() - start);

  const success = check(res, {
    'status 2xx': (r) => r.status >= 200 && r.status < 300,
  });
  errorRate.add(!success);

  sleep(0.05);  // 스트레스 테스트는 짧은 간격
}
