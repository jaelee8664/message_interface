package com.synapse.message_interface.engine

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class FlatMessageAccessorGetTest {

    private val map: Map<String, Any?> = mapOf(
        "header" to mapOf(
            "id" to "msg-001",
            "version" to 1
        ),
        "body" to mapOf(
            "status" to "PENDING",
            "amount" to 15000,
            "nullField" to null,
            "items" to listOf(
                mapOf("id" to "ITEM-1", "qty" to 2),
                mapOf("id" to "ITEM-2", "qty" to 1)
            ),
            "buyer" to mapOf(
                "name" to "홍길동",
                "address" to mapOf("city" to "서울")
            )
        ),
        "meta" to mapOf(
            "tags" to listOf("urgent", "vip")
        )
    )

    // ── 정상 케이스 ──────────────────────────────────────────

    @Test
    fun `단순 중첩 키 접근`() {
        assertEquals("msg-001", FlatMessageAccessor.get(map, "header.id"))
        assertEquals(1, FlatMessageAccessor.get(map, "header.version"))
        assertEquals("PENDING", FlatMessageAccessor.get(map, "body.status"))
    }

    @Test
    fun `3단계 이상 중첩 접근`() {
        assertEquals("서울", FlatMessageAccessor.get(map, "body.buyer.address.city"))
    }

    @Test
    fun `리스트 인덱스 접근`() {
        assertEquals("ITEM-1", FlatMessageAccessor.get(map, "body.items[0].id"))
        assertEquals("ITEM-2", FlatMessageAccessor.get(map, "body.items[1].id"))
        assertEquals(1, FlatMessageAccessor.get(map, "body.items[1].qty"))
    }

    @Test
    fun `문자열 리스트 인덱스 접근`() {
        assertEquals("urgent", FlatMessageAccessor.get(map, "meta.tags[0]"))
        assertEquals("vip", FlatMessageAccessor.get(map, "meta.tags[1]"))
    }

    @Test
    fun `null 값 필드는 null 반환`() {
        assertNull(FlatMessageAccessor.get(map, "body.nullField"))
    }

    @Test
    fun `존재하지 않는 키는 null 반환`() {
        assertNull(FlatMessageAccessor.get(map, "header.nonexistent"))
        assertNull(FlatMessageAccessor.get(map, "body.items[0].nonexistent"))
        assertNull(FlatMessageAccessor.get(map, "nonexistent"))
    }

    // ── 예외 케이스 ──────────────────────────────────────────

    @Test
    fun `인덱스 범위 초과시 IndexOutOfBoundsException`() {
        val ex = assertThrows<IndexOutOfBoundsException> {
            FlatMessageAccessor.get(map, "body.items[5].id")
        }
        assertTrue("5" in ex.message!!)
        assertTrue("items" in ex.message!!)
    }

    @Test
    fun `리스트가 아닌 필드에 인덱스 접근시 IllegalStateException`() {
        val ex = assertThrows<IllegalStateException> {
            FlatMessageAccessor.get(map, "body.status[0]")
        }
        assertTrue("status" in ex.message!!)
    }

    @Test
    fun `스칼라 값 아래 키 탐색시 IllegalStateException`() {
        val ex = assertThrows<IllegalStateException> {
            FlatMessageAccessor.get(map, "body.amount.sub")
        }
        assertTrue("sub" in ex.message!!)
    }

    @Test
    fun `빈 키는 IllegalArgumentException`() {
        assertThrows<IllegalArgumentException> {
            FlatMessageAccessor.get(map, "")
        }
    }

    @Test
    fun `점 연속 사용시 IllegalArgumentException`() {
        assertThrows<IllegalArgumentException> {
            FlatMessageAccessor.get(map, "body..status")
        }
    }

    @Test
    fun `잘못된 인덱스 표기시 IllegalArgumentException`() {
        assertThrows<IllegalArgumentException> {
            FlatMessageAccessor.get(map, "body.items[abc]")
        }
    }
}
