package com.synapse.message_interface.engine

import org.junit.jupiter.api.Test

class FlatMessageAccessorBenchmarkTest {

    // 실제 메시지와 유사한 중첩 구조
    private fun buildSampleMessage(): Map<String, Any?> = mapOf(
        "header" to mapOf(
            "messageId" to "msg-001",
            "timestamp" to "2026-03-16T12:00:00Z",
            "source" to "system-a",
            "version" to 1
        ),
        "body" to mapOf(
            "orderId" to "ORD-9999",
            "status" to "PENDING",
            "amount" to 15000,
            "currency" to "KRW",
            "items" to listOf(
                mapOf("id" to "ITEM-1", "name" to "상품A", "qty" to 2, "price" to 5000),
                mapOf("id" to "ITEM-2", "name" to "상품B", "qty" to 1, "price" to 5000)
            ),
            "buyer" to mapOf(
                "id" to "USER-123",
                "name" to "홍길동",
                "address" to mapOf(
                    "city" to "서울",
                    "zip" to "04524"
                )
            )
        ),
        "meta" to mapOf(
            "retryCount" to 0,
            "tags" to listOf("urgent", "vip")
        )
    )

    @Test
    fun `1000 messages per second - flatten throughput`() {
        val message = buildSampleMessage()
        val targetPerSec = 1000
        val durationSec = 3

        // 워밍업 (JIT 최적화 유도)
        repeat(500) { FlatMessageAccessor.flatten(message) }

        // 측정
        val totalRuns = targetPerSec * durationSec
        val start = System.nanoTime()
        repeat(totalRuns) {
            FlatMessageAccessor.flatten(message).mapValues { it.value?.toString() }
        }
        val elapsedMs = (System.nanoTime() - start) / 1_000_000

        val budgetMs = durationSec * 1000L
        val avgUs = elapsedMs * 1000.0 / totalRuns
        val actualPerSec = totalRuns * 1000.0 / elapsedMs

        println("========================================")
        println("  대상 처리량   : ${targetPerSec}/초")
        println("  총 실행 횟수  : $totalRuns 회 (${durationSec}초 분량)")
        println("  실제 소요시간 : ${elapsedMs}ms (예산: ${budgetMs}ms)")
        println("  평균 처리시간 : ${"%.2f".format(avgUs)}μs/메시지")
        println("  실제 처리량   : ${"%.0f".format(actualPerSec)}/초")
        println("  결과          : ${if (elapsedMs <= budgetMs) "✅ 통과" else "❌ 초과 (${elapsedMs - budgetMs}ms 초과)"}")
        println("========================================")

        assert(elapsedMs <= budgetMs) {
            "flatten이 ${targetPerSec}/초를 처리하지 못함: ${elapsedMs}ms > ${budgetMs}ms"
        }
    }

    @Test
    fun `flatten - custom code rules N개일 때 누적 비용`() {
        val message = buildSampleMessage()
        val messagesPerSec = 1000
        val ruleCounts = listOf(1, 3, 5, 10)

        println("========================================")
        println("  커스텀 룰 수에 따른 flatten 누적 비용")
        println("  (메시지 ${messagesPerSec}개 × 룰 N번 flatten 기준)")
        println("----------------------------------------")

        // 워밍업
        repeat(500) { FlatMessageAccessor.flatten(message) }

        for (ruleCount in ruleCounts) {
            val totalRuns = messagesPerSec * ruleCount
            val start = System.nanoTime()
            repeat(totalRuns) {
                FlatMessageAccessor.flatten(message).mapValues { it.value?.toString() }
            }
            val elapsedMs = (System.nanoTime() - start) / 1_000_000
            println("  룰 ${"%2d".format(ruleCount)}개 : ${"%4d".format(elapsedMs)}ms / 초당 ${messagesPerSec}개")
        }
        println("========================================")
    }
}
