#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# 부하테스트용 워크플로우 등록 스크립트
#
# 실행 전 확인사항:
#   1. message-interface 서버가 실행 중인지 확인 (포트 8080)
#   2. WORKFLOW_EDIT_PASSWORD 환경변수 확인 (기본값: admin)
#
# 사용법:
#   bash setup/create-workflows.sh
#   BASE_URL=http://192.168.1.10:8080 bash setup/create-workflows.sh
#   PASSWORD=mypass bash setup/create-workflows.sh
# ─────────────────────────────────────────────────────────────────

set -e

BASE_URL="${BASE_URL:-http://localhost:8080}"
PASSWORD="${PASSWORD:-admin}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOWS_DIR="$SCRIPT_DIR/workflows"

echo "==================================================="
echo "  부하테스트 워크플로우 등록"
echo "  서버: $BASE_URL"
echo "==================================================="

# 서버 연결 확인
echo ""
echo "[0/3] 서버 연결 확인..."
if ! curl -sf "$BASE_URL/actuator/health" > /dev/null 2>&1; then
  echo "  ✗ 서버에 연결할 수 없습니다: $BASE_URL"
  echo "  → message-interface 서버를 먼저 실행해주세요."
  exit 1
fi
echo "  ✓ 서버 연결 확인 완료"

# 비밀번호 치환 후 워크플로우 등록 함수
register_workflow() {
  local name="$1"
  local file="$2"
  local display="$3"

  echo ""
  echo "[$name] $display 등록 중..."

  # PASSWORD 환경변수로 치환
  local payload
  payload=$(cat "$file" | sed "s/\"admin\"/\"${PASSWORD}\"/g")

  local response
  response=$(curl -sf -X POST "$BASE_URL/synapse/workflow/units" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1)

  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "  ✗ 등록 실패 (HTTP 오류)"
    echo "  응답: $response"
    echo ""
    echo "  ⚠️  이미 등록된 워크플로우가 있거나 조건이 충돌할 수 있습니다."
    echo "     먼저 delete-workflows.sh 를 실행하거나 UI에서 삭제 후 다시 시도하세요."
    return 1
  fi

  # 응답에서 성공 여부 확인
  if echo "$response" | grep -q '"success":true'; then
    echo "  ✓ 등록 완료"
  else
    echo "  ✗ 등록 실패"
    echo "  응답: $response"
    return 1
  fi
}

# 워크플로우 등록
register_workflow "1/3" "$WORKFLOWS_DIR/lt-simple.json"   "[부하테스트] 최소 파이프라인"
register_workflow "2/3" "$WORKFLOWS_DIR/lt-pipeline.json" "[부하테스트] 풀 파이프라인"
register_workflow "3/3" "$WORKFLOWS_DIR/lt-websocket.json" "[부하테스트] WebSocket 서버"

echo ""
echo "==================================================="
echo "  ✓ 모든 워크플로우 등록 완료"
echo ""
echo "  등록된 엔드포인트:"
echo "    POST $BASE_URL/load-test/simple    (최소 파이프라인)"
echo "    POST $BASE_URL/load-test/pipeline  (풀 파이프라인)"
echo "    WS   $BASE_URL/load-test/ws        (WebSocket)"
echo ""
echo "  테스트 실행:"
echo "    k6 run k6/01_smoke.js"
echo "==================================================="
