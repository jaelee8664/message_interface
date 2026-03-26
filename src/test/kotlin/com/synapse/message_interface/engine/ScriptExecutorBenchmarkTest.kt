package com.synapse.message_interface.engine

import com.synapse.message_interface.script.JavaScriptExecutor
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Test

class ScriptExecutorBenchmarkTest {

    private val executor = JavaScriptExecutor()

    // JS 문법으로 작성된 템플릿
    private val simpleTemplate    = """{${'$'}body.status} === "PENDING" ? "OK" : "SKIP""""
    private val calcTemplate      = """{${'$'}body.amount} * 2"""
    private val stringOpsTemplate = """{${'$'}body.user.name}.toUpperCase() + "_VIP""""

    private fun buildVars(status: String = "PENDING", amount: Int = 15000, name: String = "홍길동"): Map<String, Any?> = mapOf(
        "body.status"    to status,
        "body.amount"    to amount,
        "body.user.name" to name
    )

    @Test
    fun `compile cache - first vs subsequent`() = runBlocking {
        val vars = buildVars()

        println("========================================")
        println("  GraalVM JS - 캐시 효과 측정")
        println("----------------------------------------")

        val firstMs = run {
            val start = System.nanoTime()
            executor.executeTemplate(simpleTemplate, vars, timeoutMs = 30_000L)
            (System.nanoTime() - start) / 1_000_000
        }
        println("  첫 번째 실행 : ${firstMs}ms  ← JIT 워밍업 포함")

        val times = (1..5).map {
            val start = System.nanoTime()
            executor.executeTemplate(simpleTemplate, vars)
            (System.nanoTime() - start) / 1_000_000
        }
        println("  이후 실행    : ${times.joinToString("ms, ")}ms")
        println("  캐시 효과    : ${firstMs}ms → 평균 ${"%.1f".format(times.average())}ms")
        println("========================================")
    }

    @Test
    fun `sequential throughput - after cache warmed`() = runBlocking {
        val vars = buildVars()
        val templates = listOf(
            "단순 조건문"  to simpleTemplate,
            "숫자 계산"    to calcTemplate,
            "문자열 연산"  to stringOpsTemplate
        )

        // 캐시 워밍 + JIT 워밍업
        repeat(20) { templates.forEach { (_, t) -> executor.executeTemplate(t, vars) } }

        println("========================================")
        println("  GraalVM JS - 캐시 워밍 후 순차 처리 (1000회)")
        println("----------------------------------------")

        for ((label, template) in templates) {
            val start = System.nanoTime()
            repeat(1000) { executor.executeTemplate(template, vars) }
            val elapsedMs = (System.nanoTime() - start) / 1_000_000
            val avgMs     = elapsedMs / 1000.0
            val perSec    = if (avgMs > 0) (1000.0 / avgMs).toInt() else Int.MAX_VALUE

            println("  [$label]")
            println("  1000회 소요  : ${elapsedMs}ms")
            println("  평균/1건     : ${"%.3f".format(avgMs)}ms")
            println("  예상 처리량  : ~${perSec}/초")
            println("  1000/초 가능 : ${if (perSec >= 1000) "✅" else "❌ (약 ${perSec}/초 한계)"}")
            println("----------------------------------------")
        }
        println("========================================")
    }

    @Test
    fun `vars change but code stays same - jit accumulation`() = runBlocking {
        // JIT 워밍업
        repeat(50) { executor.executeTemplate(simpleTemplate, buildVars()) }

        println("========================================")
        println("  GraalVM JS - 값 변경 시 JIT 누적 효과")
        println("----------------------------------------")

        val start = System.nanoTime()
        repeat(1000) { i ->
            executor.executeTemplate(simpleTemplate, buildVars(status = "STATUS_$i", amount = i * 100))
        }
        val elapsedMs = (System.nanoTime() - start) / 1_000_000
        val perSec = (1000 * 1000.0 / elapsedMs).toInt()

        println("  1000회 (값 매번 다름) : ${elapsedMs}ms")
        println("  평균/1건              : ${"%.3f".format(elapsedMs / 1000.0)}ms")
        println("  예상 처리량           : ~${perSec}/초")
        println("  1000/초 가능          : ${if (perSec >= 1000) "✅" else "❌ (약 ${perSec}/초 한계)"}")
        println("========================================")
    }
}
