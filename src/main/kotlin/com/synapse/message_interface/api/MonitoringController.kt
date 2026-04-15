package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.log.MessageTraceLogger
import com.synapse.message_interface.reception.GrpcClientRegistry
import com.synapse.message_interface.reception.GrpcServerManager
import com.synapse.message_interface.reception.GrpcSessionRegistry
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
    private val traceLogger: MessageTraceLogger,
    private val grpcSessionRegistry: GrpcSessionRegistry,
    private val grpcClientRegistry: GrpcClientRegistry,
    private val grpcServerManager: GrpcServerManager
) {

    @GetMapping("/status")
    fun getStatus(
        @RequestParam(defaultValue = "60") windowMinutes: Int
    ): ResponseEntity<ApiResponse<MonitorStatus>> {
        val tcpSessionActive = tcpServerSessionRegistry.getAll().mapValues { (_, ctx) -> ctx.channel().isActive }
        val tcpServerSessions = tcpServerSessionRegistry.getIpMap().map { (ip, channelIds) ->
            ServerSession(ip, channelIds.size, channelIds.all { tcpSessionActive[it] == true })
        }
        val wsSessionOpen = webSocketSessionRegistry.getAll()
        val wsServerSessions = webSocketSessionRegistry.getIpMap().map { (ip, sessionIds) ->
            ServerSession(ip, sessionIds.size, sessionIds.all { wsSessionOpen[it] == true })
        }
        val wsClientConnections = webSocketClientRegistry.getAll().map { (key, connected) ->
            ClientConnection(key, connected)
        }
        val tcpClientConnections = tcpClientConnectionPool.getAll().map { (key, connected) ->
            ClientConnection(key, connected)
        }

        val grpcUnitInfo = grpcServerManager.getUnitInfo()
        val grpcServerSessions = grpcSessionRegistry.getAllUnits().map { (unitId, count) ->
            GrpcServerSession(
                key = grpcUnitInfo[unitId] ?: unitId,
                streamCount = count
            )
        }
        val grpcClientConnections = grpcClientRegistry.getStatus().map { (key, connected) ->
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
                tcpClient = tcpClientConnections,
                grpcServer = grpcServerSessions,
                grpcClient = grpcClientConnections
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
    val totalSuccess: Long,
    val totalError: Long,
    val generatedAt: String
)

data class ConnectionStatus(
    val tcpServer: List<ServerSession>,
    val webSocketServer: List<ServerSession>,
    val webSocketClient: List<ClientConnection>,
    val tcpClient: List<ClientConnection>,
    val grpcServer: List<GrpcServerSession>,
    val grpcClient: List<ClientConnection>
)

/** TCP/WebSocket 서버에 접속한 클라이언트 1개 IP 기준 집계 */
data class ServerSession(val clientIp: String, val sessionCount: Int, val allActive: Boolean)
data class ClientConnection(val key: String, val connected: Boolean)

/** gRPC 서버 서비스 기준 활성 스트림 집계 */
data class GrpcServerSession(val key: String, val streamCount: Int)
data class UnitStatDto(
    val unitId: String,
    val unitName: String,
    val successCount: Long,
    val errorCount: Long,
    val lastActivity: String?
)
