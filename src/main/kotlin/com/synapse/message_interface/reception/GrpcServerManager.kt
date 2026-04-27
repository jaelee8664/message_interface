package com.synapse.message_interface.reception

import com.synapse.message_interface.config.ReferenceConfigService
import io.grpc.Server
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * gRPC 서버 생명주기 관리.
 *
 * ■ 단일 서버 정책
 *   모든 GRPC_SERVER 유닛은 application.yaml의 grpc.server.port 포트 하나를 공유한다.
 *   유닛마다 serviceName/methodName 을 다르게 설정해 서비스를 구분한다.
 *   단, 동일 serviceName 이 중복되면 gRPC 서버가 예외를 던진다.
 *
 * ■ 재시작 처리 (ReceptionManager.restartUnit 에서 호출)
 *   1. unregisterUnit() → 해당 유닛 제거
 *   2. registerUnit()   → 새 핸들러 등록
 *   3. rebuildServer()  → 서버를 stop → rebuild → start
 *   기존 연결된 클라이언트는 서버 GOAWAY 를 받고 재연결을 시도한다.
 *
 * ■ 최초 시작
 *   ReceptionManager @Order(2) ApplicationRunner 가 모든 유닛 핸들러를 등록한 뒤
 *   startAll() 을 호출한다.
 */
@Component
class GrpcServerManager(
    @Value("\${grpc.server.port:9090}") private val grpcPort: Int,
    private val referenceConfigService: ReferenceConfigService
) {
    private val log = LoggerFactory.getLogger(javaClass)

    private var server: Server? = null
    private val unitHandlers = ConcurrentHashMap<String, GrpcServerHandler>() // unitId → handler

    // ── 핸들러 등록 ───────────────────────────────────────────────────────────

    fun registerUnit(unitId: String, handler: GrpcServerHandler) {
        unitHandlers[unitId] = handler
    }

    fun unregisterUnit(unitId: String) {
        unitHandlers.remove(unitId)
    }

    /** 모니터링용: unitId → "serviceName/methodName" 매핑 반환 */
    fun getUnitInfo(): Map<String, String> =
        unitHandlers.mapValues { (_, h) -> "${h.serviceName}/${h.methodName}" }

    // ── 서버 시작 / 재빌드 / 정지 ────────────────────────────────────────────

    /** 애플리케이션 시작 시 등록된 모든 핸들러로 단일 gRPC 서버를 시작한다. */
    fun startAll() {
        if (unitHandlers.isEmpty()) return
        startServer(unitHandlers.values.toList())
    }

    /**
     * 유닛 재시작 후 서버를 다시 빌드한다.
     * 현재 서버를 먼저 종료하므로 짧은 재연결 공백이 발생한다.
     */
    fun rebuildServer() {
        stopServer()
        val handlers = unitHandlers.values.toList()
        if (handlers.isNotEmpty()) startServer(handlers)
        else log.info("[gRPC Server Manager] 등록된 서비스 없음, 서버 미시작")
    }

    fun stopAll() {
        stopServer()
    }

    // ── 내부 헬퍼 ─────────────────────────────────────────────────────────────

    private fun startServer(handlers: List<GrpcServerHandler>) {
        val builder = NettyServerBuilder.forPort(grpcPort)
            .maxInboundMessageSize(16 * 1024 * 1024) // 16 MB

        // keepAlive: 기준정보(reference_config.grpcServer)에서 전역 설정 적용
        @Suppress("UNCHECKED_CAST")
        val grpcServerCfg = referenceConfigService.getConfig()["grpcServer"] as? Map<String, Any?>
        val permitKeepAliveTime = (grpcServerCfg?.get("permitKeepAliveTime") as? Number)?.toLong() ?: 300L
        builder.permitKeepAliveTime(permitKeepAliveTime, TimeUnit.SECONDS)

        val keepAliveEnabled = grpcServerCfg?.get("keepAliveEnabled") as? Boolean ?: false
        if (keepAliveEnabled) {
            val interval = (grpcServerCfg?.get("keepAliveIntervalSeconds") as? Number)?.toLong() ?: 300L
            val timeout  = (grpcServerCfg?.get("keepAliveTimeoutSeconds")  as? Number)?.toLong() ?: 20L
            val permitWithoutCalls = grpcServerCfg?.get("permitKeepAliveWithoutCalls") as? Boolean ?: true
            builder
                .keepAliveTime(interval, TimeUnit.SECONDS)
                .keepAliveTimeout(timeout, TimeUnit.SECONDS)
                .permitKeepAliveWithoutCalls(permitWithoutCalls)
            log.info("[gRPC Server Manager] keepAlive 활성화: interval={}s, timeout={}s, permitWithoutCalls={}", interval, timeout, permitWithoutCalls)
        }
        log.info("[gRPC Server Manager] permitKeepAliveTime={}s", permitKeepAliveTime)

        handlers.forEach { handler ->
            try {
                builder.addService(handler.buildServiceDefinition())
                log.info(
                    "[gRPC Server Manager] 서비스 등록: {}/{}",
                    handler.serviceName, handler.methodName
                )
            } catch (e: Exception) {
                log.error(
                    "[gRPC Server Manager] 서비스 등록 실패 (unitId={}): {}",
                    handler.unit.id, e.message
                )
            }
        }

        try {
            server = builder.build().start()
            log.info(
                "[gRPC Server Manager] gRPC 서버 시작: port={}, 서비스={}개",
                grpcPort, handlers.size
            )
        } catch (e: Exception) {
            log.error("[gRPC Server Manager] gRPC 서버 시작 실패 (port={}): {}", grpcPort, e.message)
        }
    }

    private fun stopServer() {
        server?.let { s ->
            s.shutdown()
            try {
                if (!s.awaitTermination(5, TimeUnit.SECONDS)) {
                    s.shutdownNow()
                    s.awaitTermination(2, TimeUnit.SECONDS)
                }
            } catch (_: InterruptedException) {
                s.shutdownNow()
            }
            log.info("[gRPC Server Manager] gRPC 서버 종료: port={}", grpcPort)
            server = null
        }
    }
}
