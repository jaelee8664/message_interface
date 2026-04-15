package com.synapse.message_interface.manual

import tools.jackson.databind.ObjectMapper
import com.synapse.message_interface.config.MongoWorkflowRepository
import com.synapse.message_interface.domain.FieldDefinition
import com.synapse.message_interface.domain.FieldType
import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.CustomDtoDefinition
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.domain.node.Node4Definition
import com.synapse.message_interface.domain.node.Node5Definition
import com.synapse.message_interface.domain.node.NodeErrorField
import com.synapse.message_interface.domain.node.NodeErrorFieldSource
import org.apache.poi.xwpf.usermodel.ParagraphAlignment
import org.apache.poi.xwpf.usermodel.XWPFDocument
import org.apache.poi.xwpf.usermodel.XWPFTable
import org.apache.poi.xwpf.usermodel.XWPFTableRow
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblWidth
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STTblWidth
import org.springframework.stereotype.Service
import reactor.core.publisher.Mono
import java.io.ByteArrayOutputStream
import java.math.BigInteger

enum class ManualFormat { MARKDOWN, WORD }

@Service
class ManualService(
    private val repo: MongoWorkflowRepository,
    private val objectMapper: ObjectMapper
) {

    fun generate(unitIds: List<String>, format: ManualFormat): Mono<ByteArray> {
        return repo.findAllById(unitIds)
            .collectList()
            .map { units ->
                val ordered = unitIds.mapNotNull { id -> units.find { it.id == id } }
                when (format) {
                    ManualFormat.MARKDOWN -> buildMarkdown(ordered).toByteArray(Charsets.UTF_8)
                    ManualFormat.WORD     -> buildWord(ordered)
                }
            }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Example message generation
    // ─────────────────────────────────────────────────────────────────────────

    private fun exampleValue(field: FieldDefinition, customDtos: List<CustomDtoDefinition>): Any =
        when (field.type) {
            FieldType.STRING  -> field.defaultValue ?: "string"
            FieldType.INT     -> field.defaultValue?.toIntOrNull() ?: 0
            FieldType.DOUBLE  -> field.defaultValue?.toDoubleOrNull() ?: 0.0
            FieldType.BOOLEAN -> field.defaultValue?.toBooleanStrictOrNull() ?: true
            FieldType.MAP     -> emptyMap<String, Any>()
            FieldType.LIST    -> {
                val item: Any = when (field.listItemType) {
                    FieldType.STRING  -> "string"
                    FieldType.INT     -> 0
                    FieldType.DOUBLE  -> 0.0
                    FieldType.BOOLEAN -> true
                    FieldType.CUSTOM  -> customDtos.find { it.name == field.customTypeName }
                        ?.let { buildExampleMap(it.fields, customDtos) } ?: emptyMap<String, Any>()
                    else -> "item"
                }
                listOf(item)
            }
            FieldType.CUSTOM  -> customDtos.find { it.name == field.customTypeName }
                ?.let { buildExampleMap(it.fields, customDtos) } ?: emptyMap<String, Any>()
        }

    private fun setNested(map: MutableMap<String, Any>, parts: List<String>, value: Any) {
        if (parts.size == 1) { map[parts[0]] = value; return }
        @Suppress("UNCHECKED_CAST")
        val child = map.getOrPut(parts[0]) { mutableMapOf<String, Any>() } as MutableMap<String, Any>
        setNested(child, parts.drop(1), value)
    }

    private fun buildExampleMap(fields: List<FieldDefinition>, customDtos: List<CustomDtoDefinition>): Map<String, Any> {
        val root = mutableMapOf<String, Any>()
        fields.forEach { f -> setNested(root, f.key.split("."), exampleValue(f, customDtos)) }
        return root
    }

    private fun toJsonExample(fields: List<FieldDefinition>, customDtos: List<CustomDtoDefinition>): String =
        objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(buildExampleMap(fields, customDtos))

    private fun buildResponseExampleMap(fields: List<NodeErrorField>): Map<String, Any> =
        fields.associate { f ->
            f.key to when (f.source) {
                NodeErrorFieldSource.LITERAL           -> f.value
                NodeErrorFieldSource.FROM_MAP          -> "<${f.value} 값>"
                NodeErrorFieldSource.EXCEPTION_MESSAGE -> "<예외 메시지>"
            }
        }

    private fun toJsonResponseExample(fields: List<NodeErrorField>): String =
        objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(buildResponseExampleMap(fields))

    private fun toXmlResponseExample(fields: List<NodeErrorField>): String = buildString {
        appendLine("<response>")
        buildResponseExampleMap(fields).forEach { (k, v) -> appendLine("  <$k>$v</$k>") }
        append("</response>")
    }

    private fun toProtobufResponseExample(fields: List<NodeErrorField>): String = buildString {
        appendLine("message Response {")
        buildResponseExampleMap(fields).entries.forEachIndexed { idx, (k, _) ->
            appendLine("  string $k = ${idx + 1};")
        }
        append("}")
    }

    private fun toXmlExample(fields: List<FieldDefinition>, customDtos: List<CustomDtoDefinition>): String {
        val map = buildExampleMap(fields, customDtos)
        return buildString {
            appendLine("<message>")
            appendMapAsXml(map, indent = "  ")
            append("</message>")
        }
    }

    private fun toProtobufExample(fields: List<FieldDefinition>, customDtos: List<CustomDtoDefinition>): String {
        val map = buildExampleMap(fields, customDtos)
        return buildString {
            appendLine("message Message {")
            var fieldNumber = 1
            map.forEach { (k, v) ->
                val type = when (v) {
                    is Boolean -> "bool"
                    is Int     -> "int32"
                    is Long    -> "int64"
                    is Float   -> "float"
                    is Double  -> "double"
                    is List<*> -> "repeated string"
                    is Map<*, *> -> "bytes"
                    else       -> "string"
                }
                appendLine("  $type $k = ${fieldNumber++};")
            }
            append("}")
        }
    }

    private fun StringBuilder.appendMapAsXml(map: Map<*, *>, indent: String) {
        map.forEach { (k, v) ->
            when (v) {
                is Map<*, *> -> {
                    appendLine("$indent<$k>")
                    appendMapAsXml(v, "$indent  ")
                    appendLine("$indent</$k>")
                }
                is List<*> -> {
                    v.forEach { item ->
                        if (item is Map<*, *>) {
                            appendLine("$indent<$k>")
                            appendMapAsXml(item, "$indent  ")
                            appendLine("$indent</$k>")
                        } else {
                            appendLine("$indent<$k>$item</$k>")
                        }
                    }
                }
                else -> appendLine("$indent<$k>$v</$k>")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Markdown
    // ─────────────────────────────────────────────────────────────────────────

    private fun buildMarkdown(units: List<WorkflowUnit>): String = buildString {
        appendLine("# 프로토콜 정의서")
        appendLine()
        units.forEach { unit ->
            appendLine("---")
            appendLine()
            appendUnitMarkdown(unit)
        }
    }

    private fun StringBuilder.appendUnitMarkdown(unit: WorkflowUnit) {
        val node0 = unit.nodes.find { it.nodeType.name == "NODE0" }?.node0
        val node1 = unit.nodes.find { it.nodeType.name == "NODE1" }?.node1
        val node4 = unit.nodes.find { it.nodeType.name == "NODE4" }?.node4
        val node5 = unit.nodes.find { it.nodeType.name == "NODE5" }?.node5

        appendLine("## ${unit.name}")
        appendLine()

        // NODE0 — 통신 방식 및 엔드포인트
        if (node0 != null) {
            appendLine("### 통신 방식 및 엔드포인트")
            appendLine()
            appendLine(describeNode0Markdown(node0))
            appendLine()
        }

        // NODE1 — 입력 메시지 스키마 + 예시
        if (node1 != null) {
            appendLine("### 입력 메시지 스키마")
            appendLine()
            appendLine("- **포맷**: ${node1.messageFormat}")
            appendLine()
            appendFieldTableMarkdown(node1.fields)
            if (node1.customDtos.isNotEmpty()) {
                appendLine()
                appendLine("#### 커스텀 타입")
                appendLine()
                node1.customDtos.forEach { dto -> appendCustomDtoMarkdown(dto) }
            }
            if (node1.fields.isNotEmpty()) {
                appendLine()
                appendLine("#### 예시 메시지")
                appendLine()
                when (node1.messageFormat) {
                    MessageFormat.JSON -> {
                        appendLine("```json")
                        appendLine(toJsonExample(node1.fields, node1.customDtos))
                        appendLine("```")
                    }
                    MessageFormat.XML -> {
                        appendLine("```xml")
                        appendLine(toXmlExample(node1.fields, node1.customDtos))
                        appendLine("```")
                    }
                    MessageFormat.PROTOBUF -> {
                        appendLine("```protobuf")
                        appendLine(toProtobufExample(node1.fields, node1.customDtos))
                        appendLine("```")
                    }
                }
            }
            appendLine()
        }

        // 응답
        if (node5 != null) {
            appendLine("### 응답")
            appendLine()
            appendNode5Markdown(node5)
            appendLine()
        } else {
            appendLine("### 응답")
            appendLine()
            appendLine("**Fire-and-forget** — 호출자에게 응답을 반환하지 않습니다.")
            if (node4 != null) {
                appendLine()
                appendLine("처리 결과는 다음으로 전달됩니다:")
                appendLine(describeNode4Markdown(node4))
            }
            appendLine()
        }
    }

    private fun describeNode0Markdown(n: Node0Definition): String = buildString {
        appendLine("- **프로토콜**: ${n.protocol}")
        n.port?.let { appendLine("- **포트**: $it") }
        n.path?.let { appendLine("- **엔드포인트**: `$it`") }
        n.host?.let { appendLine("- **호스트**: $it") }
        n.topic?.let { appendLine("- **토픽**: $it") }
        n.groupId?.let { appendLine("- **그룹 ID**: $it") }
        n.bootstrapServers?.let { appendLine("- **Bootstrap Servers**: $it") }
        n.mongoQueueName?.let { appendLine("- **큐 이름**: $it") }
    }.trimEnd()

    private fun StringBuilder.appendFieldTableMarkdown(fields: List<FieldDefinition>) {
        if (fields.isEmpty()) { appendLine("_(필드 없음)_"); return }
        appendLine("| 필드명 | 타입 | 필수 | 기본값 | 설명 |")
        appendLine("|--------|------|------|--------|------|")
        fields.forEach { f ->
            val mandatory = if (f.mandatory) "✓" else ""
            appendLine("| `${f.key}` | ${fieldTypeLabel(f)} | $mandatory | ${f.defaultValue ?: ""} | ${f.description} |")
        }
    }

    private fun StringBuilder.appendCustomDtoMarkdown(dto: CustomDtoDefinition) {
        appendLine("**${dto.name}**")
        appendLine()
        appendFieldTableMarkdown(dto.fields)
        appendLine()
    }

    private fun StringBuilder.appendNode5Markdown(n: Node5Definition) {
        appendLine("#### 성공 응답")
        appendLine()
        val sc = n.successConfig
        appendLine("- **HTTP 상태**: ${sc.httpStatus}")
        appendLine("- **포맷**: ${sc.messageFormat}")
        if (sc.passCurrentMap) {
            appendLine("- **본문**: 파이프라인 처리 결과 전체 반환")
        } else if (sc.fields.isNotEmpty()) {
            appendLine()
            appendLine("| 필드명 | 값 출처 | 값 |")
            appendLine("|--------|---------|-----|")
            sc.fields.forEach { f -> appendLine("| `${f.key}` | ${f.source} | ${f.value} |") }
            appendLine()
            appendLine("##### 예시 응답")
            appendLine()
            when (sc.messageFormat) {
                MessageFormat.JSON     -> { appendLine("```json");     appendLine(toJsonResponseExample(sc.fields)); appendLine("```") }
                MessageFormat.XML      -> { appendLine("```xml");      appendLine(toXmlResponseExample(sc.fields));  appendLine("```") }
                MessageFormat.PROTOBUF -> { appendLine("```protobuf"); appendLine(toProtobufResponseExample(sc.fields)); appendLine("```") }
            }
        } else {
            appendLine("- **본문**: 없음")
        }
        appendLine()
        appendLine("#### 오류 응답")
        appendLine()
        val ec = n.defaultErrorConfig
        appendLine("- **HTTP 상태**: 예외에 따라 자동 결정 (ResponseStatusException → 해당 코드, 그 외 → 500)")
        appendLine("- **포맷**: ${ec.messageFormat}")
        if (ec.fields.isNotEmpty()) {
            appendLine()
            appendLine("| 필드명 | 값 출처 | 값 |")
            appendLine("|--------|---------|-----|")
            ec.fields.forEach { f -> appendLine("| `${f.key}` | ${f.source} | ${f.value} |") }
            appendLine()
            appendLine("##### 예시 오류 응답")
            appendLine()
            when (ec.messageFormat) {
                MessageFormat.JSON     -> { appendLine("```json");     appendLine(toJsonResponseExample(ec.fields));     appendLine("```") }
                MessageFormat.XML      -> { appendLine("```xml");      appendLine(toXmlResponseExample(ec.fields));      appendLine("```") }
                MessageFormat.PROTOBUF -> { appendLine("```protobuf"); appendLine(toProtobufResponseExample(ec.fields)); appendLine("```") }
            }
        }
    }

    private fun describeNode4Markdown(n: Node4Definition): String = buildString {
        appendLine("- **프로토콜**: ${n.protocol}")
        n.targetHost?.let { appendLine("- **호스트**: $it") }
        n.targetPort?.let { appendLine("- **포트**: $it") }
        n.targetPath?.let { appendLine("- **경로**: `$it`") }
        n.targetTopic?.let { appendLine("- **토픽**: $it") }
        n.bootstrapServers?.let { appendLine("- **Bootstrap Servers**: $it") }
        n.mongoQueueName?.let { appendLine("- **큐 이름**: $it") }
        appendLine("- **포맷**: ${n.messageFormat}")
    }.trimEnd()

    private fun fieldTypeLabel(f: FieldDefinition): String = when (f.type) {
        FieldType.CUSTOM -> f.customTypeName ?: "CUSTOM"
        FieldType.LIST   -> "LIST<${f.listItemType ?: "?"}>"
        else             -> f.type.name
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Word (.docx)
    // ─────────────────────────────────────────────────────────────────────────

    private fun buildWord(units: List<WorkflowUnit>): ByteArray {
        val doc = XWPFDocument()
        doc.createParagraph().also { p ->
            p.alignment = ParagraphAlignment.CENTER
            p.createRun().also { r -> r.setText("프로토콜 정의서"); r.isBold = true; r.fontSize = 20 }
        }
        units.forEachIndexed { idx, unit ->
            if (idx > 0) doc.createParagraph().createRun().addBreak()
            appendUnitWord(doc, unit)
        }
        return ByteArrayOutputStream().also { doc.write(it) }.toByteArray()
    }

    private fun appendUnitWord(doc: XWPFDocument, unit: WorkflowUnit) {
        val node0 = unit.nodes.find { it.nodeType.name == "NODE0" }?.node0
        val node1 = unit.nodes.find { it.nodeType.name == "NODE1" }?.node1
        val node4 = unit.nodes.find { it.nodeType.name == "NODE4" }?.node4
        val node5 = unit.nodes.find { it.nodeType.name == "NODE5" }?.node5

        heading1(doc, unit.name)

        // NODE0
        if (node0 != null) {
            heading2(doc, "통신 방식 및 엔드포인트")
            bodyText(doc, describeNode0Text(node0))
        }

        // NODE1
        if (node1 != null) {
            heading2(doc, "입력 메시지 스키마")
            bodyText(doc, "포맷: ${node1.messageFormat}")
            if (node1.fields.isNotEmpty()) fieldTable(doc, node1.fields)
            node1.customDtos.forEach { dto ->
                heading3(doc, "커스텀 타입: ${dto.name}")
                if (dto.fields.isNotEmpty()) fieldTable(doc, dto.fields)
            }
            if (node1.fields.isNotEmpty()) {
                heading3(doc, "예시 메시지")
                val example = when (node1.messageFormat) {
                    MessageFormat.JSON     -> toJsonExample(node1.fields, node1.customDtos)
                    MessageFormat.XML      -> toXmlExample(node1.fields, node1.customDtos)
                    MessageFormat.PROTOBUF -> toProtobufExample(node1.fields, node1.customDtos)
                }
                monoText(doc, example)
            }
        }

        // 응답
        heading2(doc, "응답")
        if (node5 != null) {
            val sc = node5.successConfig
            heading3(doc, "성공 응답")
            bodyText(doc, "HTTP 상태: ${sc.httpStatus}\n포맷: ${sc.messageFormat}")
            if (sc.passCurrentMap) {
                bodyText(doc, "본문: 파이프라인 처리 결과 전체 반환")
            } else if (sc.fields.isNotEmpty()) {
                responseFieldTable(doc, sc.fields.map { Triple(it.key, it.source.name, it.value) })
                heading3(doc, "예시 응답")
                monoText(doc, when (sc.messageFormat) {
                    MessageFormat.JSON     -> toJsonResponseExample(sc.fields)
                    MessageFormat.XML      -> toXmlResponseExample(sc.fields)
                    MessageFormat.PROTOBUF -> toProtobufResponseExample(sc.fields)
                })
            } else {
                bodyText(doc, "본문: 없음")
            }
            val ec = node5.defaultErrorConfig
            heading3(doc, "오류 응답")
            bodyText(doc, "HTTP 상태: 예외에 따라 자동 결정 (ResponseStatusException → 해당 코드, 그 외 → 500)\n포맷: ${ec.messageFormat}")
            if (ec.fields.isNotEmpty()) {
                responseFieldTable(doc, ec.fields.map { Triple(it.key, it.source.name, it.value) })
                heading3(doc, "예시 오류 응답")
                monoText(doc, when (ec.messageFormat) {
                    MessageFormat.JSON     -> toJsonResponseExample(ec.fields)
                    MessageFormat.XML      -> toXmlResponseExample(ec.fields)
                    MessageFormat.PROTOBUF -> toProtobufResponseExample(ec.fields)
                })
            }
        } else {
            bodyText(doc, "Fire-and-forget — 호출자에게 응답을 반환하지 않습니다.")
            if (node4 != null) bodyText(doc, "처리 결과 전달 대상:\n${describeNode4Text(node4)}")
        }
    }

    private fun heading1(doc: XWPFDocument, text: String) {
        doc.createParagraph().also { p ->
            p.style = "Heading1"
            p.createRun().also { r -> r.setText(text); r.isBold = true; r.fontSize = 16 }
        }
    }

    private fun heading2(doc: XWPFDocument, text: String) {
        doc.createParagraph().also { p ->
            p.style = "Heading2"
            p.createRun().also { r -> r.setText(text); r.isBold = true; r.fontSize = 13 }
        }
    }

    private fun heading3(doc: XWPFDocument, text: String) {
        doc.createParagraph().also { p ->
            p.createRun().also { r -> r.setText(text); r.isBold = true; r.fontSize = 11 }
        }
    }

    private fun bodyText(doc: XWPFDocument, text: String) {
        doc.createParagraph().also { p ->
            p.createRun().also { r -> r.setText(text); r.fontSize = 10 }
        }
    }

    private fun monoText(doc: XWPFDocument, text: String) {
        text.split("\n").forEach { line ->
            doc.createParagraph().also { p ->
                p.createRun().also { r ->
                    val leadingSpaces = line.length - line.trimStart().length
                    r.setText("\u00A0".repeat(leadingSpaces) + line.trimStart())
                    r.fontSize = 9
                    r.fontFamily = "Courier New"
                }
            }
        }
    }

    private fun fieldTable(doc: XWPFDocument, fields: List<FieldDefinition>) {
        val headers = listOf("필드명", "타입", "필수", "기본값", "설명")
        val rows = fields.map { f ->
            listOf(f.key, fieldTypeLabel(f), if (f.mandatory) "✓" else "", f.defaultValue ?: "", f.description)
        }
        createTable(doc, headers, rows)
    }

    private fun responseFieldTable(doc: XWPFDocument, rows: List<Triple<String, String, String>>) {
        createTable(doc, listOf("필드명", "값 출처", "값"), rows.map { listOf(it.first, it.second, it.third) })
    }

    private fun createTable(doc: XWPFDocument, headers: List<String>, rows: List<List<String>>) {
        val table = doc.createTable(1 + rows.size, headers.size)
        setTableFullWidth(table)
        val headerRow = table.getRow(0)
        headers.forEachIndexed { i, h ->
            headerRow.getCell(i).also { cell ->
                cell.removeParagraph(0)
                cell.addParagraph().createRun().also { r -> r.setText(h); r.isBold = true; r.fontSize = 9 }
            }
        }
        rows.forEachIndexed { ri, row ->
            val tableRow: XWPFTableRow = table.getRow(ri + 1)
            row.forEachIndexed { ci, value ->
                tableRow.getCell(ci).also { cell ->
                    cell.removeParagraph(0)
                    cell.addParagraph().createRun().also { r -> r.setText(value); r.fontSize = 9 }
                }
            }
        }
    }

    private fun setTableFullWidth(table: XWPFTable) {
        val tblPr = table.ctTbl.tblPr ?: table.ctTbl.addNewTblPr()
        val tblW: CTTblWidth = tblPr.tblW ?: tblPr.addNewTblW()
        tblW.w = BigInteger.valueOf(9638)
        tblW.type = STTblWidth.DXA
    }

    private fun describeNode0Text(n: Node0Definition): String = buildString {
        append("프로토콜: ${n.protocol}")
        n.port?.let { append("\n포트: $it") }
        n.path?.let { append("\n엔드포인트: $it") }
        n.host?.let { append("\n호스트: $it") }
        n.topic?.let { append("\n토픽: $it") }
        n.groupId?.let { append("\n그룹 ID: $it") }
        n.bootstrapServers?.let { append("\nBootstrap Servers: $it") }
        n.mongoQueueName?.let { append("\n큐 이름: $it") }
    }

    private fun describeNode4Text(n: Node4Definition): String = buildString {
        append("프로토콜: ${n.protocol}")
        n.targetHost?.let { append("\n호스트: $it") }
        n.targetPort?.let { append("\n포트: $it") }
        n.targetPath?.let { append("\n경로: $it") }
        n.targetTopic?.let { append("\n토픽: $it") }
        n.bootstrapServers?.let { append("\nBootstrap Servers: $it") }
        n.mongoQueueName?.let { append("\n큐 이름: $it") }
        append("\n포맷: ${n.messageFormat}")
    }
}
