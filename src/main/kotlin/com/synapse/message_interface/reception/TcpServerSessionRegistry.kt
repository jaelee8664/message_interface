package com.synapse.message_interface.reception

import io.netty.buffer.Unpooled
import io.netty.channel.ChannelHandlerContext
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/**
 * TCP Server 수신 채널 세션 관리.
 * Node4 TCP_SERVER 송신 시 channelId를 키로 특정 클라이언트에게 데이터를 전송할 수 있다.
 */
@Component
class TcpServerSessionRegistry {
    private val sessions = ConcurrentHashMap<String, ChannelHandlerContext>()

    fun register(channelId: String, ctx: ChannelHandlerContext) {
        sessions[channelId] = ctx
    }

    fun remove(channelId: String) {
        sessions.remove(channelId)
    }

    fun send(channelId: String, data: ByteArray) {
        val ctx = sessions[channelId] ?: throw IllegalStateException("TCP Server 세션 없음: channelId=$channelId")
        ctx.writeAndFlush(Unpooled.wrappedBuffer(data))
    }

    fun getAll(): Map<String, ChannelHandlerContext> = sessions.toMap()

    fun isActive(channelId: String) = sessions[channelId]?.channel()?.isActive == true

    /** Returns the remote address of the connected client, e.g. "/192.168.0.10:54321". */
    fun getRemoteAddress(channelId: String): String? =
        sessions[channelId]?.channel()?.remoteAddress()?.toString()

    fun closeAll() {
        sessions.values.forEach { ctx -> ctx.close() }
    }
}
