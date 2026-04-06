package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.log.MessageTraceLogger
import com.synapse.message_interface.reception.TcpClientConnectionPool
import com.synapse.message_interface.reception.TcpServerSessionRegistry
import com.synapse.message_interface.reception.WebSocketClientRegistry
import com.synapse.message_interface.reception.WebSocketSessionRegistry
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.time.Instant

@RestController
@RequestMapping("/synapse/monitor")
class MonitoringController(
    private val tcpServerSessionRegistry: TcpServerSessionRegistry,
    private val webSocketSessionRegistry: WebSocketSessionRegistry,
    private val webSocketClientRegistry: WebSocketClientRegistry,
    private val tcpClientConnectionPool: TcpClientConnectionPool,
    private val traceLogger: MessageTraceLogger
) {

    @GetMapping("/status")
    fun getStatus(
        @RequestParam(defaultValue = "60") windowMinutes: Int
    ): ResponseEntity<ApiResponse<MonitorStatus>> {
        val tcpServerSessions = tcpServerSessionRegistry.getAll().map { (channelId, _) ->
            TcpServerSession(channelId, tcpServerSessionRegistry.getRemoteAddress(channelId))
        }
        val wsServerSessions = webSocketSessionRegistry.getAll().map { (unitId, isOpen) ->
            val remoteIp = webSocketSessionRegistry.getRemoteAddress(unitId) ?: unitId
            WsSession(unitId, remoteIp, isOpen)
        }
        val wsClientConnections = webSocketClientRegistry.getAll().map { (key, connected) ->
            ClientConnection(key, connected)
        }
        val tcpClientConnections = tcpClientConnectionPool.getAll().map { (key, connected) ->
            ClientConnection(key, connected)
        }

        val pipelineStats = traceLogger.getRecentStats(windowMinutes)
            .map { s ->
                UnitStatDto(
                    unitId = s.unitId,
                    unitName = s.unitName,
                    successCount = s.successCount,
                    errorCount = s.errorCount,
                    lastActivity = s.lastActivity?.toString()
                )
            }
            .sortedByDescending { it.successCount + it.errorCount }

        val status = MonitorStatus(
            windowMinutes = windowMinutes,
            connections = ConnectionStatus(
                tcpServer = tcpServerSessions,
                webSocketServer = wsServerSessions,
                webSocketClient = wsClientConnections,
                tcpClient = tcpClientConnections
            ),
            pipelineStats = pipelineStats,
            totalSuccess = pipelineStats.sumOf { it.successCount },
            totalError = pipelineStats.sumOf { it.errorCount },
            generatedAt = Instant.now().toString()
        )
        return ResponseEntity.ok(ApiResponse.ok(status))
    }
}

data class MonitorStatus(
    val windowMinutes: Int,
    val connections: ConnectionStatus,
    val pipelineStats: List<UnitStatDto>,
    val totalSuccess: Int,
    val totalError: Int,
    val generatedAt: String
)

data class ConnectionStatus(
    val tcpServer: List<TcpServerSession>,
    val webSocketServer: List<WsSession>,
    val webSocketClient: List<ClientConnection>,
    val tcpClient: List<ClientConnection>
)

data class TcpServerSession(val channelId: String, val remoteAddress: String?)
data class WsSession(val unitId: String, val unitName: String, val isOpen: Boolean)
data class ClientConnection(val key: String, val connected: Boolean)
data class UnitStatDto(
    val unitId: String,
    val unitName: String,
    val successCount: Int,
    val errorCount: Int,
    val lastActivity: String?
)
