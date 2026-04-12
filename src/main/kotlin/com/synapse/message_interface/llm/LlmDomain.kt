package com.synapse.message_interface.llm

// ── 요청 DTO ─────────────────────────────────────────────────────────────────

data class LlmCodeSuggestRequest(
    /** 사용자가 원하는 동작 설명 */
    val prompt: String,
    /** "NODE2" | "NODE3" */
    val nodeType: String,
    /**
     * NODE2: "CUSTOM_CODE"
     * NODE3: "FILTER_CODE" | "EXPR" | "ADD_CONDITION"
     */
    val codeType: String,
    /** 현재 에디터에 입력된 코드 (수정 요청 시 컨텍스트) */
    val existingCode: String? = null,
    /** WorkflowRegistry에서 필드 목록을 가져올 유닛 ID */
    val unitId: String? = null,
    /** 현재 편집 중인 출력 필드 키 — 모델에게 {$fieldKey} 플레이스홀더 힌트 제공 */
    val fieldKey: String? = null,
)

data class ChatMessage(val role: String, val content: String)

data class LlmChatRequest(
    val prompt: String,
    /** 이전 대화 내역 (role: "user" | "assistant") */
    val history: List<ChatMessage> = emptyList(),
)

// ── 설정 ─────────────────────────────────────────────────────────────────────

data class LlmConfig(
    val enabled: Boolean,
    val ollamaBaseUrl: String,
    val codeModel: String,
    val chatModel: String,
    val timeoutSeconds: Long,
)

// ── 예외 ─────────────────────────────────────────────────────────────────────

class LlmDisabledException : RuntimeException("로컬 LLM이 비활성화되어 있습니다. 기준정보 페이지에서 활성화하세요.")
class LlmUnavailableException(cause: Throwable) : RuntimeException("Ollama에 연결할 수 없습니다: ${cause.message}", cause)
