package com.synapse.message_interface.reception

import com.synapse.message_interface.proto.MessageRequest
import io.grpc.stub.StreamObserver
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

@Component
class GrpcClientRegistry {
    // unitId → StreamObserver to send requests to the server
    private val requestObservers = ConcurrentHashMap<String, StreamObserver<MessageRequest>>()

    fun register(unitId: String, observer: StreamObserver<MessageRequest>) {
        requestObservers[unitId] = observer
    }

    fun remove(unitId: String) {
        requestObservers.remove(unitId)
    }

    fun send(unitId: String, request: MessageRequest) {
        val observer = requestObservers[unitId]
            ?: throw IllegalStateException("gRPC 스트림이 없습니다: $unitId")
        observer.onNext(request)
    }

    fun isConnected(unitId: String) = requestObservers.containsKey(unitId)
}
