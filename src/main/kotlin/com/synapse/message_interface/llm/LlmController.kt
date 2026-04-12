package com.synapse.message_interface.llm

import com.synapse.message_interface.api.dto.ApiResponse
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono

@RestController
@RequestMapping("/synapse/llm")
class LlmController(private val llmService: LlmService) {

    /**
     * NODE2 / NODE3 커스텀 코드 생성 — SSE 스트리밍
     *
     * 응답: text/event-stream, 각 이벤트 data 필드에 토큰 문자열
     */
    @PostMapping("/code-suggest", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun codeSuggest(@RequestBody req: LlmCodeSuggestRequest): Flux<String> =
        llmService.streamCodeSuggest(req)
            .onErrorResume { ex ->
                val msg = when (ex) {
                    is LlmDisabledException   -> "[LLM_DISABLED] ${ex.message}"
                    is LlmUnavailableException -> "[LLM_UNAVAILABLE] ${ex.message}"
                    else                       -> "[LLM_ERROR] ${ex.message}"
                }
                Flux.just(msg)
            }

    /**
     * UI 기능 설명 채팅 — SSE 스트리밍
     *
     * 응답: text/event-stream, 각 이벤트 data 필드에 토큰 문자열
     */
    @PostMapping("/chat", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun chat(@RequestBody req: LlmChatRequest): Flux<String> =
        llmService.streamChat(req)
            .onErrorResume { ex ->
                val msg = when (ex) {
                    is LlmDisabledException   -> "[LLM_DISABLED] ${ex.message}"
                    is LlmUnavailableException -> "[LLM_UNAVAILABLE] ${ex.message}"
                    else                       -> "[LLM_ERROR] ${ex.message}"
                }
                Flux.just(msg)
            }

    /**
     * LLM 활성화 여부 및 설정 상태 확인
     */
    @GetMapping("/status")
    fun status(): Mono<ResponseEntity<ApiResponse<Map<String, Any>>>> =
        Mono.fromCallable {
            val config = llmService.readConfigForStatus()
            ResponseEntity.ok(
                ApiResponse.ok(
                    mapOf(
                        "enabled"       to config.enabled,
                        "ollamaBaseUrl" to config.ollamaBaseUrl,
                        "codeModel"     to config.codeModel,
                        "chatModel"     to config.chatModel,
                    )
                )
            )
        }
}
