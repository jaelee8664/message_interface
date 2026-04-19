package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

class TcpClientHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val connectionPool: TcpClientConnectionPool
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val connKey = "${definition.host ?: "localhost"}:${definition.port ?: 9091}"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun start() {
        scope.launch {
            try {
                connectionPool.getOrConnect(
                    key = connKey,
                    host = definition.host ?: "localhost",
                    port = definition.port ?: 9091,
                    reconnectDelaySeconds = definition.reconnectDelaySeconds,
                    onMessage = { payload ->
                        val ctx = MessageContext(rawBytes = payload, protocol = "TCP_CLIENT")
                        dispatcher.dispatch(ctx)
                    }
                )
                log.info("[TCP Client] 연결 완료: unitId=${unit.id}, key=$connKey")
            } catch (e: Exception) {
                log.error("[TCP Client] 연결 실패: unitId=${unit.id}, ${e.message}")
            }
        }
    }

    fun stop() {
        connectionPool.remove(connKey)
        scope.cancel()
    }
}
