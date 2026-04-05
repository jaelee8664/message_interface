# 개발 사항
* 특정 워크플로우를 직접 다시 메뉴얼하게 실행시키는 기능
* Dead Letter 재처리 기능(?) 메뉴얼 방법과 겹치지 않나?
  구현된 내용
  Backend

파일	역할
DeadLetterEntry.kt	Dead letter 데이터 클래스 (id, traceId, rawBytesBase64 등)
DeadLetterStore.kt	비동기 파일 쓰기 (dead-letters/dead_YYYY-MM-DD.jsonl), 인메모리 최근 1000건 유지
MessagePipeline.kt	catch 블록에서 deadLetterStore.save() 호출 — NODE5 응답 여부 무관하게 항상 저장
LogRetentionScheduler.kt	매일 새벽 3시 deadLetterStore.runRetention() 실행
DeadLetterController.kt	GET /synapse/dead-letters?days=7&limit=200&fromFiles=false
reference.yaml	deadLetter.enabled / retentionDays(30) / directory 설정 추가
Frontend

파일	역할
DeadLetterPage.tsx	/dead-letters 페이지, 항목 클릭 시 원본 메세지 + 에러 상세 펼치기
App.tsx	네비에 "데드레터" 탭 추가 (빨간색으로 구분)
  {
  "id": "uuid",
  "traceId": "...",
  "workflowUnitId": "...",
  "workflowUnitName": "주문 처리",
  "protocol": "REST_SERVER",
  "endpoint": "/api/order",
  "metadata": { "channelId": "..." },
  "rawBytesBase64": "eyJvcmRlci...",
  "failedNodeType": "NODE2",
  "errorMessage": "Script timeout",
  "timestamp": "2026-04-06T..."
  }
  나중에 재처리 기능 만들 때 id + rawBytesBase64 + protocol + metadata로 충분히 replay 가능하게 설계됨.
* 메세지 입력 시 테스트 가능한 기능
* 부하테스트 기능

# 규칙
수정후 MANUAL.md에 반영해야 할게 있다면 반영해줘