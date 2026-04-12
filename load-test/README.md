# Message Interface 부하 테스트 가이드

이 폴더는 `message-interface` 모듈의 성능과 안정성을 측정하기 위한 부하 테스트 도구 모음입니다.  
**메인 프로젝트와 완전히 분리**되어 있으며 독립적으로 실행할 수 있습니다.

---

## 목차

1. [부하 테스트에서 중요한 지표](#1-부하-테스트에서-중요한-지표)
2. [테스트 종류별 목적](#2-테스트-종류별-목적)
3. [폴더 구조](#3-폴더-구조)
4. [빠른 시작](#4-빠른-시작)
5. [각 테스트 상세 설명](#5-각-테스트-상세-설명)
6. [결과 해석 방법](#6-결과-해석-방법)
7. [이 모듈 특화 주의사항](#7-이-모듈-특화-주의사항)

---

## 1. 부하 테스트에서 중요한 지표

### 1-1. 지연 시간 (Latency) — 가장 중요

| 지표 | 설명 | 이 모듈 권장 기준 |
|------|------|----------------|
| **p50** (중간값) | 요청의 50%가 이 시간 이내에 완료 | < 50ms |
| **p95** | 요청의 95%가 이 시간 이내에 완료 | < 200ms |
| **p99** | 요청의 99%가 이 시간 이내에 완료 | < 500ms |
| **최대값 (max)** | 가장 느린 요청 한 건 | 참고용 (이상값 제거 후 판단) |

> **왜 p50만 보면 안 되는가?**  
> 평균이나 중간값이 좋아도 p99가 10초라면, 100명 중 1명은 10초를 기다린다는 뜻입니다.  
> 실제 서비스에서는 p95~p99를 기준으로 SLA를 정하는 것이 일반적입니다.

### 1-2. 처리량 (Throughput)

| 지표 | 설명 |
|------|------|
| **RPS** (Requests Per Second) | 초당 처리 요청 수 |
| **메시지/초** | TCP·WebSocket 전용 |

RPS가 높을수록 좋지만, 동시에 지연 시간이 증가하면 의미가 없습니다.  
**목표: 지연 시간 SLA를 지키면서 달성 가능한 최대 RPS**

### 1-3. 에러율 (Error Rate)

| 기준 | 의미 |
|------|------|
| 0% | 이상적 (스모크·부하 테스트 목표) |
| < 0.1% | 허용 가능 (일반 운영) |
| < 1% | 경계 상태 (모니터링 강화 필요) |
| ≥ 5% | 위험 (즉시 조치 필요) |

### 1-4. 이 모듈 특화 지표

| 지표 | 측정 위치 | 의미 |
|------|----------|------|
| **Node2 JS 실행 시간** | `06_node2_js.js` | GraalVM 스크립트 실행 오버헤드 |
| **Node2 타임아웃율** | `node2_timeout_rate` | 3초 제한 초과 비율 → 코드 최적화 필요 신호 |
| **Dead Letter 누적** | `/synapse/monitor/status` | 처리 실패 메시지 (재처리 필요) |
| **WebSocket 세션 수** | `webSocketServer` 필드 | 동시 연결 한계 |
| **파이프라인 성공/실패 비율** | `pipelineStats` | 워크플로우 단위별 성능 |

---

## 2. 테스트 종류별 목적

```
스모크 테스트 → 부하 테스트 → 스트레스 테스트 → 소크 테스트
(배포 직후)    (정상 운영)    (한계 탐색)      (장기 안정성)
```

| 테스트 | 파일 | VU 수 | 시간 | 목적 |
|--------|------|--------|------|------|
| **스모크** | `01_smoke.js` | 1 | 2분 | "서버 살아있나?" — 배포 후 즉시 실행 |
| **부하** | `02_load.js` | 30 | 4분 | "정상 부하에서 SLA를 지키나?" |
| **스트레스** | `03_stress.js` | 300까지 | 5분 | "어디서 무너지나?" — 한계점 탐색 |
| **소크** | `04_soak.js` | 20 | 30분+ | "오래 켜두면 메모리 누수가 생기나?" |
| **WebSocket** | `05_websocket.js` | 50 | 2분 | "다수 WS 연결이 안정적인가?" |
| **Node2 JS** | `06_node2_js.js` | 20 | 4분 | "JS 실행 엔진이 고부하에서 안정적인가?" |
| **TCP** | `tcp/tcp-load.js` | 10~100 | 자유 | "TCP 서버가 다수 연결을 처리할 수 있나?" |

---

## 3. 폴더 구조

```
load-test/
├── README.md                        ← 이 파일
├── k6/
│   ├── config.js                    ← 공통 설정 (BASE_URL, 임계값 등)
│   ├── 01_smoke.js                  ← 스모크 테스트
│   ├── 02_load.js                   ← 부하 테스트
│   ├── 03_stress.js                 ← 스트레스 테스트
│   ├── 04_soak.js                   ← 소크 테스트
│   ├── 05_websocket.js              ← WebSocket 부하 테스트
│   └── 06_node2_js.js               ← Node2 JS 실행 부하 테스트
├── tcp/
│   ├── package.json
│   └── tcp-load.js                  ← TCP 부하 테스트 (Node.js)
├── setup/
│   ├── create-workflows.ps1         ← 테스트 워크플로우 등록 (Windows PowerShell)
│   ├── delete-workflows.ps1         ← 테스트 워크플로우 삭제 (Windows PowerShell)
│   ├── create-workflows.sh          ← 테스트 워크플로우 등록 (Linux/Mac)
│   ├── delete-workflows.sh          ← 테스트 워크플로우 삭제 (Linux/Mac)
│   └── workflows/
│       ├── lt-simple.json           ← 최소 파이프라인 워크플로우
│       ├── lt-pipeline.json         ← 풀 파이프라인 워크플로우 (NODE1→NODE2 포함)
│       └── lt-websocket.json        ← WebSocket 서버 워크플로우
└── results/                         ← 테스트 결과 JSON 저장 (gitignore 권장)
```

---

## 4. 빠른 시작

### 4-1. k6 설치

```bash
# Windows (winget)
winget install k6

# 또는 공식 사이트에서 다운로드
# https://grafana.com/docs/k6/latest/set-up/install-k6/
```

설치 확인:
```bash
k6 version
```

### 4-2. 서버 시작

```bash
# 프로젝트 루트에서
./gradlew bootRun
```

### 4-3. 테스트 워크플로우 등록

**Windows (PowerShell) — 권장**
```powershell
# load-test 폴더에서 실행
cd load-test
.\setup\create-workflows.ps1

# 처음 실행 시 실행 정책 오류가 나면 한 번만 실행
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# 비밀번호가 다른 경우
.\setup\create-workflows.ps1 -Password mypass

# 다른 서버 주소
.\setup\create-workflows.ps1 -BaseUrl http://192.168.1.10:8080
```

**Linux / Mac**
```bash
bash setup/create-workflows.sh
PASSWORD=mypass bash setup/create-workflows.sh
```

### 4-4. 테스트 실행

```bash
# 스모크 테스트 (가장 먼저 실행 — 2분)
k6 run k6/01_smoke.js

# 부하 테스트 (4분)
k6 run k6/02_load.js

# 결과를 JSON 파일로 저장
k6 run --out json=results/load-result.json k6/02_load.js
```

### 4-5. TCP 테스트 실행 (Node.js)

```bash
cd tcp
node tcp-load.js
node tcp-load.js --host localhost --port 9090 --vus 20 --duration 60
```

### 4-6. 테스트 워크플로우 삭제 (완료 후)

**Windows (PowerShell)**
```powershell
.\setup\delete-workflows.ps1
```

**Linux / Mac**
```bash
bash setup/delete-workflows.sh
```

---

## 5. 각 테스트 상세 설명

### [01] 스모크 테스트

```bash
k6 run k6/01_smoke.js
```

- **언제 실행?** 서버 배포 직후, 테스트 환경 초기화 후
- **VU**: 1, **요청 수**: 20회
- **통과 기준**: 에러 0개, p99 < 500ms
- **실패 시 의미**: 서버가 기본 동작조차 못 하는 상태

---

### [02] 부하 테스트

```bash
k6 run k6/02_load.js

# 다른 서버 주소로
k6 run --env BASE_URL=http://192.168.1.10:8080 k6/02_load.js
```

- **VU 패턴**: 0→30 (30초) → 유지 3분 → 0 (30초)
- **트래픽 구성**: 최소 파이프라인 60%, 풀 파이프라인 40%
- **통과 기준**:
  - 최소 파이프라인: p95 < 100ms
  - 풀 파이프라인: p95 < 300ms

---

### [03] 스트레스 테스트

```bash
k6 run k6/03_stress.js
```

- **VU 패턴**: 0→50→100→200→300→0 (각 1분)
- **주목할 점**: 어느 VU 단계에서 에러율이 급증하는가?
- **ramp-down 후 회복 확인**: 300→0 구간에서 에러율이 다시 0으로 떨어져야 정상

---

### [04] 소크 테스트

```bash
# 기본 30분
k6 run k6/04_soak.js

# 1시간으로 늘리기
k6 run --env SOAK_DURATION=1h k6/04_soak.js
```

- **VU**: 20 (중간 부하)
- **핵심 확인**: 30분 뒤 p95가 초반 대비 많이 증가했는가?
  - 증가폭 < 20%: 정상
  - 증가폭 > 50%: 메모리 누수 또는 GC 압박 의심

**모니터링과 함께 실행 권장:**
```bash
# 별도 터미널에서 30초마다 상태 확인 (Linux/Mac/WSL)
watch -n 30 'curl -s http://localhost:8080/synapse/monitor/status | python -m json.tool'
```

```powershell
# Windows PowerShell (curl.exe 명시 — PowerShell에서 curl은 Invoke-WebRequest 별칭이므로 .exe 필요)
while ($true) {
    Clear-Host
    curl.exe -s http://localhost:8080/synapse/monitor/status | python -m json.tool
    Start-Sleep 30
}
```

---

### [05] WebSocket 부하 테스트

```bash
k6 run k6/05_websocket.js
```

- **VU**: 최대 50 (동시 WS 연결)
- **전제**: `lt-websocket` 워크플로우 등록 필요

---

### [06] Node2 JavaScript 실행 부하 테스트

```bash
# 두 시나리오 동시 실행 (기본)
k6 run k6/06_node2_js.js
```

**이 테스트가 특히 중요한 이유:**

이 모듈의 Node2는 GraalVM Polyglot(JavaScript)으로 사용자 스크립트를 실행합니다.

- `ThreadLocal Context` 방식 → JVM 스레드 수가 VU의 병렬 처리 한계
- `sourceCache`(ConcurrentHashMap) → 스크립트 코드가 다양할수록 메모리 증가
- 3초 타임아웃 → 복잡한 연산이나 반복문은 타임아웃 위험

**통과 기준:**
- p95 응답시간 < 500ms
- 타임아웃율 < 0.1%

---

### [TCP] TCP 부하 테스트

```bash
cd tcp

# 스모크
node tcp-load.js --vus 2 --duration 10

# 부하
node tcp-load.js --vus 20 --duration 60

# 스트레스
node tcp-load.js --vus 100 --duration 120
```

**주의:** TCP 프레이밍 방식을 확인하세요.  
현재 스크립트는 4바이트 big-endian 길이 접두사를 사용합니다.  
서버의 `RawTcpInboundHandler`가 다른 방식(예: 개행 구분)을 사용한다면  
`tcp-load.js`의 `makePayload()` 함수를 수정해야 합니다.

---

## 6. 결과 해석 방법

### k6 출력 예시

```
     ✓ simple: status 200
     ✓ pipeline: status 200

     checks.........................: 100.00% ✓ 1800 ✗ 0
     data_received..................: 420 kB  1.7 kB/s
     data_sent......................: 310 kB  1.3 kB/s
     http_req_duration..............: avg=45ms   min=12ms   med=38ms  max=890ms  p(90)=89ms  p(95)=120ms
     http_req_failed................: 0.00%   ✓ 0 ✗ 900
     http_reqs......................: 900     3.7/s
     vus............................: 30      min=0      max=30
```

| 항목 | 읽는 법 |
|------|---------|
| `checks` | PASS/FAIL 판정 비율. 100% 목표 |
| `http_req_duration p(95)` | **핵심**: 가장 먼저 확인. SLA 기준과 비교 |
| `http_req_failed` | 에러율. 0%에 가까울수록 좋음 |
| `http_reqs` | 초당 처리량 (RPS) |
| `vus` | 현재 활성 VU 수 |

### 결과를 JSON으로 저장하고 비교

```bash
# 저장
k6 run --out json=results/load-$(date +%Y%m%d_%H%M%S).json k6/02_load.js

# 두 결과 비교 (간단한 방법)
cat results/load-20240101_120000.json | python -c "
import sys, json
lines = [json.loads(l) for l in sys.stdin if '\"metric\":\"http_req_duration\"' in l]
vals = [l['data']['value'] for l in lines if l.get('type') == 'Point']
vals.sort()
n = len(vals)
print(f'p50={vals[n//2]:.0f}ms p95={vals[int(n*0.95)]:.0f}ms p99={vals[int(n*0.99)]:.0f}ms')
"
```

---

## 7. 이 모듈 특화 주의사항

### 7-1. 테스트 실행 순서 권장

```
스모크 → 부하 → (필요시) Node2 JS → (필요시) 스트레스 → (장기 계획) 소크
```

스트레스 테스트는 서버에 큰 부하를 주므로, **개발 환경**에서 먼저 실행하세요.

### 7-2. Dead Letter 모니터링

테스트 중 Dead Letter가 쌓이면 처리 실패가 발생한 것입니다:

```bash
# 테스트 중 Dead Letter 수 확인
curl http://localhost:8080/synapse/dead-letters
```

### 7-3. 모니터링 API 활용

```bash
# 파이프라인별 성공/실패 통계 (최근 60분)
curl "http://localhost:8080/synapse/monitor/status?windowMinutes=60" | python -m json.tool
```

`pipelineStats` 배열에서 각 워크플로우 단위별 `successCount` / `errorCount`를 확인합니다.

### 7-4. JVM 메모리 확인 (소크 테스트 중)

```bash
# Spring Boot Actuator (이미 활성화됨)
curl http://localhost:8080/actuator/health

# JVM 상세 메트릭을 보려면 application.yaml에 추가:
# management.endpoints.web.exposure.include: health,info,metrics,jvm
# 이후: curl http://localhost:8080/actuator/metrics/jvm.memory.used
```

### 7-5. GraalVM 스레드 주의

Node2 JS 실행 엔진은 `ThreadLocal`로 GraalVM Context를 재사용합니다.  
스레드 수를 초과하는 동시 JS 실행 요청은 대기열이 형성됩니다.  
Spring WebFlux의 스케줄러 스레드 수 = WebFlux 설정 또는 JVM 프로세서 수에 의존합니다.

**스트레스 테스트에서 Node2가 병목이 되는 신호:**
- `full_pipeline_duration p(95)` 가 `simple_pipeline_duration p(95)` 대비 5배 이상 높을 때
- 타임아웃율(`node2_timeout_rate`)이 상승할 때
