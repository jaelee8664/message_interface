# Message Interface 구현 메뉴얼

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [메시지 포맷](#2-메시지-포맷)
3. [워크플로우 구조](#3-워크플로우-구조)
4. [Node0 — 메시지 수신](#4-node0--메시지-수신)
5. [Node1 — 입력 DTO 파싱/검증](#5-node1--입력-dto-파싱검증)
6. [Node2 — 값 변환](#6-node2--값-변환)
7. [Node3 — 출력 DTO 매핑](#7-node3--출력-dto-매핑)
8. [Node4 — 메시지 송신](#8-node4--메시지-송신)
9. [Node5 — 응답 설정](#9-node5--응답-설정)
10. [파이프라인 실행 흐름](#10-파이프라인-실행-흐름)
11. [워크플로우 조건 시스템](#11-워크플로우-조건-시스템)
12. [로그 시스템](#12-로그-시스템)
13. [히스토리/롤백](#13-히스토리롤백)
14. [저장소](#14-저장소)
15. [REST API](#15-rest-api)
16. [프론트엔드 페이지](#16-프론트엔드-페이지)
17. [보안](#17-보안)
18. [배포 — Windows 서비스](#18-배포--windows-서비스)

---

## 1. 시스템 개요

외부 시스템에서 메시지를 수신하여 6개의 노드를 통해 변환·라우팅하는 **상태 없는(stateless), 설정 기반 미들웨어**이다.

| 항목 | 내용 |
|------|------|
| 백엔드 | Kotlin Spring Boot WebFlux (포트 8080) |
| 프론트엔드 | React + TypeScript + React Flow (개발 포트 3000) |
| 패키지 | `com.synapse.message_interface` |
| 빌드 출력 | `frontend/` → `src/main/resources/static/` |

**검증 파일:** `src/main/resources/application.yaml`

---

## 2. 메시지 포맷

지원하는 메시지 포맷 3종:

| 포맷 | enum 값 |
|------|---------|
| JSON | `MessageFormat.JSON` |
| XML | `MessageFormat.XML` |
| Protobuf | `MessageFormat.PROTOBUF` |

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/domain/MessageFormat.kt`

Protobuf는 `.proto` 파일 컴파일 없이 `DynamicMessage`로 처리한다. 범용 proto 스키마를 사용:

```proto
service MessageInterfaceService {
  rpc Process(MessageRequest) returns (MessageResponse);
  rpc ProcessStream(stream MessageRequest) returns (stream MessageResponse);
}
message MessageRequest { bytes payload = 1; string format = 2; string trace_id = 3; string unit_id = 4; }
message MessageResponse { bytes payload = 1; bool success = 2; string error = 3; string trace_id = 4; }
```

**검증 파일:** `src/main/proto/message_service.proto`

파서 구현체:
- `src/main/kotlin/com/synapse/message_interface/parser/JsonMessageParser.kt`
- `src/main/kotlin/com/synapse/message_interface/parser/XmlMessageParser.kt`
- `src/main/kotlin/com/synapse/message_interface/parser/ProtobufMessageParser.kt`
- `src/main/kotlin/com/synapse/message_interface/parser/MessageParserRegistry.kt`

---

## 3. 워크플로우 구조

### 도메인 계층

```
WorkflowTree
  └── units: List<WorkflowUnit>
        ├── id, name
        ├── condition: WorkflowCondition
        ├── nodes: List<WorkflowNode>   ← NODE0~NODE5 자유롭게 배치
        └── edges: List<WorkflowEdge>   ← sourceNodeId → targetNodeId, isDashed
```

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/domain/WorkflowTree.kt`
- `src/main/kotlin/com/synapse/message_interface/domain/WorkflowUnit.kt`
- `src/main/kotlin/com/synapse/message_interface/domain/WorkflowNode.kt`

`WorkflowNode`의 주요 필드:

```kotlin
data class WorkflowNode(
    val id: String,
    val nodeType: NodeType,           // NODE0~NODE5
    val node0: Node0Definition? = null,
    ...
    val node5: Node5Definition? = null,
    val position: NodePosition,       // 캔버스 좌표
    val customErrorMessage: String? = null,  // 해당 노드 예외 시 커스텀 메시지
    val errorResponse: NodeErrorResponse? = null // null → NODE5 defaultErrorConfig 사용
)
```

`WorkflowEdge`의 주요 필드:

```kotlin
data class WorkflowEdge(
    val id: String,
    val sourceNodeId: String,
    val targetNodeId: String,
    val isDashed: Boolean = false     // true = 리턴 흐름 (점선)
)
```

---

## 4. Node0 — 메시지 수신

### 지원 프로토콜

| ProtocolType | 종류 | 시작 방식 |
|---|---|---|
| `WEBSOCKET_SERVER` | WebSocket 서버 | Spring WebSocketHandlerMapping (Bean) |
| `WEBSOCKET_CLIENT` | WebSocket 클라이언트 | `ReceptionManager.startHandlers()` |
| `GRPC_SERVER` | gRPC 서버 | Spring gRPC (`@GrpcService`) |
| `GRPC_CLIENT` | gRPC 클라이언트 | `ReceptionManager.startHandlers()` |
| `TCP_SERVER` | TCP 서버 | `ReceptionManager.startHandlers()` |
| `TCP_CLIENT` | TCP 클라이언트 | `ReceptionManager.startHandlers()` |
| `KAFKA_CONSUMER` | Kafka 소비자 | `ReceptionManager.startHandlers()` |
| `REST_SERVER` | REST 서버 | Spring `@RestController` (자동) |

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/domain/ProtocolType.kt`

### Node0Definition 필드

```kotlin
data class Node0Definition(
    val protocol: ProtocolType,
    val host: String? = null,
    val port: Int? = null,
    val path: String? = null,
    val topic: String? = null,         // Kafka
    val groupId: String? = null,       // Kafka
    val pingEnabled: Boolean = false,  // WebSocket 클라이언트 ping/pong
    val pingIntervalSeconds: Int = 30,
    val reconnectEnabled: Boolean = true,
    val reconnectDelaySeconds: Int = 5,
    val bidirectional: Boolean = false // gRPC 양방향 스트리밍
)
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/domain/node/Node0Definition.kt`

### 수신 핸들러별 동작

#### WebSocket 서버 (`WebSocketServerHandler`)
- Spring `WebSocketHandler` 구현
- 바이너리 메시지 수신 → `WorkflowDispatcher` 호출
- 최신 세션만 유지: `WebSocketSessionRegistry` (ConcurrentHashMap `unitId → session`)

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/reception/WebSocketServerHandler.kt`
- `src/main/kotlin/com/synapse/message_interface/reception/WebSocketSessionRegistry.kt`

#### WebSocket 클라이언트 (`WebSocketClientHandler`)
- `ReactorNettyWebSocketClient` 사용
- `pingEnabled = true`이면 설정된 주기로 ping 전송
- `reconnectEnabled = true`이면 연결 끊김 시 자동 재연결 코루틴 실행
- 세션도 `WebSocketSessionRegistry`에 등록 (Node4에서 역방향 송신 가능)

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/reception/WebSocketClientHandler.kt`

#### gRPC 서버 (`GrpcServerHandler`)
- `@GrpcService` 어노테이션
- 단방향 `process()` + 양방향 스트리밍 `processStream()` 모두 구현
- `bidirectional = true`이면 `processStream()` 활성화

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/reception/GrpcServerHandler.kt`

#### gRPC 클라이언트 (`GrpcClientHandler`)
- `ManagedChannelBuilder`로 채널 생성
- 양방향 스트리밍 연결 → `GrpcClientRegistry`에 `StreamObserver` 등록
- ping(주기적 빈 요청 전송), 자동 재연결 구현

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/reception/GrpcClientHandler.kt`
- `src/main/kotlin/com/synapse/message_interface/reception/GrpcClientRegistry.kt`

#### TCP 서버/클라이언트
- Reactor Netty `TcpServer` / `TcpClient` 사용
- 연결은 `TcpConnectionRegistry` (ConcurrentHashMap `unitId → Connection`)에 관리

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/reception/TcpServerHandler.kt`
- `src/main/kotlin/com/synapse/message_interface/reception/TcpClientHandler.kt`

#### Kafka 소비자 (`KafkaConsumerHandler`)
- `ReactiveKafkaConsumerTemplate` 사용
- 수동 오프셋 커밋 (at-least-once)
- `bootstrapServers`는 `ReferenceConfigService`가 `reference.yaml`의 `kafka.bootstrapServers`에서 런타임에 읽어 주입

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/reception/KafkaConsumerHandler.kt`

#### REST 서버 (`RestServerHandler`)
- `POST /receive/**` 경로를 `@RestController`로 처리
- 경로 → ENDPOINT 조건 매칭에 사용

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/reception/RestServerHandler.kt`

### 핸들러 수명주기 관리 (`ReceptionManager`)

```
애플리케이션 시작 → ApplicationRunner → startHandlers(unit) per unit
워크플로우 저장/삭제 → WorkflowController → receptionManager.restartUnit() / stopHandlers()
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/reception/ReceptionManager.kt`

### ping/pong UI 경고

Node0 설정 패널에서 `pingEnabled = false`일 때, WebSocket 클라이언트 프로토콜이면 아래 경고 블록을 표시:

> "Ping/Pong이 비활성화되어 있습니다. 상대 서버가 ping을 지원하지 않는 경우 수동으로 비활성화하세요. 연결이 불안정할 수 있습니다."

**검증 파일:** `frontend/src/components/panels/Node0Panel.tsx`

---

## 5. Node1 — 입력 DTO 파싱/검증

### Node1Definition 필드

```kotlin
data class Node1Definition(
    val messageFormat: MessageFormat,
    val fields: List<FieldDefinition>,
    val customDtos: List<CustomDtoDefinition> = emptyList(),
)

data class CustomDtoDefinition(
    val name: String,                 // 커스텀 타입 이름 (예: "Item")
    val fields: List<FieldDefinition> // 해당 타입의 필드 목록
)

data class FieldDefinition(
    val key: String,                  // 점 표기법 지원: "body.items.0.id"
    val type: FieldType,              // STRING, INT, DOUBLE, BOOLEAN, LIST, MAP, CUSTOM
    val customTypeName: String? = null, // type == CUSTOM일 때 커스텀 DTO 이름
    val listItemType: FieldType? = null, // type == LIST일 때 원소 타입 (STRING/INT/DOUBLE/BOOLEAN/MAP/CUSTOM)
    val defaultValue: String? = null, // null이면 타입 기본값 사용
    val nullable: Boolean = false,
    val mandatory: Boolean = true,
    val description: String,
)
```

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/domain/node/Node1Definition.kt`
- `src/main/kotlin/com/synapse/message_interface/domain/FieldDefinition.kt`

### 실행 동작 (`Node1Executor`)

1. `MessageParserRegistry`로 rawBytes 파싱 → `Map<String, Any?>`
2. mandatory 필드 누락 시 예외
3. nullable=false인 필드가 null이면 예외
4. 타입 캐스팅 수행

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/Node1Executor.kt`

### Node1 패널 UI

- **메세지 형식** 선택 (JSON / XML / Protobuf)
- **샘플에서 자동 생성** 섹션 (접이식):
  - 선택된 메세지 형식에 맞는 샘플을 붙여넣고 버튼을 누르면 필드를 자동 추출
  - JSON: 샘플 JSON 객체 → 값 타입 추론, 중첩 객체 → CUSTOM DTO, 배열 → LIST 자동 생성
  - XML: 샘플 XML → 엘리먼트 구조 분석, 반복 태그 → LIST, 중첩 엘리먼트 → CUSTOM DTO
  - Protobuf: `.proto` 스키마 텍스트 → message 블록 파싱, proto 타입 → FieldType 매핑
  - 기존 필드 없음: **자동 생성** 버튼 (교체)
  - 기존 필드 있음: **+ 추가** (키 중복 제외 병합) / **교체** (전체 교체) 버튼
- **필드 정의** — 인라인 필드 에디터:
  - `type = LIST` 선택 시 **리스트 원소 타입** 셀렉터 표시 (STRING / INT / DOUBLE / BOOLEAN / MAP / CUSTOM)
  - 원소 타입이 `CUSTOM`이면 커스텀 DTO 이름 선택 UI 추가 표시
  - `type = CUSTOM` 선택 시 커스텀 DTO 이름 선택 UI 표시
  - 필드 행(FieldRow)에서 LIST 타입은 `List<String>` 형태로 표시
- **커스텀 DTO 정의** 섹션 (패널 하단):
  1. **+ DTO 추가** 버튼 → DTO 이름 입력 (예: `Item`) → 추가
  2. DTO 카드를 클릭해 펼치면 → **+ 필드 추가** 버튼으로 해당 타입의 필드 정의
- **필드 구조 미리보기** 섹션 (접이식, 패널 최하단):
  - 현재 정의된 필드를 JSON / XML / Protobuf 형식으로 시각화
  - 탭 선택으로 포맷 전환; **복사** 버튼으로 클립보드 복사
  - CUSTOM 타입은 커스텀 DTO 구조를 중첩하여 표시
  - dot-notation 키(`header.time`)는 JSON/XML에서 중첩 구조로 표현

**검증 파일:** `frontend/src/components/panels/Node1Panel.tsx`

---

## 6. Node2 — 값 변환

### Node2Definition 필드

```kotlin
data class Node2Definition(
    val valueReplaceRules: List<ValueReplaceRule>,
    val typeConvertRules: List<TypeConvertRule>,
    val customCodeRules: List<CustomCodeRule>
)

data class ValueReplaceRule(val fieldKey: String, val fromValue: String, val toValue: String)
data class TypeConvertRule(val fieldKey: String, val toType: FieldType)
data class CustomCodeRule(
    val fieldKey: String,
    val code: String,        // Kotlin 스크립트, {$fieldKey} 플레이스홀더 사용
    val afterType: FieldType? = null  // 스크립트 결과 타입 캐스팅 (선택)
)
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/domain/node/Node2Definition.kt`

### 실행 순서 (`Node2Executor`)

1. **값 치환 (valueReplace):** `fromValue` → `toValue` 문자열 치환
2. **타입 변환 (typeConvert):** 지정 필드를 대상 타입으로 캐스팅
3. **커스텀 코드 (customCode):** Kotlin 스크립트 실행 → `afterType`으로 결과 캐스팅

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/Node2Executor.kt`

### Kotlin 스크립트 샌드박스 (`KotlinScriptExecutor`)

**Level 1 — 임포트 블록리스트 (텍스트 검사):**

차단 패키지:
```
java.io, java.net, java.nio, java.lang.Runtime,
java.lang.ProcessBuilder, kotlin.system, java.lang.reflect
```

**Level 2 — 코루틴 타임아웃:**

```kotlin
withTimeoutOrNull(3000L) {
    runInterruptible { ENGINE?.eval(code) }
}
```

3초 초과 시 `ScriptExecutionTimeoutException` 발생.

**플레이스홀더 치환:**

코드 내 `{$fieldKey}` → 실제 필드 값으로 치환 후 실행.

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/script/JavaScriptExecutor.kt`

---

## 7. Node3 — 출력 DTO 매핑

### Node3Definition 필드

```kotlin
data class Node3Definition(
    val mappings: List<DtoMapping>
)

data class DtoMapping(
    val newKey: String,       // 출력 키
    val beforeKey: String,    // 입력 키 (점 표기법)
    val filterCode: String?   // List 타입일 때 필터 스크립트 (선택)
)
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/domain/node/Node3Definition.kt`

### 실행 동작 (`Node3Executor`)

- `FlatMessageAccessor`로 `beforeKey` 경로에서 값 추출
- `newKey`로 새 Map에 설정
- `filterCode`가 있으면 List 필드에 Kotlin 스크립트 필터 적용

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/Node3Executor.kt`

### 점 표기법 (`FlatMessageAccessor`)

| 표기 예 | 의미 |
|--------|------|
| `body.name` | body 맵 안의 name 필드 |
| `body.items.get(0).id` | body.items 리스트의 0번째 요소의 id |

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/FlatMessageAccessor.kt`

### Node3 패널 UI

- **필드 불러오기** 버튼: 상위 NODE1/NODE2 필드를 자동으로 매핑 목록에 추가
- **필드 구조 미리보기** 섹션 (접이식, 패널 하단):
  - 현재 매핑의 `newKey` 목록을 JSON / XML / Protobuf 형식으로 시각화 (값 타입은 String 플레이스홀더 사용)
  - dot-notation `newKey`(예: `header.time`)는 중첩 구조로 표현

**검증 파일:** `frontend/src/components/panels/Node3Panel.tsx`

---

## 8. Node4 — 메시지 송신

### Node4Definition 필드

```kotlin
data class Node4Definition(
    val messageFormat: MessageFormat,
    val protocol: ProtocolType,
    val targetHost: String? = null,
    val targetPort: Int? = null,
    val targetPath: String? = null,
    val targetTopic: String? = null,  // Kafka 발행 토픽
    val retryCount: Int = 0,          // 재시도 횟수 (0 = 재시도 없음)
    val timeoutMs: Long = 5000L       // 타임아웃 (밀리초, 기본 5초)
)
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/domain/node/Node4Definition.kt`

### 프로토콜별 송신 방식 (`Node4Executor`)

| 프로토콜 | 송신 방식 |
|---------|---------|
| `REST_SERVER` | `WebClient.post()` (일반 HTTP) |
| `WEBSOCKET_CLIENT` | 새 연결로 일회성 송신 (`ReactorNettyWebSocketClient`) |
| `WEBSOCKET_SERVER` | `WebSocketSessionRegistry`에서 기존 세션 조회 후 송신 |
| `TCP_CLIENT` | 새 연결로 일회성 송신 (`TcpClient.create().connectNow()`) |
| `TCP_SERVER` | `TcpConnectionRegistry`에서 기존 연결 조회 후 송신 |
| `GRPC_CLIENT` | `GrpcClientRegistry`의 스트림 옵저버로 송신 |
| `GRPC_SERVER` | 직렬화된 바이트 반환 (gRPC 응답으로 자동 처리) |
| `KAFKA_CONSUMER` | **불가** — 예외 발생 |
| `KAFKA_PUBLISHER` | `KafkaProducer`로 `targetTopic`에 발행 |

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/Node4Executor.kt`

### 타임아웃 / 재시도

- 각 송신 시도마다 `timeoutMs` 내에 완료되지 않으면 `Node4SendException` 발생
- `retryCount` 횟수만큼 재시도 (각 시도에 독립적인 타임아웃 적용)
- 코루틴 취소(`CancellationException`)는 재시도 없이 즉시 상위로 전파

### 응답 흐름 (엣지 구조로 결정)

NODE4의 응답 처리는 캔버스에서 연결된 **solid(실선) 출력 엣지** 유무로 결정된다.

| 엣지 구성 | 동작 |
|---------|------|
| NODE4에서 solid 출력 엣지 없음 | NODE4 응답 바이트를 그대로 반환 (REST_SERVER면 HTTP 응답, gRPC_SERVER면 gRPC 응답) |
| NODE4 → [NODE1/NODE2/...] **실선** 연결 | 응답 바이트를 `state.rawBytes`에 저장 후 하위 노드로 파이프라인 계속 실행 |

> **점선(dashed) 엣지는 forward traversal에서 완전히 무시된다.** NODE4 → NODE0 점선 연결은 기능적으로 아무 효과가 없으므로 그릴 필요가 없다.
> NODE4가 파이프라인 끝(solid 출력 없음)이면 노드 내부에 **↩ 응답 반환** 뱃지가 자동으로 표시된다.

**실선 리턴 경로 예시:** `NODE4 → NODE1(응답 파싱) → NODE2(변환) → NODE3(재매핑) → NODE4(재송신)`
NODE4 이후 NODE1이 응답 바이트를 `state.rawBytes`에서 읽어 파싱하므로, 리턴 경로에서 일반 노드를 자유롭게 배치할 수 있다.

---

## 9. Node5 — 응답 설정

### 역할

NODE5는 원래 요청자(REST 클라이언트, gRPC 호출자, WebSocket 피어, TCP 피어)에게 돌려줄 **응답을 명시적으로 구성**하는 노드이다.

> **NODE5는 필수 노드이다.** 워크플로우 단위 생성 시 NODE0과 함께 자동 추가되며, NODE5가 없는 상태로 저장하면 백엔드에서 400 오류로 거부한다. 프론트엔드는 캔버스 상단 경고 배너와 저장 전 클라이언트 검증으로 사용자에게 안내한다.

- **성공 응답**: HTTP 상태 코드·응답 필드를 직접 정의 (`successConfig`). 필드가 비어있으면 빈 body.
- **기본 오류 응답**: 각 노드에 개별 오류 응답이 없을 때 사용되는 폴백 (`defaultErrorConfig`). HTTP 상태 코드는 예외에서 자동 결정

### Node5Definition 필드

```kotlin
data class Node5Definition(
    val successConfig: Node5SuccessConfig = Node5SuccessConfig(),
    val defaultErrorConfig: NodeErrorResponse = NodeErrorResponse()
)

/**
 * 성공 응답 설정 — HTTP 상태 코드를 직접 지정한다.
 *
 * [fields]가 비어있으면 빈 body(ByteArray(0))를 반환한다.
 * [fields]가 있으면 각 필드를 조합해 body를 생성한다:
 *   - LITERAL  → 고정 문자열 값
 *   - FROM_MAP → NODE5 도달 시점의 state.currentMap에서 해당 키의 값
 */
data class Node5SuccessConfig(
    val httpStatus: Int = 200,
    val messageFormat: MessageFormat = MessageFormat.JSON,
    val fields: List<NodeErrorField> = emptyList()
)
```

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/domain/node/Node5Definition.kt`

### 노드별 오류 응답 (`NodeErrorResponse`)

오류 응답 body는 NODE5의 `defaultErrorConfig`를 폴백으로 사용하지만, 각 노드(`WorkflowNode.errorResponse`)에서 개별 재정의가 가능하다.

```kotlin
/** 오류 응답 body 설명 — 노드별 또는 NODE5 기본값으로 사용 */
data class NodeErrorResponse(
    val messageFormat: MessageFormat = MessageFormat.JSON,
    val fields: List<NodeErrorField> = emptyList()
)

data class NodeErrorField(
    val key: String,
    val source: NodeErrorFieldSource,
    val value: String = ""  // LITERAL: 고정값; FROM_MAP: currentMap 키; EXCEPTION_MESSAGE: 무시
)

enum class NodeErrorFieldSource {
    LITERAL,            // [value]를 고정 문자열로 삽입
    FROM_MAP,           // [value] 키로 오류 시점 state.currentMap에서 조회; 키 없으면 null
    EXCEPTION_MESSAGE   // exception.message 삽입
}
```

HTTP 상태 코드는 항상 예외에서 자동 결정된다:
- `ResponseStatusException` → 해당 status 코드
- 그 외 모든 예외 → 500

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/domain/node/NodeErrorResponse.kt`

### 오류 응답 우선순위

```
노드 실패
  ↓
WorkflowNode.errorResponse != null?
  ├─ YES → 해당 NodeErrorResponse로 오류 body 생성
  └─ NO  → NODE5.defaultErrorConfig로 오류 body 생성
```

`FROM_MAP` 소스는 오류 발생 시점의 `currentMap` 값을 가져온다. 키가 존재하지 않으면 해당 필드는 `null`이 된다 (subtree 구조 보장 없음; 통일성 우선 설계).

### 실행 동작 (`Node5Executor`)

- **정상 흐름**: NODE5가 edge로 연결되어 traversal 중에 도달하면 `executeSuccess()` 호출 → `successConfig.httpStatus`와 body 구성으로 응답 생성
- **오류 흐름**: 어떤 노드에서든 예외 발생 시 → `MessagePipeline`이 `NodeException`으로 실패 노드 정보를 추적 → 노드별 `errorResponse` 또는 NODE5 `defaultErrorConfig`로 오류 body 생성

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/Node5Executor.kt`

### 프로토콜별 NODE5 활용

| 프로토콜 | httpStatus | isSuccess |
|---------|-----------|-----------|
| REST 서버 | `result.httpStatus`로 HTTP 응답 코드 설정 | — |
| gRPC 서버 | 무시 | `result.isSuccess`가 `MessageResponse.success` 필드로 전달 |
| WebSocket 서버 | 무시 | — (바이트만 반환) |
| TCP 서버 | 무시 | — (바이트만 반환) |

### 캔버스 배치 예시

**응답 body가 필요한 경우 — NODE1/2/3 → NODE5:**
```
NODE0 → NODE1 → NODE2 → NODE3 → NODE5
```
NODE5의 `fields`에서 `FROM_MAP` 소스로 NODE3 출력 키를 참조해 body 조합.

**외부 송신 후 응답 제어 — NODE4 이후 NODE5:**
```
NODE0 → NODE1 → NODE2 → NODE3 → NODE4 → NODE5
```
NODE4 이후 NODE5에 도달 시 currentMap = 마지막 NODE3 출력. `FROM_MAP`으로 해당 필드 조합.

**NODE4 terminal — 응답 없음:**
```
NODE0 → NODE1 → NODE2 → NODE3 → NODE4
                                  NODE5  (오류 응답 전용; 정상 흐름은 body 없음)
```
NODE4가 마지막 solid edge라면 파이프라인은 NODE5에 도달하지 않는다 → 응답 body 없음.

> NODE5는 유닛 내에 하나만 존재해야 한다. 여러 개 있을 경우 첫 번째 NODE5만 사용된다.

### Node5 패널 UI

- **성공 응답 / 기본 오류 응답** 탭 전환
- **성공 탭**에서 설정:
  - HTTP 상태 코드 (일반 목록 + 직접 입력)
  - 직렬화 형식 (JSON / XML)
  - 응답 필드 목록 — key + 소스 (리터럴 / 맵에서) + 값; 없으면 빈 body
  - **응답 body 구조 미리보기** (접이식) — fields 반영
- **기본 오류 응답 탭**에서 설정 (`NodeErrorResponse` 편집기):
  - 직렬화 형식 (JSON / XML)
  - 응답 필드 목록 — key + 소스 (리터럴 / 맵에서 / 예외 메세지) + 값
  - **응답 body 구조 미리보기** (접이식) — 소스별 표시

### Node0~Node4 패널 — 오류 응답 섹션

각 노드 설정 패널 하단에 **오류 응답** 섹션이 표시된다:

- **기본값 사용 (NODE5 기본 오류 응답)** ← 라디오 (기본 선택): `WorkflowNode.errorResponse = null`
- **직접 설정** ← 라디오: `NodeErrorResponse` 편집기 표시 (형식 + 필드 목록 + 미리보기)

**검증 파일:**
- `frontend/src/components/panels/Node5Panel.tsx`
- `frontend/src/components/panels/NodeErrorResponseSection.tsx`

### PipelineResult

파이프라인 반환 타입이 `ByteArray?`에서 `PipelineResult`로 변경되었다.

```kotlin
data class PipelineResult(
    val body: ByteArray?,
    val httpStatus: Int = 200,
    val isSuccess: Boolean = true
)
```

수신 핸들러들은 `result.body`, `result.httpStatus`, `result.isSuccess`를 각자 프로토콜에 맞게 사용한다.

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/PipelineResult.kt`

---

## 10. 파이프라인 실행 흐름

### 일반 흐름

```
수신 핸들러 → WorkflowDispatcher → 조건 매칭 → WorkflowUnit 선택
  → MessagePipeline.execute() → PipelineResult(body, httpStatus, isSuccess)
      ├── Node1Executor (파싱 + 검증)
      ├── Node2Executor (변환)
      ├── Node3Executor (출력 DTO 매핑)
      ├── Node4Executor (송신, 타임아웃/재시도 적용)
      │    ├── solid 출력 엣지 없음 → NODE4 응답 바이트 그대로 반환
      │    └── solid 출력 엣지 있음 → state.rawBytes ← 응답 바이트 → downstream 계속
      └── Node5Executor (응답 구성, 선택)
           ├── 정상 경로: successConfig → PipelineResult(body, httpStatus, isSuccess=true)
           └── 오류 경로: 예외 catch → errorConfig → PipelineResult(body, httpStatus, isSuccess=false)
```

### NODE5 오류 처리 흐름

```kotlin
// MessagePipeline.execute() 내부
return try {
    traverseForward(startNode.id, ...)
} catch (e: Exception) {
    val node5 = unit.nodes.firstOrNull { it.nodeType == NodeType.NODE5 && it.node5 != null }
    if (node5 != null) {
        node5Executor.executeError(state.currentMap, node5.node5!!, e)  // 오류 응답 생성
    } else {
        throw e  // NODE5 없음 → 수신 핸들러로 예외 전파 (기존 동작)
    }
}
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/engine/MessagePipeline.kt`

### 커스텀 에러 메시지

각 노드에 `customErrorMessage`가 설정된 경우, 해당 노드에서 예외 발생 시 원래 예외 대신 커스텀 메시지로 래핑된 `RuntimeException`을 전파한다.

```kotlin
private fun wrapException(e: Exception, customMessage: String?): Exception =
    if (!customMessage.isNullOrBlank()) RuntimeException(customMessage, e) else e
```

### 에지 표기법

모든 엣지는 실선으로 메시지 흐름을 나타낸다. 점선 구분 없음.
(`isDashed` 필드는 하위 호환을 위해 데이터 모델에 남아있지만 파이프라인에서 무시된다.)

**검증 파일:** `frontend/src/components/edges/WorkflowEdgeComponent.tsx`

### 조건 매칭 (`WorkflowDispatcher`)

수신 메시지를 flatten 후 모든 `WorkflowUnit`의 조건 평가 → 첫 번째 매칭 unit에 파이프라인 실행.

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/engine/WorkflowDispatcher.kt`
- `src/main/kotlin/com/synapse/message_interface/workflow/WorkflowConditionEvaluator.kt`

---

## 11. 워크플로우 조건 시스템

### 조건 타입

```kotlin
enum class ConditionType { ENDPOINT, FIELD_VALUE, CONTAINS_KEY }

data class WorkflowCondition(
    val type: ConditionType,
    val endpointPattern: String? = null,   // ENDPOINT용: "/order/{id}"
    val fieldKey: String? = null,          // FIELD_VALUE용
    val fieldValue: String? = null,
    val containsKey: String? = null,       // CONTAINS_KEY용
    val rawExpression: String? = null      // UI 표시용 텍스트
)
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/domain/WorkflowCondition.kt`

### 조건 교집합 검증 (`WorkflowConditionValidator`)

| 조건 타입 | 교집합 감지 방법 |
|---------|--------------|
| ENDPOINT | 동일 패턴 비교, 경로변수 `{varName}` → `{*}` 정규화 후 구조 비교 |
| FIELD_VALUE | fieldKey + fieldValue 동시 일치 |
| CONTAINS_KEY | containsKey 동일 여부 |

교집합 감지 시 `ConditionConflict` 목록 반환 → 저장 거부.

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/workflow/WorkflowConditionValidator.kt`

### 조건 검증 API

`POST /api/workflow/condition/validate`
→ 저장 전 실시간 교집합 확인 가능 (CreateUnitModal Step1, ConditionEditor에서 호출)

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/api/WorkflowController.kt` (line 85)

---

## 11. 로그 시스템

### TraceLog 구조

```kotlin
data class TraceLog(
    val traceId: String,
    val workflowUnitId: String,
    val nodeType: String,          // "NODE1", "NODE2" 등
    val timestamp: Instant,
    val protocol: String,
    val messageSnippet: Map<String, Any?>,  // 최대 10개 필드
    val status: TraceStatus,       // SUCCESS / ERROR
    val errorMessage: String? = null
)
```

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/log/TraceLog.kt`

### 로그 저장 (`MessageTraceLogger`)

- 파일: `message-logs/trace_YYYY-MM-DD.jsonl` (일별 .jsonl)
- 인메모리 버퍼: 최근 1000개 (`ConcurrentLinkedDeque`)
- 검색:
  - `search()` — 인메모리 버퍼에서 필드 key/value 검색
  - `searchFromFiles()` — 파일에서 날짜 범위 기반 검색

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/log/MessageTraceLogger.kt`

### 로그 보존 정책 (`LogRetentionScheduler`)

- 매일 03:00 실행 (`@Scheduled`)
- 7일 초과 파일 삭제
- 전체 크기 10GB 초과 시 오래된 파일부터 삭제

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/log/LogRetentionScheduler.kt`

### 로그 검색 API

`GET /api/logs/search?fieldKey=&fieldValue=&days=7&fromFiles=false`

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/api/LogController.kt`

---

## 12. 히스토리/롤백

### 저장 방식 (`WorkflowHistoryManager`)

- 경로: `workflow-history/history_<timestamp>.json`
- 최대 10개 버전 유지 (초과 시 오래된 버전 자동 삭제)
- 저장 시 `modifiedBy` 이름 포함

### 트리거 시점

워크플로우 **저장** 또는 **삭제** 직전에 현재 상태를 자동 백업.

### 롤백

`POST /api/workflow/rollback` → 선택 버전을 인메모리 레지스트리에 로드 + 파일/MongoDB 저장.

**검증 파일:** `src/main/kotlin/com/synapse/message_interface/workflow/WorkflowHistoryManager.kt`

---

## 13. 저장소

### 워크플로우 영속성 (`WorkflowPersistenceConfig`)

**로드 우선순위:**
1. MongoDB (`workflow_tree` 컬렉션, `_id = "singleton"`) — 실패 시 폴백
2. `workflow.json` (프로젝트 루트)

**저장:** 항상 `workflow.json` 기록, MongoDB 사용 가능 시 동시 저장.

MongoDB는 `@Lazy` 주입으로 미설정 시에도 앱 정상 기동.

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/config/WorkflowPersistenceConfig.kt`
- `src/main/kotlin/com/synapse/message_interface/config/MongoWorkflowDocument.kt`
- `src/main/kotlin/com/synapse/message_interface/config/MongoWorkflowRepository.kt`

### 레퍼런스 설정

`src/main/resources/reference.yaml` — Kafka, gRPC, TCP, 로그, 히스토리 공통 설정.
`kafka.bootstrapServers` 값이 Kafka Consumer/Publisher 양쪽에서 사용되며, `ReferenceConfigService`를 통해 런타임에 읽힌다. `application.yaml`에는 Kafka 설정을 두지 않는다.

API: `GET/PUT /api/reference`

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/api/ReferenceController.kt`
- `src/main/kotlin/com/synapse/message_interface/config/ReferenceConfigService.kt`

---

## 14. REST API

| 메서드 | 경로 | 설명 | 인증 |
|-------|------|------|------|
| GET | `/api/workflow/units` | 전체 단위 조회 | 없음 |
| GET | `/api/workflow/units/{id}` | 단일 단위 조회 | 없음 |
| POST | `/api/workflow/units` | 단위 저장/수정 | 이름+비밀번호 |
| DELETE | `/api/workflow/units` | 단위 삭제 | 이름+비밀번호 |
| POST | `/api/workflow/condition/validate` | 조건 교집합 검증 | 없음 |
| GET | `/api/workflow/history` | 히스토리 목록 | 없음 |
| POST | `/api/workflow/rollback` | 버전 롤백 | 비밀번호 |
| GET | `/api/logs/search` | 로그 검색 | 없음 |
| GET | `/api/reference` | 레퍼런스 설정 조회 | 없음 |
| PUT | `/api/reference` | 레퍼런스 설정 저장 | 없음 |
| POST | `/receive/**` | 메시지 수신 (REST) | 없음 |

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/api/WorkflowController.kt`
- `src/main/kotlin/com/synapse/message_interface/api/LogController.kt`
- `src/main/kotlin/com/synapse/message_interface/api/ReferenceController.kt`

---

## 15. 프론트엔드 페이지

### `/` — 워크플로우 캔버스 (`WorkflowPage`)

- React Flow 캔버스 + dagre 자동 레이아웃 (LR 방향, 노드 280×120)
- 좌측 사이드바: `WorkflowUnitList` — 단위 목록, 검색, 삭제
- 노드 클릭 → `NodeSettingsPanel` (우측 슬라이드인)
- 에지 클릭 → 액션 툴바 (삭제)
- 상단 우측 툴바: **노드 추가**, **정렬** (dagre 자동 배치), **저장** (항상 표시, 미저장 시 파란색 강조), **히스토리**
- 단위 생성: 2단계 마법사 (`CreateUnitModal`)
  - Step1: 이름 + 조건 입력 → 실시간 교집합 검증
  - Step2: 이름 + 비밀번호 확인 → 5개 기본 노드로 단위 생성

**검증 파일:**
- `frontend/src/pages/WorkflowPage.tsx`
- `frontend/src/components/WorkflowUnitList.tsx`
- `frontend/src/components/CreateUnitModal.tsx`

### 노드 색상 코드

| 노드 | 색상 |
|------|------|
| NODE0 | 파랑 (blue) |
| NODE1 | 보라 (violet) |
| NODE2 | 황색 (amber) |
| NODE3 | 초록 (emerald) |
| NODE4 | 빨강 (red) |

**검증 파일:** `frontend/src/components/nodes/WorkflowNodeComponent.tsx`

### 노드 설정 패널 (`NodeSettingsPanel`)

- 노드 설정을 편집한 뒤 **확인** 버튼을 누르면 캔버스 상태에 반영 (미저장 상태)
- 우측 상단 **저장** 버튼으로 노드 설정·위치·엣지 등 모든 변경을 한 번에 저장 (이름+비밀번호 입력)
- 모든 패널 하단에 `customErrorMessage` 입력 필드
- 각 노드별 전용 패널:
  - `frontend/src/components/panels/Node0Panel.tsx` — 프로토콜 선택 + 조건부 필드 + ping/pong 경고
  - `frontend/src/components/panels/Node1Panel.tsx` — 포맷 + 필드 인라인 편집기 + **필드 구조 미리보기**
  - `frontend/src/components/panels/Node2Panel.tsx` — 3탭: 값 치환 / 타입 변환 / 커스텀 코드 (afterType 포함)
  - `frontend/src/components/panels/Node3Panel.tsx` — DtoMapping 편집기 + **출력 구조 미리보기**
  - `frontend/src/components/panels/Node4Panel.tsx` — 포맷 + 프로토콜 + 대상 + 재시도/타임아웃 (응답 흐름은 캔버스 엣지로 결정)

**검증 파일:** `frontend/src/components/panels/NodeSettingsPanel.tsx`

### `/logs` — 로그 검색 페이지 (`LogPage`)

- fieldKey / fieldValue / days / fromFiles(파일 검색 여부) 검색
- TraceLog 목록 표시 (traceId, 노드, 상태, 시간, 스니펫)

**검증 파일:** `frontend/src/pages/LogPage.tsx`

### `/reference` — 레퍼런스 설정 페이지 (`ReferencePage`)

- Kafka / gRPC / TCP / 로그 / 히스토리 섹션별 동적 편집기

**검증 파일:** `frontend/src/pages/ReferencePage.tsx`

### 히스토리 드로어 (`HistoryDrawer`)

- 우측 드로어, 버전 카드 + 포함 단위 칩 표시
- 인라인 이름 + 비밀번호 입력 후 롤백 실행

**검증 파일:** `frontend/src/components/HistoryDrawer.tsx`

---

## 16. 보안

### 워크플로우 편집 인증

- 저장, 삭제, 롤백 시 **수정자 이름(modifiedBy)** + **비밀번호** 필수
- 비밀번호 출처: 환경변수 `WORKFLOW_EDIT_PASSWORD` → 기본값 `"admin"`
- **인증 시스템 없음** (모든 GET 엔드포인트 무인증)

**검증 파일:**
- `src/main/kotlin/com/synapse/message_interface/api/WorkflowController.kt` (line 26)
- `src/main/kotlin/com/synapse/message_interface/config/SecurityConfig.kt`

### Node2 스크립트 보안

- Level 1: 코드 텍스트 검사로 차단 패키지 사용 시 즉시 예외
- Level 2: 3초 타임아웃으로 무한루프/블로킹 차단
- 개발자 감독하에 사용 권장

---

## 17. 배포 — Windows 서비스

### 사전 준비

1. `./gradlew bootJar` 로 jar 빌드 (`build/libs/message-interface-*.jar`)
2. 배포 폴더 생성 후 jar 복사
3. [WinSW](https://github.com/winsw/winsw/releases) 에서 `WinSW-x64.exe` 다운로드 → jar과 같은 폴더에 `message-interface.exe` 로 이름 변경

### 서비스 설정 파일

jar과 같은 폴더에 `message-interface.xml` 생성:

```xml
<service>
  <id>message-interface</id>
  <name>Message Interface</name>
  <description>Synapse Message Interface Service</description>
  <executable>java</executable>
  <arguments>-Xmx2g -Dpolyglot.engine.WarnInterpreterOnly=false -jar message-interface.jar</arguments>
  <workingdirectory>C:\path\to\deploy</workingdirectory>
  <logmode>rotate</logmode>
</service>
```

### 유의사항

| 항목 | 내용 |
|------|------|
| **관리자 권한** | 서비스 등록/삭제/시작/중지 모두 관리자 권한 CMD 필요 |
| **`-Xmx2g`** | `bootRun`의 jvmArgs는 Gradle 실행 시에만 적용됨 — 서비스 실행 시 xml에 반드시 포함 |
| **`-Dpolyglot.engine.WarnInterpreterOnly=false`** | 동일 이유로 xml에 포함 필요 |
| **`WORKFLOW_EDIT_PASSWORD`** | 환경변수를 서비스에 적용하려면 xml에 `<env name="WORKFLOW_EDIT_PASSWORD" value="..."/>` 추가 |
| **작업 디렉토리** | 서비스 실행 시 작업 디렉토리가 jar 위치와 다를 수 있음 — `workflow.json`, `message-logs/`, `workflow-history/` 경로가 의도한 위치인지 확인 |
| **Java 경로** | `java` 명령어가 PATH에 있어야 함. 명시하려면 `<executable>C:\Program Files\Java\jdk-17\bin\java</executable>` |

### 서비스 명령어

```cmd
message-interface.exe install    # 서비스 등록
message-interface.exe start      # 시작
message-interface.exe stop       # 중지
message-interface.exe restart    # 재시작
message-interface.exe uninstall  # 서비스 삭제
```
