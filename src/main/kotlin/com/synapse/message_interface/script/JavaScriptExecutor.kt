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

    // 스레드별 컴파일된 함수 캐시 — Context 재생성 시 함께 초기화
    private val threadLocalFnCache = ThreadLocal.withInitial { mutableMapOf<String, org.graalvm.polyglot.Value>() }

    /**
     * 사용자가 작성한 JS 템플릿 코드({$key} 포함)를 실행.
     * vars를 JSON 문자열로 직렬화 후 함수 파라미터로 전달 → JSON.parse로 네이티브 JS 객체 생성.
     * 이 방식으로 Source 캐싱 문제(리스트 원소 간 결과 공유)와 Java String 타입 문제를 동시에 해결.
     */
    suspend fun executeTemplate(templateCode: String, vars: Map<String, Any?>, timeoutMs: Long = 3000L): Any? {
        validateImports(templateCode)

        return withTimeoutOrNull(timeoutMs) {
            runInterruptible {
                val context = threadLocalContext.get()
                try {
                    val fn = threadLocalFnCache.get().getOrPut(templateCode) {
                        val source = Source.newBuilder("js", buildFnCode(templateCode), "fn")
                            .cached(false)
                            .build()
                        context.eval(source)
                    }
                    convertValue(fn.execute(toJsonString(vars)))
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
        threadLocalFnCache.get().clear()
        threadLocalFnCache.remove()
    }

    /**
     * {$key} → __vars["key"] 변환 후 __varsJson 파라미터를 받는 함수로 컴파일.
     * JSON.parse(__varsJson)으로 매 호출마다 새로운 네이티브 JS 객체를 생성하므로
     * 리스트 원소 간 상태 공유가 원천 차단됨.
     */
    private fun buildFnCode(templateCode: String): String {
        if (templateCode.isBlank())
            throw ScriptExecutionException("스크립트 코드가 비어 있습니다. 코드를 입력하거나 해당 규칙을 삭제하세요.")
        val transformed = PLACEHOLDER_REGEX.replace(templateCode) { match ->
            """__vars["${match.groupValues[1]}"]"""
        }
        return "(function(__varsJson) { var __vars = JSON.parse(__varsJson); return ($transformed); })"
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
