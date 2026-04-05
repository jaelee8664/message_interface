package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import io.netty.buffer.ByteBuf
import io.netty.buffer.Unpooled
import io.netty.channel.ChannelHandlerContext
import io.netty.channel.ChannelInboundHandlerAdapter
import io.netty.handler.timeout.IdleStateEvent
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import reactor.core.scheduler.Schedulers

class RawTcpInboundHandler(
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: TcpServerSessionRegistry? = null
) : ChannelInboundHandlerAdapter() {
    private val log = LoggerFactory.getLogger(javaClass)

    override fun channelInactive(ctx: ChannelHandlerContext) {
        val channelId = ctx.channel().id().asShortText()
        log.info("[TCP Server] 클라이언트 연결 해제: channelId=$channelId")
        sessionRegistry?.remove(channelId)
        ctx.fireChannelInactive()
    }

    override fun channelRead(ctx: ChannelHandlerContext, msg: Any) {
        if (msg !is ByteBuf) { ctx.fireChannelRead(msg); return }
        val bytes = ByteArray(msg.readableBytes()).also { msg.readBytes(it) }
        msg.release()

        val format = if (bytes.isNotEmpty() && bytes[0] == '<'.code.toByte()) MessageFormat.XML else MessageFormat.JSON
        log.debug("[TCP Server] 수신: ${bytes.size} bytes (format=$format)")

        val channelId = ctx.channel().id().asShortText()
        mono {
            val context = MessageContext(
                rawBytes = bytes,
                protocol = "TCP_SERVER",
                metadata = mapOf("channelId" to channelId)
            )
            dispatcher.dispatch(context, format)
        }
        .subscribeOn(Schedulers.boundedElastic())
        .subscribe(
            { _ -> },
            { e -> log.error("[TCP Server] 처리 오류: ${e.message}", e) }
        )
    }

    override fun userEventTriggered(ctx: ChannelHandlerContext, evt: Any) {
        if (evt is IdleStateEvent) {
            val remoteAddr = ctx.channel().remoteAddress()?.toString() ?: "unknown"
            log.warn("[TCP Server] 수신 없음 (IdleStateEvent), 좀비 연결 감지, 강제 종료: $remoteAddr")
            ctx.close()
        } else {
            ctx.fireUserEventTriggered(evt)
        }
    }

    override fun exceptionCaught(ctx: ChannelHandlerContext, cause: Throwable) {
        log.error("[TCP Server] 채널 오류: ${cause.message}", cause)
        ctx.close()
    }
}
