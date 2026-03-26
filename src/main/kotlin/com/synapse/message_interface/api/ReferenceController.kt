package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.config.ReferenceConfigService
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import reactor.core.publisher.Mono

@RestController
@RequestMapping("/synapse/reference")
class ReferenceController(private val referenceConfigService: ReferenceConfigService) {

    @GetMapping
    fun getReference(): Mono<ResponseEntity<ApiResponse<Map<String, Any?>>>> =
        Mono.fromCallable {
            ResponseEntity.ok(ApiResponse.ok(referenceConfigService.getConfig()))
        }

    @PutMapping
    fun saveReference(@RequestBody body: Map<String, Any?>): Mono<ResponseEntity<ApiResponse<String>>> =
        Mono.fromCallable {
            referenceConfigService.saveConfig(body)
            ResponseEntity.ok(ApiResponse.ok("저장 완료"))
        }
}
