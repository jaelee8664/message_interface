package com.synapse.message_interface.llm

import tools.jackson.databind.ObjectMapper
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.reactive.function.client.WebClient
import org.springframework.web.reactive.function.client.WebClientRequestException
import org.springframework.web.reactive.function.client.WebClientResponseException
import reactor.core.publisher.Flux
import java.time.Duration

/**
 * 코드 생성용: 결정론적 + 짧게.
 * stop에 "\n\n"을 넣으면 object 리터럴처럼 줄바꿈이 있는 표현식이 중간에 잘릴 수 있으므로
 * 메시지 경계 패턴만 사용한다.
 */
val CODE_OPTIONS = OllamaOptions(temperature = 0.1, numPredict = 300, stop = listOf("\nUser:", "\nNote:", "\nExplanation:", "\n설명:", "```"))

/** 채팅용: 자연스럽게, 길게 */
val CHAT_OPTIONS = OllamaOptions(temperature = 0.7, numPredict = 1024)

data class OllamaOptions(
    val temperature: Double = 0.7,
    val numPredict: Int = 1024,
    val stop: List<String> = emptyList(),
)

@Component
class OllamaClient(private val objectMapper: ObjectMapper) {

    /**
     * Ollama /api/chat 를 ndjson 스트림으로 호출하고
     * 토큰(content) 문자열의 Flux를 반환한다.
     *
     * baseUrl 이 바뀌어도 매번 새 WebClient 를 생성하므로
     * 기준정보 변경이 즉시 반영된다.
     */
    fun streamChat(
        baseUrl: String,
        model: String,
        messages: List<OllamaMessage>,
        timeoutSeconds: Long,
        options: OllamaOptions = OllamaOptions(),
    ): Flux<String> {
        val body = buildMap {
            put("model", model)
            put("messages", messages)
            put("stream", true)
            put("options", buildMap {
                put("temperature", options.temperature)
                put("num_predict", options.numPredict)
                if (options.stop.isNotEmpty()) put("stop", options.stop)
            })
        }

        return WebClient.create(baseUrl)
            .post()
            .uri("/api/chat")
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(body)
            .retrieve()
            .bodyToFlux(String::class.java)
            .timeout(Duration.ofSeconds(timeoutSeconds))
            .flatMap { line -> extractToken(line) }
            .onErrorMap(WebClientRequestException::class.java) { LlmUnavailableException(it) }
            .onErrorMap(WebClientResponseException::class.java) { LlmUnavailableException(it) }
    }

    /**
     * Ollama ndjson 한 줄 → content 토큰 추출.
     * 빈 줄이거나 파싱 실패 시 empty Flux.
     */
    @Suppress("UNCHECKED_CAST")
    private fun extractToken(line: String): Flux<String> {
        if (line.isBlank()) return Flux.empty()
        val token = runCatching {
            val parsed = objectMapper.readValue(line, Map::class.java) as Map<String, Any?>
            val message = parsed["message"] as? Map<*, *>
            message?.get("content") as? String
        }.getOrNull()
        return if (token.isNullOrEmpty()) Flux.empty() else Flux.just(token)
    }
}

/** Ollama messages 배열의 단일 항목 */
data class OllamaMessage(val role: String, val content: String)
