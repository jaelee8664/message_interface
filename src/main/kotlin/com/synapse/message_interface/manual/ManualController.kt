package com.synapse.message_interface.manual

import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import reactor.core.publisher.Mono

data class ManualRequest(
    val unitIds: List<String>,
    val format: ManualFormat = ManualFormat.MARKDOWN
)

@RestController
@RequestMapping("/synapse/manual")
class ManualController(
    private val manualService: ManualService
) {

    @PostMapping
    fun generate(@RequestBody req: ManualRequest): Mono<ResponseEntity<ByteArray>> {
        return manualService.generate(req.unitIds, req.format).map { bytes ->
            when (req.format) {
                ManualFormat.MARKDOWN -> ResponseEntity.ok()
                    .contentType(MediaType("text", "markdown", Charsets.UTF_8))
                    .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename("protocol-manual.md").build().toString()
                    )
                    .body(bytes)

                ManualFormat.WORD -> ResponseEntity.ok()
                    .contentType(MediaType("application", "vnd.openxmlformats-officedocument.wordprocessingml.document"))
                    .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename("protocol-manual.docx").build().toString()
                    )
                    .body(bytes)
            }
        }
    }
}
