/**
 * 공통 설정 파일
 * 모든 k6 테스트 스크립트에서 import하여 사용합니다.
 *
 * 사용법:
 *   import { BASE_URL, WS_URL, DEFAULT_HEADERS, thresholds } from './config.js';
 */

// ── 서버 주소 ───────────────────────────────────────────────────────────────
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
export const WS_URL   = __ENV.WS_URL   || 'ws://localhost:8080';

// ── 인증 ────────────────────────────────────────────────────────────────────
// 워크플로우 등록 API에 필요한 비밀번호 (환경변수로 주입 권장)
export const EDIT_PASSWORD = __ENV.EDIT_PASSWORD || 'admin';

// ── 기본 요청 헤더 ───────────────────────────────────────────────────────────
export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

// ── 엔드포인트 정의 ──────────────────────────────────────────────────────────
// setup/create-workflows.sh 로 등록한 테스트 전용 워크플로우
export const ENDPOINTS = {
  simple:   '/load-test/simple',    // NODE0 → NODE5 (최소 파이프라인)
  pipeline: '/load-test/pipeline',  // NODE0 → NODE1 → NODE2 → NODE5 (풀 파이프라인)
  ws:       '/load-test/ws',        // WebSocket 서버 path
};

// ── SLA 임계값 ───────────────────────────────────────────────────────────────
// 테스트 PASS/FAIL 기준 (필요에 따라 조정)
export const thresholds = {
  // HTTP 응답 시간 기준
  http_req_duration: [
    'p(50)<50',   // 중간값 50ms 이하
    'p(95)<200',  // 95%ile 200ms 이하
    'p(99)<500',  // 99%ile 500ms 이하
  ],
  // 에러율 기준 (0.1% 이하)
  http_req_failed: ['rate<0.001'],
};

// ── 스트레스 테스트용 임계값 (느슨한 기준) ──────────────────────────────────
export const stressThresholds = {
  http_req_duration: [
    'p(95)<1000',  // 스트레스 상황에서 95%ile 1초 이하
    'p(99)<2000',
  ],
  http_req_failed: ['rate<0.05'],  // 5% 이하 에러 허용
};

// ── 소크 테스트용 임계값 ─────────────────────────────────────────────────────
export const soakThresholds = {
  http_req_duration: [
    'p(95)<300',   // 장기 운영 중 95%ile 300ms 이하
    'p(99)<800',
  ],
  http_req_failed: ['rate<0.001'],
};

// ── 헬퍼: 랜덤 JSON 페이로드 생성 ───────────────────────────────────────────
export function makePayload(extra = {}) {
  return JSON.stringify({
    id:        Math.floor(Math.random() * 1000000),
    name:      `test-user-${Math.floor(Math.random() * 1000)}`,
    value:     Math.floor(Math.random() * 100),
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

// ── 헬퍼: 응답 체크 (k6 check 래퍼) ─────────────────────────────────────────
import { check } from 'k6';

export function assertOk(res, tag = '') {
  return check(res, {
    [`${tag} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${tag} body not empty`]: (r) => r.body && r.body.length > 0,
  });
}
