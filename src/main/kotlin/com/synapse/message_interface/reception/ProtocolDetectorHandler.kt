package com.synapse.message_interface.reception

import com.synapse.message_interface.engine.WorkflowDispatcher
import io.netty.buffer.ByteBuf
import io.netty.channel.ChannelHandlerContext
import io.netty.handler.codec.ByteToMessageDecoder
import io.netty.handler.codec.json.JsonObjectDecoder
import io.netty.handler.codec.xml.XmlFrameDecoder
import io.netty.handler.timeout.IdleStateHandler
import org.slf4j.LoggerFactory
import reactor.netty.NettyPipeline
import java.util.NoSuchElementException
import java.util.concurrent.TimeUnit

class ProtocolDetectorHandler(
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: TcpServerSessionRegistry? = null,
    private val idleTimeoutSeconds: Int = 0
) : ByteToMessageDecoder() {
    private val log = LoggerFactory.getLogger(javaClass)

    override fun decode(ctx: ChannelHandlerContext, buf: ByteBuf, out: MutableList<Any>) {
        if (buf.readableBytes() < 4) return

        val pipeline = ctx.pipeline()
        if (isHttp(buf)) {
            log.debug("[ProtocolDetector] HTTP 감지 → Spring 처리")
            pipeline.remove(this)
        } else {
            val format = detectFormat(buf)
            log.debug("[ProtocolDetector] raw TCP 감지 (format=$format) → TCP 핸들러로 전환")

            val tcpHandler = RawTcpInboundHandler(dispatcher, sessionRegistry)

            // IdleStateHandler는 raw TCP 연결에만 적용 (HTTP/WebSocket 제외)
            if (idleTimeoutSeconds > 0) {
                pipeline.addAfter(ctx.name(), "tcp-idle-state",
                    IdleStateHandler(idleTimeoutSeconds.toLong(), 0L, 0L, TimeUnit.SECONDS))
                val insertAfter = "tcp-idle-state"
                when (format) {
                    TcpFormat.JSON -> {
                        pipeline.addAfter(insertAfter, "json-frame-decoder", JsonObjectDecoder(MAX_FRAME_SIZE))
                        pipeline.addAfter("json-frame-decoder", "raw-tcp-inbound", tcpHandler)
                    }
                    TcpFormat.XML -> {
                        pipeline.addAfter(insertAfter, "xml-frame-decoder", XmlFrameDecoder(MAX_FRAME_SIZE))
                        pipeline.addAfter("xml-frame-decoder", "raw-tcp-inbound", tcpHandler)
                    }
                    TcpFormat.UNKNOWN -> {
                        pipeline.addAfter(insertAfter, "raw-tcp-inbound", tcpHandler)
                    }
                }
            } else {
                when (format) {
                    TcpFormat.JSON -> {
                        pipeline.addAfter(ctx.name(), "json-frame-decoder", JsonObjectDecoder(MAX_FRAME_SIZE))
                        pipeline.addAfter("json-frame-decoder", "raw-tcp-inbound", tcpHandler)
                    }
                    TcpFormat.XML -> {
                        pipeline.addAfter(ctx.name(), "xml-frame-decoder", XmlFrameDecoder(MAX_FRAME_SIZE))
                        pipeline.addAfter("xml-frame-decoder", "raw-tcp-inbound", tcpHandler)
                    }
                    TcpFormat.UNKNOWN -> {
                        pipeline.addAfter(ctx.name(), "raw-tcp-inbound", tcpHandler)
                    }
                }
            }

            listOf(NettyPipeline.HttpCodec, NettyPipeline.HttpTrafficHandler, NettyPipeline.ReactiveBridge).forEach { name ->
                try { pipeline.remove(name) } catch (_: NoSuchElementException) {}
            }

            // Reactor Netty HTTP 서버는 demand-driven(auto-read=false) 방식으로 동작한다.
            // raw TCP 연결에서는 지속적으로 데이터를 읽어야 하므로 auto-read를 활성화한다.
            ctx.channel().config().setAutoRead(true)

            // channelActive는 ProtocolDetector 추가 전에 이미 발화했으므로
            // RawTcpInboundHandler.channelActive()가 호출되지 않는다.
            // 이 시점(TCP 판별 완료, detector 제거 직전)에 세션을 등록한다 — 커넥션당 1회.
            val channelId = ctx.channel().id().asShortText()
            val remoteAddr = ctx.channel().remoteAddress()?.toString() ?: channelId
            log.info("[TCP Server] 클라이언트 연결: $remoteAddr (channelId=$channelId)")
            sessionRegistry?.register(channelId, ctx)

            pipeline.remove(this)
        }
    }

    private fun isHttp(buf: ByteBuf): Boolean {
        val bytes = ByteArray(minOf(8, buf.readableBytes()))
        buf.getBytes(buf.readerIndex(), bytes)
        val prefix = String(bytes, Charsets.US_ASCII)
        return HTTP_METHODS.any { prefix.startsWith(it) }
    }

    private fun detectFormat(buf: ByteBuf): TcpFormat {
        for (i in buf.readerIndex() until buf.readerIndex() + buf.readableBytes()) {
            return when (buf.getByte(i).toInt().toChar()) {
                '{', '[' -> TcpFormat.JSON
                '<'      -> TcpFormat.XML
                ' ', '\t', '\r', '\n' -> continue
                else -> TcpFormat.UNKNOWN
            }
        }
        return TcpFormat.UNKNOWN
    }

    enum class TcpFormat { JSON, XML, UNKNOWN }

    companion object {
        private val HTTP_METHODS = listOf("GET ", "POST", "PUT ", "DELE", "HEAD", "OPTI", "PATC", "TRAC", "CONN")
        private const val MAX_FRAME_SIZE = 10 * 1024 * 1024 // 10MB
    }
}
