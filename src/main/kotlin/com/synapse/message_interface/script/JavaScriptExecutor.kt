package com.synapse.message_interface.script

import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withTimeoutOrNull
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.Engine
import org.graalvm.polyglot.Source
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

class ScriptExecutionTimeoutException(message: String) : RuntimeException(message)
class ScriptExecutionException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

@Component
class JavaScriptExecutor {
    companion object {
        private val BLOCKED_PATTERNS = listOf("java.", "Packages.", "Java.type")
        private val PLACEHOLDER_REGEX = Regex("""\{\$([^}]+)\}""")

        // 공유 Engine: 스레드 간 AST 캐시 공유 (OpenJDK 환경 — Truffle JIT 미지원)
        private val ENGINE = Engine.create()
    }

    // Source 캐시: templateCode → Source (재시작 시 자동 초기화 — JVM 메모리 객체)
    private val sourceCache = ConcurrentHashMap<String, Source>()

    // Context는 thread-safe하지 않으므로 스레드별 재사용
    private val threadLocalContext = ThreadLocal.withInitial {
        Context.newBuilder("js")
            .engine(ENGINE)
            .allowAllAccess(false)  // Java 클래스 접근 차단
            .build()
    }

    /**
     * 사용자가 작성한 JS 템플릿 코드({$key} 포함)를 파싱 캐싱 후 실행.
     * OpenJDK 환경에서는 Truffle JIT 미지원 — 인터프리터 모드로 동작.
     * Source.cached(true) + 공유 Engine으로 파싱/AST 재사용(파싱 오버헤드 제거)은 유효.
     * @param templateCode 사용자가 작성한 JS 코드 ({$body.status} 형태 포함)
     * @param vars flatten된 메시지 맵 (실행 시 __vars로 바인딩)
     */
    suspend fun executeTemplate(templateCode: String, vars: Map<String, Any?>, timeoutMs: Long = 3000L): Any? {
        validateImports(templateCode)

        val source = sourceCache.getOrPut(templateCode) { buildSource(templateCode) }

        return withTimeoutOrNull(timeoutMs) {
            runInterruptible {
                val context = threadLocalContext.get()
                try {
                    val jsVars = context.eval("js", "Object.create(null)")
                    for ((k, v) in vars) {
                        jsVars.putMember(k, v)
                    }
                    context.getBindings("js").putMember("__vars", jsVars)
                    convertValue(context.eval(source))
                } catch (e: OutOfMemoryError) {
                    // OOM은 Exception이 아닌 Error — 별도 캐치하여 Context 정리 후 변환
                    context.close()
                    threadLocalContext.remove()
                    throw ScriptExecutionException("스크립트 메모리 한도 초과", e)
                } catch (e: Exception) {
                    // 예외 발생 시 Context 상태가 불안정할 수 있으므로 재생성
                    context.close()
                    threadLocalContext.remove()
                    throw ScriptExecutionException("스크립트 실행 오류: ${e.message}", e)
                }
            }
        } ?: throw ScriptExecutionTimeoutException("스크립트 실행 시간 초과 (${timeoutMs}ms)")
    }

    /**
     * GraalVM Value → Kotlin 타입 재귀 변환.
     * JS object → Map<String, Any?>, JS array → List<Any?>, primitive → 해당 타입
     */
    private fun convertValue(value: org.graalvm.polyglot.Value): Any? = when {
        value.isNull            -> null
        value.isBoolean         -> value.asBoolean()
        value.fitsInInt()       -> value.asInt()
        value.fitsInDouble()    -> value.asDouble()
        value.isString          -> value.asString()
        value.hasArrayElements() -> (0 until value.arraySize).map { convertValue(value.getArrayElement(it)) }
        value.hasMembers()      -> value.memberKeys.associateWith { convertValue(value.getMember(it)) }
        else                    -> value.toString()
    }

    /**
     * {$key} → __vars.get("key") 로 변환 후 Source 빌드.
     * IIFE로 감싸 독립 스코프 보장.
     */
    private fun buildSource(templateCode: String): Source {
        if (templateCode.isBlank())
            throw ScriptExecutionException("스크립트 코드가 비어 있습니다. 코드를 입력하거나 해당 규칙을 삭제하세요.")

        val transformed = PLACEHOLDER_REGEX.replace(templateCode) { match ->
            """__vars["${match.groupValues[1]}"]"""
        }
        val jsCode = "(function() { return ($transformed); })()"
        return try {
            Source.newBuilder("js", jsCode, "template").cached(true).build()
        } catch (e: Exception) {
            throw ScriptExecutionException("스크립트 컴파일 오류 — 생성된 코드: [$jsCode]\n원인: ${e.message}", e)
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
