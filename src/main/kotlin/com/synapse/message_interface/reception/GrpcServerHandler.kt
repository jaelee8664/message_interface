package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.proto.MessageInterfaceServiceGrpc
import com.synapse.message_interface.proto.MessageRequest
import com.synapse.message_interface.proto.MessageResponse
import io.grpc.stub.StreamObserver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory
import org.springframework.grpc.server.service.GrpcService

@GrpcService
class GrpcServerHandler(
    private val dispatcher: WorkflowDispatcher
) : MessageInterfaceServiceGrpc.MessageInterfaceServiceImplBase() {

    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(Dispatchers.IO)

    /**
     * Unary RPC: Process a single message request and return a single response.
     * Used when Node0 gRPC server is in non-bidirectional mode.
     */
    override fun process(request: MessageRequest, responseObserver: StreamObserver<MessageResponse>) {
        scope.launch {
            val response = try {
                val ctx = MessageContext(
                    rawBytes = request.payload.toByteArray(),
                    protocol = "GRPC_SERVER",
                    traceId = request.traceId.ifEmpty { java.util.UUID.randomUUID().toString() }
                )
                val format = parseFormat(request.format)
                val result = dispatcher.dispatch(ctx, format)
                val builder = MessageResponse.newBuilder()
                    .setPayload(com.google.protobuf.ByteString.copyFrom(result.body ?: ByteArray(0)))
                    .setSuccess(result.isSuccess)
                    .setTraceId(ctx.traceId)
                if (!result.isSuccess) builder.setError("처리 오류 (HTTP ${result.httpStatus})")
                builder.build()
            } catch (e: Exception) {
                log.error("[gRPC Server] 처리 오류: ${e.message}", e)
                MessageResponse.newBuilder()
                    .setSuccess(false)
                    .setError(e.message ?: "알 수 없는 오류")
                    .build()
            }
            responseObserver.onNext(response)
            responseObserver.onCompleted()
        }
    }

    /**
     * Bidirectional Streaming RPC: Each received message is dispatched through the pipeline.
     * Used when Node0 gRPC server has bidirectional=true.
     */
    override fun processStream(responseObserver: StreamObserver<MessageResponse>): StreamObserver<MessageRequest> {
        log.info("[gRPC Server] Bidirectional streaming 연결 시작")

        return object : StreamObserver<MessageRequest> {
            override fun onNext(request: MessageRequest) {
                scope.launch {
                    try {
                        val ctx = MessageContext(
                            rawBytes = request.payload.toByteArray(),
                            protocol = "GRPC_SERVER_BIDI",
                            traceId = request.traceId.ifEmpty { java.util.UUID.randomUUID().toString() }
                        )
                        val format = parseFormat(request.format)
                        val result = dispatcher.dispatch(ctx, format)
                        val builder = MessageResponse.newBuilder()
                            .setPayload(com.google.protobuf.ByteString.copyFrom(result.body ?: ByteArray(0)))
                            .setSuccess(result.isSuccess)
                            .setTraceId(ctx.traceId)
                        if (!result.isSuccess) builder.setError("처리 오류 (HTTP ${result.httpStatus})")
                        synchronized(responseObserver) {
                            responseObserver.onNext(builder.build())
                        }
                    } catch (e: Exception) {
                        log.error("[gRPC Server Bidi] 처리 오류: ${e.message}", e)
                        val errorResponse = MessageResponse.newBuilder()
                            .setSuccess(false)
                            .setError(e.message ?: "알 수 없는 오류")
                            .build()
                        synchronized(responseObserver) {
                            responseObserver.onNext(errorResponse)
                        }
                    }
                }
            }

            override fun onError(t: Throwable) {
                log.error("[gRPC Server Bidi] 스트림 오류: ${t.message}", t)
            }

            override fun onCompleted() {
                log.info("[gRPC Server Bidi] 스트림 종료")
                responseObserver.onCompleted()
            }
        }
    }

    private fun parseFormat(formatStr: String): MessageFormat = when (formatStr.uppercase()) {
        "XML" -> MessageFormat.XML
        "PROTOBUF" -> MessageFormat.PROTOBUF
        else -> MessageFormat.JSON
    }
}
