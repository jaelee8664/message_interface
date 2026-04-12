#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# 부하테스트용 워크플로우 삭제 스크립트
#
# 사용법:
#   bash setup/delete-workflows.sh
#   BASE_URL=http://192.168.1.10:8080 bash setup/delete-workflows.sh
# ─────────────────────────────────────────────────────────────────

set -e

BASE_URL="${BASE_URL:-http://localhost:8080}"
PASSWORD="${PASSWORD:-admin}"

echo "==================================================="
echo "  부하테스트 워크플로우 삭제"
echo "  서버: $BASE_URL"
echo "==================================================="

delete_workflow() {
  local unit_id="$1"
  local display="$2"

  echo ""
  echo "  [$unit_id] $display 삭제 중..."

  local response
  response=$(curl -sf -X DELETE "$BASE_URL/synapse/workflow/units" \
    -H "Content-Type: application/json" \
    -d "{\"unitId\":\"$unit_id\",\"modifiedBy\":\"load-test-cleanup\",\"password\":\"$PASSWORD\"}" 2>&1)

  if echo "$response" | grep -q '"success":true'; then
    echo "  ✓ 삭제 완료"
  else
    echo "  ⚠️  삭제 실패 또는 이미 없음: $response"
  fi
}

delete_workflow "lt-simple"   "[부하테스트] 최소 파이프라인"
delete_workflow "lt-pipeline" "[부하테스트] 풀 파이프라인"
delete_workflow "lt-websocket" "[부하테스트] WebSocket 서버"

echo ""
echo "==================================================="
echo "  ✓ 삭제 완료"
echo "==================================================="
