package com.synapse.message_interface.simulator

import org.springframework.data.annotation.Id
import org.springframework.data.mongodb.core.mapping.Document
import java.time.Instant

/**
 * 워크플로우 유닛별 단일 테스트 메세지 저장.
 * unitId를 _id로 사용 → 유닛당 1개, 테스트할 때마다 덮어쓰기.
 * collection: simulator_unit_messages
 */
@Document(collection = "simulator_unit_messages")
data class SimulatorUnitMessage(
    @Id val unitId: String,
    val message: String,
    val format: String,
    val endpoint: String?,
    val protocol: String?,
    val metadata: Map<String, String>,
    val node4Overrides: Map<String, Node4Override>,
    val savedAt: Instant = Instant.now()
)
