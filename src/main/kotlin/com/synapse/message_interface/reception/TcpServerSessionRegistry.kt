package com.synapse.message_interface.reception

import io.netty.buffer.Unpooled
import io.netty.channel.ChannelHandlerContext
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap

/**
 * TCP Server 수신 채널 세션 관리.
 * - channelId → ChannelHandlerContext (다수의 클라이언트 동시 연결 지원)
 * - clientIp  → Set<channelId> (같은 IP의 복수 세션 모두 추적 — IP 기반 라우팅용)
 */
@Component
class TcpServerSessionRegistry {
    private val log = LoggerFactory.getLogger(javaClass)

    private val sessions = ConcurrentHashMap<String, ChannelHandlerContext>()

    // clientIp → Set<channelId>
    private val ipToChannelIds = ConcurrentHashMap<String, MutableSet<String>>()

    fun register(channelId: String, ctx: ChannelHandlerContext) {
        val clientIp = (ctx.channel().remoteAddress() as? InetSocketAddress)?.address?.hostAddress

        sessions[channelId] = ctx
        if (clientIp != null) {
            ipToChannelIds.computeIfAbsent(clientIp) { ConcurrentHashMap.newKeySet() }.add(channelId)
        }
        log.info("[TCP Server] 세션 등록: channelId=$channelId, ip=$clientIp, 현재 연결 수=${sessions.size}")
    }

    fun remove(channelId: String) {
        val ctx = sessions.remove(channelId) ?: return
        val clientIp = (ctx.channel().remoteAddress() as? InetSocketAddress)?.address?.hostAddress
        if (clientIp != null) {
            ipToChannelIds[clientIp]?.let { set ->
                set.remove(channelId)
                if (set.isEmpty()) ipToChannelIds.remove(clientIp)
            }
        }
        log.info("[TCP Server] 세션 제거: channelId=$channelId, ip=$clientIp, 현재 연결 수=${sessions.size}")
    }

    fun send(channelId: String, data: ByteArray) {
        val ctx = sessions[channelId]
            ?: throw IllegalStateException("TCP Server 세션 없음: channelId=$channelId")
        ctx.writeAndFlush(Unpooled.wrappedBuffer(data))
    }

    /**
     * IP 주소로 해당 클라이언트의 모든 채널에 송신한다.
     * 동일 IP 복수 세션이 있으면 전부 전송한다.
     * 개별 채널 송신 실패는 경고 로그 후 무시한다.
     */
    fun sendByIp(ip: String, data: ByteArray) {
        val channelIds = ipToChannelIds[ip]
        if (channelIds.isNullOrEmpty()) throw IllegalStateException("IP에 해당하는 세션 없음: ip=$ip")
        for (channelId in channelIds) {
            try {
                send(channelId, data)
            } catch (e: Exception) {
                log.warn("[TCP Server] 채널 송신 실패 무시 (channelId=$channelId): ${e.message}")
            }
        }
    }

    /** 모니터링용: channelId → ChannelHandlerContext */
    fun getAll(): Map<String, ChannelHandlerContext> = sessions.toMap()

    /** 모니터링용: ip → Set<channelId> */
    fun getIpMap(): Map<String, Set<String>> = ipToChannelIds.toMap()

    fun isActive(channelId: String) = sessions[channelId]?.channel()?.isActive == true

    fun closeAll() {
        sessions.values.forEach { ctx -> ctx.close() }
    }
}
