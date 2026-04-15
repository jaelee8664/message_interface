package com.synapse.message_interface.api

import tools.jackson.databind.ObjectMapper
import com.synapse.message_interface.domain.ProtoFieldDef
import com.synapse.message_interface.domain.ProtoFieldLabel
import com.synapse.message_interface.domain.ProtoFieldType
import com.synapse.message_interface.domain.ProtoMessageDef
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import javax.xml.parsers.DocumentBuilderFactory
import org.xml.sax.InputSource
import java.io.StringReader
import java.util.concurrent.atomic.AtomicInteger

data class ProtoInferRequest(
    val format: String,   // "JSON" | "XML"
    val sample: String
)

data class ProtoInferResponse(
    val fields: List<ProtoFieldDef>,
    val messages: List<ProtoMessageDef> = emptyList(),
)

/**
 * JSON 또는 XML 샘플에서 proto 스키마 필드 목록을 추론한다.
 *
 * ■ 지원 범위
 *   - 중첩 객체/엘리먼트 → 별도 MESSAGE 타입으로 정의 (protoMessages)
 *   - 객체 배열         → 별도 MESSAGE 타입으로 정의 후 REPEATED 레이블
 *   - 스칼라 배열       → REPEATED 레이블
 *   - 타입 추론: Int → INT32, Long → INT64, Double → DOUBLE, Boolean → BOOL, 나머지 → STRING
 *
 * ■ 필드 번호
 *   각 메시지 내에서 1부터 자동 부여. UI 에서 사용자가 재순서 조정 가능.
 */
@RestController
@RequestMapping("/synapse/api/proto")
class ProtoSchemaController(
    private val objectMapper: ObjectMapper
) {

    @PostMapping("/infer")
    fun infer(@RequestBody req: ProtoInferRequest): ProtoInferResponse {
        val result = when (req.format.uppercase()) {
            "JSON" -> inferFromJson(req.sample)
            "XML"  -> inferFromXml(req.sample)
            else   -> throw IllegalArgumentException("지원하지 않는 형식: ${req.format}. JSON 또는 XML 을 사용하세요.")
        }
        return ProtoInferResponse(result.fields, result.messages)
    }

    private data class InferResult(
        val fields: List<ProtoFieldDef>,
        val messages: List<ProtoMessageDef>,
    )

    // ── JSON 추론 ─────────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun inferFromJson(sample: String): InferResult {
        val root = objectMapper.readValue(sample, Map::class.java) as Map<String, Any?>
        val messages = mutableListOf<ProtoMessageDef>()
        val fields = extractJsonFields(root, AtomicInteger(1), messages)
        return InferResult(fields, messages)
    }

    /**
     * JSON 객체를 재귀적으로 순회하여 스키마를 추출한다.
     * - 중첩 객체 → 새 ProtoMessageDef 를 [messages] 에 추가 후, MESSAGE 타입 필드 생성
     * - 객체 배열 → 첫 원소로 ProtoMessageDef 생성 후 REPEATED MESSAGE 필드 생성
     * - 스칼라 배열 → REPEATED 스칼라 필드
     * - 스칼라 → 타입 추론 후 일반 필드
     */
    @Suppress("UNCHECKED_CAST")
    private fun extractJsonFields(
        obj: Map<String, Any?>,
        counter: AtomicInteger,
        messages: MutableList<ProtoMessageDef>,
    ): List<ProtoFieldDef> {
        val result = mutableListOf<ProtoFieldDef>()
        for ((key, value) in obj.entries) {
            val fieldName = sanitizeName(key)
            when {
                value is Map<*, *> -> {
                    val msgName = uniqueMessageName(toPascalCase(key), messages)
                    val nestedFields = extractJsonFields(value as Map<String, Any?>, AtomicInteger(1), messages)
                    messages.add(ProtoMessageDef(msgName, nestedFields))
                    result.add(ProtoFieldDef(
                        number = counter.getAndIncrement(),
                        name   = fieldName,
                        type   = ProtoFieldType.STRING,   // MESSAGE 타입 필드: type 무시됨
                        label  = ProtoFieldLabel.OPTIONAL,
                        messageTypeName = msgName,
                    ))
                }
                value is List<*> -> {
                    val first = (value as List<Any?>).firstOrNull { it != null }
                    if (first is Map<*, *>) {
                        val msgName = uniqueMessageName(toPascalCase(key) + "Item", messages)
                        val nestedFields = extractJsonFields(first as Map<String, Any?>, AtomicInteger(1), messages)
                        messages.add(ProtoMessageDef(msgName, nestedFields))
                        result.add(ProtoFieldDef(
                            number = counter.getAndIncrement(),
                            name   = fieldName,
                            type   = ProtoFieldType.STRING,
                            label  = ProtoFieldLabel.REPEATED,
                            messageTypeName = msgName,
                        ))
                    } else {
                        val elemType = if (first == null) ProtoFieldType.STRING
                                       else inferJsonScalarType(first)
                        result.add(ProtoFieldDef(counter.getAndIncrement(), fieldName, elemType, ProtoFieldLabel.REPEATED))
                    }
                }
                else -> {
                    val type = inferJsonScalarType(value)
                    result.add(ProtoFieldDef(counter.getAndIncrement(), fieldName, type, ProtoFieldLabel.OPTIONAL))
                }
            }
        }
        return result
    }

    private fun inferJsonScalarType(value: Any?): ProtoFieldType = when (value) {
        null       -> ProtoFieldType.STRING
        is Boolean -> ProtoFieldType.BOOL
        is Int     -> ProtoFieldType.INT32
        is Long    -> ProtoFieldType.INT64
        is Float   -> ProtoFieldType.FLOAT
        is Double  -> ProtoFieldType.DOUBLE
        is Number  -> {
            val str = value.toString()
            if (str.contains('.')) ProtoFieldType.DOUBLE else ProtoFieldType.INT64
        }
        else       -> ProtoFieldType.STRING
    }

    // ── XML 추론 ─────────────────────────────────────────────────────────────

    private fun inferFromXml(sample: String): InferResult {
        val factory = DocumentBuilderFactory.newInstance().also {
            it.isNamespaceAware = false
            it.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        }
        val builder = factory.newDocumentBuilder()
        val doc = builder.parse(InputSource(StringReader(sample)))
        val messages = mutableListOf<ProtoMessageDef>()
        val fields = extractXmlFields(doc.documentElement, AtomicInteger(1), messages)
        return InferResult(fields, messages)
    }

    /**
     * XML 엘리먼트를 재귀적으로 순회하여 스키마를 추출한다.
     * - 자식 엘리먼트 있음 → 새 ProtoMessageDef 생성 후 MESSAGE 필드
     * - 반복 태그 → REPEATED
     * - 리프 → 타입 추론 후 스칼라 필드
     */
    private fun extractXmlFields(
        el: org.w3c.dom.Element,
        counter: AtomicInteger,
        messages: MutableList<ProtoMessageDef>,
    ): List<ProtoFieldDef> {
        val childElements = (0 until el.childNodes.length)
            .map { el.childNodes.item(it) }
            .filter { it.nodeType == org.w3c.dom.Node.ELEMENT_NODE }
            .map { it as org.w3c.dom.Element }

        if (childElements.isEmpty()) {
            val name = sanitizeName(el.tagName)
            val type = inferXmlTextType(el.textContent?.trim() ?: "")
            return listOf(ProtoFieldDef(counter.getAndIncrement(), name, type, ProtoFieldLabel.OPTIONAL))
        }

        val tagCounts = childElements.groupingBy { it.tagName }.eachCount()
        val seen = mutableSetOf<String>()
        val result = mutableListOf<ProtoFieldDef>()

        for (child in childElements) {
            val tag = child.tagName
            if (!seen.add(tag)) continue
            val fieldName = sanitizeName(tag)
            val repeated  = (tagCounts[tag] ?: 1) > 1
            val hasChildren = (0 until child.childNodes.length).any {
                child.childNodes.item(it).nodeType == org.w3c.dom.Node.ELEMENT_NODE
            }

            if (hasChildren) {
                val msgName = uniqueMessageName(toPascalCase(tag), messages)
                val nestedFields = extractXmlFields(child, AtomicInteger(1), messages)
                messages.add(ProtoMessageDef(msgName, nestedFields))
                result.add(ProtoFieldDef(
                    number = counter.getAndIncrement(),
                    name   = fieldName,
                    type   = ProtoFieldType.STRING,
                    label  = if (repeated) ProtoFieldLabel.REPEATED else ProtoFieldLabel.OPTIONAL,
                    messageTypeName = msgName,
                ))
            } else {
                val type  = inferXmlTextType(child.textContent?.trim() ?: "")
                val label = if (repeated) ProtoFieldLabel.REPEATED else ProtoFieldLabel.OPTIONAL
                result.add(ProtoFieldDef(counter.getAndIncrement(), fieldName, type, label))
            }
        }
        return result
    }

    private fun inferXmlTextType(text: String): ProtoFieldType = when {
        text == "true" || text == "false"                      -> ProtoFieldType.BOOL
        text.matches(Regex("-?\\d+"))                          -> ProtoFieldType.INT64
        text.matches(Regex("-?\\d+\\.\\d+([eE][+-]?\\d+)?")) -> ProtoFieldType.DOUBLE
        else                                                   -> ProtoFieldType.STRING
    }

    // ── 공통 헬퍼 ─────────────────────────────────────────────────────────────

    /** proto 필드 이름: 소문자+숫자+언더스코어만 허용. */
    private fun sanitizeName(name: String): String =
        name.replace(Regex("[^a-zA-Z0-9_]"), "_")
            .let { if (it.first().isDigit()) "_$it" else it }

    /** camelCase / snake_case → PascalCase (메시지 타입 이름용). */
    private fun toPascalCase(name: String): String =
        name.split(Regex("[_\\-\\s]+"))
            .joinToString("") { it.replaceFirstChar { c -> c.uppercase() } }
            .ifEmpty { "Message" }

    /** 이미 [messages] 에 같은 이름이 있으면 숫자를 붙여 고유 이름 생성. */
    private fun uniqueMessageName(base: String, messages: List<ProtoMessageDef>): String {
        val existing = messages.map { it.name }.toSet()
        if (base !in existing) return base
        var i = 2
        while ("$base$i" in existing) i++
        return "$base$i"
    }
}
