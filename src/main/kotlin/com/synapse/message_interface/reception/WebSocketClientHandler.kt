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
import java.net.URI

class WebSocketClientHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val clientRegistry: WebSocketClientRegistry
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val connKey = "${definition.host}:${definition.port}${definition.path ?: "/"}"
    private val uri = URI("ws://${definition.host}:${definition.port}${definition.path ?: "/"}")
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun start() {
        scope.launch {
            try {
                clientRegistry.getOrConnect(
                    key = connKey,
                    uri = uri,
                    reconnectDelaySeconds = definition.reconnectDelaySeconds,
                    pingEnabled = definition.pingEnabled,
                    pingIntervalSeconds = definition.pingIntervalSeconds,
                    pongTimeoutSeconds = definition.pongTimeoutSeconds,
                    onMessage = { payload ->
                        val ctx = MessageContext(
                            rawBytes = payload,
                            endpoint = definition.path ?: "/",
                            protocol = "WEBSOCKET_CLIENT"
                        )
                        dispatcher.dispatch(ctx)
                    },
                    retryOnFirstFailure = true
                )
                log.info("[WebSocket Client] 연결 완료: unitId=${unit.id}, key=$connKey")
            } catch (e: Exception) {
                log.error("[WebSocket Client] 연결 실패: unitId=${unit.id}, ${e.message}")
            }
        }
    }

    fun stop() {
        clientRegistry.remove(connKey)
        scope.cancel()
    }
}
