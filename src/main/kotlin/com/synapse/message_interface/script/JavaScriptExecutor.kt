package com.synapse.message_interface.script

import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withTimeoutOrNull
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.Engine
import org.graalvm.polyglot.Source
import org.springframework.stereotype.Component

class ScriptExecutionTimeoutException(message: String) : RuntimeException(message)
class ScriptExecutionException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

@Component
class JavaScriptExecutor {
    companion object {
        private val BLOCKED_PATTERNS = listOf("java.", "Packages.", "Java.type")
        private val PLACEHOLDER_REGEX = Regex("""\{\$([^}]+)\}""")
        private val ENGINE = Engine.create()
    }

    private val threadLocalContext = ThreadLocal.withInitial {
        Context.newBuilder("js")
            .engine(ENGINE)
            .allowAllAccess(false)
            .build()
    }

    /**
     * 사용자가 작성한 JS 템플릿 코드({$key} 포함)를 실행.
     * vars JSON을 소스코드에 직접 임베드한 뒤 context.eval()로 실행한다.
     * fn.execute(arg) 방식은 OpenJDK 환경의 GraalVM에서 두 번째 호출 시
     * 첫 번째 인자가 재사용되는 버그가 있어 리스트 원소 간 결과가 동일해지는 현상이 발생한다.
     */
    suspend fun executeTemplate(templateCode: String, vars: Map<String, Any?>, timeoutMs: Long = 3000L): Any? {
        validateImports(templateCode)

        return withTimeoutOrNull(timeoutMs) {
            runInterruptible {
                val context = threadLocalContext.get()
                try {
                    val source = Source.newBuilder("js", buildEmbeddedCode(templateCode, toJsonString(vars)), "exec")
                        .cached(false)
                        .build()
                    convertValue(context.eval(source))
                } catch (e: OutOfMemoryError) {
                    closeAndReset(context)
                    throw ScriptExecutionException("스크립트 메모리 한도 초과", e)
                } catch (e: Exception) {
                    closeAndReset(context)
                    throw ScriptExecutionException("스크립트 실행 오류: ${e.message}", e)
                }
            }
        } ?: throw ScriptExecutionTimeoutException("스크립트 실행 시간 초과 (${timeoutMs}ms)")
    }

    private fun closeAndReset(context: Context) {
        context.close()
        threadLocalContext.remove()
    }

    /**
     * {$key} → __vars["key"] 변환 후, vars JSON을 소스에 직접 임베드한 즉시실행 함수 생성.
     * 파라미터 전달 없이 JSON.parse로 매 호출마다 완전히 독립된 JS 객체를 생성한다.
     */
    private fun buildEmbeddedCode(templateCode: String, varsJson: String): String {
        if (templateCode.isBlank())
            throw ScriptExecutionException("스크립트 코드가 비어 있습니다. 코드를 입력하거나 해당 규칙을 삭제하세요.")
        val transformed = PLACEHOLDER_REGEX.replace(templateCode) { match ->
            """__vars["${match.groupValues[1]}"]"""
        }
        return "(function() { var __vars = JSON.parse(${jsStringLiteral(varsJson)}); return ($transformed); })()"
    }

    private fun jsStringLiteral(s: String): String {
        val escaped = s.replace("\\", "\\\\").replace("'", "\\'")
        return "'$escaped'"
    }

    private fun convertValue(value: org.graalvm.polyglot.Value): Any? = when {
        value.isNull             -> null
        value.isBoolean          -> value.asBoolean()
        value.fitsInInt()        -> value.asInt()
        value.fitsInDouble()     -> value.asDouble()
        value.isString           -> value.asString()
        value.hasArrayElements() -> (0 until value.arraySize).map { convertValue(value.getArrayElement(it)) }
        value.hasMembers()       -> value.memberKeys.associateWith { convertValue(value.getMember(it)) }
        else                     -> value.toString()
    }

    private fun toJsonString(vars: Map<String, Any?>): String {
        val sb = StringBuilder("{")
        vars.entries.forEachIndexed { i, (k, v) ->
            if (i > 0) sb.append(',')
            sb.append('"').append(jsonEscape(k)).append("\":")
            appendJson(sb, v)
        }
        sb.append('}')
        return sb.toString()
    }

    private fun appendJson(sb: StringBuilder, v: Any?) {
        when (v) {
            null      -> sb.append("null")
            is Boolean -> sb.append(v)
            is Int, is Long, is Short, is Byte -> sb.append(v)
            is Float  -> if (v.isNaN() || v.isInfinite()) sb.append("null") else sb.append(v)
            is Double -> if (v.isNaN() || v.isInfinite()) sb.append("null") else sb.append(v)
            is String -> sb.append('"').append(jsonEscape(v)).append('"')
            is List<*> -> {
                sb.append('[')
                v.forEachIndexed { i, item -> if (i > 0) sb.append(','); appendJson(sb, item) }
                sb.append(']')
            }
            is Map<*, *> -> {
                sb.append('{')
                @Suppress("UNCHECKED_CAST")
                (v as Map<String, Any?>).entries.forEachIndexed { i, (mk, mv) ->
                    if (i > 0) sb.append(',')
                    sb.append('"').append(jsonEscape(mk)).append("\":")
                    appendJson(sb, mv)
                }
                sb.append('}')
            }
            else -> sb.append('"').append(jsonEscape(v.toString())).append('"')
        }
    }

    private fun jsonEscape(s: String) = buildString {
        for (c in s) when (c) {
            '"'      -> append("\\\"")
            '\\'     -> append("\\\\")
            '\n'     -> append("\\n")
            '\r'     -> append("\\r")
            '\t'     -> append("\\t")
            '\b'     -> append("\\b")
            '' -> append("\\f")
            else     -> if (c < ' ') append("\\u${c.code.toString(16).padStart(4, '0')}") else append(c)
        }
    }

    private fun validateImports(code: String) {
        for (blocked in BLOCKED_PATTERNS) {
            if (code.contains(blocked)) {
                throw ScriptExecutionException(
                    "허용되지 않은 패턴: '$blocked'. 허용된 타입: 기본 JS 타입 (String, Number, Boolean 등)"
                )
            }
        }
    }
}
