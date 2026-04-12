/**
 * [06] Node2 JavaScript 실행 부하 테스트
 * ─────────────────────────────────────
 * 목적: GraalVM 스크립트 실행 엔진(JavaScriptExecutor)의 성능 한계 측정
 *
 * 이 테스트가 중요한 이유:
 *   - Node2는 사용자가 작성한 JS 코드를 GraalVM으로 실행 (매 요청마다)
 *   - ThreadLocal Context 재사용 구조 → 스레드 수 초과 시 대기 발생
 *   - 3초 타임아웃 → 복잡한 코드일수록 타임아웃 위험
 *   - sourceCache(ConcurrentHashMap) → 코드 종류가 많을수록 메모리 증가
 *
 * 테스트 시나리오:
 *   SCENARIO_SIMPLE  : 단순 연산 (빠름, 타임아웃 없음)
 *   SCENARIO_COMPLEX : 반복 연산 (느림, 타임아웃 경계 탐색)
 *
 * 전제 조건:
 *   lt-pipeline 워크플로우의 NODE2에 아래 JS 규칙이 등록되어 있어야 함
 *   (setup/create-workflows.sh 가 자동으로 설정)
 *
 * 실행:
 *   k6 run k6/06_node2_js.js
 *   k6 run --env SCENARIO=complex k6/06_node2_js.js
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, ENDPOINTS } from './config.js';

const jsExecDuration = new Trend('node2_js_exec_duration', true);
const timeoutRate    = new Rate('node2_timeout_rate');
const scriptErrors   = new Counter('node2_script_errors');

export const options = {
  scenarios: {
    // 시나리오 1: 단순 JS 연산 — 기준 성능 측정
    simple_js: {
      executor:       'ramping-vus',
      startVUs:       0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m',  target: 20 },
        { duration: '15s', target: 0  },
      ],
      env: { SCENARIO: 'simple' },
      tags: { scenario: 'simple_js' },
    },
    // 시나리오 2: 복잡한 JS 연산 — 타임아웃 경계 탐색 (시나리오1 종료 후 실행)
    complex_js: {
      executor:       'ramping-vus',
      startVUs:       0,
      startTime:      '2m',  // 시나리오1 끝난 후 시작
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m',  target: 10 },
        { duration: '15s', target: 0  },
      ],
      env: { SCENARIO: 'complex' },
      tags: { scenario: 'complex_js' },
    },
  },
  thresholds: {
    node2_js_exec_duration: [
      'p(95)<500',   // JS 실행 포함 전체 응답시간 500ms 이하
      'p(99)<1500',  // 99%ile 1.5초 (타임아웃 3초의 절반)
    ],
    node2_timeout_rate: ['rate<0.001'],  // 타임아웃 0.1% 이하
    node2_script_errors: ['count<5'],
  },
};

export default function () {
  const scenario = __ENV.SCENARIO || 'simple';

  // 시나리오에 따라 다른 복잡도의 페이로드 전송
  // (lt-pipeline NODE2에 등록된 JS가 value 필드를 기반으로 연산)
  const payload = scenario === 'simple'
    ? JSON.stringify({ id: __VU, name: 'test', value: 42 })
    : JSON.stringify({
        id:    __VU,
        name: 'heavy-test',
        value: 100,
        // 복잡한 변환을 트리거할 추가 필드
        items: Array.from({ length: 20 }, (_, i) => ({ idx: i, score: i * 3.14 })),
      });

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}${ENDPOINTS.pipeline}`,
    payload,
    {
      headers: DEFAULT_HEADERS,
      tags:    { name: `node2-${scenario}` },
      timeout: '10s',
    }
  );
  jsExecDuration.add(Date.now() - start);

  // 타임아웃 감지 (서버가 503 또는 500 + "시간 초과" 메시지 반환)
  const isTimeout = res.status === 503 ||
    (res.status === 500 && res.body && res.body.includes('시간 초과'));
  timeoutRate.add(isTimeout ? 1 : 0);

  const ok = check(res, {
    [`node2-${scenario}: status 200`]: (r) => r.status === 200,
  });
  if (!ok && !isTimeout) scriptErrors.add(1);

  sleep(0.1);
}
