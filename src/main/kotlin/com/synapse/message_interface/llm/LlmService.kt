package com.synapse.message_interface.llm

import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.domain.FieldDefinition
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.workflow.WorkflowRegistry
import org.springframework.stereotype.Service
import reactor.core.publisher.Flux

@Service
class LlmService(
    private val ollamaClient: OllamaClient,
    private val referenceConfigService: ReferenceConfigService,
    private val registry: WorkflowRegistry,
) {

    // ── 공개 API ──────────────────────────────────────────────────────────────

    fun streamCodeSuggest(req: LlmCodeSuggestRequest): Flux<String> {
        val config = readConfig()
        if (!config.enabled) return Flux.error(LlmDisabledException())

        val fields = req.unitId?.let { fetchFields(it) } ?: emptyList()
        val messages = buildCodeMessages(req, fields)

        return ollamaClient.streamChat(
            baseUrl        = config.ollamaBaseUrl,
            model          = config.codeModel,
            messages       = messages,
            timeoutSeconds = config.timeoutSeconds,
            options        = CODE_OPTIONS,
        )
    }

    fun streamChat(req: LlmChatRequest): Flux<String> {
        val config = readConfig()
        if (!config.enabled) return Flux.error(LlmDisabledException())

        val messages = buildList {
            add(OllamaMessage("system", UI_HELP_SYSTEM_PROMPT))
            req.history.forEach { add(OllamaMessage(it.role, it.content)) }
            add(OllamaMessage("user", req.prompt))
        }

        return ollamaClient.streamChat(
            baseUrl        = config.ollamaBaseUrl,
            model          = config.chatModel,
            messages       = messages,
            timeoutSeconds = config.timeoutSeconds,
            options        = CHAT_OPTIONS,
        )
    }

    /** 컨트롤러 status 엔드포인트용 */
    fun readConfigForStatus(): LlmConfig = readConfig()

    // ── 설정 읽기 ─────────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun readConfig(): LlmConfig {
        val llm = referenceConfigService.getConfig()["llm"] as? Map<String, Any?> ?: emptyMap()
        return LlmConfig(
            enabled        = llm["enabled"] as? Boolean ?: false,
            ollamaBaseUrl  = llm["ollamaBaseUrl"] as? String ?: "http://localhost:11434",
            codeModel      = llm["codeModel"] as? String ?: "qwen2.5-coder:7b",
            chatModel      = llm["chatModel"] as? String ?: "llama3.2:3b",
            timeoutSeconds = (llm["timeoutSeconds"] as? Number)?.toLong() ?: 60L,
        )
    }

    // ── 필드 목록 추출 ────────────────────────────────────────────────────────

    private fun fetchFields(unitId: String): List<FieldDefinition> =
        registry.findById(unitId)
            ?.nodes?.firstOrNull { it.nodeType == NodeType.NODE1 }
            ?.node1?.fields
            ?: emptyList()

    // ── 코드 생성 메시지 빌드 ─────────────────────────────────────────────────

    /**
     * 전략: 시스템 프롬프트는 간결하게 규칙만 제시,
     * few-shot 예시를 가짜 user/assistant 대화 턴으로 주입.
     * 소형 로컬 모델은 긴 설명보다 패턴 반복에 더 잘 반응한다.
     */
    private fun buildCodeMessages(req: LlmCodeSuggestRequest, fields: List<FieldDefinition>): List<OllamaMessage> {
        val messages = mutableListOf<OllamaMessage>()

        // 1. 시스템 프롬프트: 규칙 + 필드 목록
        messages.add(OllamaMessage("system", buildSystemPrompt(req.codeType, fields)))

        // 2. Few-shot 예시 (가짜 대화 턴)
        getFewShotExamples(req.codeType).forEach { (q, a) ->
            messages.add(OllamaMessage("user", q))
            messages.add(OllamaMessage("assistant", a))
        }

        // 3. 실제 사용자 요청
        messages.add(OllamaMessage("user", buildUserTurn(req)))

        return messages
    }

    private fun buildSystemPrompt(codeType: String, fields: List<FieldDefinition>): String {
        // 코드 모델은 영어 지시에 훨씬 많이 학습되어 있으므로 시스템 프롬프트는 영어로 작성.
        // few-shot 예시의 user 턴은 한국어(실제 사용자 입력과 동일한 언어)로 유지.
        val fieldSection = if (fields.isEmpty()) {
            "Available fields: (no unit selected — user will specify field names directly)"
        } else {
            "Available input fields (access via {${'$'}key} placeholder):\n" +
                fields.joinToString("\n") { "  {${'$'}${it.key}} : ${it.type}" }
        }

        return when (codeType) {
            "CUSTOM_CODE" -> """
You are a JavaScript expression generator for a message transformation pipeline.
Output ONLY the raw JavaScript expression. No explanation. No markdown. No code fences.
Rules:
- Single expression only. No statements (no if/var/let/const/return).
- Access input fields using {${'$'}fieldName} placeholder, e.g. {${'$'}body.status}
- Forbidden: java. / Packages. / Java.type (runtime sandbox blocks them)
- Return type: String, Number, Boolean, null, object literal, or array
$fieldSection
""".trimIndent()

            "FILTER_CODE" -> """
You are a JavaScript list-filter expression generator for a message transformation pipeline.
Output ONLY the raw boolean JavaScript expression. No explanation. No markdown. No code fences.
Rules:
- Single boolean expression that returns true (keep) or false (discard).
- {${'$'}el} = current list element (primitive value). {${'$'}el.fieldName} = field of current list element (map/object).
- Access outer DTO fields using {${'$'}fieldName} placeholder (e.g. {${'$'}body.threshold}).
- Forbidden: java. / Packages. / Java.type
$fieldSection
""".trimIndent()

            "LIST_ITEM_CODE" -> """
You are a JavaScript expression generator for transforming individual list element fields in a message pipeline.
Output ONLY the raw JavaScript expression. No explanation. No markdown. No code fences.
Rules:
- Single expression only. No statements (no if/var/let/const/return).
- {${'$'}el} = the current list element (use for primitive elements like numbers/strings).
- {${'$'}el.fieldName} = a field of the current list element (use for map/object elements).
- Access outer DTO fields using {${'$'}outerFieldKey} placeholder (e.g. {${'$'}body.divisor}).
- Forbidden: java. / Packages. / Java.type
$fieldSection
""".trimIndent()

            "EXPR" -> """
You are a JavaScript value expression generator for a message transformation pipeline.
Output ONLY the raw JavaScript expression. No explanation. No markdown. No code fences.
Rules:
- Single expression only. No statements.
- Access input fields using {${'$'}fieldName} placeholder.
- When returning an object literal, wrap it in parentheses: ({ key: value })
- Forbidden: java. / Packages. / Java.type
$fieldSection
""".trimIndent()

            "ADD_CONDITION" -> """
You are a JavaScript condition expression generator for a message transformation pipeline.
Output ONLY the raw boolean JavaScript expression. No explanation. No markdown. No code fences.
Rules:
- Single boolean expression. true = add the item, false = skip.
- Access input fields using {${'$'}fieldName} placeholder.
- Forbidden: java. / Packages. / Java.type
$fieldSection
""".trimIndent()

            else -> "Output ONLY a raw JavaScript expression. No explanation."
        }
    }

    private fun buildUserTurn(req: LlmCodeSuggestRequest): String {
        // 편집 중인 필드 키가 있으면 모델에게 플레이스홀더 형식을 명시적으로 알려준다.
        // 소형 로컬 모델은 "어느 필드를 써야 하는지" 힌트가 없으면 잘못된 값만 반환하는 경우가 많다.
        val keyHint = req.fieldKey?.takeIf { it.isNotBlank() }?.let { key ->
            when (req.codeType) {
                "LIST_ITEM_CODE" ->
                    "Element field being transformed: $key — reference it as {\$el.$key} for map elements, or {\$el} for primitives.\n"
                else ->
                    "Target output field key: $key — reference it as {\$${key}} in your expression.\n"
            }
        } ?: ""
        return if (!req.existingCode.isNullOrBlank())
            "${keyHint}Existing code: ${req.existingCode}\nRequest: ${req.prompt}"
        else
            "${keyHint}${req.prompt}"
    }

    // ── Few-shot 예시 ─────────────────────────────────────────────────────────

    /**
     * 도메인에 맞는 예시를 user/assistant 쌍으로 반환.
     * 예시가 많을수록 좋지만, 컨텍스트 길이를 고려해 4~5개가 적절.
     */
    private fun getFewShotExamples(codeType: String): List<Pair<String, String>> = when (codeType) {
        "CUSTOM_CODE" -> listOf(
            "status가 200이면 \"SUCCESS\", 아니면 \"FAIL\"로 변환"
                to """{${'$'}body.status} === 200 ? "SUCCESS" : "FAIL"""",

            "time 필드의 \"-\"를 \".\"으로 모두 교체"
                to """{${'$'}body.time}.replace(/-/g, ".")""",

            "count 필드를 1000으로 나눈 뒤 소수점 2자리로 반올림"
                to "Math.round({${'$'}body.count} / 1000 * 100) / 100",

            "name 필드를 대문자로 변환"
                to "{${'$'}body.name}.toUpperCase()",

            "amount와 tax를 더한 합계"
                to "{${'$'}body.amount} + {${'$'}body.tax}",
        )

        "FILTER_CODE" -> listOf(
            "qty가 0보다 큰 항목만 통과"
                to "{${'$'}el.qty} > 0",

            "status가 \"ACTIVE\"인 항목만"
                to """{${'$'}el.status} === "ACTIVE"""",

            "deleted가 false이거나 없는 항목만"
                to "{${'$'}el.deleted} === false || {${'$'}el.deleted} == null",

            "amount가 외부 threshold 필드 이상인 항목만"
                to "{${'$'}el.amount} >= {${'$'}body.threshold}",

            "원시값 리스트에서 100 초과인 숫자만"
                to "{${'$'}el} > 100",
        )

        "EXPR" -> listOf(
            "userId와 타임스탬프를 합친 고유 키 문자열"
                to """{${'$'}body.userId} + "_" + Date.now()""",

            "price에 세율 10%를 더한 최종 금액"
                to "{${'$'}body.price} * 1.1",

            "name과 code를 조합한 object"
                to """({ name: {${'$'}body.name}, code: {${'$'}body.code} })""",

            "items 배열의 첫 번째 원소"
                to "{${'$'}body.items}[0]",
        )

        "LIST_ITEM_CODE" -> listOf(
            "id를 문자열로 변환"
                to "String({${'$'}el.id})",

            "name 필드를 소문자로 변환"
                to "{${'$'}el.name}.toLowerCase()",

            "price에 세율 10% 적용"
                to "{${'$'}el.price} * 1.1",

            "원시 숫자 원소를 2배로"
                to "{${'$'}el} * 2",

            "score가 1 이상인지 여부 (boolean)"
                to "{${'$'}el.score} >= 1",

            "외부 divisor로 amount를 나눈 값"
                to "{${'$'}el.amount} / {${'$'}body.divisor}",
        )

        "ADD_CONDITION" -> listOf(
            "items 배열이 비어 있을 때만 추가"
                to "{${'$'}body.items}.length === 0",

            "type이 \"VIP\"인 경우에만 추가"
                to """{${'$'}body.type} === "VIP"""",

            "count가 10 미만일 때만 추가"
                to "{${'$'}body.count} < 10",

            "flag가 true이고 status가 \"OK\"일 때만"
                to """{${'$'}body.flag} === true && {${'$'}body.status} === "OK"""",
        )

        else -> emptyList()
    }

    // ── UI 도우미 시스템 프롬프트 ─────────────────────────────────────────────

    private companion object {
        val UI_HELP_SYSTEM_PROMPT = """
당신은 'Message Interface' 워크플로우 설정 도구의 사용 도우미입니다.
사용자가 UI 기능이나 설정 방법을 질문하면 친절하고 명확하게 한국어로 안내하세요.

## 응답 형식 규칙 (반드시 준수)
- 마크다운 형식으로 작성하세요.
- 섹션은 ## 또는 ### 제목으로 구분하세요.
- 항목 나열은 반드시 번호 목록(1. 2. 3.) 또는 불릿(-) 형식으로 작성하세요.
- 각 항목과 섹션 사이에는 반드시 빈 줄을 넣으세요.
- 중요한 용어는 **굵게** 표시하세요.
- 절대로 모든 내용을 한 문단에 붙여서 쓰지 마세요.

## 시스템 개요
메시지를 수신하여 조건에 따라 변환·전송하는 파이프라인을 시각적으로 구성하는 도구입니다.
워크플로우 캔버스(/)에서 노드와 엣지를 배치해 파이프라인을 만듭니다.

## 워크플로우 유닛
- 하나의 유닛 = 조건 + 여러 노드 + 엣지로 구성된 독립적인 파이프라인
- 유닛 간 조건이 겹치면 오류 (반드시 해소 후 저장 가능)
- 저장 시 수정자 이름과 비밀번호(기본값: admin) 필요

## 노드 종류
**NODE0 (수신)**: 외부로부터 메시지를 받는 입구
  - 지원 프로토콜: WebSocket(클라/서버), gRPC(클라/서버), TCP/IP(클라/서버), Kafka 컨슈머, REST 서버
  - 클라이언트 모드: ping/pong + 자동 재연결

**NODE1 (입력 DTO)**: 수신 메시지의 필드 구조 정의
  - 필드 타입: STRING, INT, DOUBLE, BOOLEAN, LIST, MAP, CUSTOM(커스텀 DTO 참조)
  - 커스텀 DTO: 복합 객체 타입을 별도 정의해 재사용
  - 메시지 포맷: JSON, XML, Protobuf

**NODE2 (변환)**: 메시지 필드 값 변환 (3가지 탭)
  - 값 치환: 특정 필드의 값이 일치하면 다른 값으로 교체
  - 타입 변환: 필드의 데이터 타입 변경
  - 커스텀 코드: JavaScript 표현식으로 동적 값 계산 ({${'$'}필드명} 플레이스홀더 사용)

**NODE3 (출력 DTO)**: 전송할 메시지 구조 재구성
  - 필드 매핑: 입력 DTO 필드를 새 키로 복사
  - filterCode: LIST 필드 원소 필터링 (JS 표현식, el = 현재 원소)
  - listAddItems: 리스트에 고정값/필드참조/JS표현식으로 원소 추가

**NODE4 (전송)**: 변환된 메시지를 외부로 송신
  - 지원 프로토콜: NODE0와 동일 (단, REST 서버는 제외)
  - CUSTOM_RETURN: 수신 연결로 응답 메시지를 되돌려 보내는 모드

**NODE5 (에러 응답)**: 파이프라인 오류 시 반환할 기본 응답 설정
  - 노드별로 개별 오버라이드도 가능

## 조건 시스템
- **ENDPOINT**: 수신 경로/토픽이 패턴과 일치 (와일드카드 * ? {} 지원)
- **FIELD_VALUE**: 특정 필드 값이 일치
- **CONTAINS_KEY**: 특정 필드 키 존재 여부
- **AND / OR**: 여러 조건을 복합 구성

## 엣지(연결선)
- **실선**: 일반 순방향 흐름 (NODE0 → NODE1 → ... → NODE4)
- **점선**: 반환 메시지 흐름 (시각적 표시 전용)

## 주요 페이지
- `/` : 워크플로우 캔버스 (노드 추가·삭제·연결)
- `/logs` : 메시지 로그 검색 (필드 키/값 필터)
- `/reference` : 기준정보 설정 (로그, 히스토리, Dead Letter, Mongo 큐, 로컬 LLM)

## 노드 조작 방법
- 노드 추가: 유닛 선택 → 우측 패널 상단 "+ 노드 추가" 버튼
- 노드 삭제: 우측 패널 하단 "이 노드 삭제" 버튼 또는 캔버스에서 노드 선택 후 Backspace/Delete
- 엣지 연결: 노드 핸들에서 드래그하여 다른 노드 핸들로 연결
        """.trimIndent()
    }
}
