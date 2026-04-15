package com.synapse.message_interface.reception

import com.google.protobuf.DynamicMessage
import io.grpc.stub.StreamObserver
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/**
 * GRPC_SERVER Node0 전용: 서버 측 bidi stream 세션 레지스트리.
 *
 * ■ 구조
 *   unitId → (streamId → responseObserver)
 *   unitId → (remoteIp → Set<streamId>)  ← IP 기반 전송을 위한 보조 인덱스
 *
 * ■ 생명주기
 *   - 클라이언트 연결 시: register()
 *   - 클라이언트 정상 종료(onCompleted) 또는 오류(onError): remove()
 *   - 유닛 재시작 시: closeAllForUnit() — 서버가 모든 스트림을 onCompleted 로 닫는다
 *
 * ■ 교차 오염 방지
 *   remove(unitId, streamId) 는 정확히 해당 entry만 제거한다.
 */
@Component
class GrpcSessionRegistry {
    private val log = LoggerFactory.getLogger(javaClass)

    // unitId → ConcurrentHashMap<streamId, responseObserver>
    private val sessions = ConcurrentHashMap<String, ConcurrentHashMap<String, StreamObserver<DynamicMessage>>>()

    // unitId → (remoteIp → MutableSet<streamId>) — IP 기반 전송용 보조 인덱스
    private val ipIndex = ConcurrentHashMap<String, ConcurrentHashMap<String, MutableSet<String>>>()

    fun register(unitId: String, streamId: String, observer: StreamObserver<DynamicMessage>, remoteIp: String = "unknown") {
        sessions.getOrPut(unitId) { ConcurrentHashMap() }[streamId] = observer
        ipIndex.getOrPut(unitId) { ConcurrentHashMap() }
            .getOrPut(remoteIp) { ConcurrentHashMap.newKeySet() }
            .add(streamId)
        log.debug("[gRPC Session] 등록: unitId={}, streamId={}, remoteIp={}", unitId, streamId, remoteIp)
    }

    fun remove(unitId: String, streamId: String) {
        sessions[unitId]?.remove(streamId)
        ipIndex[unitId]?.forEach { (_, streamIds) -> streamIds.remove(streamId) }
        log.debug("[gRPC Session] 제거: unitId={}, streamId={}", unitId, streamId)
    }

    /**
     * context.metadata["grpcStreamId"] 기준으로 응답 메시지를 전송한다.
     * Node4 GRPC_SERVER 에서 호출.
     */
    fun send(unitId: String, streamId: String, message: DynamicMessage) {
        val obs = sessions[unitId]?.get(streamId)
            ?: throw IllegalStateException("gRPC 스트림 없음: unitId=$unitId, streamId=$streamId")
        obs.onNext(message)
    }

    /**
     * 특정 IP에서 연결된 모든 스트림에 메시지를 전송한다.
     * Node4 GRPC_SERVER 에서 targetPath(IP)가 설정된 경우 호출.
     * 전송 실패한 개별 스트림은 로그만 남기고 계속 진행한다.
     */
    fun sendByIp(unitId: String, remoteIp: String, message: DynamicMessage) {
        val streamIds = ipIndex[unitId]?.get(remoteIp)?.toSet()
        if (streamIds.isNullOrEmpty())
            throw IllegalStateException("gRPC 스트림 없음 (IP): unitId=$unitId, remoteIp=$remoteIp")
        streamIds.forEach { streamId ->
            val obs = sessions[unitId]?.get(streamId)
            if (obs != null) {
                try { obs.onNext(message) }
                catch (e: Exception) {
                    log.warn("[gRPC Session] IP 기반 전송 실패: streamId={}, err={}", streamId, e.message)
                }
            }
        }
    }

    /**
     * 유닛 재시작 시 해당 유닛의 모든 열린 스트림을 정상 종료 후 레지스트리에서 제거.
     * 클라이언트는 onCompleted 를 받고 재연결을 시도한다.
     */
    fun closeAllForUnit(unitId: String) {
        ipIndex.remove(unitId)
        val unitSessions = sessions.remove(unitId) ?: return
        unitSessions.forEach { (streamId, obs) ->
            try {
                obs.onCompleted()
                log.debug("[gRPC Session] 스트림 종료 (유닛 재시작): streamId={}", streamId)
            } catch (e: Exception) {
                log.warn("[gRPC Session] 스트림 종료 실패 (무시): streamId={}, err={}", streamId, e.message)
            }
        }
        log.info("[gRPC Session] 유닛 세션 전체 종료: unitId={}, 종료 수={}", unitId, unitSessions.size)
    }

    fun activeCount(unitId: String): Int = sessions[unitId]?.size ?: 0

    fun getAllUnits(): Map<String, Int> = sessions.mapValues { (_, m) -> m.size }
}
